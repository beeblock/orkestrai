<script lang="ts">
  import type { NodeProps } from '@xyflow/svelte';
  import { Eye, FileDown, Layers, Paperclip, Pencil, StickyNote, X, Bold, Italic, Heading2, List, ListChecks, Link2, Code, Palette } from '@lucide/svelte';
  import { printMarkdown } from '../print-markdown.js';
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

  /*
   * Sticky paper: each note is a sheet in one of these colors with dark ink,
   * readable on light and dark themes alike. "glass" keeps the dark card.
   * Legacy ids (yellow, blue, green, purple, red, neutral) map to papers.
   */
  const NOTE_COLORS: Record<string, { color: string; ink: string; label: string }> = {
    yellow: { color: '#efcd72', ink: '#2c230b', label: m['note.color_yellow']() },
    peach: { color: '#f2b089', ink: '#2e1609', label: m['note.color_peach']() },
    red: { color: '#f0a7b4', ink: '#2e0d14', label: m['note.color_red']() },
    purple: { color: '#c7b6f6', ink: '#1d1436', label: m['note.color_purple']() },
    blue: { color: '#a7d0f3', ink: '#0b2133', label: m['note.color_blue']() },
    green: { color: '#a9dfc0', ink: '#0d2a1b', label: m['note.color_green']() },
    lime: { color: '#d3e48f', ink: '#212a07', label: m['note.color_lime']() },
    neutral: { color: '#e8e2d5', ink: '#26221b', label: m['note.color_neutral']() },
    glass: { color: '#1b1a17', ink: '#efebe4', label: m['note.color_glass']() },
  };
  const NOTE_FONTS = { hand: 'var(--font-hand)', sans: 'inherit', mono: 'var(--font-mono)' } as const;
  const NOTE_SIZES = { hand: { s: 17, m: 21, l: 27 }, sans: { s: 12, m: 13.5, l: 16 }, mono: { s: 11.5, m: 12.5, l: 14.5 } } as const;
  import NodeShell from './NodeShell.svelte';
  import * as Popover from '$lib/components/ui/popover';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import { noteStackState, setNoteStackExpanded } from './note-stacks.svelte.js';
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
  const stack = $derived(noteStackState.tops[id] ?? null);
  const noteColor = $derived(NOTE_COLORS[data.payload.color ?? 'yellow'] ?? NOTE_COLORS.yellow);
  const noteFont = $derived<'hand' | 'sans' | 'mono'>(data.payload.font ?? 'sans');
  const noteSize = $derived<'s' | 'm' | 'l'>(data.payload.size ?? 'm');
  const paperVars = $derived(`--paper:${noteColor.color};--ink:${noteColor.ink};--note-font:${NOTE_FONTS[noteFont]};--note-size:${NOTE_SIZES[noteFont][noteSize]}px`);

  function setStyle(partial: { font?: 'hand' | 'sans' | 'mono'; size?: 's' | 'm' | 'l' }) {
    data.onContentChange(id, draft);
    Object.assign(data.payload as Record<string, unknown>, partial);
    void data.onPayloadChange?.(id, partial);
  }

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

  // Ticking a checklist item in the formatted view flips the matching `- [ ]` in the text.
  const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/;
  function toggleTask(event: MouseEvent) {
    const item = (event.target as HTMLElement | null)?.closest('li');
    const box = item?.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
    if (!item || !box) return;
    event.preventDefault();
    event.stopPropagation();
    const boxes = [...(event.currentTarget as HTMLElement).querySelectorAll('li input[type="checkbox"]')];
    const index = boxes.indexOf(box);
    if (index < 0) return;
    let seen = -1;
    draft = draft.split('\n').map((line: string) => {
      if (!TASK.test(line)) return line;
      seen += 1;
      return seen === index ? line.replace(TASK, (_match: string, lead: string, mark: string) => `${lead}[${mark.trim() ? ' ' : 'x'}]`) : line;
    }).join('\n');
    data.onContentChange(id, draft);
  }

  // Editing helpers: wrap the selection or start the current line with markdown.
  let editor = $state<HTMLTextAreaElement | null>(null);
  function applyFormat(kind: 'bold' | 'italic' | 'heading' | 'list' | 'task' | 'link' | 'code') {
    const area = editor;
    if (!area) return;
    const start = area.selectionStart;
    const end = area.selectionEnd;
    const selected = draft.slice(start, end);
    const lineStart = draft.lastIndexOf('\n', start - 1) + 1;
    let next = draft;
    let cursorStart = start;
    let cursorEnd = end;
    const wrap = (left: string, right: string, fallback: string) => {
      const inner = selected || fallback;
      next = `${draft.slice(0, start)}${left}${inner}${right}${draft.slice(end)}`;
      cursorStart = start + left.length;
      cursorEnd = cursorStart + inner.length;
    };
    const prefix = (mark: string) => {
      next = `${draft.slice(0, lineStart)}${mark}${draft.slice(lineStart)}`;
      cursorStart = start + mark.length;
      cursorEnd = end + mark.length;
    };
    if (kind === 'bold') wrap('**', '**', m['note.format_text']());
    else if (kind === 'italic') wrap('_', '_', m['note.format_text']());
    else if (kind === 'code') wrap('`', '`', 'code');
    else if (kind === 'link') wrap('[', '](https://)', selected || m['note.format_link_text']());
    else if (kind === 'heading') prefix('## ');
    else if (kind === 'list') prefix('- ');
    else prefix('- [ ] ');
    draft = next;
    handleInput();
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(cursorStart, cursorEnd);
    });
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
  class={`${stack && !stack.expanded ? 'canvas-note note-stack-top' : 'canvas-note'}${data.payload.color === 'glass' ? ' note-glass' : ' note-paper'}`}
  vars={paperVars}
  deferOffscreen
  accent="var(--app-accent)"
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
    {#if stack}
      <button
        type="button"
        class="stack-toggle nodrag"
        class:open={stack.expanded}
        aria-pressed={stack.expanded}
        title={stack.expanded ? m['note.stack_collapse']() : m['note.stack_expand']({ count: stack.count })}
        onclick={() => setNoteStackExpanded(stack.agentId, !stack.expanded)}
      >
        <Layers size={12} /><span class="tabular-nums">{stack.expanded ? m['note.stack_group']() : `+${stack.count - 1}`}</span>
      </button>
    {/if}
    <input bind:this={attachmentInput} type="file" multiple class="hidden" onchange={pickAttachments} />
    <!-- Uma bolinha com a cor atual abre o seletor: cabecalho limpo mesmo
         em notas estreitas; as seis cores continuam a um clique. -->
    <Popover.Root>
      <Popover.Trigger class="node-action-btn color-trigger nodrag" aria-label={m['note.color_picker']({ color: noteColor.label })} title={m['note.color_picker']({ color: noteColor.label })}>
        <Palette size={13} />
        <span class="color-dot" style:background={noteColor.color}></span>
      </Popover.Trigger>
      <Popover.Content align="end" class="w-[262px] p-2.5">
        <p class="style-label">{m['note.style_paper']()}</p>
        <div class="swatch-grid nodrag" role="radiogroup" aria-label={m['note.color_picker']({ color: noteColor.label })}>
          {#each Object.entries(NOTE_COLORS) as [name, preset] (name)}
            {@const active = (data.payload.color ?? 'yellow') === name}
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
        <p class="style-label">{m['note.style_font']()}</p>
        <div class="seg nodrag" role="radiogroup" aria-label={m['note.style_font']()}>
          {#each [['hand', m['note.font_hand']()], ['sans', m['note.font_sans']()], ['mono', m['note.font_mono']()]] as [value, label] (value)}
            <button type="button" role="radio" aria-checked={noteFont === value} class:on={noteFont === value} class={`font-${value}`} onclick={() => setStyle({ font: value as 'hand' | 'sans' | 'mono' })}>{label}</button>
          {/each}
        </div>
        <p class="style-label">{m['note.style_size']()}</p>
        <div class="seg nodrag" role="radiogroup" aria-label={m['note.style_size']()}>
          {#each [['s', m['note.size_s']()], ['m', m['note.size_m']()], ['l', m['note.size_l']()]] as [value, label] (value)}
            <button type="button" role="radio" aria-checked={noteSize === value} class:on={noteSize === value} onclick={() => setStyle({ size: value as 's' | 'm' | 'l' })}>{label}</button>
          {/each}
        </div>
      </Popover.Content>
    </Popover.Root>
    <HeaderIconButton class="node-action-btn" label={m['attachment.add']()} disabled={attachmentBusy} onclick={() => attachmentInput.click()}>
      <Paperclip size={13} /></HeaderIconButton>
    <HeaderIconButton class="node-action-btn" label={m['note.export_pdf']()} onclick={() => printMarkdown(data.title || m['note.default_title'](), draft)}>
      <FileDown size={13} /></HeaderIconButton>
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
      onclick={toggleTask}
      ondragover={handleDragOver}
      ondragleave={() => (attachmentDropActive = false)}
      ondrop={handleDrop}
      role="presentation"
    >
      <MarkdownView content={draft} />
    </div>
  {:else}
    <div class="format-bar nodrag" role="toolbar" aria-label={m['note.format_toolbar']()}>
      <button type="button" onclick={() => applyFormat('bold')} aria-label={m['note.format_bold']()} title={m['note.format_bold']()}><Bold size={13} /></button>
      <button type="button" onclick={() => applyFormat('italic')} aria-label={m['note.format_italic']()} title={m['note.format_italic']()}><Italic size={13} /></button>
      <button type="button" onclick={() => applyFormat('heading')} aria-label={m['note.format_heading']()} title={m['note.format_heading']()}><Heading2 size={13} /></button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" onclick={() => applyFormat('list')} aria-label={m['note.format_list']()} title={m['note.format_list']()}><List size={13} /></button>
      <button type="button" onclick={() => applyFormat('task')} aria-label={m['note.format_task']()} title={m['note.format_task']()}><ListChecks size={13} /></button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" onclick={() => applyFormat('link')} aria-label={m['note.format_link']()} title={m['note.format_link']()}><Link2 size={13} /></button>
      <button type="button" onclick={() => applyFormat('code')} aria-label={m['note.format_code']()} title={m['note.format_code']()}><Code size={13} /></button>
    </div>
    <textarea
      bind:this={editor}
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
  /* Collapsed stack: two sheets peek out behind the newest note. */
  :global(.svelte-flow__node:has(.note-stack-top)) {
    filter: drop-shadow(5px 5px 0 color-mix(in srgb, var(--app-surface-raised) 92%, var(--app-border))) drop-shadow(5px 5px 0 color-mix(in srgb, var(--app-surface) 88%, var(--app-border)));
  }

  .stack-toggle {
    height: 22px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 7px;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .stack-toggle:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .stack-toggle.open {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .stack-toggle:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .note-content {
    flex: 1;
    min-height: 0;
    resize: none;
    border: none;
    outline: none;
    padding: 10px 16px 14px;
    background: transparent;
    color: var(--ink);
    font-family: var(--note-font);
    font-size: var(--note-size);
    line-height: 1.5;
    text-wrap: pretty;
  }

  .note-content::placeholder {
    color: color-mix(in srgb, var(--ink) 50%, transparent);
  }

  .note-content:focus-visible {
    box-shadow: none;
  }

  /* The whole node is the sheet: paper fill, ink header, a folded corner. */
  :global(.node-shell.note-paper) {
    background:
      linear-gradient(225deg, color-mix(in srgb, #000000 14%, var(--paper)) 0 12px, transparent 12px),
      linear-gradient(180deg, color-mix(in srgb, #ffffff 16%, var(--paper)), var(--paper) 40%);
    color: var(--ink);
  }

  :global(.node-shell.note-paper:not(.selected)) {
    box-shadow:
      0 1px 0 color-mix(in srgb, #ffffff 30%, transparent) inset,
      0 2px 4px color-mix(in srgb, #000000 18%, transparent),
      0 18px 34px -10px color-mix(in srgb, #000000 50%, transparent);
  }

  :global(.node-shell.note-paper .node-header) {
    background: transparent;
    border-bottom: 1px dashed color-mix(in srgb, var(--ink) 18%, transparent);
    color: var(--ink);
  }

  :global(.node-shell.note-paper .node-icon),
  :global(.node-shell.note-paper .node-action-btn) {
    color: color-mix(in srgb, var(--ink) 62%, transparent);
  }

  :global(.node-shell.note-paper .node-action-btn:hover) {
    background: color-mix(in srgb, var(--ink) 10%, transparent);
    color: var(--ink);
  }

  :global(.node-shell.note-paper .overview-label) {
    background: var(--paper);
    color: var(--ink);
  }

  :global(.node-shell.note-glass) .note-content {
    color: var(--app-text);
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
    box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--ink, var(--app-text)) 45%, transparent);
  }

  :global(.color-trigger) {
    width: auto !important;
    gap: 4px;
    padding: 0 6px !important;
    display: inline-flex !important;
    align-items: center;
  }

  .swatch-grid {
    display: grid;
    grid-template-columns: repeat(9, 24px);
    gap: 2px;
  }

  .style-label {
    margin: 8px 2px 5px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .style-label:first-child {
    margin-top: 0;
  }

  .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 9px;
    background: var(--app-hover);
  }

  .seg button {
    flex: 1;
    height: 28px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
  }

  .seg button.on {
    background: var(--app-surface);
    color: var(--app-text);
    box-shadow: var(--app-shadow-border);
  }

  .seg .font-hand {
    font-family: var(--font-hand);
    font-size: 16px;
  }

  .seg .font-mono {
    font-family: var(--font-mono);
  }

  /* Alvo de 26px para uma cor de 16px; anel marca a cor atual. */
  .swatch {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
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

  /* The formatted view writes in the note's ink, on every paper. */
  .note-preview {
    color: var(--ink);
    font-family: var(--note-font);
    font-size: var(--note-size);
    --md-size: var(--note-size);
    --md-text: var(--ink);
    --md-heading: var(--ink);
    --md-link: var(--note-link);
    --md-link-hover: var(--ink);
    --md-code-bg: color-mix(in srgb, var(--ink) 9%, transparent);
    --md-pre-bg: color-mix(in srgb, var(--ink) 7%, transparent);
    --md-border: color-mix(in srgb, var(--ink) 22%, transparent);
    --md-quote-accent: color-mix(in srgb, var(--ink) 45%, transparent);
    --md-quote-bg: color-mix(in srgb, var(--ink) 6%, transparent);
    --md-check-border: color-mix(in srgb, var(--ink) 55%, transparent);
    --md-check-on: var(--ink);
    --md-check-mark: var(--paper);
    --md-h1: 1.45em;
    --md-h2: 1.25em;
    --md-h3: 1.1em;
    --md-h4: 1em;
  }

  :global(.node-shell.note-paper) {
    --note-link: color-mix(in srgb, #8a4f00 80%, var(--ink));
  }

  :global(.node-shell.note-glass) {
    --note-link: var(--app-accent);
    --paper: var(--app-surface);
    --ink: var(--app-text);
  }

  .note-preview :global(a) {
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 2px;
  }

  .note-preview :global(li:has(input[type='checkbox'])) {
    cursor: pointer;
    border-radius: 6px;
  }

  .note-preview :global(li:has(input[type='checkbox']):hover) {
    background: color-mix(in srgb, var(--ink) 6%, transparent);
  }

  .note-preview :global(li input[type='checkbox']) {
    pointer-events: none;
  }

  .note-preview :global(li:has(input[type='checkbox']:checked)) {
    color: color-mix(in srgb, var(--ink) 55%, transparent);
    text-decoration: line-through;
    text-decoration-color: color-mix(in srgb, var(--ink) 40%, transparent);
  }

  .note-preview :global(img) {
    max-width: 100%;
    border-radius: 8px;
    display: block;
    margin: 0.4em 0;
  }

  .format-bar {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 6px 12px 0;
    padding: 3px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--ink) 7%, transparent);
    color: color-mix(in srgb, var(--ink) 72%, transparent);
    align-self: flex-start;
  }

  .format-bar button {
    width: 26px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
  }

  .format-bar button:hover {
    background: color-mix(in srgb, var(--ink) 12%, transparent);
    color: var(--ink);
  }

  .format-bar button:focus-visible {
    outline: 2px solid color-mix(in srgb, var(--ink) 60%, transparent);
    outline-offset: 1px;
  }

  .format-bar .sep {
    width: 1px;
    height: 14px;
    margin: 0 3px;
    background: color-mix(in srgb, var(--ink) 20%, transparent);
  }
</style>
