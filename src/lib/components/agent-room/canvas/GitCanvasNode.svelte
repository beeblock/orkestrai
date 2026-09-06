<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { GitFork, X } from '@lucide/svelte';
  import GitWorkspace from '../GitWorkspace.svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import IconAction from './IconAction.svelte';
  import * as m from '$lib/paraglide/messages.js';

  type GitNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: GitNodeData }>();
</script>

<NodeShell {id} {selected} class="canvas-git" accent="var(--app-success)" minWidth={420} minHeight={320} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<GitFork size={13}/>{/snippet}
  {#snippet title()}{data.title || m['git.title']()}{/snippet}
  {#snippet actions()}<IconAction label={m['files.remove']()} danger onclick={() => data.onDelete(id)}><X size={13}/></IconAction>{/snippet}
  <div class="nodrag nowheel h-full min-h-0"><GitWorkspace workspaceId={data.workspaceId} compact /></div>
</NodeShell>
