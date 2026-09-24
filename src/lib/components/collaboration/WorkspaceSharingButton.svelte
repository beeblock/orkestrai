<script lang="ts">
  import { onMount } from "svelte";
  import { Share2 } from "@lucide/svelte";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import * as m from "$lib/paraglide/messages.js";

  let {
    workspaceId,
    variant = "toolbar",
    onOpen,
  }: {
    workspaceId: string | null;
    variant?: "toolbar" | "icon";
    onOpen: () => void;
  } = $props();

  let active = $state(false);
  let peers = $state(0);
  let online = $state(false);
  let pending = $state(0);

  // Resumo do estado para tooltip e leitor de tela: o icone sozinho nao diz
  // se o workspace esta compartilhado, quantos entraram ou quem espera.
  const statusLines = $derived(
    active
      ? [
          online ? m["collaboration.status_connected"]() : m["collaboration.status_offline"](),
          peers > 0 ? `${m["collaboration.connected_peers"]()}: ${peers}` : null,
          pending > 0 ? `${m["collaboration.pending"]()}: ${pending}` : null,
        ].filter((line): line is string => Boolean(line))
      : [m["collaboration.not_shared"]()],
  );
  const title = $derived(active ? m["collaboration.active"]() : m["collaboration.share_workspace"]());
  // Cor so para estado: verde online, ambar quando alguem espera ou o relay caiu.
  const tone = $derived(pending > 0 || !online ? "warning" : "success");

  async function refresh(): Promise<void> {
    if (!workspaceId) {
      active = false;
      peers = 0;
      pending = 0;
      return;
    }
    try {
      const response = await fetch(
        `/api/agent-room/workspaces/${workspaceId}/collaboration`,
      );
      const payload = await response.json();
      active = Boolean(payload.data?.share);
      peers = Number(payload.data?.transport?.connectedPeers ?? 0);
      online = payload.data?.transport?.state === "connected";
      pending = Array.isArray(payload.data?.devices)
        ? payload.data.devices.filter(
            (device: {
              approvedAt?: string | null;
              revokedAt?: string | null;
            }) => !device.approvedAt && !device.revokedAt,
          ).length
        : 0;
    } catch {
      online = false;
    }
  }

  $effect(() => {
    workspaceId;
    void refresh();
  });

  onMount(() => {
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  });
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        disabled={!workspaceId}
        class="share-btn"
        class:toolbar={variant === "toolbar"}
        class:shared={active}
        aria-label={[m["collaboration.share_workspace"](), ...statusLines].join(", ")}
        data-tour="workspace-sharing"
        onclick={onOpen}
      >
        <Share2 size={15} aria-hidden="true" />
        {#if variant === "toolbar"}<span class="share-label"
            >{m["collaboration.share_workspace"]()}</span
          >{/if}
        {#if active && peers > 0 && variant === "toolbar"}<span
            class="share-peers">{peers}</span
          >{/if}
        {#if pending > 0}
          <span class="share-badge" aria-hidden="true">{pending > 9 ? "9+" : pending}</span>
        {:else if active}
          <span class="share-dot" data-tone={tone} aria-hidden="true"></span>
        {/if}
      </button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="bottom" class="flex-col items-start gap-0.5">
    <span>{title}</span>
    {#each statusLines as line}<span class="font-normal tabular-nums opacity-70">{line}</span>{/each}
  </Tooltip.Content>
</Tooltip.Root>

<style>
  /* Mesmo vocabulario do ToolbarButton do canvas: sem borda, hover neutro,
     e o tom de destaque so quando o workspace esta de fato compartilhado. */
  .share-btn {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-soft);
    cursor: pointer;
    transition-property: background-color, color, transform;
    transition-duration: var(--duration-quick);
    transition-timing-function: var(--ease-smooth-out);
  }

  .share-btn.toolbar {
    display: inline-flex;
    gap: 6px;
    width: auto;
    height: 30px;
    padding: 0 10px;
    font-size: 11.5px;
    font-weight: 500;
  }

  .share-btn:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .share-btn:active:not(:disabled) {
    transform: scale(var(--scale-press));
  }

  .share-btn:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .share-btn:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .share-btn.shared {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .share-btn.shared:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-accent) 22%, transparent);
    color: var(--app-accent);
  }

  .share-peers {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  /* Ponto de estado dentro do proprio botao: nao depende da cor do fundo
     do container (dock do canvas ou sidebar do workbench). */
  .share-dot {
    position: absolute;
    top: 5px;
    right: 5px;
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--app-success);
  }

  .share-dot[data-tone='warning'] {
    background: var(--app-warning);
  }

  .share-badge {
    position: absolute;
    top: -4px;
    right: -4px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--app-warning);
    color: var(--app-accent-contrast);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
</style>
