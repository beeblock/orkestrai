<script lang="ts">
  /**
   * Notificador global de atualizacoes do app desktop (Electron).
   * O download e automatico e em background; quando termina, pergunta se
   * reinicia para instalar. Em erro (ex.: mac sem assinatura de codigo),
   * oferece o download manual na pagina de releases.
   */
  import { onMount } from 'svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Progress } from '$lib/components/ui/progress';
  import { Download, ExternalLink, RotateCw } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';

  const RELEASES_URL = 'https://github.com/beeblock/orkestrai/releases/latest';

  type UpdatePayload =
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'available'; version: string }
    | { status: 'manual'; version: string }
    | { status: 'downloading'; percent: number }
    | { status: 'downloaded'; version: string }
    | { status: 'none' }
    | { status: 'check-error'; message: string }
    | { status: 'error'; message: string };

  type DesktopBridge = {
    onUpdate?: (callback: (payload: UpdatePayload) => void) => () => void;
    updateState?: () => Promise<UpdatePayload>;
    installUpdate?: () => Promise<void>;
    openExternal?: (url: string) => Promise<void>;
  };

  let status = $state<UpdatePayload['status'] | null>(null);
  let version = $state('');
  let percent = $state(0);
  let dialogOpen = $state(false);
  let failed = $state(false);
  let plannedManualUpdate = $state(false);

  onMount(() => {
    const desktop = (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
    if (!desktop?.onUpdate) return;
    let active = true;
    const apply = (payload: UpdatePayload) => {
      status = payload.status;
      if (payload.status === 'available') version = payload.version;
      if (payload.status === 'downloading') percent = payload.percent;
      if (payload.status === 'downloaded') {
        version = payload.version;
        failed = false;
        plannedManualUpdate = false;
        dialogOpen = true;
      }
      if (payload.status === 'manual') {
        version = payload.version;
        failed = false;
        plannedManualUpdate = true;
        dialogOpen = true;
      }
      if (payload.status === 'error') {
        // Falha na troca automatica: oferece download manual em vez de insistir.
        failed = true;
        plannedManualUpdate = false;
        dialogOpen = true;
      }
    };
    const unsubscribe = desktop.onUpdate(apply);
    void desktop.updateState?.().then((payload) => {
      if (active) apply(payload);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  });

  function install() {
    dialogOpen = false;
    const desktop = (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
    void desktop?.installUpdate?.();
  }

  function downloadManually() {
    dialogOpen = false;
    const desktop = (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;
    void desktop?.openExternal?.(RELEASES_URL);
  }
</script>

{#if status === 'downloading'}
  <!-- Pilula flutuante; quando ha toasts no canto, desliza para o lado deles. -->
  <div class="update-progress" role="status">
    <span class="update-progress-head">
      <Download size={13} class="update-progress-icon" aria-hidden="true" />
      <span class="update-progress-label">{m['update.downloading']({ percent })}</span>
    </span>
    <Progress value={percent} max={100} class="update-progress-bar" aria-label={m['update.downloading']({ percent })} />
  </div>
{/if}

<AlertDialog.Root bind:open={dialogOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{failed || plannedManualUpdate ? m['update.manual_title']() : m['update.ready_title']()}</AlertDialog.Title>
      <AlertDialog.Description>
        {#if plannedManualUpdate}
          {m['update.manual_unsigned_desc']({ version })}
        {:else if failed}
          {m['update.manual_desc']()}
        {:else}
          {m['update.ready_desc']({ version })}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['update.later']()}</AlertDialog.Cancel>
      {#if failed || plannedManualUpdate}
        <Button onclick={downloadManually}><ExternalLink aria-hidden="true" />{m['update.download_site']()}</Button>
      {:else}
        <Button onclick={install}><RotateCw aria-hidden="true" />{m['update.restart']()}</Button>
      {/if}
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .update-progress {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 232px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-panel);
    animation: update-in var(--duration-slow) var(--ease-smooth-out) both;
    transition: translate var(--duration-medium) var(--ease-smooth-out);
  }

  /* Toasts ocupam o mesmo canto (coluna de 400px): a pilula abre espaco ao lado. */
  :global(body:has(.orkestrai-toaster > [role='alert'])) .update-progress {
    translate: calc(-400px - 8px) 0;
  }

  @media (max-width: 720px) {
    :global(body:has(.orkestrai-toaster > [role='alert'])) .update-progress {
      translate: 0 calc(-100% - 88px);
    }
  }

  @keyframes update-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-base));
    }
  }

  .update-progress-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .update-progress :global(.update-progress-icon) {
    flex-shrink: 0;
    color: var(--app-accent);
  }

  .update-progress-label {
    font-size: 12px;
    color: var(--app-text-soft);
    font-variant-numeric: tabular-nums;
  }

  .update-progress :global(.update-progress-bar) {
    height: 4px;
    background: var(--app-hover);
  }

  .update-progress :global(.update-progress-bar [data-slot='progress-indicator']) {
    background: var(--app-accent);
  }

  @media (prefers-reduced-motion: reduce) {
    .update-progress {
      animation: none;
      transition: none;
    }
  }
</style>
