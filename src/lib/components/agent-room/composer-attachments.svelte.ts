import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
import * as m from '$lib/paraglide/messages.js';
import {
  attachmentsFromTransfer,
  deleteWorkspaceAttachment,
  MAX_WORKSPACE_ATTACHMENTS,
  transferHasWorkspaceAttachments,
  uploadWorkspaceAttachment,
} from './workspace-attachments.js';

function errorLabel(error: unknown): string {
  if (error instanceof Error && error.message === 'attachment_too_large') return m['attachment.too_large']();
  if (error instanceof Error && error.message === 'attachment_too_many') return m['attachment.too_many']({ count: MAX_WORKSPACE_ATTACHMENTS });
  return m['attachment.error']();
}

/** Each file is deleted through the workspace that holds it. */
type Staged = { attachment: WorkspaceAttachment; workspaceId: string };

function discard(entries: readonly Staged[]): Promise<unknown> {
  return Promise.allSettled(entries.map((entry) => deleteWorkspaceAttachment(entry.workspaceId, entry.attachment)));
}

/** What one send holds: only these files leave the draft, and only if it is accepted. */
export type AttachmentSubmission = {
  attachments: WorkspaceAttachment[];
  commit(): void;
  release(): void;
};

/**
 * Images, PDFs, files and links staged in a message field before it is sent:
 * pasted, dropped or picked, uploaded to the workspace's attachment folder and
 * shown as chips. The same staging serves every place the owner writes to agents.
 *
 * A draft belongs to one conversation: `reset` (a workspace or conversation
 * change, or the field going away) discards its unsent files, and an upload
 * still in flight is discarded when it lands instead of joining another draft.
 * A send reserves the files it carries, so files added meanwhile stay in the
 * next draft and a reserved file cannot be removed until the send settles.
 */
export class ComposerAttachments {
  #entries = $state<Staged[]>([]);
  #pending = $state(0);
  #reserved = $state<string[]>([]);
  #generation = 0;
  error = $state('');
  dragging = $state(false);

  constructor(private readonly workspaceId: () => string | null) {}

  get items(): WorkspaceAttachment[] {
    return this.#entries.map((entry) => entry.attachment);
  }

  /** An upload is still running: sending now would leave it behind. */
  get busy(): boolean {
    return this.#pending > 0;
  }

  /** A send holds some of the files: none can be removed until it settles. */
  get sending(): boolean {
    return this.#reserved.length > 0;
  }

  /** Reads the transfer synchronously (the browser empties it after the event), then uploads. */
  private async stage(load: (workspaceId: string) => Promise<WorkspaceAttachment[]>): Promise<void> {
    const workspaceId = this.workspaceId();
    if (!workspaceId) return;
    const generation = this.#generation;
    const pending = load(workspaceId);
    this.#pending += 1;
    this.error = '';
    try {
      const added = (await pending).map((attachment) => ({ attachment, workspaceId }));
      // The draft changed while this upload ran: its files never belonged to the new one.
      if (generation !== this.#generation) {
        await discard(added);
        return;
      }
      const room = Math.max(0, MAX_WORKSPACE_ATTACHMENTS - this.#entries.length);
      if (added.length > room) {
        await discard(added.slice(room));
        this.error = m['attachment.too_many']({ count: MAX_WORKSPACE_ATTACHMENTS });
      }
      if (generation === this.#generation) this.#entries = [...this.#entries, ...added.slice(0, room)];
      else await discard(added.slice(0, room));
    } catch (error) {
      if (generation === this.#generation) this.error = errorLabel(error);
    } finally {
      if (generation === this.#generation) this.#pending = Math.max(0, this.#pending - 1);
    }
  }

  addFiles(files: File[]): Promise<void> {
    if (!files.length) return Promise.resolve();
    return this.stage(async (workspaceId) => {
      if (files.length > MAX_WORKSPACE_ATTACHMENTS) throw new Error('attachment_too_many');
      const uploaded: WorkspaceAttachment[] = [];
      try {
        for (const file of files) uploaded.push(await uploadWorkspaceAttachment(workspaceId, file));
        return uploaded;
      } catch (error) {
        await discard(uploaded.map((attachment) => ({ attachment, workspaceId })));
        throw error;
      }
    });
  }

  /** A pasted image or file becomes an attachment; pasted text keeps the field's own paste. */
  paste = (event: ClipboardEvent): void => {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) return;
    event.preventDefault();
    void this.addFiles(files);
  };

  dragover = (event: DragEvent): void => {
    if (!transferHasWorkspaceAttachments(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.dragging = true;
  };

  dragleave = (event: DragEvent): void => {
    const area = event.currentTarget;
    if (area instanceof Node && event.relatedTarget instanceof Node && area.contains(event.relatedTarget)) return;
    this.dragging = false;
  };

  drop = (event: DragEvent): void => {
    this.dragging = false;
    const transfer = event.dataTransfer;
    if (!transfer || !transferHasWorkspaceAttachments(transfer)) return;
    event.preventDefault();
    event.stopPropagation();
    void this.stage((workspaceId) => attachmentsFromTransfer(workspaceId, transfer));
  };

  remove = async (attachment: WorkspaceAttachment): Promise<void> => {
    // A file a send in flight carries may already belong to the message.
    if (this.#reserved.includes(attachment.id)) return;
    const entry = this.#entries.find((candidate) => candidate.attachment.id === attachment.id);
    if (!entry) return;
    this.#entries = this.#entries.filter((candidate) => candidate !== entry);
    await discard([entry]);
  };

  /** Takes the files staged now for one send; files added meanwhile stay for the next one. */
  reserve(): AttachmentSubmission {
    const generation = this.#generation;
    const held = this.#entries.filter((entry) => !this.#reserved.includes(entry.attachment.id)).map((entry) => entry.attachment);
    const ids = held.map((attachment) => attachment.id);
    this.#reserved = [...this.#reserved, ...ids];
    let settled = false;
    const settle = (accepted: boolean) => {
      if (settled || generation !== this.#generation) return;
      settled = true;
      this.#reserved = this.#reserved.filter((id) => !ids.includes(id));
      if (accepted) this.#entries = this.#entries.filter((entry) => !ids.includes(entry.attachment.id));
    };
    return { attachments: held, commit: () => settle(true), release: () => settle(false) };
  }

  /**
   * The draft's conversation or workspace changed, or its field went away:
   * unsent files are deleted, and uploads still running are discarded when
   * they land. Files a send in flight carries are left to that send.
   */
  reset = (): void => {
    this.#generation += 1;
    const unsent = this.#entries.filter((entry) => !this.#reserved.includes(entry.attachment.id));
    this.#entries = [];
    this.#pending = 0;
    this.#reserved = [];
    this.error = '';
    this.dragging = false;
    void discard(unsent);
  };
}
