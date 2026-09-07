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

<div class={selected
  ? 'nowheel relative size-full rounded-lg border-2 border-dashed border-[var(--app-secondary)] bg-[color-mix(in_srgb,var(--app-secondary)_7%,transparent)]'
  : 'nowheel relative size-full rounded-lg border-2 border-dashed border-[color-mix(in_srgb,var(--app-secondary)_52%,transparent)] bg-[color-mix(in_srgb,var(--app-secondary)_7%,transparent)]'}>
  <header class="absolute -top-3.5 left-3.5 inline-flex max-w-[calc(100%-28px)] cursor-grab select-none items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-0.5 text-ui-sm font-medium text-[var(--app-text-soft)] shadow-sm" ondblclick={startRename} role="presentation">
    <Group size={12} class="shrink-0" aria-hidden="true" />
    {#if editing}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="nodrag w-[min(220px,45vw)] border-0 bg-transparent text-ui-sm text-inherit outline-none"
        bind:value={draft}
        onkeydown={handleKeydown}
        onblur={commitRename}
        autofocus
      />
    {:else}
      <span class="min-w-0 truncate">{data.title}</span>
      {#if data.payload.workflowKind === 'design-exploration'}
        <span class="shrink-0 whitespace-nowrap border-l border-[var(--app-border)] pl-1.5 text-ui-xs font-medium text-[var(--app-text-muted)]">{m['design.exploration_group_summary']({ directions: String(data.payload.designNodeIds?.length ?? 3), tasks: String(data.payload.taskIds?.length ?? 5) })}</span>
      {/if}
    {/if}
    <HeaderIconButton label={m['group.ungroup']()} class="nodrag inline-flex size-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[var(--app-text-muted)] hover:text-[var(--app-danger)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 focus-visible:outline-none" side="left" onclick={() => data.onUngroup(id)}>
      <Ungroup size={12} />
    </HeaderIconButton>
  </header>
</div>
