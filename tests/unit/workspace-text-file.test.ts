import { afterEach, describe, expect, it, vi } from 'vitest';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_WORKSPACE_TEXT_BYTES, readWorkspaceTextFile } from '$lib/modules/agent-room/infrastructure/WorkspaceTextFile.js';

const directories: string[] = [];
async function fixture() { const root = await fsPromises.mkdtemp(join(tmpdir(), 'workspace-text-')); directories.push(root); return root; }
afterEach(async () => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map(path => fsPromises.rm(path, { recursive: true, force: true })));
});

describe('bounded workspace instruction reads', () => {
  it('preserves complete UTF-8 text even when the filesystem returns short reads', async () => {
    const root = await fixture(), path = join(root, 'AGENTS.md');
    const content = '# Regras\n\nNão apagar as imagens. 🧭\n';
    await fsPromises.writeFile(path, content);
    const open = fsPromises.open;
    vi.spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      const handle = await open(...args), read = handle.read.bind(handle);
      handle.read = ((buffer: Buffer, offset: number, length: number, position: number) => read(buffer, offset, Math.min(length, 3), position)) as typeof handle.read;
      return handle;
    });
    syncBuiltinESMExports();
    expect(await readWorkspaceTextFile(path)).toBe(content);
  });

  it('distinguishes a missing file from unsupported existing files', async () => {
    const root = await fixture();
    expect(await readWorkspaceTextFile(join(root, 'missing.md'))).toBe('');
    await expect(readWorkspaceTextFile(root)).rejects.toThrow(/type or size/);
    const large = join(root, 'large.md');
    const handle = await fsPromises.open(large, 'wx');
    await handle.truncate(MAX_WORKSPACE_TEXT_BYTES + 1); await handle.close();
    await expect(readWorkspaceTextFile(large)).rejects.toThrow(/type or size/);
    expect((await fsPromises.stat(large)).size).toBe(MAX_WORKSPACE_TEXT_BYTES + 1);
  });

  it.skipIf(process.platform === 'win32')('rejects a FIFO before opening it and refuses linked instruction files', async () => {
    const root = await fixture(), fifo = join(root, 'AGENTS.md');
    execFileSync('mkfifo', [fifo]);
    await expect(readWorkspaceTextFile(fifo)).rejects.toThrow(/type or size/);
    const target = join(root, 'owner.md'), link = join(root, 'CLAUDE.md');
    await fsPromises.writeFile(target, 'Owner instructions'); await fsPromises.symlink(target, link);
    await expect(readWorkspaceTextFile(link)).rejects.toThrow(/type or size/);
    expect(await fsPromises.readFile(target, 'utf8')).toBe('Owner instructions');
  });

  it('refuses a file replaced between inspection and opening', async () => {
    const root = await fixture(), path = join(root, 'AGENTS.md');
    await fsPromises.writeFile(path, 'Before');
    const open = fsPromises.open;
    vi.spyOn(fsPromises, 'open').mockImplementation(async (...args) => {
      await fsPromises.rename(path, path + '.old'); await fsPromises.writeFile(path, 'New owner content');
      return open(...args);
    });
    syncBuiltinESMExports();
    await expect(readWorkspaceTextFile(path)).rejects.toThrow(/changed before reading/);
    expect(await fsPromises.readFile(path, 'utf8')).toBe('New owner content');
  });

  it('refuses binary content instead of rewriting it as instruction text', async () => {
    const root = await fixture(), path = join(root, 'AGENTS.md');
    await fsPromises.writeFile(path, Buffer.from([65, 0, 66]));
    await expect(readWorkspaceTextFile(path)).rejects.toThrow(/binary/);
  });

  it('rejects invalid UTF-8 and preserves an existing UTF-8 byte order mark', async () => {
    const root = await fixture(), path = join(root, 'AGENTS.md');
    await fsPromises.writeFile(path, Buffer.from([0xff, 0xfe]));
    await expect(readWorkspaceTextFile(path)).rejects.toThrow();
    await fsPromises.writeFile(path, '\uFEFF# Owner instructions\n');
    expect(await readWorkspaceTextFile(path)).toBe('\uFEFF# Owner instructions\n');
  });
});
