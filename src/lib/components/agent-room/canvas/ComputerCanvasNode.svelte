<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { MonitorCog, X } from '@lucide/svelte';
  import ComputerWorkbenchPanel from '../ComputerWorkbenchPanel.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import * as m from '$lib/paraglide/messages.js';

  export type ComputerNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: ComputerNodeData }>();
</script>

<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={520} minHeight={600} onResize={data.onResize} connections={data.connections ?? []} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection} titleText={data.title} onRename={data.onRename} class="canvas-computer">
  {#snippet icon()}<MonitorCog size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['settings.delete']()} class="node-action-btn danger" side="left" onclick={() => data.onDelete(id)}><X size={12} /></HeaderIconButton>{/snippet}
  <div class="nodrag nowheel h-full min-h-0"><ComputerWorkbenchPanel workspaceId={data.workspaceId} /></div>
</NodeShell>
