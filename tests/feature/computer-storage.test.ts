import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { ComputerEvidenceService, COMPUTER_STORAGE_LIMITS } from '$lib/modules/agent-room/application/services/ComputerEvidenceService.js';
import { computerNodeConfigSchema } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const folders: string[] = [];
const defaults = { ...COMPUTER_STORAGE_LIMITS };
afterEach(async () => { Object.assign(COMPUTER_STORAGE_LIMITS, defaults); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });

async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-capture-test-')); folders.push(folder);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Capture limits', workingDir: folder });
  const config = computerNodeConfigSchema.parse({ enabled: true, evidenceRetentionDays: 1 });
  await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: config } });
  return { folder, workspace, config, service: new ComputerEvidenceService() };
}
async function write(path: string) { await writeFile(path, 'test capture'); return { width: 100, height: 100 }; }

describe('Computer capture retention', () => {
  useSvelarTest({ refreshDatabase: true });

  it('expires captures without needing another screenshot and preserves unrelated files', async () => {
    const { folder, workspace, service } = await fixture();
    const directory = join(folder, '.orkestrai/computer/evidence'); await mkdir(directory, { recursive: true });
    const old = join(directory, `${uuidv7()}.png`); await write(old); await utimes(old, new Date(0), new Date(0));
    const unrelated = join(directory, 'my-design.png'); await write(unrelated); await utimes(unrelated, new Date(0), new Date(0));
    await service.sweep();
    expect(await readdir(directory)).toEqual(['my-design.png']);
    expect(service.usage(workspace.id)).toMatchObject({ files: 0, error: false });
  });

  it('discards unchanged observations immediately and bounds retained temporary files', async () => {
    const { folder, workspace, config, service } = await fixture();
    COMPUTER_STORAGE_LIMITS.temporaryFiles = 2;
    expect(await service.capture(workspace.id, config, true, write, async () => false)).toBeNull();
    expect(await readdir(join(folder, '.orkestrai/computer/pending'))).toEqual([]);
    expect(await readdir(join(folder, '.orkestrai/computer/observations'))).toEqual([]);
    for (let i = 0; i < 4; i++) await service.capture(workspace.id, config, true, write);
    expect(service.usage(workspace.id)).toMatchObject({ temporaryFiles: 2, files: 0 });
    const directory = join(folder, '.orkestrai/computer/observations');
    for (const name of await readdir(directory)) await utimes(join(directory, name), new Date(0), new Date(0));
    await service.sweep();
    expect(await readdir(directory)).toEqual([]);
  });

  it('enforces a combined quota across workspaces and cleans partial failures', async () => {
    const a = await fixture(); const b = await fixture();
    COMPUTER_STORAGE_LIMITS.totalFiles = 2;
    await a.service.capture(a.workspace.id, a.config, false, write);
    await a.service.capture(b.workspace.id, b.config, false, write);
    const latest = await a.service.capture(b.workspace.id, b.config, false, write);
    expect(a.service.usage(a.workspace.id).files + a.service.usage(b.workspace.id).files).toBe(2);
    expect(await readFile(join(b.folder, latest!.path), 'utf8')).toBe('test capture');
    await expect(a.service.capture(a.workspace.id, a.config, false, async (path) => { await write(path); throw new Error('failed capture'); })).rejects.toThrow('failed capture');
    expect(await readdir(join(a.folder, '.orkestrai/computer/pending'))).toEqual([]);
  });

  it('refuses to follow even an in-workspace storage symlink', async () => {
    const { folder, workspace, config, service } = await fixture();
    const target = join(folder, 'user-images'); await mkdir(target);
    const userFile = join(target, `${uuidv7()}.png`); await write(userFile); await utimes(userFile, new Date(0), new Date(0));
    await mkdir(join(folder, '.orkestrai/computer'), { recursive: true });
    await symlink(target, join(folder, '.orkestrai/computer/evidence'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(service.sweep()).rejects.toThrow('cleanup failed');
    await expect(service.capture(workspace.id, config, false, write)).rejects.toThrow('cleanup failed');
    expect(await readFile(userFile, 'utf8')).toBe('test capture');
    expect(service.usage(workspace.id).error).toBe(true);
  });

  it('pauses capture before writing when free space is below the floor', async () => {
    const { workspace, config, service } = await fixture();
    COMPUTER_STORAGE_LIMITS.minimumFreeBytes = Number.MAX_SAFE_INTEGER;
    let called = false;
    await expect(service.capture(workspace.id, config, false, async (path) => { called = true; return write(path); })).rejects.toThrow('free disk space');
    expect(called).toBe(false);
  });
});
