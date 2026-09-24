<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Film, Download, Columns2, TriangleAlert, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import CreativeAssetReviewDialog from '../CreativeAssetReviewDialog.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import type { CreativeVideoAsset } from '$lib/modules/creative-media/domain/types.js';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  type Data = { title: string; workspaceId: string; payload: Partial<CreativeVideoAsset>; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void; };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let failed = $state(false);
  let reviewing = $state(false);
  let decodedSize = $state<{ width: number; height: number } | null>(null);
  const url = $derived(`/api/agent-room/workspaces/${data.workspaceId}/creative-media/videos/${id}`);
  const fileName = $derived(data.payload.path?.split('/').at(-1) ?? '');
</script>
<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={280} minHeight={220} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Film size={14} />{/snippet}
  {#snippet title()}{data.title || m['creative.video']()}{/snippet}
  {#snippet actions()}<HeaderIconButton class="node-action-btn" label={m['creative_review.title']()} onclick={() => reviewing = true}><Columns2 size={13} /></HeaderIconButton><HeaderIconButton class="node-action-btn" label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>{/snippet}
  <div class="nodrag nowheel flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--app-canvas)]">
    {#if data.payload.mimeType === 'image/gif'}
      <img src={url} alt={data.title || m['creative.video']()} class="min-h-0 w-full flex-1 object-contain" onerror={() => failed = true} />
    {:else if data.payload.mimeType?.startsWith('audio/')}
      <div class="flex min-h-0 flex-1 items-center p-3"><audio src={url} controls preload="metadata" aria-label={data.title || m['creative.audio']()} class="w-full" onerror={() => failed = true}></audio></div>
    {:else}
    <!-- Generated clips have no supplied caption track; native controls remain accessible. -->
    <!-- svelte-ignore a11y_media_has_caption -->
    <video src={url} controls playsinline preload="metadata" aria-label={data.title || m['creative.video']()} class="min-h-0 w-full flex-1 object-contain" onloadedmetadata={(event) => { decodedSize = { width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight }; failed = false; }} onerror={() => failed = true}></video>
    {/if}
    <!-- Rodape de metadados: dimensoes em mono; falha vira aviso com a
         recuperacao (baixar o original) ao lado, no mesmo lugar. -->
    <footer class="flex min-h-10 shrink-0 items-center justify-between gap-3 border-t border-[color-mix(in_srgb,var(--app-border)_80%,transparent)] bg-[var(--app-surface)] py-1.5 pr-1.5 pl-3">
      {#if failed}
        <span class="flex min-w-0 items-start gap-1.5 text-ui-sm leading-[1.4] text-pretty text-[var(--app-danger)]"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />{m['creative.video_unavailable']()}</span>
      {:else}
        <span class="meta-mono min-w-0 truncate" title={fileName || undefined}>{#if decodedSize?.width}{decodedSize.width} × {decodedSize.height}{:else if data.payload.width && data.payload.height}{data.payload.width} × {data.payload.height}{:else}{fileName}{/if}</span>
      {/if}
      <Button href={url} download variant={failed ? 'outline' : 'ghost'} size="sm" class="shrink-0 text-[var(--app-text-soft)]"><Download size={13} />{m['creative.download']()}</Button>
    </footer>
  </div>
</NodeShell>
<CreativeAssetReviewDialog bind:open={reviewing} workspaceId={data.workspaceId} initialNodeId={id} onOpenNode={data.onJumpToNode} />
