<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { Archive, ArchiveRestore, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, History, Link2, Paperclip, Plus, Scale, SquareKanban, StickyNote, Trash2, X } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import AttachmentList from '../AttachmentList.svelte';
  import {
    attachmentsFromClipboard,
    attachmentsFromTransfer,
    transferHasWorkspaceAttachments,
    uploadWorkspaceAttachment,
  } from '../workspace-attachments.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
  import CouncilDialog from '../CouncilDialog.svelte';

  type BoardTask = {
    id: string;
    title: string;
    description: string | null;
    status: string;
    assigneeNodeId: string | null;
    assigneeTitle: string | null;
    imagePath: string | null;
    images: string[];
    attachments: WorkspaceAttachment[];
    createdBy: string;
    updatedAt: string;
    archivedAt: string | null;
    noteId: string | null;
    noteTitle: string | null;
  };

  type BoardColumn = {
    id: string;
    key: string;
    name: string | null;
    color: string;
    position: number;
    builtin: boolean;
  };

  export type TasksNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: TasksNodeData }>();

  function defaultColumnLabel(key: string): string {
    if (key === 'todo') return m['tasks.col_todo']();
    if (key === 'doing') return m['tasks.col_doing']();
    if (key === 'done') return m['tasks.col_done']();
    return key;
  }

  const FALLBACK_COLUMNS: BoardColumn[] = [
    { id: 'todo', key: 'todo', name: null, color: '#7de5ff', position: 0, builtin: true },
    { id: 'doing', key: 'doing', name: null, color: '#ffc857', position: 1, builtin: true },
    { id: 'done', key: 'done', name: null, color: '#8ec98e', position: 2, builtin: true },
  ];
  let taskColumns = $state<BoardColumn[]>([]);
  const COLUMNS = $derived((taskColumns.length ? taskColumns : FALLBACK_COLUMNS).map((column) => ({
    ...column,
    status: column.key,
    label: column.name ?? defaultColumnLabel(column.key),
    hint: column.color,
  })));

  let tasks = $state<BoardTask[]>([]);
  let agents = $state<Array<{ id: string; title: string }>>([]);
  let draft = $state('');
  let dragTaskId = $state<string | null>(null);
  let dropTarget = $state<BoardTask['status'] | null>(null);
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let fileInput: HTMLInputElement;
  let attachmentTargetId = $state<string | null>(null);
  let attachmentDropTaskId = $state<string | null>(null);
  let attachmentBusy = $state(false);
  let columnsOpen = $state(false);
  let columnError = $state('');
  let newColumnName = $state('');
  let newColumnColor = $state('#9675ff');
  let councilOpen = $state(false);
  let councilSource = $state<{ taskId: string; taskTitle: string; taskDescription: string | null } | null>(null);

  function openCouncil(task: BoardTask): void {
    councilSource = { taskId: task.id, taskTitle: task.title, taskDescription: task.description };
    councilOpen = true;
  }

  // -- Historico / arquivamento ------------------------------------------------
  // Quadro mostra so tarefas vivas; concluidas podem ser arquivadas (saem do
  // quadro, ficam no historico do workspace — o "o que foi feito" do projeto).
  let view = $state<'board' | 'history'>('board');
  let historyItems = $state<BoardTask[]>([]);
  let historyLoading = $state(false);
  let notes = $state<Array<{ id: string; title: string }>>([]);
  // Nota aberta a partir do historico (pode estar arquivada — fora do canvas).
  let noteViewer = $state<{ title: string; content: string } | null>(null);

  async function openLinkedNote(noteId: string, onCanvas: boolean) {
    if (onCanvas && data.onJumpToNode) {
      data.onJumpToNode(noteId);
      return;
    }
    const node = await api<{ title: string | null; payload?: { content?: string } }>(`/api/agent-room/workspaces/${data.workspaceId}/nodes/${noteId}`);
    if (node) noteViewer = { title: node.title ?? m['tasks.note_title_fallback'](), content: node.payload?.content ?? '' };
  }

  const doneCount = $derived(tasks.filter((task) => task.status === 'done').length);

  function fmtWhen(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  async function openHistory() {
    view = 'history';
    historyLoading = true;
    try {
      historyItems = (await api<BoardTask[]>(`/api/agent-room/workspaces/${data.workspaceId}/tasks/history`)) ?? [];
    } finally {
      historyLoading = false;
    }
  }

  async function archiveTask(task: BoardTask) {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${task.id}/archive`, { method: 'POST' });
    await refresh();
  }

  async function archiveAllDone() {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/archive-done`, { method: 'POST' });
    await refresh();
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      const response = await fetch(path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}),
          ...(init?.headers ?? {}),
        },
      });
      const payload = await response.json();
      if (!response.ok || payload.error) return null;
      return payload.data as T;
    } catch {
      return null;
    }
  }

  async function refresh() {
    const [taskList, nodeList, columnList] = await Promise.all([
      api<BoardTask[]>(`/api/agent-room/workspaces/${data.workspaceId}/tasks`),
      api<Array<{ id: string; type: string; title: string | null }>>(`/api/agent-room/workspaces/${data.workspaceId}/nodes`),
      api<BoardColumn[]>(`/api/agent-room/workspaces/${data.workspaceId}/task-columns`),
    ]);
    if (taskList) tasks = taskList;
    if (columnList) taskColumns = columnList;
    if (nodeList) {
      agents = nodeList.filter((node) => node.type === 'terminal').map((node) => ({ id: node.id, title: node.title ?? m['tasks.terminal_fallback']() }));
      notes = nodeList.filter((node) => node.type === 'note').map((node) => ({ id: node.id, title: node.title ?? m['tasks.note_fallback']() }));
    }
  }

  async function columnRequest<T>(path: string, init: RequestInit): Promise<T | null> {
    columnError = '';
    try {
      const token = getCsrfToken();
      const response = await fetch(path, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'X-CSRF-Token': token } : {}),
          ...(init.headers ?? {}),
        },
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        columnError = m['tasks.column_error']();
        return null;
      }
      return payload.data as T;
    } catch {
      columnError = m['tasks.column_error']();
      return null;
    }
  }

  async function addColumn() {
    const name = newColumnName.trim();
    if (!name) return;
    const created = await columnRequest<BoardColumn>(`/api/agent-room/workspaces/${data.workspaceId}/task-columns`, {
      method: 'POST',
      body: JSON.stringify({ name, color: newColumnColor }),
    });
    if (!created) return;
    newColumnName = '';
    newColumnColor = '#9675ff';
    await refresh();
  }

  async function updateColumn(column: BoardColumn, patch: Record<string, unknown>) {
    const updated = await columnRequest<BoardColumn>(`/api/agent-room/workspaces/${data.workspaceId}/task-columns/${column.id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    if (updated) await refresh();
  }

  async function removeColumn(column: BoardColumn) {
    const removed = await columnRequest(`/api/agent-room/workspaces/${data.workspaceId}/task-columns/${column.id}`, { method: 'DELETE' });
    if (removed) await refresh();
    else columnError = m['tasks.column_delete_blocked']();
  }

  onMount(() => {
    refresh();
    // Agentes (lider) alteram o quadro pela bridge — sincroniza periodico.
    const timer = setInterval(refresh, 5_000);
    return () => clearInterval(timer);
  });

  async function addTask() {
    const title = draft.trim();
    if (!title) return;
    const description = draftDescription.trim();
    const task = await api<BoardTask>(`/api/agent-room/workspaces/${data.workspaceId}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title, description: description || undefined, attachments: stagedAttachments }),
    });
    if (!task) return;
    imageError = '';
    draft = '';
    draftDescription = '';
    clearStaged();
    composerOpen = false;
    await refresh();
  }

  // -- Anexos no composer (anexar ANTES de criar a tarefa) ----------------------
  let composerOpen = $state(false);
  let draftDescription = $state('');
  let stagedAttachments = $state<WorkspaceAttachment[]>([]);

  function stageAttachments(attachments: WorkspaceAttachment[]) {
    const unique = new Map(stagedAttachments.map((attachment) => [attachment.id, attachment]));
    for (const attachment of attachments) unique.set(attachment.id, attachment);
    stagedAttachments = [...unique.values()].slice(0, 12);
  }

  function unstageAttachment(attachment: WorkspaceAttachment) {
    stagedAttachments = stagedAttachments.filter((item) => item.id !== attachment.id);
  }

  function clearStaged() {
    stagedAttachments = [];
  }

  async function uploadFiles(files: File[]): Promise<WorkspaceAttachment[]> {
    const attachments: WorkspaceAttachment[] = [];
    for (const file of files) attachments.push(await uploadWorkspaceAttachment(data.workspaceId, file));
    return attachments;
  }

  async function onComposerPaste(event: ClipboardEvent) {
    if (!event.clipboardData?.files.length) return;
    event.preventDefault();
    attachmentBusy = true;
    imageError = '';
    try {
      stageAttachments(await attachmentsFromClipboard(data.workspaceId, event.clipboardData));
    } catch (error) {
      imageError = attachmentErrorMessage(error);
    } finally {
      attachmentBusy = false;
    }
  }

  async function patchTask(taskId: string, patch: Record<string, unknown>) {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${taskId}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await refresh();
  }

  async function removeTask(task: BoardTask) {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${task.id}`, { method: 'DELETE' });
    await refresh();
  }

  // -- Edicao inline do titulo -------------------------------------------------
  function startEdit(task: BoardTask) {
    editingId = task.id;
    editDraft = task.title;
  }

  async function commitEdit() {
    const taskId = editingId;
    editingId = null;
    const title = editDraft.trim();
    if (taskId && title) await patchTask(taskId, { title });
  }

  // -- Edicao inline da descricao (markdown, duplo-clique) -----------------------
  let editingDescId = $state<string | null>(null);
  let editDescDraft = $state('');

  function startDescEdit(task: BoardTask) {
    editingDescId = task.id;
    editDescDraft = task.description ?? '';
  }

  async function commitDescEdit() {
    const taskId = editingDescId;
    editingDescId = null;
    if (taskId) await patchTask(taskId, { description: editDescDraft.trim() || null });
  }

  // -- Drag and drop entre colunas ----------------------------------------------
  function onDragStart(event: DragEvent, task: BoardTask) {
    dragTaskId = task.id;
    event.dataTransfer?.setData('text/plain', task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event: DragEvent, status: BoardTask['status']) {
    if (!dragTaskId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dropTarget = status;
  }

  async function onDrop(event: DragEvent, status: BoardTask['status']) {
    event.preventDefault();
    const taskId = dragTaskId ?? event.dataTransfer?.getData('text/plain');
    dropTarget = null;
    dragTaskId = null;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    await patchTask(task.id, { status });
  }

  // -- Anexos e imagens de referencia ------------------------------------------
  let viewerTask = $state<BoardTask | null>(null);
  let viewerIndex = $state(0);
  let imageError = $state('');

  function attachmentErrorMessage(error: unknown): string {
    return error instanceof Error && error.message === 'attachment_too_large'
      ? m['attachment.too_large']()
      : m['attachment.error']();
  }

  function pickAttachment(task: BoardTask) {
    imageError = '';
    attachmentTargetId = task.id;
    fileInput.click();
  }

  async function attachToTask(taskId: string, attachments: WorkspaceAttachment[]) {
    for (const attachment of attachments) {
      const result = await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${taskId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ attachment }),
      });
      if (!result) throw new Error('attachment_failed');
    }
    await refresh();
  }

  async function onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    attachmentBusy = true;
    imageError = '';
    try {
      const attachments = await uploadFiles(files);
      if (attachmentTargetId) await attachToTask(attachmentTargetId, attachments);
      else stageAttachments(attachments);
    } catch (error) {
      imageError = attachmentErrorMessage(error);
    } finally {
      attachmentBusy = false;
      attachmentTargetId = null;
    }
  }

  function onAttachmentDragOver(event: DragEvent, taskId: string | null = null) {
    if (!transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    attachmentDropTaskId = taskId ?? 'composer';
  }

  async function onAttachmentDrop(event: DragEvent, taskId: string | null = null) {
    if (!event.dataTransfer || !transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    attachmentDropTaskId = null;
    attachmentBusy = true;
    imageError = '';
    try {
      const attachments = await attachmentsFromTransfer(data.workspaceId, event.dataTransfer);
      if (taskId) await attachToTask(taskId, attachments);
      else stageAttachments(attachments);
    } catch (error) {
      imageError = attachmentErrorMessage(error);
    } finally {
      attachmentBusy = false;
    }
  }

  async function removeTaskAttachment(task: BoardTask, attachment: WorkspaceAttachment) {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${task.id}/attachments?attachmentId=${encodeURIComponent(attachment.id)}`, {
      method: 'DELETE',
    });
    await refresh();
  }

  function openViewer(task: BoardTask, index: number) {
    viewerTask = task;
    viewerIndex = index;
  }

  function viewerMove(delta: number) {
    if (!viewerTask?.images.length) return;
    viewerIndex = (viewerIndex + delta + viewerTask.images.length) % viewerTask.images.length;
  }

  async function viewerDelete() {
    if (!viewerTask) return;
    const path = viewerTask.images[viewerIndex];
    if (!path) return;
    const attachment = viewerTask.attachments.find((item) => item.path === path);
    if (attachment) await removeTaskAttachment(viewerTask, attachment);
    else await api(`/api/agent-room/workspaces/${data.workspaceId}/tasks/${viewerTask.id}/images?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
    await refresh();
    const updated = tasks.find((task) => task.id === viewerTask?.id);
    if (!updated?.images.length) viewerTask = null;
    else {
      viewerTask = updated;
      viewerIndex = Math.min(viewerIndex, updated.images.length - 1);
    }
  }

  const imageUrl = (path: string) =>
    `/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(path)}`;
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-tasks"
  accent="var(--app-success)"
  minWidth={400}
  minHeight={260}
  onResize={data.onResize}
  titleText={data.title}
  onRename={data.onRename}
  connections={data.connections ?? []}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<SquareKanban size={13} />{/snippet}
  {#snippet title()}{data.title || m['tasks.title_default']()}{/snippet}
  {#snippet actions()}
    {#if view === 'board'}
      <HeaderIconButton label={m['tasks.column_manager']()} class="node-action-btn" side="left" onclick={() => (columnsOpen = !columnsOpen)}>
        <Columns3 size={13} /></HeaderIconButton>
      {#if doneCount > 0}
        <HeaderIconButton label={m['tasks.archive_done_label']({ count: doneCount })} class="node-action-btn" side="left" onclick={archiveAllDone}>
          <Archive size={13} /></HeaderIconButton>
      {/if}
      <HeaderIconButton label={m['tasks.history_action']()} class="node-action-btn" side="left" onclick={openHistory}>
        <History size={13} /></HeaderIconButton>
    {:else}
      <HeaderIconButton label={m['tasks.back_to_board']()} class="node-action-btn" side="left" onclick={() => (view = 'board')}>
        <ArchiveRestore size={13} /></HeaderIconButton>
    {/if}
    <HeaderIconButton label={m['tasks.remove_board']()} class="node-action-btn" danger side="left" onclick={() => data.onDelete(id)}>
      <X size={13} /></HeaderIconButton>
  {/snippet}

  <input bind:this={fileInput} type="file" multiple class="tb-hidden" onchange={onFilePicked} />

  {#if imageError}
    <p class="tb-image-error nodrag">{imageError}</p>
  {/if}

  {#if view === 'history'}
    <div class="tb-history nodrag nowheel">
      {#if historyLoading}
        <span class="tb-empty">{m['tasks.history_loading']()}</span>
      {:else if historyItems.length === 0}
        <span class="tb-empty">{m['tasks.history_empty']()}</span>
      {:else}
        {#each historyItems as item (item.id)}
          <article class="tb-history-row">
            <div class="tb-history-main">
              <span class="tb-history-title">{item.title}</span>
              <span class="tb-history-meta">
                {item.assigneeTitle ?? m['tasks.no_assignee_inline']()} · {fmtWhen(item.updatedAt)}
                {#if item.archivedAt} · {m['tasks.status_archived']()}{/if}
              </span>
            </div>
            {#if item.noteId}
              <button
                class="tb-note-chip"
                title={m['tasks.open_note_title']({ title: item.noteTitle ?? m['tasks.note_fallback']() })}
                onclick={() => openLinkedNote(item.noteId!, !item.archivedAt)}
              >
                <StickyNote size={10} />
                <span class="tb-note-chip-label">{item.noteTitle ?? m['tasks.note_fallback']()}</span>
              </button>
            {/if}
            <span class="tb-history-status" class:archived={Boolean(item.archivedAt)}>{item.archivedAt ? m['tasks.status_archived']() : m['tasks.status_done']()}</span>
          </article>
        {/each}
      {/if}
    </div>
  {:else}
  {#if columnsOpen}
    <div class="nodrag border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2.5 py-2">
      <div class="mb-2 flex justify-end text-[10px] tabular-nums text-muted-foreground">{COLUMNS.length}/10</div>
      <div class="space-y-1.5">
        {#each COLUMNS as column, index (column.id)}
          <div class="grid grid-cols-[24px_minmax(0,1fr)_24px_24px_24px] items-center gap-1">
            <input
              type="color"
              value={column.color}
              aria-label={m['tasks.column_color']()}
              class="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
              onchange={(event) => updateColumn(column, { color: (event.target as HTMLInputElement).value })}
            />
            <input
              value={column.label}
              aria-label={m['tasks.column_name']()}
              class="h-7 min-w-0 rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-xs text-foreground outline-none focus:border-primary"
              onchange={(event) => updateColumn(column, { name: (event.target as HTMLInputElement).value })}
            />
            <button class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label={m['tasks.column_up']()} disabled={index === 0} onclick={() => updateColumn(column, { position: index - 1 })}><ChevronUp size={13} /></button>
            <button class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30" aria-label={m['tasks.column_down']()} disabled={index === COLUMNS.length - 1} onclick={() => updateColumn(column, { position: index + 1 })}><ChevronDown size={13} /></button>
            {#if column.builtin}
              <span class="h-6 w-6"></span>
            {:else}
              <button class="inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive" aria-label={m['tasks.column_delete']()} onclick={() => removeColumn(column)}><Trash2 size={12} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="mt-2 grid grid-cols-[24px_minmax(0,1fr)_28px] items-center gap-1">
        <input type="color" bind:value={newColumnColor} aria-label={m['tasks.column_color']()} class="h-6 w-6 cursor-pointer border-0 bg-transparent p-0" />
        <input
          bind:value={newColumnName}
          aria-label={m['tasks.column_name']()}
          placeholder={m['tasks.column_name_placeholder']()}
          class="h-7 min-w-0 rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-xs text-foreground outline-none focus:border-primary"
          disabled={COLUMNS.length >= 10}
          onkeydown={(event) => event.key === 'Enter' && addColumn()}
        />
        <button class="inline-flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground disabled:opacity-30" aria-label={m['tasks.column_add']()} disabled={!newColumnName.trim() || COLUMNS.length >= 10} onclick={addColumn}><Plus size={14} /></button>
      </div>
      {#if COLUMNS.length >= 10}<p class="mt-1.5 text-[10px] text-muted-foreground">{m['tasks.column_limit']()}</p>{/if}
      {#if columnError}<p class="mt-1.5 text-[10px] text-destructive" role="alert">{columnError}</p>{/if}
    </div>
  {/if}
  <div class="tb-add nodrag">
    {#if composerOpen}
      <div
        class="tb-composer"
        class:attachment-drop-active={attachmentDropTaskId === 'composer'}
        role="group"
        aria-label={m['attachment.task_drop_target']()}
        ondragover={(event) => onAttachmentDragOver(event)}
        ondragleave={() => (attachmentDropTaskId = null)}
        ondrop={(event) => onAttachmentDrop(event)}
      >
        <input
          bind:value={draft}
          placeholder={m['ph.task_title']()}
          aria-label={m['tasks.title_aria']()}
          autocomplete="off"
          spellcheck="false"
          onpaste={onComposerPaste}
          onkeydown={(event) => {
            if (event.key === 'Enter') addTask();
            if (event.key === 'Escape') composerOpen = false;
          }}
        />
        <textarea
          bind:value={draftDescription}
          placeholder={m['ph.task_desc']()}
          aria-label={m['tasks.desc_aria']()}
          rows="3"
          spellcheck="false"
          onpaste={onComposerPaste}
        ></textarea>
        <AttachmentList
          workspaceId={data.workspaceId}
          attachments={stagedAttachments}
          compact
          onRemove={unstageAttachment}
        />
        <div class="tb-composer-actions">
          <HeaderIconButton label={m['attachment.add']()} class="tb-icon-btn subtle" side="top" disabled={attachmentBusy} onclick={() => { attachmentTargetId = null; fileInput.click(); }}>
            <Paperclip size={13} />
          </HeaderIconButton>
          <span class="tb-spacer"></span>
          <button class="tb-cancel" onclick={() => { composerOpen = false; clearStaged(); }}>{m['tasks.cancel']()}</button>
          <HeaderIconButton label={m['tasks.add_task']()} class="tb-add-btn" side="top" onclick={addTask} disabled={!draft.trim()}>
            <Plus size={14} />
          </HeaderIconButton>
        </div>
      </div>
    {:else}
      <button class="tb-add-open" onclick={() => (composerOpen = true)}>
        <Plus size={14} /> {m['tasks.add_task']()}
      </button>
    {/if}
  </div>

  <div class="tb-board nodrag nowheel">
    {#each COLUMNS as column (column.id)}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <section
        class="tb-column"
        class:drop-target={dropTarget === column.status}
        style:--column-hint={column.hint}
        ondragover={(event) => onDragOver(event, column.status)}
        ondragleave={() => (dropTarget = null)}
        ondrop={(event) => onDrop(event, column.status)}
      >
        <header class="tb-column-head">
          <span class="tb-dot"></span>
          <span class="tb-label">{column.label}</span>
          <span class="tb-count">{tasks.filter((task) => task.status === column.status).length}</span>
        </header>

        <div class="tb-cards">
          {#each tasks.filter((task) => task.status === column.status) as task (task.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <article
              class="tb-card"
              class:dragging={dragTaskId === task.id}
              class:attachment-drop-active={attachmentDropTaskId === task.id}
              draggable="true"
              ondragstart={(event) => onDragStart(event, task)}
              ondragend={() => { dragTaskId = null; dropTarget = null; }}
              ondragover={(event) => onAttachmentDragOver(event, task.id)}
              ondragleave={() => (attachmentDropTaskId = null)}
              ondrop={(event) => onAttachmentDrop(event, task.id)}
            >
              {#if task.images?.length}
                <div class="tb-thumbs">
                  {#each task.images as path, index (path)}
                    <button class="tb-thumb-btn" aria-label={m['tasks.view_image']({ index: index + 1, total: task.images.length })} onclick={() => openViewer(task, index)}>
                      <img class="tb-thumb" src={imageUrl(path)} alt="" loading="lazy" />
                    </button>
                  {/each}
                </div>
              {/if}
              <div class="tb-card-top">
                {#if editingId === task.id}
                  <input
                    class="tb-edit nodrag"
                    bind:value={editDraft}
                    aria-label={m['tasks.edit_task']()}
                    spellcheck="false"
                    onkeydown={(event) => {
                      if (event.key === 'Enter') commitEdit();
                      if (event.key === 'Escape') editingId = null;
                    }}
                    onblur={commitEdit}
                  />
                {:else}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <span class="tb-title" title={undefined} ondblclick={() => startEdit(task)}>{task.title}</span>
                {/if}
                <div class="flex shrink-0 items-center gap-0.5">
                  <HeaderIconButton label={m['council.ask_perspectives']()} class="tb-icon-btn subtle" side="top" onclick={() => openCouncil(task)}>
                    <Scale size={11} />
                  </HeaderIconButton>
                  <HeaderIconButton label={m['tasks.remove_task']()} class="tb-icon-btn" side="top" onclick={() => removeTask(task)}>
                    <Trash2 size={11} />
                  </HeaderIconButton>
                </div>
              </div>
              {#if task.description?.trim()}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="tb-desc" ondblclick={() => startDescEdit(task)}>
                  <MarkdownView content={task.description} compact />
                </div>
              {:else if editingDescId === task.id}{/if}
              {#if editingDescId === task.id}
                <textarea
                  class="tb-desc-edit nodrag"
                  bind:value={editDescDraft}
                  aria-label={m['tasks.edit_desc']()}
                  rows="4"
                  spellcheck="false"
                  onkeydown={(event) => {
                    if (event.key === 'Escape') editingDescId = null;
                  }}
                  onblur={commitDescEdit}
                ></textarea>
              {/if}
              <AttachmentList
                workspaceId={data.workspaceId}
                attachments={(task.attachments ?? []).filter((attachment) => !attachment.path || !task.images.includes(attachment.path))}
                compact
                onRemove={(attachment) => removeTaskAttachment(task, attachment)}
              />
              <div class="tb-card-bottom">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="tb-assignee" aria-label={m['tasks.assign_aria']()}>
                    {task.assigneeTitle ?? m['tasks.assign_fallback']()}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content class="w-44">
                    <DropdownMenu.Item onclick={() => patchTask(task.id, { assigneeNodeId: null })}>{m['tasks.no_assignee']()}</DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    {#each agents as agent (agent.id)}
                      <DropdownMenu.Item onclick={() => patchTask(task.id, { assigneeNodeId: agent.id })}>{agent.title}</DropdownMenu.Item>
                    {/each}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                {#if task.noteId}
                  <button
                    class="tb-note-chip"
                    title={m['tasks.linked_note_title']({ title: task.noteTitle ?? m['tasks.note_fallback']() })}
                    onclick={() => openLinkedNote(task.noteId!, true)}
                  >
                    <StickyNote size={10} />
                    <span class="tb-note-chip-label">{task.noteTitle ?? m['tasks.note_fallback']()}</span>
                  </button>
                {/if}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="tb-icon-btn subtle tb-link-trigger" aria-label={m['tasks.link_note_aria']()}>
                    <Link2 size={11} />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content class="w-52">
                    {#if task.noteId}
                      <DropdownMenu.Item onclick={() => patchTask(task.id, { noteId: null })}>{m['tasks.unlink_note']()}</DropdownMenu.Item>
                      <DropdownMenu.Separator />
                    {/if}
                    {#each notes.filter((note) => note.id !== task.noteId) as note (note.id)}
                      <DropdownMenu.Item onclick={() => patchTask(task.id, { noteId: note.id })}>{note.title}</DropdownMenu.Item>
                    {:else}
                      <DropdownMenu.Item disabled>{m['tasks.no_notes']()}</DropdownMenu.Item>
                    {/each}
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
                <HeaderIconButton label={m['attachment.add_to_task']()} class="tb-icon-btn subtle" side="top" disabled={attachmentBusy} onclick={() => pickAttachment(task)}>
                  <Paperclip size={11} />
                </HeaderIconButton>
                {#if task.status === 'done'}
                  <HeaderIconButton label={m['tasks.archive_task']()} class="tb-icon-btn subtle" side="top" onclick={() => archiveTask(task)}>
                    <Archive size={11} />
                  </HeaderIconButton>
                {/if}
              </div>
            </article>
          {:else}
            <span class="tb-empty">{m['tasks.drop_hint']()}</span>
          {/each}
        </div>
      </section>
    {/each}
  </div>
  {/if}
</NodeShell>

<CouncilDialog bind:open={councilOpen} workspaceId={data.workspaceId} source={councilSource} />

{#if viewerTask}
  <Dialog.Root open={viewerTask !== null} onOpenChange={(open: boolean) => !open && (viewerTask = null)}>
    <Dialog.Content class="tb-viewer-content">
      <Dialog.Header>
        <Dialog.Title>{viewerTask.title}</Dialog.Title>
        <Dialog.Description>{m['tasks.viewer_desc']({ index: viewerIndex + 1, total: viewerTask.images.length })}</Dialog.Description>
      </Dialog.Header>
      <div class="tb-viewer-body">
        <button class="tb-viewer-nav" aria-label={m['tasks.img_prev']()} onclick={() => viewerMove(-1)} disabled={viewerTask.images.length < 2}>
          <ChevronLeft size={18} />
        </button>
        <img class="tb-viewer-img" src={imageUrl(viewerTask.images[viewerIndex])} alt={m['tasks.img_alt']()} />
        <button class="tb-viewer-nav" aria-label={m['tasks.img_next']()} onclick={() => viewerMove(1)} disabled={viewerTask.images.length < 2}>
          <ChevronRight size={18} />
        </button>
      </div>
      <Dialog.Footer>
        <button class="tb-viewer-delete" onclick={viewerDelete}>
          <Trash2 size={13} /> {m['tasks.image_remove']()}
        </button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

{#if noteViewer}
  <Dialog.Root open={noteViewer !== null} onOpenChange={(open: boolean) => !open && (noteViewer = null)}>
    <Dialog.Content class="tb-viewer-content">
      <Dialog.Header>
        <Dialog.Title>{noteViewer.title}</Dialog.Title>
        <Dialog.Description>{m['tasks.note_viewer_desc']()}</Dialog.Description>
      </Dialog.Header>
      <div class="tb-note-viewer-body nodrag nowheel">
        <MarkdownView content={noteViewer.content} />
      </div>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .tb-hidden {
    display: none;
  }

  .tb-image-error {
    margin: 0 8px 6px;
    font-size: 11px;
    color: var(--app-danger);
  }

  .tb-history {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    padding: 2px 6px 8px;
    flex: 1;
    min-height: 0;
  }

  .tb-history-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 8px;
    background: var(--app-surface-subtle);
    border: 1px solid var(--app-border);
  }

  .tb-history-main {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .tb-history-title {
    font-size: 12px;
    color: var(--app-text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-history-meta {
    font-size: 10px;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tb-history-status {
    flex-shrink: 0;
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    border-radius: 999px;
    padding: 2px 8px;
  }

  .tb-history-status.archived {
    color: var(--app-text-muted);
    background: var(--app-border);
  }

  .tb-note-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    max-width: 110px;
    padding: 2px 7px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--app-secondary) 35%, var(--app-border));
    background: color-mix(in srgb, var(--app-secondary) 9%, transparent);
    color: var(--app-secondary);
    font-size: 9.5px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background 120ms ease;
  }

  .tb-note-chip:hover {
    background: color-mix(in srgb, var(--app-secondary) 17%, transparent);
  }

  .tb-note-chip-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-link-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    cursor: pointer;
    border-radius: 6px;
    padding: 2px;
  }

  .tb-note-viewer-body {
    max-height: 55vh;
    overflow-y: auto;
    padding: 4px 2px;
  }

  /* ---- Composer estilo Trello ---------------------------------------------- */
  .tb-add-open {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px dashed var(--app-border-strong);
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11.5px;
    cursor: pointer;
    transition: color 120ms ease, border-color 120ms ease;
  }

  .tb-add-open:hover {
    color: var(--app-text);
    border-color: var(--app-text-muted);
  }

  .tb-composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--app-accent) 42%, var(--app-border));
    background: color-mix(in srgb, var(--app-accent) 7%, var(--app-surface));
  }

  .tb-composer.attachment-drop-active,
  .tb-card.attachment-drop-active {
    border-color: var(--app-accent);
    box-shadow: inset 0 0 0 1px var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 9%, var(--app-surface));
  }

  .tb-composer input,
  .tb-composer textarea,
  .tb-desc-edit {
    width: 100%;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-surface-subtle);
    color: var(--app-text);
    font-size: 12px;
    font-family: inherit;
    padding: 6px 9px;
    outline: none;
    resize: vertical;
  }

  .tb-composer input:focus,
  .tb-composer textarea:focus,
  .tb-desc-edit:focus {
    border-color: var(--app-accent);
  }

  .tb-composer-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .tb-spacer {
    flex: 1;
  }

  .tb-cancel {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }

  .tb-cancel:hover {
    color: var(--app-text);
    background: var(--app-border);
  }

  /* ---- Descricao markdown no cartao ------------------------------------------ */
  .tb-desc {
    margin: 2px 6px 0;
    padding: 6px 8px;
    border-radius: 7px;
    background: var(--app-surface-subtle);
    max-height: 130px;
    overflow-y: auto;
    cursor: text;
  }

  .tb-add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--app-border);
  }

  .tb-add input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .tb-add input:focus-visible {
    outline: none;
  }

  .tb-board {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 8px;
    padding: 10px;
    overflow: auto;
    background: var(--app-canvas);
  }

  .tb-column {
    flex: 1 0 120px;
    min-width: 120px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    border: 1px solid transparent;
    padding: 8px;
    transition: border-color 140ms ease, background 140ms ease;
  }

  .tb-column.drop-target {
    border-color: var(--column-hint, var(--app-accent));
    background: var(--app-border);
  }

  .tb-column-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 2px;
  }

  .tb-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--column-hint, var(--app-accent));
  }

  .tb-label {
    flex: 1;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--app-text-muted);
  }

  .tb-count {
    font-size: 10px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
    background: var(--app-border);
    border-radius: 8px;
    padding: 1px 7px;
  }

  .tb-cards {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 40px;
  }

  .tb-empty {
    font-size: 11px;
    color: var(--app-text-muted);
    font-style: italic;
    text-align: center;
    padding: 14px 4px;
    border: 1px dashed var(--app-border);
    border-radius: 8px;
  }

  .tb-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 9px;
    padding: 7px 8px;
    cursor: grab;
    transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }

  .tb-card:hover {
    border-color: var(--app-border-strong);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  }

  .tb-card.dragging {
    opacity: 0.45;
    cursor: grabbing;
  }

  .tb-card:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .tb-cover {
    width: 100%;
    max-height: 90px;
    object-fit: cover;
    border-radius: 6px;
    display: block;
  }

  .tb-thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .tb-thumb-btn {
    border: 1px solid var(--app-border);
    border-radius: 6px;
    padding: 0;
    background: transparent;
    cursor: zoom-in;
    overflow: hidden;
    line-height: 0;
  }

  .tb-thumb-btn:hover {
    border-color: var(--app-border-strong);
  }

  .tb-thumb {
    width: 52px;
    height: 38px;
    object-fit: cover;
    display: block;
  }

  :global(.tb-viewer-content) {
    max-width: min(860px, 92vw) !important;
  }

  .tb-viewer-body {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
  }

  .tb-viewer-img {
    max-width: 100%;
    max-height: 62vh;
    border-radius: 10px;
    object-fit: contain;
    background: var(--app-canvas);
  }

  .tb-viewer-nav {
    flex-shrink: 0;
    border: 1px solid var(--app-border);
    background: var(--app-border);
    color: var(--app-text-soft);
    border-radius: 8px;
    padding: 8px 4px;
    cursor: pointer;
  }

  .tb-viewer-nav:hover:not(:disabled) {
    background: var(--app-surface-raised);
  }

  .tb-viewer-nav:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .tb-viewer-delete {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgba(229, 72, 77, 0.4);
    background: rgba(229, 72, 77, 0.12);
    color: var(--app-danger);
    font-size: 12px;
    border-radius: 8px;
    padding: 6px 12px;
    cursor: pointer;
  }

  .tb-viewer-delete:hover {
    background: rgba(229, 72, 77, 0.22);
  }

  .tb-card-top {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .tb-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--app-text);
    overflow-wrap: break-word;
    cursor: text;
  }

  .tb-edit {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: var(--app-border);
    border-radius: 6px;
    color: var(--app-text);
    font-size: 12px;
    padding: 2px 6px;
  }

  .tb-card-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .tb-board :global(.tb-assignee) {
    border: none;
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    color: var(--app-success);
    font-size: 10px;
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-board :global(.tb-icon-btn) {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: 5px;
  }

  .tb-board :global(.tb-icon-btn:hover) {
    color: var(--app-danger);
    background: var(--app-border);
  }

  .tb-board :global(.tb-icon-btn.subtle:hover) {
    color: var(--app-secondary);
  }

  .tb-board :global(.tb-add-btn) {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--app-success);
    cursor: pointer;
    padding: 2px;
  }

  .tb-board :global(.tb-add-btn:disabled) {
    opacity: 0.3;
    cursor: default;
  }

  .tb-add :global(.tb-add-btn) {
    display: inline-flex;
    border: none;
    background: transparent;
    color: var(--app-success);
    cursor: pointer;
    padding: 2px;
  }

  .tb-add :global(.tb-add-btn:disabled) {
    opacity: 0.3;
    cursor: default;
  }

  @media (prefers-reduced-motion: reduce) {
    .tb-card,
    .tb-column {
      transition: none;
    }
  }
</style>
