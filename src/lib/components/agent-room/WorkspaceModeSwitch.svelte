<script lang="ts">
  import { MessagesSquare, Network, SquareTerminal } from '@lucide/svelte';
  import type { WorkspaceMode } from './workspace-context.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    active,
    workspaceId = null,
    nodeId = null,
  }: {
    active: WorkspaceMode;
    workspaceId?: string | null;
    nodeId?: string | null;
  } = $props();

  function target(path: '/canvas' | '/terminal' | '/chat'): string {
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
    `inline-flex h-[26px] flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-medium transition-[background-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${
      selected
        ? 'bg-[color-mix(in_srgb,var(--app-text)_10%,transparent)] text-[var(--app-text)] shadow-[inset_0_1px_0_color-mix(in_srgb,#fff_8%,transparent)]'
        : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'
    }`;
</script>

<nav
  class="flex h-[30px] items-center gap-0.5 rounded-[10px] border border-[var(--app-glass-line)] bg-[color-mix(in_srgb,var(--app-surface)_50%,transparent)] p-[1px]"
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
  <a
    href={target('/chat')}
    data-sveltekit-preload-data="hover"
    class={itemClass(active === 'chat')}
    aria-current={active === 'chat' ? 'page' : undefined}
  >
    <MessagesSquare size={13} strokeWidth={1.8} class={active === 'chat' ? 'text-[var(--app-accent)]' : ''} />
    <span>{m['workspace_view.chat']()}</span>
  </a>
</nav>
