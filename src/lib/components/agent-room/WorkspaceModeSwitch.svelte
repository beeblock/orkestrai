<script lang="ts">
  import { Network, SquareTerminal } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';

  let {
    active,
    workspaceId = null,
    nodeId = null,
  }: {
    active: 'canvas' | 'terminals';
    workspaceId?: string | null;
    nodeId?: string | null;
  } = $props();

  function target(path: '/canvas' | '/terminal'): string {
    const params = new URLSearchParams();
    if (workspaceId) params.set('workspace', workspaceId);
    let targetNodeId = nodeId;
    if (!targetNodeId && active === 'canvas' && workspaceId && typeof location !== 'undefined') {
      const current = new URLSearchParams(location.search);
      if (current.get('workspace') === workspaceId) targetNodeId = current.get('node');
    }
    if (targetNodeId) params.set('node', targetNodeId);
    const query = params.toString();
    return query ? `${path}?${query}` : path;
  }

  const itemClass = (selected: boolean) =>
    `inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-ui-sm font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${
      selected
        ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)] shadow-sm'
        : 'text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]'
    }`;
</script>

<nav
  class="inline-flex h-8 items-center gap-0.5 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-0.5"
  aria-label={m['workspace_view.switcher_label']()}
>
  <a
    href={target('/canvas')}
    data-sveltekit-preload-data="hover"
    class={itemClass(active === 'canvas')}
    aria-current={active === 'canvas' ? 'page' : undefined}
  >
    <Network size={13} strokeWidth={1.8} />
    <span>{m['workspace_view.canvas']()}</span>
  </a>
  <a
    href={target('/terminal')}
    data-sveltekit-preload-data="hover"
    class={itemClass(active === 'terminals')}
    aria-current={active === 'terminals' ? 'page' : undefined}
  >
    <SquareTerminal size={13} strokeWidth={1.8} />
    <span>{m['workspace_view.workbench']()}</span>
  </a>
</nav>
