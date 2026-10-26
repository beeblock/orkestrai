import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { adventureService } from '$lib/modules/agent-room/application/services/AdventureService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AdventureController } from '$lib/modules/agent-room/interface/http/controllers/AdventureController.js';
import { AgentAdventure } from '$lib/modules/agent-room/domain/models/AgentAdventure.js';
import { AgentAdventureHero } from '$lib/modules/agent-room/domain/models/AgentAdventureHero.js';
import { AgentAdventureItem } from '$lib/modules/agent-room/domain/models/AgentAdventureItem.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { xpToNext } from '$lib/modules/agent-room/domain/adventure/world.js';
import type { AdventureReportInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';
import type { AdventureSnapshot } from '$lib/modules/agent-room/application/services/AdventureService.js';

const roots: string[] = [];

async function team() {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-adventure-'));
  roots.push(root);
  const ws = await workspaceRepository.createWorkspace({ name: 'Aventura', workingDir: root });
  const lead = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'Lead', payload: { provider: 'claude', command: 'true', args: [], maestro: true } as never });
  const qa = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'QA', payload: { provider: 'codex', command: 'true', args: [], role: 'QA engineer' } as never });
  await workspaceRepository.createNode({ workspaceId: ws.id, type: 'note', title: 'Briefing', payload: {} as never });
  return { ws, lead, qa };
}

function heroOf(snapshot: AdventureSnapshot, nodeId: string) {
  const hero = snapshot.heroes.find((candidate) => candidate.agent?.nodeId === nodeId);
  if (!hero) throw new Error(`no hero for ${nodeId}`);
  return hero;
}

function report(overrides: Record<string, unknown> = {}): AdventureReportInput {
  return {
    reportId: uuidv7(), elapsedMs: 60_000, position: { difficulty: 'normal' as const, act: 1, stage: 2 }, wave: 0,
    xp: {}, gold: 0, kills: {}, chests: [], bosses: [], stages: [{ difficulty: 'normal' as const, act: 1, stage: 1, result: 'clear' as const }],
    ...overrides,
  } as unknown as AdventureReportInput;
}

function request(body: unknown, id: string) {
  return {
    params: { id },
    request: new Request('http://localhost/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    url: new URL('http://localhost/api'),
    locals: {},
  } as never;
}

describe('AdventureService', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

  it('turns every agent into a named guild hero with a starter kit, leader first as the Maestro', async () => {
    const { ws, lead, qa } = await team();
    const { snapshot } = await adventureService.state(ws.id);
    expect(snapshot.heroes.map((hero) => [hero.agent?.nodeId, hero.classId])).toEqual([[lead.id, 'maestro'], [qa.id, 'ranger']]);
    expect(snapshot.heroes.every((hero) => hero.name.length > 0 && hero.deployed)).toBe(true);
    const ranger = snapshot.heroes[1];
    expect(ranger.agentTitle).toBe('QA');
    expect(snapshot.items.filter((item) => item.heroId === ranger.id).map((item) => item.slot).sort()).toEqual(['armor', 'weapon']);
    expect(ranger.build?.visualTier).toBe(1);
    expect(snapshot.account.position).toEqual({ difficulty: 'normal', act: 1, stage: 1 });
    expect(snapshot.limits.formation).toBe(3);
  });

  it('records the battle: levels, gold, chests and cleared stages, once per report', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    const input = report({ xp: { [ranger.id]: xpToNext(1) + 1 }, gold: 40, kills: { 'glitch-slime': 12 }, chests: [{ tier: 'white', level: 1, difficulty: 'normal', act: 1 }] });
    const outcome = await adventureService.report(ws.id, input);
    expect(outcome.levelUps).toEqual([{ heroId: ranger.id, level: 2 }]);
    expect(outcome.snapshot.account.gold).toBe(40);
    expect(outcome.snapshot.account.chests).toHaveLength(1);
    expect(outcome.snapshot.account.cleared.normal).toBe(0);
    expect(outcome.snapshot.account.position).toEqual({ difficulty: 'normal', act: 1, stage: 2 });
    const again = await adventureService.report(ws.id, input);
    expect(again.snapshot.account.gold).toBe(40);
  });

  it('opens chests, equips the loot and refuses what the rules forbid', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    await adventureService.report(ws.id, report({ chests: [{ tier: 'blue', level: 3, difficulty: 'normal', act: 1 }] }));
    const opened = await adventureService.act(ws.id, { type: 'open-chests', tier: 'blue' });
    expect(opened.opened[0].items).toHaveLength(2);
    const loot = opened.opened[0].items[0];
    expect(opened.snapshot.items.find((item) => item.id === loot.id)?.location).toBe('inventory');
    const helmet = opened.snapshot.items.find((item) => item.slot !== 'weapon' && item.location === 'inventory');
    if (helmet) {
      const equipped = await adventureService.act(ws.id, { type: 'equip', itemId: helmet.id, heroId: ranger.id });
      expect(equipped.snapshot.items.find((item) => item.id === helmet.id)?.heroId).toBe(ranger.id);
    }
    await expect(adventureService.act(ws.id, { type: 'buy-rune', runeId: 'fortune' })).rejects.toThrow('rune-locked');
    await expect(adventureService.act(ws.id, { type: 'travel', difficulty: 'hell', act: 1, stage: 1 })).rejects.toThrow('locked-stage');
  });

  it('pays a Kanban card finished after the Adventure began as a quest chest', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    const now = new Date().toISOString();
    await AgentBoardTask.create({ id: uuidv7(), workspace_id: ws.id, title: 'Ship the login', status: 'done', assignee_node_id: qa.id, created_by: 'user', created_at: now, updated_at: now });
    const outcome = await adventureService.state(ws.id);
    expect(outcome.quests).toEqual([{ title: 'Ship the login', heroId: ranger.id }]);
    expect(outcome.snapshot.account.chests.map((chest) => chest.tier)).toEqual(['quest']);
    expect((await adventureService.state(ws.id)).quests).toEqual([]);
  });

  it('accepts a battle report over HTTP with only the monsters that fell', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    const controller = new AdventureController();
    const response = await controller.report(request(report({ xp: { [ranger.id]: 25 }, gold: 9, kills: { 'bug-beetle': 3 } }), ws.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.snapshot.account.killsByMonster).toEqual({ 'bug-beetle': 3 });
  });

  it('answers rule refusals over HTTP with a code and rejects malformed actions', async () => {
    const { ws } = await team();
    const controller = new AdventureController();
    const refused = await controller.act(request({ type: 'offering' }, ws.id));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: 'cube-level' });
    const malformed = await controller.act(request({ type: 'teleport' }, ws.id));
    expect(malformed.status).toBe(400);
  });

  it('keeps a dismissed agent\'s hero resting in the guild and hands it to the next agent of its class', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    await adventureService.report(ws.id, report({ xp: { [ranger.id]: xpToNext(1) + xpToNext(2) + 1 }, kills: { 'glitch-slime': 40 } }));
    await workspaceRepository.deleteNode(qa.id);

    const resting = (await adventureService.state(ws.id)).snapshot.heroes.find((hero) => hero.id === ranger.id);
    expect(resting).toMatchObject({ agent: null, agentNodeId: null, level: 3, name: ranger.name });
    expect(resting?.deployed).toBe(true);

    const tester = await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'Tester', payload: { provider: 'claude', command: 'true', args: [], role: 'QA tester' } as never });
    const { snapshot } = await adventureService.state(ws.id);
    expect(snapshot.heroes).toHaveLength(2);
    expect(heroOf(snapshot, tester.id)).toMatchObject({ id: ranger.id, level: 3, agentTitle: 'Tester' });
    expect(snapshot.items.filter((item) => item.heroId === ranger.id && item.location === 'equipped')).toHaveLength(2);
  });

  it('is deleted with its workspace', async () => {
    const { ws } = await team();
    await adventureService.state(ws.id);
    expect(await AgentAdventureHero.query().where('workspace_id', ws.id).count()).toBe(2);
    await workspaceRepository.deleteWorkspace(ws.id);
    expect(await AgentAdventure.query().where('workspace_id', ws.id).count()).toBe(0);
    expect(await AgentAdventureHero.query().where('workspace_id', ws.id).count()).toBe(0);
    expect(await AgentAdventureItem.query().where('workspace_id', ws.id).count()).toBe(0);
  });
});
