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

/**
 * Images, PDFs, files and links staged in a message field before it is sent:
 * pasted, dropped or picked, uploaded to the workspace's attachment folder and
 * shown as chips. The same staging serves every place the owner writes to agents.
 */
export class ComposerAttachments {
  items = $state<WorkspaceAttachment[]>([]);
  busy = $state(false);
  error = $state('');
  dragging = $state(false);

  constructor(private readonly workspaceId: () => string | null) {}

  /** Reads the transfer synchronously (the browser empties it after the event), then uploads. */
  private async stage(load: (workspaceId: string) => Promise<WorkspaceAttachment[]>): Promise<void> {
    const workspaceId = this.workspaceId();
    if (!workspaceId) return;
    const pending = load(workspaceId);
    this.busy = true;
    this.error = '';
    try {
      const added = await pending;
      const room = Math.max(0, MAX_WORKSPACE_ATTACHMENTS - this.items.length);
      if (added.length > room) {
        await Promise.allSettled(added.slice(room).map((attachment) => deleteWorkspaceAttachment(workspaceId, attachment)));
        this.error = m['attachment.too_many']({ count: MAX_WORKSPACE_ATTACHMENTS });
      }
      this.items = [...this.items, ...added.slice(0, room)];
    } catch (error) {
      this.error = errorLabel(error);
    } finally {
      this.busy = false;
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
        await Promise.allSettled(uploaded.map((attachment) => deleteWorkspaceAttachment(workspaceId, attachment)));
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
    this.items = this.items.filter((candidate) => candidate.id !== attachment.id);
    const workspaceId = this.workspaceId();
    if (workspaceId) await deleteWorkspaceAttachment(workspaceId, attachment).catch(() => undefined);
  };

  /** After a send went through: the files now belong to the message. */
  clear(): void {
    this.items = [];
    this.error = '';
  }
}
