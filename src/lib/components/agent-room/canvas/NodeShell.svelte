<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Handle, NodeResizer, Position, useEdges, useNodes, type NodeProps } from '@xyflow/svelte';
  import * as Popover from '$lib/components/ui/popover';
  import { Link2, X } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { floatingAnchorFor, nodeIndexFor } from './floating-anchor.js';

  export type NodeConnection = {
    edgeId: string;
    targetId: string;
    targetTitle: string;
    targetType: string;
    direction: 'in' | 'out';
  };

  type Props = {
    id: NodeProps['id'];
    selected: NodeProps['selected'];
    /** Cor de destaque do tipo de no (borda selecionada / dot). */
    accent?: string;
    minWidth?: number;
    minHeight?: number;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    /** Conexoes do no (para o popover de inspecao). */
    connections?: NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    /** Titulo em texto puro + callback — habilita renomear com duplo-clique. */
    titleText?: string;
    onRename?: (id: string, title: string) => void;
    onDragOver?: (event: DragEvent) => void;
    onDragLeave?: (event: DragEvent) => void;
    onDrop?: (event: DragEvent) => void;
    /** Classe extra no wrapper (ex.: canvas-terminal) — mantida para testes/estilo. */
    class?: string;
    deferOffscreen?: boolean;
    icon: Snippet;
    title: Snippet;
    actions?: Snippet;
    children: Snippet;
  };

  let {
    id,
    selected,
    accent = 'var(--app-accent)',
    minWidth = 320,
    minHeight = 200,
    onResize,
    connections = [],
    onJumpToNode,
    onRemoveConnection,
    titleText = '',
    onRename,
    onDragOver,
    onDragLeave,
    onDrop,
    class: klass = '',
    deferOffscreen = false,
    icon,
    title,
    actions,
    children,
  }: Props = $props();

  // Renomear inline: duplo-clique no titulo vira input; Enter/blur confirma.
  let editingTitle = $state(false);
  let titleDraft = $state('');

  function startRename() {
    if (!onRename) return;
    titleDraft = titleText;
    editingTitle = true;
  }

  function commitRename() {
    editingTitle = false;
    const next = titleDraft.trim();
    if (next && next !== titleText) onRename?.(id, next);
  }

  const nodesStore = useNodes();
  const edgesStore = useEdges();

  // Handle flutuante: a bolinha desliza pela borda do no ate o ponto mais
  // proximo do vizinho conectado mais perto — a mesma matematica da ancora
  // da corda (OrkestraiEdge), entao a ponta da corda sempre toca a bolinha.
  const floatingAnchor = $derived.by(() => {
    const absolute = floatingAnchorFor(id, nodesStore.current, edgesStore.current);
    if (!absolute) return null;
    const self = nodeIndexFor(nodesStore.current).get(id);
    if (!self) return null;
    return { x: absolute.x - self.position.x, y: absolute.y - self.position.y };
  });

  const handleStyle = $derived(
    floatingAnchor
      ? `left: ${floatingAnchor.x}px; top: ${floatingAnchor.y}px; right: auto; transform: translate(-50%, -50%);`
      : undefined
  );
</script>

<div class={`node-shell nowheel ${klass}`} class:selected style:--accent={accent} role="group" aria-label={titleText || undefined} ondragover={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
  <NodeResizer
    isVisible={selected ?? false}
    {minWidth}
    {minHeight}
    onResizeEnd={(_event, params) => onResize?.(id, params)}
    lineStyle="border-color: var(--accent)"
    handleStyle="background: var(--accent)"
  />
  <!-- Handle unico bidirecional (connectionMode Loose), estilo Maestri: sem
       conexoes fica na lateral direita; com conexoes flutua pela borda ate a
       ancora da corda (ver floatingAnchor acima). -->
  <Handle type="source" position={Position.Right} class="node-handle" style={handleStyle} />

  <header class="node-header">
    <span class="node-icon">{@render icon()}</span>
    {#if editingTitle}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="node-title-input nodrag"
        bind:value={titleDraft}
        autofocus
        spellcheck="false"
        onkeydown={(event) => {
          if (event.key === 'Enter') commitRename();
          if (event.key === 'Escape') editingTitle = false;
        }}
        onblur={commitRename}
      />
    {:else}
      <span
        class="node-title"
        class:renamable={Boolean(onRename)}
        aria-label={onRename ? m['shell.rename_hint']() : undefined}
        ondblclick={startRename}
        onkeydown={(event) => {
          if (onRename && (event.key === 'Enter' || event.key === 'F2')) {
            event.preventDefault();
            startRename();
          }
        }}
        role={onRename ? 'button' : undefined}
        tabindex={onRename ? 0 : undefined}
      >{@render title()}</span>
    {/if}
    {#if connections.length}
      <Popover.Root>
        <Popover.Trigger class="connections-badge nodrag inline-flex h-[22px] shrink-0 items-center gap-1 rounded-md bg-[var(--app-hover)] px-1.5 font-mono text-[10.5px] leading-none text-[var(--app-text-muted)] tabular-nums transition-[color,background-color] duration-150 hover:bg-[var(--app-active)] hover:text-[var(--app-text)] data-[state=open]:bg-[var(--app-active)] data-[state=open]:text-[var(--app-text)]" aria-label={m['shell.connections']()}>
          <Link2 size={11} />{connections.length}
        </Popover.Trigger>
        <Popover.Content class="w-56 p-1">
          {#each connections as connection (connection.edgeId)}
            <div class="connection-row">
              <button class="connection-jump" onclick={() => onJumpToNode?.(connection.targetId)}>
                <span class="connection-dir">{connection.direction === 'out' ? '→' : '←'}</span>
                <span class="connection-title">{connection.targetTitle}</span>
                <span class="connection-type">{connection.targetType}</span>
              </button>
              <button class="connection-remove" aria-label={m['shell.remove_connection']()} onclick={() => onRemoveConnection?.(connection.edgeId)}>
                <X size={11} />
              </button>
            </div>
          {/each}
        </Popover.Content>
      </Popover.Root>
    {/if}
    {#if actions}
      <span class="node-actions nodrag">{@render actions()}</span>
    {/if}
  </header>

  <div class="node-body {deferOffscreen ? '[content-visibility:auto] [contain-intrinsic-size:auto_300px]' : ''}">
    {@render children()}
  </div>
</div>

<style>
  /*
   * Chassi dos nos: elevacao por sombra (anel de 1px do tema + profundidade),
   * cabecalho de altura fixa e acoes de 26px iguais em todos os tipos.
   * Raio concentrico: moldura 10px; cabecalho e corpo seguem o mesmo raio.
   */
  .node-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    border-radius: 10px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-card);
    /* overflow visivel: os handles ficam a cavalo da borda (estilo Maestri)
       e precisam ser clicaveis fora da caixa; o recorte dos cantos fica a
       cargo do header/body. */
    overflow: visible;
    overscroll-behavior: contain;
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .node-shell:hover {
    box-shadow: 0 0 0 1px var(--app-ring-hairline-strong), var(--app-shadow-card);
  }

  .node-shell.selected {
    box-shadow:
      0 0 0 1px var(--accent),
      0 0 0 4px color-mix(in srgb, var(--accent) 16%, transparent),
      var(--app-shadow-overlay);
  }

  .node-header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    flex-shrink: 0;
    padding: 0 5px 0 10px;
    background: color-mix(in srgb, var(--app-surface-raised) 55%, var(--app-surface));
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    border-radius: 10px 10px 0 0;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 500;
    cursor: grab;
    user-select: none;
  }

  .node-header:active {
    cursor: grabbing;
  }

  .node-icon {
    display: inline-flex;
    flex-shrink: 0;
    color: var(--accent);
  }

  .node-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  .node-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 4px;
  }

  .node-title.renamable {
    cursor: text;
  }

  .node-title.renamable:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .node-title-input {
    flex: 1;
    min-width: 0;
    height: 24px;
    border: 1px solid var(--app-accent);
    outline: none;
    background: var(--app-surface-subtle);
    border-radius: 6px;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 500;
    padding: 0 6px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .node-actions {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    flex: none;
    min-width: 0;
  }

  .connection-row {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }

  .connection-row:hover {
    background: var(--app-hover);
  }

  .connection-jump {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 30px;
    padding: 0 8px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .connection-jump:hover {
    color: var(--app-text);
  }

  .connection-dir {
    color: var(--app-text-muted);
  }

  .connection-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-type {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
  }

  .connection-remove {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .connection-remove:hover {
    color: var(--app-danger);
    background: var(--app-danger-soft);
  }

  .node-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 0 0 10px 10px;
  }

  .node-shell :global(.node-action-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    padding: 0;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .node-shell :global(.node-action-btn:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .node-shell :global(.node-action-btn:active) {
    transform: scale(var(--scale-press));
  }

  .node-shell :global(.node-action-btn.danger:hover) {
    color: var(--app-danger);
    background: var(--app-danger-soft);
  }

  .node-shell :global(.node-action-btn.active) {
    color: var(--app-warning);
  }

  .node-shell :global(.node-handle) {
    width: 12px;
    height: 12px;
    z-index: 20;
    background: var(--accent);
    border: 2px solid var(--app-surface);
    /* O anel nao e elevacao: e um recorte na cor do fundo para a bolinha
       nao encostar nas cordas que passam por baixo. */
    box-shadow: 0 0 0 2px var(--app-canvas), 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
    opacity: 0.95;
    /* `scale` (propriedade propria) compoe com o transform de posicionamento
       do xyflow e com o translate inline do handle flutuante. */
    transition: scale var(--duration-quick) var(--ease-smooth-out), box-shadow var(--duration-quick) ease-out;
  }

  .node-shell :global(.node-handle:hover) {
    scale: 1.25;
    box-shadow: 0 0 0 2px var(--app-canvas), 0 0 0 5px color-mix(in srgb, var(--accent) 30%, transparent);
  }

  /* area de clique um pouco maior que a bolinha para iniciar conexoes —
     sem exagerar para nao cobrir a corda quando os nos estao proximos */
  .node-shell :global(.node-handle::after) {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: 50%;
  }
</style>
