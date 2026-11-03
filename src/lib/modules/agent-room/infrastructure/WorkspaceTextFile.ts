import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

export const MAX_WORKSPACE_TEXT_BYTES = 1024 * 1024;

/** Missing is empty; unreadable, oversized, redirected or changing files are never empty defaults. */
export async function readWorkspaceTextFile(path: string): Promise<string> {
  const before = await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!before) return '';
  if (!before.isFile() || before.size > MAX_WORKSPACE_TEXT_BYTES) throw new Error('Unsupported workspace text file type or size.');
  const nonblocking = process.platform === 'win32' ? 0 : (constants.O_NONBLOCK ?? 0);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | nonblocking);
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size > MAX_WORKSPACE_TEXT_BYTES) {
      throw new Error('Workspace text file changed before reading.');
    }
    const buffer = Buffer.alloc(MAX_WORKSPACE_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > MAX_WORKSPACE_TEXT_BYTES || after.size !== length || after.mtimeMs !== opened.mtimeMs) {
      throw new Error('Workspace text file changed or exceeded its read limit.');
    }
    if (buffer.subarray(0, length).includes(0)) throw new Error('Workspace text file contains binary data.');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } finally { await handle.close(); }
}
