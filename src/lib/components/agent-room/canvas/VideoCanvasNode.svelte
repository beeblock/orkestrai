<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Film, Download, X } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import type { CreativeVideoAsset } from '$lib/modules/creative-media/domain/types.js';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  type Data = { title: string; workspaceId: string; payload: Partial<CreativeVideoAsset>; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void; };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let failed = $state(false);
  let decodedSize = $state<{ width: number; height: number } | null>(null);
  const url = $derived(`/api/agent-room/workspaces/${data.workspaceId}/creative-media/videos/${id}`);
</script>
<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={280} minHeight={220} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Film size={14} />{/snippet}
  {#snippet title()}{data.title || m['creative.video']()}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>{/snippet}
  <div class="nodrag nowheel flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--app-canvas)]">
    <!-- Generated clips have no supplied caption track; native controls remain accessible. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} controls playsinline preload="metadata" aria-label={data.title || m['creative.video']()} class="min-h-0 w-full flex-1 object-contain" onloadedmetadata={(event) => { decodedSize = { width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }; failed = false; }} onerror={() => failed = true}></video>
    <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--app-border)] p-2 text-xs text-[var(--app-text-muted)]">
      <span class="min-w-0 break-words">{#if failed}{m['creative.video_unavailable']()}{:else if decodedSize?.width}{decodedSize.width} × {decodedSize.height}{:else if data.payload.width && data.payload.height}{data.payload.width} × {data.payload.height}{:else}{data.payload.path?.split('/').at(-1) ?? ''}{/if}</span>
      <a href={url} download class="inline-flex shrink-0 items-center gap-1 text-[var(--app-accent)] underline"><Download size={13} />{m['creative.download']()}</a>
    </footer>
  </div>
</NodeShell>
