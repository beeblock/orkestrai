<script lang="ts">
  import { onMount } from 'svelte';
  import { GitBranch } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';

  /** Branch of the workspace repository and how many files changed, bottom left of the board. */
  let { workspaceId, onOpen }: { workspaceId: string; onOpen: () => void } = $props();

  let branch = $state<string | null>(null);
  let changes = $state(0);

  async function load(id: string) {
    const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(id)}/git/status`, { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { data?: { isRepo?: boolean; branch?: string | null; changes?: unknown[] } } | null : null;
    if (id !== workspaceId) return;
    branch = body?.data?.isRepo ? body.data.branch ?? null : null;
    changes = Array.isArray(body?.data?.changes) ? body.data.changes.length : 0;
  }

  $effect(() => {
    const id = workspaceId;
    branch = null;
    changes = 0;
    void load(id);
  });

  onMount(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load(workspaceId);
    }, 30_000);
    const refresh = () => void load(workspaceId);
    window.addEventListener('orkestrai:workspace-changed', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('orkestrai:workspace-changed', refresh);
    };
  });
</script>

{#if branch}
  <button type="button" class="git-pill" data-testid="canvas-git-pill" aria-label={m['canvas.git_pill']({ branch, count: changes })} title={m['canvas.git_open']()} onclick={onOpen}>
    <GitBranch size={13} strokeWidth={2} />
    <span class="name">{branch}</span>
    {#if changes > 0}<span class="count">{changes > 999 ? '999+' : changes}</span>{/if}
  </button>
{/if}

<style>
  .git-pill {
    height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 10px 0 9px;
    border-radius: 999px;
    border: 1px solid var(--app-glass-line);
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    box-shadow: var(--app-glass-shadow);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11.5px;
    transition: color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .git-pill:hover {
    color: var(--app-text);
  }

  .git-pill:active {
    transform: scale(var(--scale-press));
  }

  .name {
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    min-width: 18px;
    height: 17px;
    padding: 0 5px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: color-mix(in srgb, var(--app-accent) 18%, transparent);
    color: var(--app-accent);
    font-size: 10.5px;
    font-weight: 600;
  }
</style>
