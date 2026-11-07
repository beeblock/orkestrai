import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { FilesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { gitService } from '$lib/modules/agent-room/application/services/GitService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { FilesystemController } from '$lib/modules/agent-room/interface/http/controllers/FilesystemController.js';
import { CoreRuntimeController } from '$lib/modules/agent-room/interface/http/controllers/CoreRuntimeController.js';

const directories: string[] = [];
async function fixture() {
  const root = await fsp.mkdtemp(join(tmpdir(), 'workspace-io-'));
  directories.push(root);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Unity assets', workingDir: root, codeIntelligenceMode: 'disabled' });
  return { root, workspace };
}
afterEach(async () => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map(root => fsp.rm(root, { recursive: true, force: true })));
});

describe('workspace I/O without Code Intelligence', () => {
  useSvelarTest({ refreshDatabase: true });

  function gitFixture(count = 80) {
    let active = 0, peak = 0, contentVersion = 'a';
    const run = vi.spyOn(gitService as any, 'workspaceGit').mockImplementation(async (_workspaceId, args: any) => {
      if (args[0] === 'status') return Array.from({ length: count }, (_, i) => `?? Assets/art-${i}.png\0`).join('');
      if (args[0] === 'branch') return 'main\n';
      if (args[0] === 'hash-object') {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active--;
        return contentVersion.repeat(40);
      }
      if (args.includes('@{upstream}')) return '';
      return args.includes('--is-inside-work-tree') ? 'true\n' : 'head\n';
    });
    return { run, peak: () => peak, change: () => { contentVersion = 'b'; } };
  }

  it('polls Canvas Git metadata without opening every untracked asset', async () => {
    const { workspace } = await fixture();
    const { run } = gitFixture();
    const response = await new FilesystemController().gitStatus({ params: { id: workspace.id }, url: new URL('http://localhost/git/status?summary=1') });
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.changes).toHaveLength(80);
    expect(data.branch).toBe('main');
    expect(run.mock.calls.filter(([, args]: any) => args[0] === 'hash-object')).toHaveLength(0);
    expect(data).not.toHaveProperty('revision');
  });

  it.each(['native', 'wsl'])('prepares the %s Git launch without synchronous PATH or workspace probes', async runtimeKind => {
    const { root } = await fixture();
    const probes = ['existsSync', 'readdirSync', 'statSync', 'readFileSync'] as const;
    const spies = probes.map(name => vi.spyOn(fs, name)); syncBuiltinESMExports();
    const launch = await (gitService as any).launch({ workingDir: root, runtimeKind, wslDistribution: 'Ubuntu', wslWorkingDir: '/home/owner/game' }, ['status', '--porcelain=v1', '-z', '-uall']);
    expect(launch.command).toBe(runtimeKind === 'wsl' ? 'wsl.exe' : 'git');
    if (runtimeKind === 'wsl') {
      expect(launch.args).toContain('/home/owner/game');
      expect(launch.args).toContain('Ubuntu');
    } else expect(launch.cwd).toBe(root);
    expect(launch.args.slice(-4)).toEqual(['status', '--porcelain=v1', '-z', '-uall']);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('shares concurrent Canvas polls but retains exact, bounded content checks for mutations', async () => {
    const { workspace } = await fixture();
    const { run, peak, change } = gitFixture();
    const controller = new FilesystemController();
    await Promise.all(Array.from({ length: 3 }, () => controller.gitStatus({ params: { id: workspace.id }, url: new URL('http://localhost/git/status?summary=1') })));
    expect(run.mock.calls.filter(([, args]: any) => args[0] === 'status')).toHaveLength(1);
    const first = await gitService.status(workspace.id);
    change();
    const second = await gitService.status(workspace.id);
    expect(second.revision).not.toBe(first.revision);
    expect(first.revision).toHaveLength(64);
    expect(peak()).toBeLessThanOrEqual(2);
  });

  it('lists, reads, writes and deletes assets without synchronous project I/O', async () => {
    const { root, workspace } = await fixture();
    await fsp.writeFile(join(root, 'art.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const methods = ['existsSync', 'statSync', 'readdirSync', 'readFileSync', 'writeFileSync', 'unlinkSync'] as const;
    const spies = methods.map(name => vi.spyOn(fs, name));
    syncBuiltinESMExports();
    const service = new FilesystemService();
    expect((await service.list(workspace.id)).map(entry => entry.name)).toContain('art.png');
    expect((await service.readBinary(workspace.id, 'art.png')).data).toHaveLength(4);
    await service.write(workspace.id, 'script.cs', 'class Player {}');
    expect((await service.read(workspace.id, 'script.cs')).content).toContain('Player');
    await service.writeBinary(workspace.id, 'copy.png', new Uint8Array([1, 2, 3]));
    expect(await service.deleteFile(workspace.id, 'copy.png')).toBe(true);
    for (const spy of spies) expect(spy.mock.calls.filter(call => String(call[0]).startsWith(root))).toEqual([]);
  });

  it('does not synchronously crawl the project when the search binary is unavailable', async () => {
    const { root, workspace } = await fixture();
    await fsp.mkdir(join(root, 'Assets'));
    await fsp.writeFile(join(root, 'Assets', 'Player.cs'), 'class Player {}');
    const service = new FilesystemService();
    vi.spyOn(service as any, 'searchWithRipgrep').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const read = vi.spyOn(fs, 'readdirSync');
    syncBuiltinESMExports();
    expect(await service.search(workspace.id, 'Player', { byContent: true })).toEqual([expect.objectContaining({ path: join(root, 'Assets', 'Player.cs'), line: 1 })]);
    expect(read.mock.calls.filter(call => String(call[0]).startsWith(root))).toEqual([]);
  });

  it.each([false, true])('serializes writes and deletes across instances and releases failed paths (existing=%s)', async existing => {
    const { root, workspace } = await fixture();
    const target = join(root, 'shared.txt');
    if (existing) await fsp.writeFile(target, 'original');
    const write = fsp.writeFile;
    let release!: () => void, entered = false;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(fsp, 'writeFile').mockImplementation(async (...args: any[]) => {
      if (String(args[0]) === target && args[1] === 'first') {
        await (write as any)(...args); entered = true; await barrier; return;
      }
      return (write as any)(...args);
    });
    syncBuiltinESMExports();
    const first = new FilesystemService().write(workspace.id, 'shared.txt', 'first');
    let second!: Promise<unknown>, deleted!: Promise<unknown>;
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      second = new FilesystemService().writeBinary(workspace.id, 'shared.txt', Buffer.from('second'));
      await new FilesystemService().write(workspace.id, 'independent.txt', 'works');
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(spy.mock.calls.filter(call => String(call[0]) === target)).toHaveLength(1);
      deleted = new FilesystemService().deleteFile(workspace.id, 'shared.txt');
      expect(await fsp.readFile(target, 'utf8')).toBe('first');
    } finally { release(); await Promise.all([first, second, deleted]); }
    expect(await fsp.stat(target).then(() => true, () => false)).toBe(false);
    spy.mockRejectedValueOnce(new Error('disk write failed'));
    await expect(new FilesystemService().write(workspace.id, 'shared.txt', 'fails')).rejects.toThrow('disk write failed');
    await new FilesystemService().write(workspace.id, 'shared.txt', 'recovered');
    expect(await fsp.readFile(target, 'utf8')).toBe('recovered');
  });

  it('never starts a fallback scan after the search process times out', async () => {
    const { workspace } = await fixture();
    const service = new FilesystemService();
    vi.spyOn(service as any, 'searchWithRipgrep').mockRejectedValue(Object.assign(new Error('Search timed out'), { killed: true, code: null }));
    const scan = vi.spyOn(fsp, 'opendir'); syncBuiltinESMExports();
    await expect(service.search(workspace.id, 'not-present')).rejects.toThrow('Search timed out');
    expect(scan).not.toHaveBeenCalled();
  });

  it.each([false, true])('omits Unity root caches while retaining authored source (fallback=%s)', async fallback => {
    const { root, workspace } = await fixture();
    for (const dir of ['ProjectSettings', 'Library', 'Assets/Library', 'Packages']) await fsp.mkdir(join(root, dir), { recursive: true });
    await fsp.writeFile(join(root, 'ProjectSettings', 'ProjectVersion.txt'), 'm_EditorVersion: 6000.0');
    for (const name of ['Library/needle.cs', 'Assets/Library/needle.cs', 'Packages/needle.cs']) await fsp.writeFile(join(root, name), 'needle');
    const service = new FilesystemService();
    if (fallback) vi.spyOn(service as any, 'searchWithRipgrep').mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    const results = await service.search(workspace.id, 'needle', { byContent: true });
    expect(results.map(file => file.path).sort()).toEqual([join(root, 'Assets/Library/needle.cs'), join(root, 'Packages/needle.cs')].sort());
    expect((await fsp.readFile(join(root, 'Library/needle.cs'), 'utf8'))).toBe('needle');
  });

  it('keeps Core health responsive while an asset-directory stat waits', async () => {
    const { root, workspace } = await fixture();
    await fsp.writeFile(join(root, 'art.png'), 'image');
    let release!: () => void, entered = false;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const stat = fsp.stat;
    vi.spyOn(fsp, 'stat').mockImplementation(async (...args: any[]) => {
      if (String(args[0]) === join(root, 'art.png')) { entered = true; await barrier; }
      return (stat as any)(...args);
    });
    syncBuiltinESMExports();
    vi.stubEnv('ORKESTRAI_CORE_TOKEN', 'test-core-token');
    const pending = new FilesystemService().list(workspace.id);
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await new Promise<void>(resolve => setImmediate(resolve));
      const response = await new CoreRuntimeController().health({ request: new Request('http://localhost/core/health', { headers: { 'x-orkestrai-core-token': 'test-core-token' } }) } as any);
      expect(response.status).toBe(200);
      expect((await response.json()).data.pid).toBe(process.pid);
    } finally { release(); await pending; vi.unstubAllEnvs(); }
  });

  it('rejects an already-aborted asset request before opening a file', async () => {
    const { root, workspace } = await fixture();
    await fsp.writeFile(join(root, 'cancelled.bin'), Buffer.alloc(64 * 1024));
    const abort = new AbortController(); abort.abort();
    const opening = vi.spyOn(fsp, 'open'); syncBuiltinESMExports();
    await expect(new FilesystemService().streamBinary(workspace.id, 'cancelled.bin', abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(opening).not.toHaveBeenCalled();
  });

  it('keeps Core alive when a request aborts while its asset stream is being constructed', async () => {
    const { root, workspace } = await fixture();
    const path = join(root, 'cancelled.bin');
    await fsp.writeFile(path, Buffer.alloc(64 * 1024));
    const abort = new AbortController();
    const originalOpen = fsp.open;
    let stream: fs.ReadStream | undefined;
    vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await originalOpen(file, flags, mode);
      if (String(file) === path) {
        const create = handle.createReadStream.bind(handle);
        handle.createReadStream = options => {
          abort.abort();
          stream = create(options);
          return stream;
        };
      }
      return handle;
    });
    syncBuiltinESMExports();
    const file = await new FilesystemService().streamBinary(workspace.id, 'cancelled.bin', abort.signal);
    await expect(file.body.getReader().read()).rejects.toMatchObject({ name: 'AbortError' });
    await expect.poll(() => stream?.closed).toBe(true);
  });

  it('preserves file read errors for an active asset consumer', async () => {
    const { root, workspace } = await fixture();
    const path = join(root, 'failed.bin');
    await fsp.writeFile(path, Buffer.alloc(64 * 1024));
    const originalOpen = fsp.open;
    let stream: fs.ReadStream | undefined;
    vi.spyOn(fsp, 'open').mockImplementation(async (file, flags, mode) => {
      const handle = await originalOpen(file, flags, mode);
      if (String(file) === path) {
        const create = handle.createReadStream.bind(handle);
        handle.createReadStream = options => { stream = create(options); return stream; };
      }
      return handle;
    });
    syncBuiltinESMExports();
    const file = await new FilesystemService().streamBinary(workspace.id, 'failed.bin');
    const failure = new Error('Fixture read failure');
    stream!.destroy(failure);
    await expect(file.body.getReader().read()).rejects.toThrow('Fixture read failure');
    await expect.poll(() => stream?.closed).toBe(true);
  });

  it('streams a large asset with bounded chunks, preserving bytes and closing on cancellation', async () => {
    const { root, workspace } = await fixture();
    const path = join(root, 'large-asset.bin');
    const handle = await fsp.open(path, 'w');
    // APFS/Linux sparse fixture represents the reported 6 GiB without allocating
    // 6 GiB. Keep Windows CI small: NTFS allocation behavior is machine-specific.
    const size = process.platform === 'win32' ? 32 * 1024 * 1024 : 6 * 1024 ** 3;
    await handle.truncate(size); await handle.write(Buffer.from('ASSET'), 0, 5, 0); await handle.close();
    const service = new FilesystemService();
    const opened = fsp.open;
    let close!: ReturnType<typeof vi.spyOn>;
    vi.spyOn(fsp, 'open').mockImplementation(async (...args: any[]) => {
      const file = await (opened as any)(...args);
      if (String(args[0]) === path) close = vi.spyOn(file, 'close');
      return file;
    });
    syncBuiltinESMExports();
    const file = await service.streamBinary(workspace.id, 'large-asset.bin');
    expect(file.size).toBe(size);
    const reader = file.body.getReader();
    const { value } = await reader.read();
    expect(Buffer.from(value!).subarray(0, 5).toString()).toBe('ASSET');
    expect(value!.byteLength).toBeLessThanOrEqual(64 * 1024);
    await reader.cancel();
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    if (size > 64 * 1024 * 1024) await expect(service.readBinary(workspace.id, 'large-asset.bin')).rejects.toThrow('too large');
    expect((await fsp.stat(path)).size).toBe(size);
    await fsp.writeFile(join(root, 'empty.bin'), '');
    const empty = await service.streamBinary(workspace.id, 'empty.bin');
    await fsp.appendFile(join(root, 'empty.bin'), 'new bytes');
    expect(empty.size).toBe(0);
    expect(await new Response(empty.body).text()).toBe('');
  });
});
