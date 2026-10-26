import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { adventureService } from '$lib/modules/agent-room/application/services/AdventureService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AdventureController } from '$lib/modules/agent-room/interface/http/controllers/AdventureController.js';
import { AgentAdventureProgress } from '$lib/modules/agent-room/domain/models/AgentAdventureProgress.js';

const roots: string[] = [];

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-adventure-'));
  roots.push(root);
  return workspaceRepository.createWorkspace({ name: 'Aventura', workingDir: root });
}

describe('AdventureService', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

  it('starts a new party at the beginning of the road', async () => {
    const ws = await workspace();
    expect(await adventureService.read(ws.id)).toEqual({ progress: { stageIndex: 0, wave: 0, xp: 0, gold: 0, kills: 0, bosses: 0, quests: 0 }, heroClasses: {} });
  });

  it('keeps the furthest progress two screens report, never moving it back', async () => {
    const ws = await workspace();
    await adventureService.saveProgress(ws.id, { stageIndex: 3, wave: 2, xp: 900, gold: 120, kills: 80, bosses: 1, quests: 4 });
    const merged = await adventureService.saveProgress(ws.id, { stageIndex: 2, wave: 4, xp: 950, gold: 100, kills: 70, bosses: 1, quests: 5 });
    expect(merged).toEqual({ stageIndex: 3, wave: 2, xp: 950, gold: 120, kills: 80, bosses: 1, quests: 5 });
    expect((await adventureService.read(ws.id)).progress).toEqual(merged);
  });

  it('stores the class the owner picks for a teammate and validates it over HTTP', async () => {
    const ws = await workspace();
    const agent = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'QA', payload: { provider: 'claude' } as never });
    expect(await adventureService.setHeroClass(ws.id, agent.id, 'cleric')).toEqual({ [agent.id]: 'cleric' });
    const controller = new AdventureController();
    const put = (body: unknown) => controller.heroClass({ url: new URL('http://localhost/api'), params: { id: ws.id, nodeId: agent.id },
      request: new Request('http://localhost/api', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) } as never);
    // The leader's class is not a teammate's to take.
    expect((await put({ classId: 'maestro' })).status).toBe(400);
    expect((await put({ classId: null })).status).toBe(200);
    expect((await adventureService.read(ws.id)).heroClasses).toEqual({});
    await expect(adventureService.setHeroClass(ws.id, 'not-a-node', 'knight')).rejects.toThrow();
  });

  it('is removed with its workspace', async () => {
    const ws = await workspace();
    await adventureService.saveProgress(ws.id, { stageIndex: 1, wave: 0, xp: 10, gold: 1, kills: 1, bosses: 0, quests: 0 });
    await workspaceRepository.deleteWorkspace(ws.id);
    expect(await AgentAdventureProgress.query().where('workspace_id', ws.id).first()).toBeFalsy();
  });
});
