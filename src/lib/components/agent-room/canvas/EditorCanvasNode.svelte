<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { languages } from '@codemirror/language-data';
  import { CircleAlert, CircleCheck, FileCode2, Info, MessageSquareQuote, RefreshCw, Save, X } from '@lucide/svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as m from '$lib/paraglide/messages.js';

  export type EditorNodeData = {
    title: string;
    workspaceId: string;
    payload: { path?: string };
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: EditorNodeData }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let dirty = $state(false);
  let truncated = $state(false);
  let statusMessage = $state('');
  // Tom so da mensagem na tela: sucesso e orientacao nao devem aparecer em vermelho.
  let statusTone = $state<'danger' | 'info' | 'success'>('danger');
  let saving = $state(false);

  const filePath = $derived(data.payload.path ?? '');
  const fileName = $derived(filePath.split('/').at(-1) ?? 'editor');
  const fileDir = $derived(filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '');

  function languageFor(path: string) {
    const ext = path.split('.').at(-1) ?? '';
    return languages.find((item) => item.extensions.includes(ext)) ?? null;
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['editor.error_api']());
    return payload.data as T;
  }

  async function loadFile() {
    if (!filePath) return;
    statusMessage = '';
    try {
      const result = await api<{ content: string; truncated: boolean }>(
        `/api/agent-room/workspaces/${data.workspaceId}/fs/read?path=${encodeURIComponent(filePath)}`
      );
      truncated = result.truncated;
      dirty = false;
      const lang = languageFor(filePath);
      const langExtension = lang ? await lang.load() : null;
      view?.destroy();
      view = new EditorView({
        parent: container,
        state: EditorState.create({
          doc: result.content,
          extensions: [
            basicSetup,
            oneDark,
            ...(langExtension ? [langExtension] : []),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) dirty = true;
            }),
            EditorView.theme({
              '&': { height: '100%', fontSize: '12px' },
              '.cm-scroller': { overflow: 'auto' },
            }),
          ],
        }),
      });
    } catch (error) {
      statusTone = 'danger';
      statusMessage = error instanceof Error ? error.message : m['editor.error_open']();
    }
  }

  async function save() {
    if (!view || !filePath) return;
    saving = true;
    statusMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${data.workspaceId}/fs/write`, {
        method: 'PUT',
        body: JSON.stringify({ path: filePath, content: view.state.doc.toString() }),
      });
      dirty = false;
    } catch (error) {
      statusTone = 'danger';
      statusMessage = error instanceof Error ? error.message : m['editor.error_save']();
    } finally {
      saving = false;
    }
  }

  async function citeSelection() {
    if (!view) return;
    const selection = view.state.selection.main;
    if (selection.empty) {
      statusTone = 'info';
      statusMessage = m['editor.cite_no_selection']();
      return;
    }
    const text = view.state.sliceDoc(selection.from, selection.to);
    const target = (data.connections ?? []).find((connection: NodeConnection) => connection.targetType === 'terminal');
    if (!target) {
      statusTone = 'info';
      statusMessage = m['editor.cite_no_terminal']();
      return;
    }
    statusMessage = '';
    try {
      await api(`/api/agent-room/workspaces/${data.workspaceId}/terminals/${target.targetId}/write`, {
        method: 'POST',
        body: JSON.stringify({ data: `\n[citacao de ${fileName}:${selection.from}-${selection.to}]\n${text}\n` }),
      });
      statusTone = 'success';
      statusMessage = m['editor.cite_sent']({ title: target.targetTitle });
    } catch (error) {
      statusTone = 'danger';
      statusMessage = error instanceof Error ? error.message : m['editor.error_cite']();
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      event.stopPropagation();
      save();
    }
  }

  onMount(() => {
    loadFile();
    return () => view?.destroy();
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-editor"
  accent="var(--app-secondary)"
  minWidth={360}
  minHeight={220}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<FileCode2 size={13} />{/snippet}
  {#snippet title()}
    <!-- Sem arquivo, o titulo do no ainda identifica o editor no canvas. -->
    {fileName || data.title}
    {#if dirty}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="dirty-badge" role="img" aria-label={m['editor.unsaved']()}></span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">{m['editor.unsaved']()}</Tooltip.Content>
      </Tooltip.Root>
    {/if}
    {#if truncated}
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <span {...props} class="trunc-badge" aria-label={m['editor.truncated_tooltip']()}>{m['editor.truncated_badge']()}</span>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content side="top">{m['editor.truncated_tooltip']()}</Tooltip.Content>
      </Tooltip.Root>
    {/if}
  {/snippet}
  {#snippet actions()}
    {#if filePath}
      <HeaderIconButton class="node-action-btn" label={m['editor.cite_tooltip']()} onclick={citeSelection}>
        <MessageSquareQuote size={13} />
      </HeaderIconButton>
      <HeaderIconButton class="node-action-btn" label={m['editor.save']()} active={dirty && !saving} disabled={saving || !dirty} onclick={save}><Save size={13} /></HeaderIconButton>
      <HeaderIconButton class="node-action-btn" label={m['editor.reload']()} onclick={loadFile}><RefreshCw size={13} /></HeaderIconButton>
    {/if}
    <HeaderIconButton class="node-action-btn" label={m['editor.close']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  <div role="presentation" onkeydown={handleKeydown} class="editor-wrap">
    {#if filePath}
      <p class="editor-path" title={filePath}>{#if fileDir}<span class="editor-dir">{fileDir}/</span>{/if}<span class="editor-file">{fileName}</span></p>
    {/if}
    <div class="editor-body nodrag nowheel" class:hidden={!filePath} bind:this={container}></div>
    {#if !filePath}
      <NodeEmptyState icon={FileCode2} title={m['editor.empty_title']()} description={m['editor.empty_hint']()} />
    {/if}
    {#if statusMessage}
      <p class="editor-status" data-tone={statusTone} role={statusTone === 'danger' ? 'alert' : 'status'}>
        {#if statusTone === 'success'}<CircleCheck size={13} aria-hidden="true" />{:else if statusTone === 'info'}<Info size={13} aria-hidden="true" />{:else}<CircleAlert size={13} aria-hidden="true" />{/if}
        <span>{statusMessage}</span>
      </p>
    {/if}
  </div>
</NodeShell>

<style>
  .editor-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  /* Nao salvo: ponto discreto ao lado do nome, com nome acessivel. */
  .dirty-badge {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-left: 7px;
    border-radius: 50%;
    background: var(--app-warning);
    vertical-align: 1px;
  }

  .trunc-badge {
    display: inline-flex;
    align-items: center;
    height: 18px;
    margin-left: 7px;
    padding: 0 6px;
    border-radius: 5px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    font-size: 11px;
    font-weight: 500;
    vertical-align: 1px;
  }

  .editor-path {
    flex: none;
    margin: 0;
    padding: 5px 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .editor-dir {
    color: var(--app-text-muted);
  }

  .editor-file {
    color: var(--app-text-soft);
  }

  .editor-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .editor-body.hidden {
    display: none;
  }

  .editor-body :global(.cm-editor) {
    height: 100%;
  }

  .editor-status {
    display: flex;
    flex: none;
    align-items: flex-start;
    gap: 7px;
    margin: 0;
    padding: 7px 12px;
    border-top: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .editor-status :global(svg) {
    flex: none;
    margin-top: 2px;
  }

  .editor-status[data-tone='danger'] {
    background: var(--app-danger-soft);
  }

  .editor-status[data-tone='danger'] :global(svg) {
    color: var(--app-danger);
  }

  .editor-status[data-tone='success'] :global(svg) {
    color: var(--app-success);
  }

  .editor-status[data-tone='info'] :global(svg) {
    color: var(--app-info);
  }
</style>
