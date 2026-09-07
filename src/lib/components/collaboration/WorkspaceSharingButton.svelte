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
        class={variant === "toolbar"
          ? `relative flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-ui-sm transition-[color,background-color,border-color] ${active ? "border-[var(--app-accent)]/45 bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "border-transparent text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]"}`
          : `relative grid size-8 shrink-0 place-items-center rounded-md border transition-[color,background-color,border-color] ${active ? "border-[var(--app-accent)]/45 bg-[var(--app-accent-soft)] text-[var(--app-accent)]" : "border-[var(--app-border)] text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]"}`}
        aria-label={m["collaboration.share_workspace"]()}
        data-tour="workspace-sharing"
        onclick={onOpen}
      >
        <Share2 size={15} aria-hidden="true" />
        {#if variant === "toolbar"}<span
            >{m["collaboration.share_workspace"]()}</span
          >{/if}
        {#if active}
          <span
            class={`absolute right-0.5 top-0.5 size-1.5 rounded-full ring-2 ring-[var(--app-canvas)] ${pending > 0 || !online ? "bg-[var(--app-warning)]" : "bg-[var(--app-success)]"}`}
          ></span>
          {#if peers > 0 && variant === "toolbar"}<span
              class="ml-0.5 text-ui-xs tabular-nums">{peers}</span
            >{/if}
        {/if}
        {#if pending > 0}<span
            class={variant === "toolbar"
              ? "ml-0.5 rounded bg-[var(--app-warning)] px-1 text-ui-xs font-semibold text-black"
              : "absolute -right-1.5 -bottom-1 grid size-4 place-items-center rounded-full bg-[var(--app-warning)] text-ui-xs font-bold text-black"}
            >{pending}</span
          >{/if}
      </button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="bottom"
    >{m["collaboration.share_workspace"]()}</Tooltip.Content
  >
</Tooltip.Root>
