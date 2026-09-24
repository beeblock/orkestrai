<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { FileText, FileWarning, FileX, LoaderCircle, X, ExternalLink, RefreshCw } from '@lucide/svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import KnowledgePdfPreview from '../KnowledgePdfPreview.svelte';
  import DocumentPassages from '../DocumentPassages.svelte';
  import DocumentExtractionNotice from '../DocumentExtractionNotice.svelte';
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
  async function load(force = false) {
    busy = true; error = '';
    try {
      if (force) await knowledgeApi(data.workspaceId, 'knowledge', { command: 'refresh' });
      const result = await knowledgeApi<{ document: KnowledgeDocument }>(data.workspaceId, `knowledge?id=${encodeURIComponent(`node:${id}`)}`); if (alive) doc = result.document;
    }
    catch { if (alive) error = m['knowledge.error'](); } finally { if (alive) busy = false; }
  }
  onMount(() => { void load(); return () => { alive = false; }; });

  // Sem trechos e fora do estado "indexado": o corpo vira um estado vazio que
  // explica o motivo e oferece a acao de recuperacao ja existente.
  const emptyDoc = $derived(Boolean(doc && doc.status !== 'ready' && doc.passages.length === 0));
  const recoverable = $derived(doc?.status === 'missing' || doc?.status === 'error');
  const statusTone = $derived(doc?.status === 'ready' ? 'success' : doc?.status === 'missing' || doc?.status === 'error' ? 'warning' : 'neutral');
</script>
{#snippet refreshAction()}<Button size="sm" variant="outline" disabled={busy} onclick={() => void load(true)}><RefreshCw size={13} class={busy ? 'animate-spin' : ''} />{m['knowledge.refresh']()}</Button>{/snippet}
<NodeShell {id} {selected} minWidth={340} minHeight={280} deferOffscreen onResize={data.onResize} connections={data.connections} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection} titleText={data.title} onRename={data.onRename}>
  {#snippet icon()}<FileText size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['knowledge.close']()} class="node-action-btn danger" onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>{/snippet}
  <div class="doc nodrag nowheel" data-testid="document-node">
    {#if !(doc?.status === 'missing' && !data.payload.path)}
    <div class="doc-toolbar">
      {#if doc && !emptyDoc}
        <span class="doc-status" data-tone={statusTone}><span class="doc-status-dot" aria-hidden="true"></span>{knowledgeLabel(doc.status)}</span>
      {/if}
      <span class="doc-path" title={data.payload.path}>{data.payload.path ?? ''}</span>
      {#if doc}<span class="doc-revision">v{doc.revision}</span>{/if}
      {#if !(emptyDoc && recoverable) && !(error && !doc)}
        <HeaderIconButton label={m['knowledge.refresh']()} class="node-action-btn" disabled={busy} onclick={() => void load(true)}><RefreshCw size={14} class={busy ? 'animate-spin' : ''} /></HeaderIconButton>
      {/if}
      <!-- Fonte ausente: "Abrir original" nunca habilita, entao sai de cena. -->
      {#if doc?.status !== 'missing'}
        <Button size="sm" variant="outline" disabled={!doc} onclick={() => open = true}><ExternalLink size={14} />{m['knowledge.open_original']()}</Button>
      {/if}
    </div>
    {/if}
    <div class="doc-body">
      {#if error && !doc}
        <div role="alert" class="doc-fill">
          <NodeEmptyState icon={FileWarning} tone="danger" title={error} actions={refreshAction} />
        </div>
      {:else if error}
        <p role="alert" class="doc-alert"><FileWarning size={13} aria-hidden="true" /><span>{error}</span></p>
      {/if}
      {#if doc}
        <DocumentExtractionNotice extraction={doc.extraction} />
        {#if doc.truncated}<p class="doc-truncated">{m['knowledge.truncated']()}</p>{/if}
        {#if emptyDoc}
          <div class="doc-fill">
            <NodeEmptyState
              icon={doc.status === 'missing' ? FileX : doc.status === 'error' ? FileWarning : FileText}
              tone={recoverable ? 'warning' : 'neutral'}
              title={knowledgeLabel(doc.status)}
              description={doc.status === 'missing' ? m['knowledge.missing_hint']() : doc.status === 'error' ? m['knowledge.error_hint']() : m['knowledge.original_hint']()}
              actions={recoverable ? refreshAction : undefined}
            />
          </div>
        {:else}
          <DocumentPassages passages={doc.passages} />
        {/if}
      {:else if busy && !error}
        <div class="doc-fill"><span class="doc-loading" role="status"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['knowledge.loading']()}</span></div>
      {/if}
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

<style>
  .doc {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    color: var(--app-text);
  }

  .doc-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 6px 8px 6px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
  }

  .doc-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .doc-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  .doc-status[data-tone='success'] .doc-status-dot {
    background: var(--app-success);
  }

  .doc-status[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-text);
  }

  .doc-status[data-tone='warning'] .doc-status-dot {
    background: var(--app-warning);
  }

  .doc-path {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .doc-revision {
    flex-shrink: 0;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .doc-body {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 12px 14px;
  }

  .doc-fill {
    display: grid;
    flex: 1;
    min-height: 0;
    place-items: center;
  }

  .doc-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 10px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .doc-alert :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--app-danger);
  }

  .doc-truncated {
    margin: 0 0 10px;
    color: var(--app-warning);
    font-size: 12px;
    line-height: 1.45;
  }

  .doc-loading {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
  }
</style>
