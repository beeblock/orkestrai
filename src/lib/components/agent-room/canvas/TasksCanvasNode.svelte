<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { Archive, ArchiveRestore, ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, History, Link2, Paperclip, Plus, Scale, SquareKanban, StickyNote, Trash2, X } from '@lucide/svelte';
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
  // Mover pelo teclado ou pelo menu usa o mesmo patch do arrastar-e-soltar.
  function moveTaskBy(task: BoardTask, delta: number) {
    const index = COLUMNS.findIndex((column) => column.status === task.status);
    const next = COLUMNS[index + delta];
    if (next) void patchTask(task.id, { status: next.status });
  }

  function onCardKeydown(event: KeyboardEvent, task: BoardTask) {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === 'F2') {
      event.preventDefault();
      startEdit(task);
    } else if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      moveTaskBy(task, 1);
    } else if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      moveTaskBy(task, -1);
    }
  }

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
      <div class="mb-2 flex items-center justify-between"><span class="section-label">{m['tasks.column_manager']()}</span><span class="font-mono text-[10.5px] tabular-nums text-muted-foreground">{COLUMNS.length}/10</span></div>
      <div class="space-y-1.5">
        {#each COLUMNS as column, index (column.id)}
          <div class="grid grid-cols-[24px_minmax(0,1fr)_24px_24px_24px] items-center gap-1">
            <input
              type="color"
              value={column.color}
              aria-label={m['tasks.column_color']()}
              class="tb-color"
              onchange={(event) => updateColumn(column, { color: (event.target as HTMLInputElement).value })}
            />
            <input
              value={column.label}
              aria-label={m['tasks.column_name']()}
              class="h-7 min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-ui-md text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--app-accent)] focus:ring-3 focus:ring-[var(--app-accent)]/15"
              onchange={(event) => updateColumn(column, { name: (event.target as HTMLInputElement).value })}
            />
            <button class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-foreground disabled:opacity-30" aria-label={m['tasks.column_up']()} disabled={index === 0} onclick={() => updateColumn(column, { position: index - 1 })}><ChevronUp size={13} /></button>
            <button class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-foreground disabled:opacity-30" aria-label={m['tasks.column_down']()} disabled={index === COLUMNS.length - 1} onclick={() => updateColumn(column, { position: index + 1 })}><ChevronDown size={13} /></button>
            {#if column.builtin}
              <span class="h-6 w-6"></span>
            {:else}
              <button class="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-[var(--app-danger-soft)] hover:text-destructive" aria-label={m['tasks.column_delete']()} onclick={() => removeColumn(column)}><Trash2 size={12} /></button>
            {/if}
          </div>
        {/each}
      </div>
      <div class="mt-2 grid grid-cols-[24px_minmax(0,1fr)_28px] items-center gap-1">
        <input type="color" bind:value={newColumnColor} aria-label={m['tasks.column_color']()} class="tb-color" />
        <input
          bind:value={newColumnName}
          aria-label={m['tasks.column_name']()}
          placeholder={m['tasks.column_name_placeholder']()}
          class="h-7 min-w-0 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-ui-md text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:border-[var(--app-accent)] focus:ring-3 focus:ring-[var(--app-accent)]/15"
          disabled={COLUMNS.length >= 10}
          onkeydown={(event) => event.key === 'Enter' && addColumn()}
        />
        <button class="press inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-30" aria-label={m['tasks.column_add']()} disabled={!newColumnName.trim() || COLUMNS.length >= 10} onclick={addColumn}><Plus size={14} /></button>
      </div>
      {#if COLUMNS.length >= 10}<p class="mt-1.5 text-ui-xs text-muted-foreground">{m['tasks.column_limit']()}</p>{/if}
      {#if columnError}<p class="mt-1.5 text-ui-xs text-destructive" role="alert">{columnError}</p>{/if}
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

  <span id={`tb-card-hint-${id}`} class="sr-only">{m['tasks.card_hint']()}</span>
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
          <span class="tb-count" aria-label={String(tasks.filter((task) => task.status === column.status).length)}>{tasks.filter((task) => task.status === column.status).length}</span>
        </header>

        <div class="tb-cards">
          {#each tasks.filter((task) => task.status === column.status) as task (task.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <article
              class="tb-card"
              class:dragging={dragTaskId === task.id}
              class:attachment-drop-active={attachmentDropTaskId === task.id}
              tabindex="0"
              aria-label={task.title}
              aria-describedby={`tb-card-hint-${id}`}
              aria-keyshortcuts="Enter Alt+ArrowLeft Alt+ArrowRight"
              onkeydown={(event) => onCardKeydown(event, task)}
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
                <div class="tb-reveal">
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger class="tb-icon-btn subtle" aria-label={m['tasks.move_to']()} title={m['tasks.move_to']()}>
                      <ArrowRightLeft size={12} />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Content class="w-44">
                      <DropdownMenu.Label class="text-ui-xs text-[var(--app-text-muted)]">{m['tasks.move_to']()}</DropdownMenu.Label>
                      {#each COLUMNS.filter((column) => column.status !== task.status) as column (column.id)}
                        <DropdownMenu.Item onclick={() => patchTask(task.id, { status: column.status })}>
                          <span class="tb-menu-dot" style:background={column.hint}></span>{column.label}
                        </DropdownMenu.Item>
                      {/each}
                    </DropdownMenu.Content>
                  </DropdownMenu.Root>
                  <HeaderIconButton label={m['council.ask_perspectives']()} class="tb-icon-btn subtle" side="top" onclick={() => openCouncil(task)}>
                    <Scale size={12} />
                  </HeaderIconButton>
                  <HeaderIconButton label={m['tasks.remove_task']()} class="tb-icon-btn" side="top" onclick={() => removeTask(task)}>
                    <Trash2 size={12} />
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
                <span class="tb-spacer"></span>
                <span class="tb-reveal">
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger class="tb-icon-btn subtle tb-link-trigger" aria-label={m['tasks.link_note_aria']()} title={m['tasks.link_note_aria']()}>
                    <Link2 size={12} />
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
                  <Paperclip size={12} />
                </HeaderIconButton>
                {#if task.status === 'done'}
                  <HeaderIconButton label={m['tasks.archive_task']()} class="tb-icon-btn subtle" side="top" onclick={() => archiveTask(task)}>
                    <Archive size={12} />
                  </HeaderIconButton>
                {/if}
                </span>
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

  /* Seletor de cor nativo apresentado como uma bolinha. */
  .tb-color {
    appearance: none;
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    margin: 2px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    overflow: hidden;
    cursor: pointer;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-text) 16%, transparent);
  }

  .tb-color::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .tb-color::-webkit-color-swatch {
    border: none;
    border-radius: 50%;
  }

  .tb-color:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
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
    font-size: 11px;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .tb-history-status {
    flex-shrink: 0;
    font-size: 10.5px;
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
    max-width: 120px;
    height: 20px;
    padding: 0 7px;
    border-radius: 6px;
    border: 0;
    background: var(--app-secondary-soft);
    color: var(--app-secondary);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color var(--duration-quick) ease-out;
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

  /* ---- Composer ---------------------------------------------------------- */
  .tb-add-open {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 8px;
    border: 0;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 12.5px;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .tb-add-open:hover {
    color: var(--app-text);
    background: var(--app-hover);
  }

  .tb-composer {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    padding: 10px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-accent) 45%, var(--app-border)), 0 0 0 4px color-mix(in srgb, var(--app-accent) 10%, transparent);
    animation: tb-composer-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes tb-composer-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--distance-micro) * -1));
    }
  }

  .tb-composer.attachment-drop-active,
  .tb-card.attachment-drop-active {
    box-shadow: 0 0 0 2px var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 9%, var(--app-surface));
  }

  .tb-composer input,
  .tb-composer textarea,
  .tb-desc-edit {
    width: 100%;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-surface);
    color: var(--app-text);
    font-size: 12.5px;
    font-family: inherit;
    padding: 6px 9px;
    outline: none;
    resize: vertical;
    transition: border-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .tb-composer input {
    height: 32px;
    font-weight: 500;
  }

  .tb-composer input:focus,
  .tb-composer textarea:focus,
  .tb-desc-edit:focus {
    border-color: var(--app-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .tb-composer-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tb-spacer {
    flex: 1;
  }

  .tb-cancel {
    height: 28px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 12px;
    cursor: pointer;
    padding: 0 10px;
    border-radius: 7px;
  }

  .tb-cancel:hover {
    color: var(--app-text);
    background: var(--app-hover);
  }

  /* ---- Descricao markdown no cartao ------------------------------------------ */
  .tb-desc {
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--app-surface-subtle);
    max-height: 130px;
    overflow-y: auto;
    cursor: text;
    font-size: 12px;
  }

  .tb-add {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--app-border);
  }

  .tb-add input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .tb-add input:focus-visible {
    outline: none;
  }

  /* ---- Quadro e colunas ---------------------------------------------------- */
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
    flex: 1 0 150px;
    min-width: 150px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    padding: 8px;
    box-shadow: inset 0 0 0 1px transparent;
    transition: box-shadow var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  /* Coluna alvo durante o arraste: contorno na cor da coluna. */
  .tb-column.drop-target {
    background: color-mix(in srgb, var(--column-hint, var(--app-accent)) 8%, var(--app-surface-subtle));
    box-shadow: inset 0 0 0 1.5px var(--column-hint, var(--app-accent));
  }

  .tb-column-head {
    display: flex;
    align-items: center;
    gap: 7px;
    min-height: 22px;
    padding: 0 2px;
  }

  .tb-dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--column-hint, var(--app-accent));
  }

  .tb-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--app-text-soft);
  }

  .tb-count {
    min-width: 20px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
    background: var(--app-hover);
    border-radius: 999px;
    padding: 0 6px;
  }

  .tb-cards {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    overflow-y: auto;
    min-height: 40px;
    padding: 1px;
  }

  /* Zona de soltar vazia: ensina o gesto sem gritar. */
  .tb-empty {
    display: grid;
    place-items: center;
    min-height: 64px;
    font-size: 11.5px;
    color: var(--app-text-muted);
    text-align: center;
    padding: 12px 6px;
    border: 1px dashed color-mix(in srgb, var(--app-border-strong) 70%, transparent);
    border-radius: 8px;
  }

  .tb-history .tb-empty {
    border: 0;
  }

  /* ---- Cartoes ------------------------------------------------------------- */
  .tb-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--app-surface);
    border-radius: 8px;
    padding: 8px 8px 7px 10px;
    box-shadow: var(--app-shadow-border);
    cursor: grab;
    transition: box-shadow var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .tb-card:hover {
    box-shadow: var(--app-shadow-border-hover), 0 4px 12px color-mix(in srgb, #000000 12%, transparent);
  }

  .tb-card.dragging {
    opacity: 0.5;
    transform: scale(0.98);
    cursor: grabbing;
  }

  .tb-card:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  /* Acoes secundarias do cartao aparecem ao apontar ou focar. */
  .tb-reveal {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .tb-card:hover .tb-reveal,
  .tb-card:focus-within .tb-reveal {
    opacity: 1;
  }

  /* No topo, as acoes flutuam sobre o fim do titulo: nao roubam largura
     do texto quando estao ocultas. */
  .tb-card-top .tb-reveal {
    position: absolute;
    top: 5px;
    right: 5px;
    padding: 1px;
    border-radius: 7px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
    pointer-events: none;
  }

  .tb-card-top .tb-reveal > :global(*) {
    pointer-events: auto;
  }

  .tb-card:hover .tb-card-top .tb-reveal,
  .tb-card:focus-within .tb-card-top .tb-reveal {
    pointer-events: auto;
  }

  .tb-menu-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
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
    border: 0;
    border-radius: 6px;
    padding: 0;
    background: transparent;
    cursor: zoom-in;
    overflow: hidden;
    line-height: 0;
    outline: 1px solid var(--app-image-outline);
    outline-offset: -1px;
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
    outline: 1px solid var(--app-image-outline);
    outline-offset: -1px;
  }

  .tb-viewer-nav {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 48px;
    border: 0;
    background: var(--app-hover);
    color: var(--app-text-soft);
    border-radius: 8px;
    cursor: pointer;
  }

  .tb-viewer-nav:hover:not(:disabled) {
    background: var(--app-active);
    color: var(--app-text);
  }

  .tb-viewer-nav:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .tb-viewer-delete {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    border: 0;
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12.5px;
    border-radius: 7px;
    padding: 0 12px;
    cursor: pointer;
  }

  .tb-viewer-delete:hover {
    background: color-mix(in srgb, var(--app-danger) 24%, transparent);
  }

  .tb-card-top {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .tb-title {
    flex: 1;
    min-width: 0;
    padding-top: 1px;
    font-size: 12.5px;
    font-weight: 500;
    line-height: 1.45;
    color: var(--app-text);
    overflow-wrap: break-word;
    cursor: text;
  }

  .tb-edit {
    flex: 1;
    min-width: 0;
    height: 26px;
    border: 1px solid var(--app-accent);
    outline: none;
    background: var(--app-surface-subtle);
    border-radius: 6px;
    color: var(--app-text);
    font-size: 12.5px;
    padding: 0 7px;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .tb-card-bottom {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 22px;
  }

  .tb-board :global(.tb-assignee) {
    display: inline-flex;
    align-items: center;
    height: 20px;
    border: none;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    border-radius: 6px;
    padding: 0 7px;
    cursor: pointer;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .tb-board :global(.tb-assignee:hover),
  .tb-board :global(.tb-assignee[data-state='open']) {
    background: var(--app-active);
    color: var(--app-text);
  }

  .tb-board :global(.tb-icon-btn),
  .tb-add :global(.tb-icon-btn) {
    display: inline-grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    padding: 0;
    border-radius: 6px;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .tb-board :global(.tb-icon-btn:hover),
  .tb-add :global(.tb-icon-btn:hover) {
    color: var(--app-danger);
    background: var(--app-danger-soft);
  }

  .tb-board :global(.tb-icon-btn.subtle:hover),
  .tb-add :global(.tb-icon-btn.subtle:hover),
  .tb-board :global(.tb-icon-btn.subtle[data-state='open']) {
    color: var(--app-text);
    background: var(--app-hover);
  }

  .tb-board :global(.tb-add-btn),
  .tb-add :global(.tb-add-btn) {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 7px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    cursor: pointer;
    padding: 0;
    transition: background-color var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .tb-board :global(.tb-add-btn:active:not(:disabled)),
  .tb-add :global(.tb-add-btn:active:not(:disabled)) {
    transform: scale(var(--scale-press));
  }

  .tb-board :global(.tb-add-btn:disabled),
  .tb-add :global(.tb-add-btn:disabled) {
    opacity: 0.35;
    cursor: default;
  }

  @media (prefers-reduced-motion: reduce) {
    .tb-card,
    .tb-column {
      transition: none;
    }
  }
</style>
