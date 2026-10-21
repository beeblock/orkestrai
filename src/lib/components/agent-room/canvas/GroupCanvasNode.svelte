<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';

  import type { NodeProps } from '@xyflow/svelte';
  import { ChevronDown, LayoutGrid, Ungroup } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { agentStatus } from '../agent-status.svelte.js';
  import { agentColor } from '../agent-identity.js';

  export type GroupNodeData = {
    title: string;
    payload: { members?: string[]; workflowKind?: string; designNodeIds?: string[]; taskIds?: string[]; collapsed?: boolean };
    onRename: (id: string, title: string) => void;
    onUngroup: (id: string) => void;
    onArrange?: (id: string) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void | Promise<void>;
  };

  let { id, data, selected } = $props<NodeProps & { data: GroupNodeData }>();

  // Named team frame: the group keeps one color and counts its agents live.
  const tint = $derived(agentColor(id).bg);
  const stats = $derived.by(() => {
    const members = data.payload.members ?? [];
    const agents = members.filter((memberId: string) => agentStatus.agents[memberId]);
    const working = agents.filter((memberId: string) => {
      const state = agentStatus.agents[memberId]?.state;
      return state === 'working' || state === 'starting';
    }).length;
    return { members: members.length, agents: agents.length, working };
  });

  const collapsed = $derived(Boolean(data.payload.collapsed));

  function toggleCollapsed() {
    const next = !collapsed;
    data.payload.collapsed = next;
    void data.onPayloadChange?.(id, { collapsed: next });
  }

  let editing = $state(false);
  let draft = $state('');

  function startRename() {
    draft = data.title;
    editing = true;
  }

  function commitRename() {
    editing = false;
    if (draft.trim() && draft.trim() !== data.title) {
      data.onRename(id, draft.trim());
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') commitRename();
    if (event.key === 'Escape') editing = false;
  }
</script>

<!-- Grupo: contorno tracejado no tom do no; selecionado vira anel cheio
     com halo de 4px (mesma linguagem do NodeShell). -->
<div class="canvas-group nowheel" class:selected class:collapsed style:--group-tint={tint}>
  <header class="group-label" class:editing ondblclick={startRename} role="presentation">
    <span class="group-dot" class:live={stats.working > 0} aria-hidden="true"></span>
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="group-input nodrag"
        bind:value={draft}
        aria-label={m['shell.rename_hint']()}
        spellcheck="false"
        onkeydown={handleKeydown}
        onblur={commitRename}
        autofocus
      />
    {:else}
      <span
        class="group-title"
        role="button"
        tabindex="0"
        title={m['shell.rename_hint']()}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === 'F2') {
            event.preventDefault();
            startRename();
          }
        }}
      >{data.title}</span>
      <span class="group-stats">{stats.agents ? m['group.team_stats']({ count: stats.agents, working: stats.working }) : m['group.items']({ count: stats.members })}</span>
      {#if data.payload.workflowKind === 'design-exploration'}
        <span class="group-summary">{m['design.exploration_group_summary']({ directions: String(data.payload.designNodeIds?.length ?? 3), tasks: String(data.payload.taskIds?.length ?? 5) })}</span>
      {/if}
    {/if}
    <HeaderIconButton label={collapsed ? m['group.expand']() : m['group.collapse']()} class="group-ungroup nodrag" side="top" onclick={toggleCollapsed}>
      <ChevronDown size={13} class={collapsed ? 'rotate-[-90deg] transition-transform' : 'transition-transform'} />
    </HeaderIconButton>
    {#if !collapsed && (data.payload.members?.length ?? 0) > 1}
      <HeaderIconButton label={m['group.arrange']()} class="group-ungroup nodrag" side="top" onclick={() => data.onArrange?.(id)}>
        <LayoutGrid size={12} />
      </HeaderIconButton>
    {/if}
    <HeaderIconButton label={m['group.ungroup']()} class="group-ungroup nodrag" side="top" onclick={() => data.onUngroup(id)}>
      <Ungroup size={12} />
    </HeaderIconButton>
  </header>
</div>

<style>
  /* O xyflow pinta o tipo "group" com padding, borda e fundo cinza padrao;
     aqui o proprio no desenha o contorno, entao o involucro fica neutro. */
  :global(.svelte-flow .svelte-flow__node-group) {
    --xy-node-border: 0;
    --xy-node-background-color: transparent;
    --xy-node-group-background-color: transparent;
    --xy-node-boxshadow-hover: none;
    --xy-node-boxshadow-selected: none;
    padding: 0;
    border-radius: 12px;
  }

  .canvas-group {
    position: relative;
    width: 100%;
    height: 100%;
    border: 1px solid color-mix(in srgb, var(--group-tint) 34%, transparent);
    border-radius: 20px;
    background:
      radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--group-tint) 7%, transparent), transparent 60%),
      color-mix(in srgb, var(--group-tint) 2.5%, transparent);
    box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 4%, transparent);
    transition:
      border-color var(--duration-quick) ease-out,
      box-shadow var(--duration-quick) ease-out,
      background-color var(--duration-quick) ease-out;
  }

  .canvas-group:hover {
    border-color: color-mix(in srgb, var(--group-tint) 55%, transparent);
  }

  /* Collapsed: only the label stays; the frame lets clicks through to the canvas. */
  .canvas-group.collapsed {
    border-color: transparent;
    background: transparent;
    box-shadow: none;
    pointer-events: none;
  }

  .canvas-group.collapsed .group-label {
    pointer-events: auto;
  }

  .canvas-group.selected {
    border-color: var(--group-tint);
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--group-tint) 12%, transparent), 0 0 60px -10px color-mix(in srgb, var(--group-tint) 30%, transparent);
  }

  .group-label {
    position: absolute;
    top: -15px;
    left: 18px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 36px);
    height: 30px;
    padding: 0 4px 0 12px;
    border-radius: 999px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    backdrop-filter: blur(18px) saturate(160%);
    border: 1px solid color-mix(in srgb, var(--group-tint) 30%, var(--app-glass-line));
    box-shadow: var(--app-glass-shadow);
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    cursor: grab;
    user-select: none;
    transition: box-shadow var(--duration-quick) ease-out, border-color var(--duration-quick) ease-out;
  }

  .group-label:active {
    cursor: grabbing;
  }

  .canvas-group.selected .group-label {
    border-color: var(--group-tint);
    color: var(--app-text);
  }

  .group-label.editing {
    box-shadow:
      0 0 0 1px var(--app-accent),
      0 0 0 4px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .group-dot {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: var(--group-tint);
  }

  .group-dot.live {
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--group-tint) 25%, transparent);
    animation: group-live 2.2s ease-in-out infinite;
  }

  @keyframes group-live {
    50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--group-tint) 6%, transparent); }
  }

  .group-stats {
    flex-shrink: 0;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .group-title {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--app-text);
    line-height: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-radius: 4px;
    cursor: text;
  }

  .group-title:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .group-input {
    width: min(220px, 45vw);
    min-width: 0;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font: inherit;
  }

  .group-summary {
    flex-shrink: 0;
    padding-left: 6px;
    border-left: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    color: var(--app-text-muted);
    font-size: 11px;
    white-space: nowrap;
  }

  .group-label :global(.group-ungroup) {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition:
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out,
      transform var(--duration-quick) var(--ease-smooth-out);
  }

  .group-label :global(.group-ungroup:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .group-label :global(.group-ungroup:active) {
    transform: scale(var(--scale-press));
  }

  .group-label :global(.group-ungroup:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
  /* Far out the team frames read as a map: their names grow to headlines. */
  :global(.svelte-flow[data-canvas-overview='true']) .group-label {
    top: -92px;
    height: auto;
    max-width: none;
    padding: 10px 26px;
    gap: 20px;
  }

  :global(.svelte-flow[data-canvas-overview='true']) .group-title {
    font-family: var(--font-headline);
    font-stretch: 62%;
    font-size: 60px;
    letter-spacing: 0;
    overflow: visible;
  }

  :global(.svelte-flow[data-canvas-overview='true']) .group-stats {
    font-size: 28px;
  }

  :global(.svelte-flow[data-canvas-overview='true']) .group-dot {
    width: 30px;
    height: 30px;
  }
</style>
