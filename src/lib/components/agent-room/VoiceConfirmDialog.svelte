<script lang="ts">
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Progress } from '$lib/components/ui/progress';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { getAppSettings, invalidateAppSettings } from './app-settings.svelte.js';
  import * as m from '$lib/paraglide/messages.js';
  import { CircleAlert, Download, HardDrive, LoaderCircle, RotateCcw } from '@lucide/svelte';

  type Props = {
    open: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  };

  let { open = $bindable(false), onConfirm, onCancel }: Props = $props();

  type Phase = 'confirm' | 'downloading' | 'error';
  let phase = $state<Phase>('confirm');
  let percent = $state(0);
  let stage = $state('');
  let errorMessage = $state('');
  let freeBytes = $state<number | null>(null);
  let requiredBytes = $state(0);
  const insufficient = $derived(freeBytes !== null && requiredBytes > 0 && freeBytes < requiredBytes);
  let poller: ReturnType<typeof setInterval> | null = null;
  let wasOpen = false;

  function formatGb(bytes: number): string {
    return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB`;
  }

  function stageLabel(value: string): string {
    if (value === 'stt') return m['voice.stage_stt']();
    if (value === 'tts') return m['voice.stage_tts']();
    if (value === 'runtime') return m['voice.stage_runtime']();
    if (value === 'extracting') return m['voice.stage_extracting']();
    return '';
  }

  // Ao abrir na fase de confirmacao, ja consulta o espaco livre em disco.
  $effect(() => {
    if (!open || phase !== 'confirm' || freeBytes !== null) return;
    fetch('/api/agent-room/voice/models')
      .then((response) => response.json())
      .then((body) => {
        freeBytes = body.data.freeBytes ?? null;
        requiredBytes = body.data.requiredBytes ?? 0;
      })
      .catch(() => {});
  });

  function stopPolling() {
    if (poller) clearInterval(poller);
    poller = null;
  }

  function resetDialog() {
    phase = 'confirm';
    percent = 0;
    stage = '';
    errorMessage = '';
    freeBytes = null;
    requiredBytes = 0;
  }

  $effect(() => {
    if (open && !wasOpen) resetDialog();
    if (!open && wasOpen) stopPolling();
    wasOpen = open;
  });

  function csrfHeaders(extra: Record<string, string> = {}): HeadersInit {
    const token = getCsrfToken();
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  }

  async function markModelsConfirmed() {
    try {
      const response = await fetch('/api/agent-room/settings', {
        method: 'PUT',
        headers: csrfHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ voiceModelsConfirmed: 'true' }),
      });
      if (!response.ok) return;
      invalidateAppSettings();
      await getAppSettings(true);
    } catch {
      // O status real dos arquivos continua permitindo o uso nesta sessao.
    }
  }

  async function confirm() {
    phase = 'downloading';
    percent = 0;
    errorMessage = '';
    // A confirmacao so e persistida quando os arquivos estiverem prontos.
    // Assim uma falha/cancelamento nunca deixa uma flag true sem modelos.
    try {
      const response = await fetch('/api/agent-room/voice/models', {
        method: 'POST',
        headers: csrfHeaders(),
      });
      if (!response.ok) throw new Error('download_start_failed');
    } catch {
      phase = 'error';
      errorMessage = m['voice.download_start_error']();
      return;
    }
    stopPolling();
    poller = setInterval(async () => {
      try {
        const response = await fetch('/api/agent-room/voice/models');
        const status = (await response.json()).data;
        percent = status.percent ?? 0;
        stage = status.stage ?? '';
        if (status.error) {
          stopPolling();
          phase = 'error';
          errorMessage = status.error;
          return;
        }
        if (status.ready) {
          stopPolling();
          await markModelsConfirmed();
          open = false;
          onConfirm();
        }
      } catch {
        // rede oscilando — tenta no proximo tick
      }
    }, 1_000);
  }

  function cancel() {
    stopPolling();
    open = false;
    onCancel();
  }

  function retry() {
    phase = 'confirm';
    errorMessage = '';
  }

  $effect(() => () => stopPolling());
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content class="sm:max-w-[440px]">
    <AlertDialog.Header>
      <AlertDialog.Title>
        {#if phase === 'downloading'}{m['voice.downloading_title']()}
        {:else if phase === 'error'}{m['voice.download_failed_title']()}
        {:else}{m['voice.download_title']()}{/if}
      </AlertDialog.Title>
      <AlertDialog.Description>
        {#if phase === 'confirm'}
          {m['voice.download_desc']()}
        {:else if phase === 'downloading'}
          {m['voice.downloading_desc']()}
        {:else}
          {m['voice.download_failed_desc']()}
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>

    {#if phase === 'downloading'}
      <!-- Progresso: barra + percentual tabular; etapa atual logo abaixo. -->
      <div class="download-state">
        <div class="download-row">
          <Progress value={percent} max={100} aria-label={m['voice.downloading_title']()} />
          <span class="download-percent">{percent}%</span>
        </div>
        <p class="download-stage" aria-live="polite">
          <LoaderCircle size={12} class="shrink-0 animate-spin" aria-hidden="true" />
          <span>{stage ? stageLabel(stage) : m['voice.downloading_title']()}</span>
        </p>
      </div>
    {:else if phase === 'error'}
      <p class="download-alert" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{errorMessage}</span></p>
    {:else if insufficient}
      <p class="download-alert" role="alert">
        <HardDrive size={14} class="mt-px shrink-0" aria-hidden="true" />
        <span>{m['voice.insufficient_space']({ free: formatGb(freeBytes ?? 0), required: formatGb(requiredBytes) })}</span>
      </p>
    {/if}

    {#if phase !== 'downloading'}
      <AlertDialog.Footer>
        {#if phase === 'confirm'}
          <AlertDialog.Cancel onclick={cancel}>{m['voice.not_now']()}</AlertDialog.Cancel>
          <AlertDialog.Action disabled={insufficient} onclick={confirm}><Download aria-hidden="true" />{m['voice.download_continue']()}</AlertDialog.Action>
        {:else if phase === 'error'}
          <AlertDialog.Cancel onclick={cancel}>{m['onboarding.close']()}</AlertDialog.Cancel>
          <AlertDialog.Action onclick={retry}><RotateCcw aria-hidden="true" />{m['voice.retry']()}</AlertDialog.Action>
        {/if}
      </AlertDialog.Footer>
    {/if}
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .download-state {
    display: grid;
    gap: 8px;
  }

  .download-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .download-row :global([data-slot='progress']) {
    flex: 1;
    height: 6px;
  }

  .download-percent {
    min-width: 40px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--app-text-soft);
  }

  .download-stage {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  /* Mesmo bloco de alerta usado nos demais dialogos. */
  .download-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
  }
</style>
