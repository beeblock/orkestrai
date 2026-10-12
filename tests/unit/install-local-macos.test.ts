import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installLocalMacos } from '../../scripts/install-local-macos.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(failure?: 'copy' | 'signature' | 'live' | 'health' | 'archive' | 'swap') {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-install-test-')); roots.push(root);
  const applications = join(root, 'Applications'); const cache = join(root, 'cache');
  const source = join(root, 'source', 'Orkestrai.app');
  await mkdir(join(source, 'Contents/Resources/app'), { recursive: true });
  await writeFile(join(source, 'Contents/Resources/app/package.json'), JSON.stringify({ version: '0.42.0' }));
  const installed = join(applications, 'Orkestrai.app');
  await mkdir(installed, { recursive: true }); await writeFile(join(installed, 'previous-marker'), 'original');
  const calls: string[] = [];
  const run = async (command: string, args: string[]) => {
    calls.push(command + ' ' + args.join(' '));
    if (command.endsWith('/PlistBuddy')) return 'com.orkestrai.desktop';
    if (command.endsWith('/file')) return 'Mach-O 64-bit executable arm64';
    if (command.endsWith('/ps')) return failure === 'live' ? `123 ${installed}/Contents/MacOS/Orkestrai\n` : '';
    if (command.endsWith('/ditto') && args[0] === '--rsrc') {
      if (failure === 'copy') throw new Error('copy failed');
      await mkdir(args.at(-1)!, { recursive: true }); await writeFile(join(args.at(-1)!, 'new-marker'), 'new');
    }
    if (command.endsWith('/codesign') && failure === 'signature') throw new Error('signature failed');
    if (command.endsWith('/ditto') && args[0] === '-c') {
      if (failure === 'archive') throw new Error('archive failed');
      await writeFile(args.at(-1)!, 'test archive');
    }
    return '';
  };
  const options = { applications, cache, arch: 'arm64', run, statfs: async () => ({ bavail: 10 * 1024 ** 3, bsize: 1 }), health: async () => { if (failure === 'health') throw new Error('health failed'); } };
  return { source, installed, cache, calls, options };
}
describe('verified local macOS installation', () => {
  it('refuses low disk before creating a copy or touching the installed app', async () => {
    const f = await fixture();
    await expect(installLocalMacos(f.source, { ...f.options, statfs: async () => ({ bavail: 1, bsize: 1 }) })).rejects.toThrow('3 GiB');
    expect(await readFile(join(f.installed, 'previous-marker'), 'utf8')).toBe('original');
    expect(f.calls.some(call => call.includes('/ditto'))).toBe(false);
  });
  it('awaits copy, signature and health before compacting the only rollback outside Applications', async () => {
    const f = await fixture();
    await mkdir(f.cache, { recursive: true }); await writeFile(join(f.cache, 'rollback-0.41.0-1.zip'), 'obsolete');
    await writeFile(join(f.cache, 'owner.zip'), 'keep');
    expect(await installLocalMacos(f.source, f.options)).toMatchObject({ installed: f.installed, version: '0.42.0' });
    expect(await readdir(f.cache)).toEqual(expect.arrayContaining(['owner.zip']));
    expect((await readdir(f.cache)).filter(name => name.startsWith('rollback-'))).toHaveLength(1);
    expect((await readdir(f.cache)).filter(name => name.startsWith('staging-'))).toHaveLength(0);
    expect(await readFile(join(f.installed, 'new-marker'), 'utf8')).toBe('new');
    expect(f.calls.findIndex(call => call.includes('codesign'))).toBeLessThan(f.calls.findIndex(call => call.includes('/open')));
  });
  it.each(['copy', 'signature', 'live'] as const)('does not touch the installed bundle on %s failure', async failure => {
    const f = await fixture(failure);
    await expect(installLocalMacos(f.source, f.options)).rejects.toThrow();
    expect(await readFile(join(f.installed, 'previous-marker'), 'utf8')).toBe('original');
    expect(f.calls.some(call => call.includes('/open'))).toBe(false);
  });
  it('restores the previous bundle on a failed health check after the new app has exited', async () => {
    const f = await fixture('health'); await expect(installLocalMacos(f.source, f.options)).rejects.toThrow('health failed');
    expect(await readFile(join(f.installed, 'previous-marker'), 'utf8')).toBe('original');
    expect((await readdir(f.cache)).filter(name => name.startsWith('staging-'))).toHaveLength(0);
  });
  it('preserves a recoverable previous bundle when archiving fails after healthy startup', async () => {
    const f = await fixture('archive'); await expect(installLocalMacos(f.source, f.options)).rejects.toThrow('recoverable previous bundle');
    const stage = (await readdir(f.cache)).find(name => name.startsWith('staging-'))!;
    expect(await readFile(join(f.cache, stage, 'previous.app/previous-marker'), 'utf8')).toBe('original');
    expect(await readFile(join(f.installed, 'new-marker'), 'utf8')).toBe('new');
  });
});
