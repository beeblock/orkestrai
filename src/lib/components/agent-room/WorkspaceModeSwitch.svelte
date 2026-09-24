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

  // Controle segmentado: trilho neutro, segmento ativo elevado. Raio
  // concentrico: trilho 8px com 2px de respiro -> segmento 6px.
  const itemClass = (selected: boolean) =>
    `inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-ui-sm font-medium transition-[background-color,color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${
      selected
        ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-border'
        : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
    }`;
</script>

<nav
  class="flex h-8 items-center gap-0.5 rounded-lg bg-[var(--app-hover)] p-0.5"
  aria-label={m['workspace_view.switcher_label']()}
>
  <a
    href={target('/canvas')}
    data-sveltekit-preload-data="hover"
    class={itemClass(active === 'canvas')}
    aria-current={active === 'canvas' ? 'page' : undefined}
  >
    <Network size={13} strokeWidth={1.8} class={active === 'canvas' ? 'text-[var(--app-accent)]' : ''} />
    <span>{m['workspace_view.canvas']()}</span>
  </a>
  <a
    href={target('/terminal')}
    data-sveltekit-preload-data="hover"
    class={itemClass(active === 'terminals')}
    aria-current={active === 'terminals' ? 'page' : undefined}
  >
    <SquareTerminal size={13} strokeWidth={1.8} class={active === 'terminals' ? 'text-[var(--app-accent)]' : ''} />
    <span>{m['workspace_view.workbench']()}</span>
  </a>
</nav>
