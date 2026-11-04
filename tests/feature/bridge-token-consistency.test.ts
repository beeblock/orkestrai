import { afterEach, describe, expect, it } from 'vitest';
import { link, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { BridgeService, bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function workspaceFixture() {
  const workingDir = await mkdtemp(join(tmpdir(), 'orkestrai-token-consistency-'));
  directories.push(workingDir);
  return workspaceRepository.createWorkspace({ name: 'Bridge consistency', workingDir });
}

describe('workspace bridge token consistency', () => {
  useSvelarTest({ refreshDatabase: true });
  it('does not overwrite a hard-linked file outside the workspace', async () => {
    const workspace = await workspaceFixture();
    await bridgeService.getOrCreateToken(workspace.id);
    const outside = await mkdtemp(join(tmpdir(), 'orkestrai-token-outside-'));
    directories.push(outside);
    const externalFile = join(outside, 'private.json');
    await writeFile(externalFile, 'unchanged');
    const config = join(workspace.workingDir, '.orkestrai/workspace.json');
    await rm(config);
    await link(externalFile, config);
    await expect(bridgeService.getOrCreateToken(workspace.id)).rejects.toThrow('configuration path');
    expect(await readFile(externalFile, 'utf8')).toBe('unchanged');
  });
  it.skipIf(process.platform === 'win32')('does not follow a replaced configuration file outside the workspace', async () => {
    const workspace = await workspaceFixture();
    await bridgeService.getOrCreateToken(workspace.id);
    const outside = await mkdtemp(join(tmpdir(), 'orkestrai-token-outside-'));
    directories.push(outside);
    const externalFile = join(outside, 'private.json');
    await writeFile(externalFile, 'unchanged');
    const config = join(workspace.workingDir, '.orkestrai/workspace.json');
    await rm(config);
    await symlink(externalFile, config);
    await expect(bridgeService.getOrCreateToken(workspace.id)).rejects.toThrow('configuration path');
    expect(await readFile(externalFile, 'utf8')).toBe('unchanged');
  });

  it('returns one persisted token to concurrent first-time callers across service instances', async () => {
    const workspace = await workspaceFixture();
    const tokens = await Promise.all(Array.from({ length: 6 }, () => new BridgeService().getOrCreateToken(workspace.id)));
    expect(new Set(tokens).size).toBe(1);
    for (const token of tokens) {
      const resolved = await bridgeService.resolveWorkspaceByToken(token);
      expect(resolved.id).toBe(workspace.id);
    }
    const config = JSON.parse(await readFile(join(workspace.workingDir, '.orkestrai/workspace.json'), 'utf8'));
    expect(config.token === tokens[0]).toBe(true);
  });

  it.each(['stale-token', 'wrong-workspace', 'malformed-json'])('repairs %s even when every bridge skill is already current', async corruption => {
    const workspace = await workspaceFixture();
    const expectedToken = await bridgeService.getOrCreateToken(workspace.id);
    await bridgeService.provisionSkill(workspace, expectedToken);
    const file = join(workspace.workingDir, '.orkestrai/workspace.json');
    const config = JSON.parse(await readFile(file, 'utf8'));
    if (corruption === 'stale-token') config.token = 'removed-workspace-token';
    if (corruption === 'wrong-workspace') config.workspaceId = 'removed-workspace';
    await writeFile(file, corruption === 'malformed-json' ? '{"workspaceId":' : JSON.stringify(config));

    await workspaceService.get(workspace.id);

    const repaired = JSON.parse(await readFile(file, 'utf8'));
    expect(repaired.workspaceId).toBe(workspace.id);
    expect(repaired.token === expectedToken).toBe(true);
    expect((await bridgeService.resolveWorkspaceByToken(repaired.token)).id).toBe(workspace.id);
    expect((await bridgeService.getOrCreateToken(workspace.id)) === expectedToken).toBe(true);
  });
});
