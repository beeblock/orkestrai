<script lang="ts">
  import HeaderIconButton from './HeaderIconButton.svelte';

  import type { NodeProps } from '@xyflow/svelte';
  import { Group, Ungroup } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';

  export type GroupNodeData = {
    title: string;
    payload: { members?: string[]; workflowKind?: string; designNodeIds?: string[]; taskIds?: string[] };
    onRename: (id: string, title: string) => void;
    onUngroup: (id: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: GroupNodeData }>();

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
<div class="canvas-group nowheel" class:selected>
  <header class="group-label" class:editing ondblclick={startRename} role="presentation">
    <Group size={12} class="group-icon shrink-0" aria-hidden="true" />
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
      {#if data.payload.workflowKind === 'design-exploration'}
        <span class="group-summary">{m['design.exploration_group_summary']({ directions: String(data.payload.designNodeIds?.length ?? 3), tasks: String(data.payload.taskIds?.length ?? 5) })}</span>
      {/if}
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
    border: 1.5px dashed color-mix(in srgb, var(--app-secondary) 50%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--app-secondary) 5%, transparent);
    transition:
      border-color var(--duration-quick) ease-out,
      box-shadow var(--duration-quick) ease-out,
      background-color var(--duration-quick) ease-out;
  }

  .canvas-group:hover {
    border-color: color-mix(in srgb, var(--app-secondary) 75%, transparent);
  }

  .canvas-group.selected {
    border-style: solid;
    border-color: var(--app-secondary);
    background: color-mix(in srgb, var(--app-secondary) 7%, transparent);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--app-secondary) 16%, transparent);
  }

  .group-label {
    position: absolute;
    top: -14px;
    left: 14px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 28px);
    height: 26px;
    padding: 0 3px 0 10px;
    border-radius: 999px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-panel);
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    cursor: grab;
    user-select: none;
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .group-label:active {
    cursor: grabbing;
  }

  .canvas-group.selected .group-label {
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--app-secondary) 60%, transparent),
      var(--app-shadow-panel);
    color: var(--app-text);
  }

  .group-label.editing {
    box-shadow:
      0 0 0 1px var(--app-accent),
      0 0 0 4px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .group-label :global(.group-icon) {
    color: var(--app-secondary);
  }

  .group-title {
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
</style>
