import { getCsrfToken } from '@beeblock/svelar/http';
import { isRasterWorkspaceAttachment, type WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';
import {
  MAX_WORKSPACE_ATTACHMENT_BYTES,
  MAX_WORKSPACE_ATTACHMENTS,
} from '$lib/modules/agent-room/contracts/schemas/workspaceAttachmentSchemas.js';

export { MAX_WORKSPACE_ATTACHMENT_BYTES, MAX_WORKSPACE_ATTACHMENTS };

function csrfHeaders(): HeadersInit {
  const csrf = getCsrfToken();
  return csrf ? { 'X-CSRF-Token': csrf } : {};
}

async function attachmentResponse(response: Response): Promise<WorkspaceAttachment> {
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload.data as WorkspaceAttachment;
}

export async function uploadWorkspaceAttachment(workspaceId: string, file: File): Promise<WorkspaceAttachment> {
  if (file.size > MAX_WORKSPACE_ATTACHMENT_BYTES) throw new Error('attachment_too_large');
  const form = new FormData();
  form.set('file', file);
  return attachmentResponse(await fetch(`/api/agent-room/workspaces/${workspaceId}/attachments`, {
    method: 'POST',
    headers: csrfHeaders(),
    body: form,
  }));
}

export async function createWorkspaceLinkAttachment(workspaceId: string, url: string): Promise<WorkspaceAttachment> {
  return attachmentResponse(await fetch(`/api/agent-room/workspaces/${workspaceId}/attachments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ url }),
  }));
}

export async function deleteWorkspaceAttachment(
  workspaceId: string,
  attachment: WorkspaceAttachment,
): Promise<void> {
  const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/attachments`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ attachment }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`);
}

export function transferHasWorkspaceAttachments(transfer: DataTransfer | null): boolean {
  if (!transfer) return false;
  if (transfer.files.length > 0) return true;
  // External file drags are protected until drop: files is empty during dragover.
  return Array.from(transfer.types).some(type => type === 'Files' || type === 'text/uri-list');
}

function transferUrl(transfer: DataTransfer): string | null {
  const candidate = transfer.getData('text/uri-list')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith('#'));
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function attachmentsFromTransfer(workspaceId: string, transfer: DataTransfer): Promise<WorkspaceAttachment[]> {
  const files = Array.from(transfer.files);
  const url = transferUrl(transfer);
  if (files.length + (url ? 1 : 0) > MAX_WORKSPACE_ATTACHMENTS) throw new Error('attachment_too_many');
  if (files.some(file => file.size > MAX_WORKSPACE_ATTACHMENT_BYTES)) throw new Error('attachment_too_large');
  const attachments: WorkspaceAttachment[] = [];
  try {
    for (const file of files) attachments.push(await uploadWorkspaceAttachment(workspaceId, file));
    if (url) attachments.push(await createWorkspaceLinkAttachment(workspaceId, url));
    return attachments;
  } catch (error) {
    // These uploads have not been handed to a note, task or prompt yet.
    await Promise.allSettled(attachments.map(attachment => deleteWorkspaceAttachment(workspaceId, attachment)));
    throw error;
  }
}

export async function attachmentsFromClipboard(workspaceId: string, clipboard: DataTransfer): Promise<WorkspaceAttachment[]> {
  const files = Array.from(clipboard.files);
  if (files.length) {
    const attachments: WorkspaceAttachment[] = [];
    for (const file of files.slice(0, MAX_WORKSPACE_ATTACHMENTS)) {
      attachments.push(await uploadWorkspaceAttachment(workspaceId, file));
    }
    return attachments;
  }
  const text = clipboard.getData('text/plain').trim();
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return [await createWorkspaceLinkAttachment(workspaceId, url.toString())];
    }
  } catch {
    // Ordinary pasted text stays under the browser's default behavior.
  }
  return [];
}

export function attachmentHref(workspaceId: string, attachment: WorkspaceAttachment): string {
  if (attachment.kind === 'link') return attachment.url ?? '#';
  return `/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(attachment.path ?? '')}`;
}

export function attachmentPromptReference(attachment: WorkspaceAttachment): string {
  return attachment.kind === 'link'
    ? `Reference link "${attachment.name}": ${attachment.url}`
    : `Attached file "${attachment.name}": ${attachment.path}`;
}

export function attachmentMarkdown(workspaceId: string, attachment: WorkspaceAttachment): string {
  if (attachment.kind === 'link') return `[${attachment.name}](${attachment.url})`;
  const href = attachmentHref(workspaceId, attachment);
  const reference = `\`${attachment.path}\``;
  return isRasterWorkspaceAttachment(attachment)
    ? `![${attachment.name}](${href})\n\n${reference}`
    : `[${attachment.name}](${href}) — ${reference}`;
}

export function removeAttachmentMarkdown(
  content: string,
  workspaceId: string,
  attachment: WorkspaceAttachment,
): string {
  const markdown = attachmentMarkdown(workspaceId, attachment);
  const index = content.indexOf(markdown);
  if (index < 0) return content;

  let start = index;
  let end = index + markdown.length;
  if (content.slice(Math.max(0, start - 2), start) === '\n\n') start -= 2;
  else if (content.slice(end, end + 2) === '\n\n') end += 2;
  else if (content[start - 1] === '\n') start -= 1;
  else if (content[end] === '\n') end += 1;
  return `${content.slice(0, start)}${content.slice(end)}`;
}
