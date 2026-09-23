<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { FileText, X, ExternalLink, RefreshCw } from '@lucide/svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import KnowledgePdfPreview from '../KnowledgePdfPreview.svelte';
  import DocumentPassages from '../DocumentPassages.svelte';
  import { knowledgeApi } from '../knowledge-client.js';
  import { knowledgeLabel } from '../knowledge-labels.js';
  import type { KnowledgeDocument } from '$lib/modules/agent-room/domain/knowledge.js';
  import * as m from '$lib/paraglide/messages.js';
  let { id, selected, data } = $props<NodeProps & { data: {
    title: string; workspaceId: string; workingDir?: string; payload: { path?: string }; connections?: NodeConnection[];
    onDelete: (id: string) => void; onRename?: (id: string, title: string) => void;
    onResize?: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
    onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void;
  } }>();
  let doc = $state<KnowledgeDocument | null>(null), busy = $state(false), error = $state(''), open = $state(false);
  let alive = true;
  async function load() {
    busy = true; error = '';
    try { const result = await knowledgeApi<{ document: KnowledgeDocument }>(data.workspaceId, `knowledge?id=${encodeURIComponent(`node:${id}`)}`); if (alive) doc = result.document; }
    catch { if (alive) error = m['knowledge.error'](); } finally { if (alive) busy = false; }
  }
  onMount(() => { void load(); return () => { alive = false; }; });
</script>
<NodeShell {id} {selected} minWidth={340} minHeight={280} deferOffscreen onResize={data.onResize} connections={data.connections} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection} titleText={data.title} onRename={data.onRename}>
  {#snippet icon()}<FileText size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['knowledge.close']()} onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>{/snippet}
  <div class="nodrag nowheel flex h-full min-h-0 flex-col text-[var(--app-text)]" data-testid="document-node">
    <div class="flex items-center gap-2 border-b border-[var(--app-border)] p-2">
      <span class="min-w-0 flex-1 truncate text-xs text-[var(--app-text-muted)]" title={data.payload.path}>{data.payload.path}</span>
      <HeaderIconButton label={m['knowledge.refresh']()} disabled={busy} onclick={() => void load()}><RefreshCw size={14} class={busy ? 'animate-spin' : ''} /></HeaderIconButton>
      <Button size="sm" variant="outline" disabled={!doc || ['missing', 'error'].includes(doc.status)} onclick={() => open = true}><ExternalLink size={14} />{m['knowledge.open_original']()}</Button>
    </div>
    <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
      {#if error}<p role="alert" class="text-sm text-[var(--app-danger)]">{error}</p>{/if}
      {#if doc}<p class="mb-3 text-xs text-[var(--app-text-muted)]">{knowledgeLabel(doc.status)} · v{doc.revision}</p>
        {#if doc.truncated}<p class="mb-3 text-xs text-[var(--app-warning)]">{m['knowledge.truncated']()}</p>{/if}
        <DocumentPassages passages={doc.passages} />
      {:else if busy}<p class="text-sm text-[var(--app-text-muted)]">{m['knowledge.loading']()}</p>{/if}
    </div>
  </div>
</NodeShell>
<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[88vh] max-w-[94vw] flex-col gap-2 p-3 sm:max-w-[1100px]">
    <Dialog.Title class="pr-8 text-sm">{data.title}</Dialog.Title>
    <div class="min-h-0 flex-1 overflow-auto">{#if open && doc}
      {@const fileUrl = `/api/agent-room/workspaces/${data.workspaceId}/knowledge/file?nodeId=${encodeURIComponent(id)}`}
      {#if /\.pdf$/i.test(data.payload.path ?? '')}<KnowledgePdfPreview url={fileUrl} />
      {:else}<Button variant="outline" size="sm" href={fileUrl} download>{m['knowledge.download']()}</Button><div class="p-3"><DocumentPassages passages={doc.passages} /></div>{/if}
    {/if}</div>
  </Dialog.Content>
</Dialog.Root>
