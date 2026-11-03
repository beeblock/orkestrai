import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { UpdateWorkspaceDto } from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';

const directories: string[] = [];
async function fixture() { const path = await fsp.mkdtemp(join(tmpdir(), 'workspace-folder-')); directories.push(path); return path; }
afterEach(async () => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await Promise.all(directories.splice(0).map(path => fsp.rm(path, { recursive: true, force: true })));
});

describe('workspace folder availability', () => {
  useSvelarTest({ refreshDatabase: true });

  it('creates and changes folders without synchronous project filesystem access, preserving owner instructions', async () => {
    const root = await fixture(), next = await fixture();
    for (const dir of [root, next]) {
      await fsp.writeFile(join(dir, 'AGENTS.md'), '# Owner rules\nDo not delete approved art.\n');
      await fsp.writeFile(join(dir, 'CLAUDE.md'), '# Claude rules\n');
    }
    const operations = ['existsSync', 'statSync', 'realpathSync', 'readFileSync', 'writeFileSync'] as const;
    const spies = operations.map(name => vi.spyOn(fs, name));
    syncBuiltinESMExports();
    const workspace = await workspaceService.create({ name: 'Async folder', workingDir: root, icon: null, instructions: 'Deliver the game.', syncAgentInstructionFiles: true, codeIntelligenceMode: 'disabled' });
    const updated = await workspaceService.update(workspace.id, new UpdateWorkspaceDto({ workingDir: next, instructions: 'Continue the game.' }));
    expect(updated.codeIntelligenceMode).toBe('disabled');
    expect(await fsp.readFile(join(next, 'AGENTS.md'), 'utf8')).toContain('Do not delete approved art.');
    expect(await fsp.readFile(join(next, 'CLAUDE.md'), 'utf8')).toContain('Continue the game.');
    for (const spy of spies) expect(spy.mock.calls.filter(call => [root, next].some(dir => String(call[0]).startsWith(dir)))).toEqual([]);
  });

  it('keeps another workspace and the event loop responsive while a project instruction read waits', async () => {
    const slow = await fixture(), fast = await fixture();
    await fsp.writeFile(join(slow, 'AGENTS.md'), '# Slow share\n');
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const open = fsp.open;
    let entered = false;
    vi.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      if (String(args[0]) === join(slow, 'AGENTS.md')) { entered = true; await barrier; }
      return open(...args);
    });
    syncBuiltinESMExports();
    const pending = workspaceService.create({ name: 'Slow share', workingDir: slow, icon: null, instructions: 'Preserve content.', codeIntelligenceMode: 'disabled' });
    try {
      await vi.waitFor(() => expect(entered).toBe(true));
      await new Promise<void>(resolve => setImmediate(resolve));
      expect((await workspaceService.create({ name: 'Healthy folder', workingDir: fast, icon: null, instructions: null, codeIntelligenceMode: 'disabled' })).name).toBe('Healthy folder');
    } finally { release(); await pending; }
  });
});
