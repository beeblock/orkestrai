<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { BookOpen, X } from '@lucide/svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import KnowledgeView from '../KnowledgeView.svelte';
  import * as m from '$lib/paraglide/messages.js';
  let { id, selected, data } = $props<NodeProps & { data: {
    title: string; workspaceId: string; connections?: NodeConnection[];
    onDelete: (id: string) => void; onRename?: (id: string, title: string) => void;
    onResize?: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
    onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void;
  } }>();
</script>
<NodeShell {id} {selected} minWidth={520} minHeight={420} onResize={data.onResize} connections={data.connections} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection} titleText={data.title} onRename={data.onRename}>
  {#snippet icon()}<BookOpen size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['knowledge.close']()} class="node-action-btn danger" side="left" onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>{/snippet}
  <KnowledgeView workspaceId={data.workspaceId} onJumpToNode={data.onJumpToNode} embedded />
</NodeShell>
