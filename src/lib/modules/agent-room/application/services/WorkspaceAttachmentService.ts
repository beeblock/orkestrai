import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import type { TerminalNodePayload, Workspace, WorkspaceAttachment } from '../../domain/types.js';
import { workspaceFileForTerminal } from '../../infrastructure/WslRuntime.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { MAX_WORKSPACE_ATTACHMENT_BYTES } from '../../contracts/schemas/workspaceAttachmentSchemas.js';
import type { WorkspaceAttachmentDto } from '../dto/WorkspaceAttachmentDto.js';
import type { WorkspaceAttachmentDeleteDto } from '../dto/WorkspaceAttachmentDto.js';
import { filesystemService } from './FilesystemService.js';

function safeFilename(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 120);
  return normalized || 'attachment';
}

function canonicalMime(name: string, declared: string): string {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
  }[extension] ?? (declared || 'application/octet-stream');
}

export class WorkspaceAttachmentService {
  private ownership = new Map<string, Promise<unknown>>();

  /**
   * Runs one change of attachment ownership at a time per workspace: a
   * message claiming files (checked, then stored) never interleaves with a
   * file being deleted, so a stored message never points to a deleted file.
   */
  async exclusive<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.ownership.get(workspaceId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.catch(() => undefined);
    this.ownership.set(workspaceId, tail);
    try {
      return await run;
    } finally {
      if (this.ownership.get(workspaceId) === tail) this.ownership.delete(workspaceId);
    }
  }

  async create(workspaceId: string, dto: WorkspaceAttachmentDto): Promise<WorkspaceAttachment> {
    if (dto.kind === 'link') {
      return {
        id: uuidv7(),
        kind: 'link',
        name: dto.name,
        path: null,
        url: dto.url,
        mimeType: null,
        size: null,
      };
    }

    const file = dto.file;
    if (!file || file.size <= 0) throw new Error('The attachment is empty.');
    if (file.size > MAX_WORKSPACE_ATTACHMENT_BYTES) throw new Error('The attachment exceeds the 10 MB limit.');
    const id = uuidv7();
    const path = `.orkestrai/attachments/${id}-${safeFilename(file.name)}`;
    await filesystemService.writeBinary(workspaceId, path, new Uint8Array(await file.arrayBuffer()));
    return {
      id,
      kind: 'file',
      name: file.name.slice(0, 180),
      path,
      url: null,
      mimeType: canonicalMime(file.name, file.type),
      size: file.size,
    };
  }

  /** Fails, before anything is sent, when an attached file is gone or does not match its identifier. */
  async assertPresent(workspace: Pick<Workspace, 'workingDir'>, attachments: readonly WorkspaceAttachment[]): Promise<void> {
    for (const attachment of attachments) {
      if (attachment.kind === 'link') continue;
      const path = attachment.path ?? '';
      const present = path.startsWith(`.orkestrai/attachments/${attachment.id}-`)
        && await stat(resolve(workspace.workingDir, path)).then((info) => info.isFile()).catch(() => false);
      if (!present) throw new Error(`O anexo "${attachment.name}" não está mais no workspace. Anexe de novo.`);
    }
  }

  /**
   * Each attachment as the terminal that receives it can open it: a link by
   * its URL, a file by an absolute path in that terminal's own runtime (WSL
   * or host), which also reaches the file from a Floor.
   */
  describeFor(
    workspace: Pick<Workspace, 'workingDir' | 'runtimeKind' | 'wslDistribution' | 'wslWorkingDir'>,
    payload: Pick<TerminalNodePayload, 'executionRuntime'> | null | undefined,
    attachments: readonly WorkspaceAttachment[],
  ): string[] {
    return attachments.map((attachment) => attachment.kind === 'link'
      ? `link "${attachment.name}": ${attachment.url}`
      : `arquivo "${attachment.name}"${attachment.mimeType ? ` (${attachment.mimeType})` : ''} em ${workspaceFileForTerminal(workspace, payload, attachment.path ?? '')}`);
  }

  async remove(workspaceId: string, dto: WorkspaceAttachmentDeleteDto): Promise<void> {
    const attachment = dto.attachment;
    if (attachment.kind === 'link') return;
    const expectedPrefix = `.orkestrai/attachments/${attachment.id}-`;
    if (!attachment.path?.startsWith(expectedPrefix)) {
      throw new Error('The attachment path does not match its identifier.');
    }
    const path = attachment.path;
    await this.exclusive(workspaceId, async () => {
      // A message that was stored keeps its file, even when the screen that sent it
      // never learned so (a lost response) and discards its draft afterwards.
      if (await channelRepository.referencesAttachment(workspaceId, attachment.id)) return;
      await filesystemService.deleteFile(workspaceId, path);
    });
  }
}

export const workspaceAttachmentService = new WorkspaceAttachmentService();
