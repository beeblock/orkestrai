import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { createRequire } from 'node:module';
import { openWorkspaceFolderSchema } from '$lib/modules/agent-room/contracts/schemas/fsSchemas.js';

const { openWorkspaceFolder, isWithin } = createRequire(import.meta.url)('../../electron/workspace-folder.cjs');
let root: string;
const shell = { openPath: vi.fn() };
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'ork-folder-')));
  shell.openPath.mockReset().mockResolvedValue('');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('Workspace folder desktop boundary', () => {
  it('opens the exact directory with literal spaces and shell metacharacters', async () => {
    const folder = join(root, 'campaign ; $draft');
    await mkdir(folder);
    await expect(openWorkspaceFolder(shell, { root, path: folder })).resolves.toEqual({ opened: true });
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith(folder);
  });
  it('rejects files, missing directories, URLs, traversal and application bundles', async () => {
    await writeFile(join(root, 'test.txt'), 'hello');
    await mkdir(join(root, 'Danger.app'));
    for (const path of [join(root, 'test.txt'), join(root, 'missing'), 'https://example.com', join(root, '..'), join(root, 'Danger.app')]) {
      await expect(openWorkspaceFolder(shell, { root, path })).rejects.toThrow();
    }
    expect(shell.openPath).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform === 'win32')('rechecks symlink targets before invoking Electron', async () => {
    await symlink(tmpdir(), join(root, 'escape'));
    await expect(openWorkspaceFolder(shell, { root, path: join(root, 'escape') })).rejects.toThrow('outside');
    expect(shell.openPath).not.toHaveBeenCalled();
  });
  it('reports native failures without claiming the folder was opened', async () => {
    shell.openPath.mockResolvedValue('OS details');
    await expect(openWorkspaceFolder(shell, { root, path: root })).rejects.toThrow('could not open');
  });
  it('confines native Windows and WSL paths to the selected root/distro', () => {
    expect(isWithin('C:\\work\\project', 'C:\\work\\project\\images', win32)).toBe(true);
    expect(isWithin('C:\\work\\project', 'C:\\work\\project-other', win32)).toBe(false);
    expect(isWithin('C:\\work', 'D:\\work', win32)).toBe(false);
    expect(isWithin('\\\\wsl.localhost\\Ubuntu\\home\\me', '\\\\wsl.localhost\\Ubuntu\\home\\me\\images', win32)).toBe(true);
    expect(isWithin('\\\\wsl.localhost\\Ubuntu\\home\\me', '\\\\wsl.localhost\\Debian\\home\\me', win32)).toBe(false);
  });
  it('accepts only bounded relative paths in the public contract', () => {
    for (const path of ['.', 'generated/images/my campaign', '@assets/images']) expect(openWorkspaceFolderSchema.safeParse({ path }).success).toBe(true);
    for (const path of ['', 'file:///tmp', 'https://example.com', '/tmp', 'C:\\temp', '\\\\server\\folder', 'a\nb', 'a'.repeat(4001)]) expect(openWorkspaceFolderSchema.safeParse({ path }).success).toBe(false);
    expect(openWorkspaceFolderSchema.safeParse({ path: '.', from: 'spoofed' }).success).toBe(false);
  });
});
