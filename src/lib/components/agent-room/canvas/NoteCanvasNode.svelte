<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Eye, Paperclip, Pencil, StickyNote, X } from '@lucide/svelte';
  import MarkdownView from '../MarkdownView.svelte';
  import AttachmentList from '../AttachmentList.svelte';
  import {
    attachmentMarkdown,
    attachmentsFromClipboard,
    attachmentsFromTransfer,
    deleteWorkspaceAttachment,
    MAX_WORKSPACE_ATTACHMENTS,
    removeAttachmentMarkdown,
    transferHasWorkspaceAttachments,
    uploadWorkspaceAttachment,
  } from '../workspace-attachments.js';
  import * as m from '$lib/paraglide/messages.js';

  const NOTE_COLORS: Record<string, { color: string; label: string }> = {
    yellow: { color: '#d09a00', label: m['note.color_yellow']() },
    blue: { color: '#3e78d8', label: m['note.color_blue']() },
    green: { color: '#298457', label: m['note.color_green']() },
    purple: { color: '#8357c5', label: m['note.color_purple']() },
    red: { color: '#c84f57', label: m['note.color_red']() },
    neutral: { color: '#777487', label: m['note.color_neutral']() },
  };
  import NodeShell from './NodeShell.svelte';
  import * as Popover from '$lib/components/ui/popover';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import type { NoteNodePayload, WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';

  export type NoteNodeData = {
    title: string;
    workspaceId: string;
    payload: NoteNodePayload;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onContentChange: (id: string, content: string) => void | Promise<void>;
    onColorChange?: (id: string, color: string) => void;
    onPayloadChange?: (id: string, partial: Record<string, unknown>) => void | Promise<void>;
  };

  let { id, data, selected } = $props<NodeProps & { data: NoteNodeData }>();

  let draft = $state(data.payload.content ?? '');
  let formatted = $state(Boolean(data.payload.formatted));
  let attachments = $state<WorkspaceAttachment[]>([...(data.payload.attachments ?? [])]);
  let attachmentInput: HTMLInputElement;
  let attachmentBusy = $state(false);
  let attachmentDropActive = $state(false);
  let attachmentError = $state('');
  const noteColor = $derived(NOTE_COLORS[(data.payload as { color?: string }).color ?? 'yellow'] ?? NOTE_COLORS.yellow);

  function setColor(color: string) {
    data.onContentChange(id, draft);
    (data.payload as Record<string, unknown>).color = color;
    data.onColorChange?.(id, color);
  }
  let debounce: ReturnType<typeof setTimeout> | null = null;

  function handleInput() {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => data.onContentChange(id, draft), 600);
  }

  function toggleFormatted() {
    formatted = !formatted;
  }

  async function addAttachments(next: WorkspaceAttachment[], at = draft.length) {
    if (!next.length) return;
    const available = Math.max(0, MAX_WORKSPACE_ATTACHMENTS - attachments.length);
    const accepted = next.slice(0, available);
    await Promise.allSettled(next.slice(available).map(
      (attachment) => deleteWorkspaceAttachment(data.workspaceId, attachment),
    ));
    if (!accepted.length) return;

    const previousAttachments = attachments;
    const previousDraft = draft;
    attachments = [...attachments, ...accepted];
    const markdown = accepted.map((attachment) => attachmentMarkdown(data.workspaceId, attachment)).join('\n\n');
    const separatorBefore = at > 0 && !draft.slice(0, at).endsWith('\n') ? '\n\n' : '';
    const separatorAfter = at < draft.length && !draft.slice(at).startsWith('\n') ? '\n\n' : '';
    draft = `${draft.slice(0, at)}${separatorBefore}${markdown}${separatorAfter}${draft.slice(at)}`;
    try {
      if (data.onPayloadChange) await data.onPayloadChange(id, { attachments, content: draft });
      else await data.onContentChange(id, draft);
    } catch (error) {
      attachments = previousAttachments;
      draft = previousDraft;
      await Promise.allSettled(accepted.map(
        (attachment) => deleteWorkspaceAttachment(data.workspaceId, attachment),
      ));
      throw error;
    }
  }

  async function handlePaste(event: ClipboardEvent) {
    if (!event.clipboardData?.files.length) return;
    event.preventDefault();
    attachmentBusy = true;
    attachmentError = '';
    try {
      const textarea = event.target as HTMLTextAreaElement;
      await addAttachments(await attachmentsFromClipboard(data.workspaceId, event.clipboardData), textarea.selectionStart ?? draft.length);
    } catch (error) {
      attachmentError = error instanceof Error && error.message === 'attachment_too_large'
        ? m['attachment.too_large']()
        : m['attachment.error']();
    } finally {
      attachmentBusy = false;
    }
  }

  function handleDragOver(event: DragEvent) {
    if (!transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    attachmentDropActive = true;
  }

  async function handleDrop(event: DragEvent) {
    if (!event.dataTransfer || !transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    attachmentDropActive = false;
    attachmentBusy = true;
    attachmentError = '';
    try {
      const at = event.currentTarget instanceof HTMLTextAreaElement
        ? event.currentTarget.selectionStart ?? draft.length
        : draft.length;
      await addAttachments(await attachmentsFromTransfer(data.workspaceId, event.dataTransfer), at);
    } catch (error) {
      attachmentError = error instanceof Error && error.message === 'attachment_too_large'
        ? m['attachment.too_large']()
        : m['attachment.error']();
    } finally {
      attachmentBusy = false;
    }
  }

  async function pickAttachments(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    attachmentBusy = true;
    attachmentError = '';
    try {
      const uploaded: WorkspaceAttachment[] = [];
      for (const file of files) uploaded.push(await uploadWorkspaceAttachment(data.workspaceId, file));
      await addAttachments(uploaded);
    } catch (error) {
      attachmentError = error instanceof Error && error.message === 'attachment_too_large'
        ? m['attachment.too_large']()
        : m['attachment.error']();
    } finally {
      attachmentBusy = false;
    }
  }

  async function removeAttachment(attachment: WorkspaceAttachment) {
    if (attachmentBusy) return;
    attachmentBusy = true;
    attachmentError = '';
    const previousAttachments = attachments;
    const previousDraft = draft;
    try {
      await deleteWorkspaceAttachment(data.workspaceId, attachment);
      attachments = attachments.filter((item) => item.id !== attachment.id);
      draft = removeAttachmentMarkdown(draft, data.workspaceId, attachment);
      if (data.onPayloadChange) await data.onPayloadChange(id, { attachments, content: draft });
      else await data.onContentChange(id, draft);
    } catch {
      attachments = previousAttachments;
      draft = previousDraft;
      attachmentError = m['attachment.remove_error']();
    } finally {
      attachmentBusy = false;
    }
  }
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-note"
  accent={noteColor.color}
  minWidth={220}
  minHeight={140}
  onResize={data.onResize}
  connections={data.connections ?? []}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<StickyNote size={13} />{/snippet}
  {#snippet title()}{data.title || m['note.default_title']()}{/snippet}
  {#snippet actions()}
    <input bind:this={attachmentInput} type="file" multiple class="hidden" onchange={pickAttachments} />
    <!-- Uma bolinha com a cor atual abre o seletor: cabecalho limpo mesmo
         em notas estreitas; as seis cores continuam a um clique. -->
    <Popover.Root>
      <Popover.Trigger class="node-action-btn color-trigger nodrag" aria-label={m['note.color_picker']({ color: noteColor.label })} title={m['note.color_picker']({ color: noteColor.label })}>
        <span class="color-dot" style:background={noteColor.color}></span>
      </Popover.Trigger>
      <Popover.Content align="end" class="w-auto p-1.5">
        <div class="swatch-grid nodrag" role="radiogroup" aria-label={m['note.color_picker']({ color: noteColor.label })}>
          {#each Object.entries(NOTE_COLORS) as [name, preset] (name)}
            {@const active = ((data.payload as { color?: string }).color ?? 'yellow') === name}
            <button
              type="button"
              class="swatch"
              class:active
              role="radio"
              aria-checked={active}
              aria-label={preset.label}
              title={preset.label}
              style:--swatch={preset.color}
              onclick={() => setColor(name)}
            ></button>
          {/each}
        </div>
      </Popover.Content>
    </Popover.Root>
    <HeaderIconButton class="node-action-btn" label={m['attachment.add']()} disabled={attachmentBusy} onclick={() => attachmentInput.click()}>
      <Paperclip size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={formatted ? m['note.edit_raw']() : m['note.view_formatted']()} onclick={toggleFormatted}>
      {#if formatted}<Pencil size={13} />{:else}<Eye size={13} />{/if}
    </HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['note.remove']()} danger onclick={() => data.onDelete(id)}>
      <X size={13} /></HeaderIconButton>
  {/snippet}

  {#if formatted}
    <div
      class="note-content note-preview nodrag nowheel"
      class:attachment-drop-active={attachmentDropActive}
      style="--note-color: {noteColor.color}"
      ondblclick={toggleFormatted}
      ondragover={handleDragOver}
      ondragleave={() => (attachmentDropActive = false)}
      ondrop={handleDrop}
      role="presentation"
    >
      <MarkdownView content={draft} />
    </div>
  {:else}
    <textarea
      class="note-content nodrag nowheel"
      class:attachment-drop-active={attachmentDropActive}
      style="--note-color: {noteColor.color}"
      bind:value={draft}
      oninput={handleInput}
      onpaste={handlePaste}
      ondragover={handleDragOver}
      ondragleave={() => (attachmentDropActive = false)}
      ondrop={handleDrop}
      placeholder={m['ph.note_content']()}
      spellcheck="false"
    ></textarea>
  {/if}
  <AttachmentList workspaceId={data.workspaceId} {attachments} compact onRemove={removeAttachment} />
  {#if attachmentError}<p class="attachment-error" role="status">{attachmentError}</p>{/if}
</NodeShell>

<style>
  .note-content {
    flex: 1;
    min-height: 0;
    resize: none;
    border: none;
    outline: none;
    padding: 12px 14px;
    background: color-mix(in srgb, var(--note-color, var(--app-warning)) 12%, var(--app-surface));
    color: var(--app-text);
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
    text-wrap: pretty;
  }

  .note-content::placeholder {
    color: var(--app-text-muted);
  }

  .note-content:focus-visible {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--note-color, var(--app-warning)) 55%, transparent);
  }

  .note-content.attachment-drop-active {
    box-shadow: inset 0 0 0 2px var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 10%, var(--app-surface));
  }

  .attachment-error {
    margin: 0;
    padding: 4px 12px 6px;
    color: var(--app-danger);
    font-size: 11px;
  }

  .note-preview {
    overflow-y: auto;
    font-family: inherit;
    cursor: text;
  }

  .color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-text) 18%, transparent);
  }

  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(6, 26px);
    gap: 4px;
  }

  /* Alvo de 26px para uma cor de 16px; anel marca a cor atual. */
  .swatch {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .swatch::after {
    content: '';
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-text) 16%, transparent);
  }

  .swatch:hover {
    background: var(--app-hover);
  }

  .swatch:active {
    transform: scale(var(--scale-press));
  }

  .swatch.active::after {
    box-shadow: 0 0 0 2px var(--app-surface-raised), 0 0 0 4px var(--swatch);
  }

  .swatch:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .note-preview :global(h1),
  .note-preview :global(h2),
  .note-preview :global(h3) {
    margin: 0.5em 0 0.3em;
    line-height: 1.3;
  }

  .note-preview :global(p) {
    margin: 0 0 0.5em;
  }

  .note-preview :global(code) {
    background: var(--app-border);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 11px;
  }

  .note-preview :global(pre) {
    background: var(--app-canvas);
    border-radius: 8px;
    padding: 8px;
    overflow-x: auto;
  }

  .note-preview :global(pre code) {
    background: transparent;
    padding: 0;
  }

  .note-preview :global(ul),
  .note-preview :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.2em;
  }

  .note-preview :global(table) {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
  }

  .note-preview :global(th),
  .note-preview :global(td) {
    border: 1px solid var(--app-border);
    padding: 3px 7px;
    text-align: left;
  }

  .note-preview :global(a) {
    color: var(--app-secondary);
  }

  .note-preview :global(img) {
    max-width: 100%;
    border-radius: 8px;
    display: block;
    margin: 0.4em 0;
  }

  .note-preview :global(blockquote) {
    border-left: 3px solid var(--note-color, var(--app-warning));
    margin: 0.5em 0;
    padding-left: 0.8em;
    color: var(--app-text-soft);
  }
</style>
