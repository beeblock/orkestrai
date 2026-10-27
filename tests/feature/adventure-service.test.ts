import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { adventureService } from '$lib/modules/agent-room/application/services/AdventureService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AdventureController } from '$lib/modules/agent-room/interface/http/controllers/AdventureController.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { AgentAdventure } from '$lib/modules/agent-room/domain/models/AgentAdventure.js';
import { AgentAdventureHero } from '$lib/modules/agent-room/domain/models/AgentAdventureHero.js';
import { AgentAdventureItem } from '$lib/modules/agent-room/domain/models/AgentAdventureItem.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { xpToNext } from '$lib/modules/agent-room/domain/adventure/world.js';
import type { AdventureReportInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';
import type { AdventureSnapshot } from '$lib/modules/agent-room/application/services/AdventureService.js';
import { adventureRepository } from '$lib/modules/agent-room/infrastructure/repositories/AdventureRepository.js';
import { canEquip, rollItem } from '$lib/modules/agent-room/domain/adventure/items.js';
import { ReportOutbox, type Battle } from '$lib/components/agent-room/adventure/adventure-outbox.js';

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
    await adventureService.act(ws.id, { type: 'settings', settings: { autoOpen: false } });
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

  it('pays a report whose answer was lost only once, even with another report in between', async () => {
    const { ws } = await team();
    await adventureService.state(ws.id);
    const outbox = new ReportOutbox();
    const send = async () => {
      const next = outbox.next()!;
      return adventureService.report(next.workspaceId, { reportId: next.reportId, ...next.battle } as AdventureReportInput);
    };
    const fought = (gold: number): Battle => ({ elapsedMs: 5_000, xp: {}, gold, kills: { 'bug-beetle': 2 }, chests: [], bosses: [], stages: [], position: { difficulty: 'normal', act: 1, stage: 1 }, wave: 0 });

    outbox.add(ws.id, fought(5));
    const first = outbox.next()!;
    // The server stores the report, then the answer is lost on the way back.
    await send();
    // Meanwhile the battle goes on: the next interval waits in a report of its own.
    outbox.add(ws.id, fought(7));
    expect(outbox.next()).toEqual(first);
    // Another screen's report lands between the two attempts.
    await adventureService.report(ws.id, report({ stages: [], gold: 100, kills: { 'bug-beetle': 1 } }));
    const retried = await send();
    expect(retried.snapshot.account.gold).toBe(105);
    outbox.settle(first.reportId);
    const second = outbox.next()!;
    expect(second.reportId).not.toBe(first.reportId);
    expect(second.battle.gold).toBe(7);
    expect((await send()).snapshot.account.gold).toBe(112);
  });

  it('pays every report of battle fought while the server was away, within the time that passed', async () => {
    const { ws } = await team();
    await adventureService.state(ws.id);
    // The last report came half an hour ago.
    const before = (await adventureRepository.load(ws.id))!;
    const after = structuredClone(before);
    const away = new Date(Date.now() - 30 * 60_000).toISOString();
    after.account.lastReportAt = away;
    after.account.battleUntil = away;
    await adventureRepository.persist(ws.id, before, after);

    const fiveMinutes = () => report({ elapsedMs: 5 * 60_000, stages: [], kills: { 'bug-beetle': 1_000 } });
    for (let index = 0; index < 6; index++) await adventureService.report(ws.id, fiveMinutes());
    expect((await adventureService.state(ws.id)).snapshot.account.kills).toBe(6_000);
    // Time that never passed is not paid: a seventh report is cut to the timers' slack.
    const extra = await adventureService.report(ws.id, fiveMinutes());
    expect(extra.snapshot.account.kills).toBeLessThan(6_000 + 400);
  });

  it('opens chests, equips the loot and refuses what the rules forbid', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    // Everything by hand here: no automatic opening, gear or salvage.
    await adventureService.act(ws.id, { type: 'settings', settings: { autoOpen: false, autoSalvage: 'off' } });
    for (const entry of (await adventureService.state(ws.id)).snapshot.heroes) await adventureService.act(ws.id, { type: 'auto-gear', heroId: entry.id, enabled: false });
    await adventureService.report(ws.id, report({ chests: [{ tier: 'blue', level: 3, difficulty: 'normal', act: 1 }] }));
    const opened = await adventureService.act(ws.id, { type: 'open-chests', tier: 'blue' });
    expect(opened.opened[0].items).toHaveLength(2);
    const loot = opened.opened[0].items[0];
    expect(opened.snapshot.items.find((item) => item.id === loot.id)?.location).toBe('inventory');
    // Any piece the ranger can wear (off hands and set pieces belong to a class).
    const helmet = opened.snapshot.items.find((item) => item.location === 'inventory' && canEquip(item, { classId: 'ranger', level: 1 }) === 'ok');
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
    await adventureService.act(ws.id, { type: 'settings', settings: { autoOpen: false } });
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
    const gone = await controller.report(request(report(), uuidv7()));
    expect(gone.status).toBe(404);
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

  it('stores variants, uniques, set pieces, gem cuts and elixirs, and runs the new camp actions', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    const before = (await adventureRepository.load(ws.id))!;
    const after = structuredClone(before);
    const rng = () => 0.42;
    const bow = { ...rollItem(rng, { level: 5, rarity: 'legendary', uniqueId: 'canopy-whisper' }), id: uuidv7(), location: 'inventory' as const, heroId: null, locked: false, createdAt: new Date().toISOString() };
    const hood = { ...rollItem(rng, { level: 30, rarity: 'epic', setId: 'windrunner', slot: 'helmet' }), id: uuidv7(), location: 'inventory' as const, heroId: null, locked: false, createdAt: new Date().toISOString() };
    const quiver = { ...rollItem(rng, { level: 30, rarity: 'rare', slot: 'offhand', classId: 'ranger' }), id: uuidv7(), location: 'inventory' as const, heroId: null, locked: false, createdAt: new Date().toISOString() };
    const boots = { ...rollItem(rng, { level: 30, rarity: 'rare', slot: 'boots', variant: 2 }), id: uuidv7(), location: 'inventory' as const, heroId: null, locked: false, createdAt: new Date().toISOString() };
    hood.sockets = [{ kind: 'decoration', material: 'ruby', quality: 4 }];
    after.items.push(bow, hood, quiver, boots);
    after.account.materials = { 'sapphire:1': 3 };
    after.account.elixirs = { might: 1 };
    after.account.cube = { level: 2, xp: 0 };
    after.account.gold = 10_000;
    await adventureRepository.persist(ws.id, before, after);

    const { snapshot } = await adventureService.state(ws.id);
    const stored = (id: string) => snapshot.items.find((item) => item.id === id);
    expect(stored(bow.id)).toMatchObject({ uniqueId: 'canopy-whisper', slot: 'weapon', classId: 'ranger' });
    expect(stored(hood.id)).toMatchObject({ setId: 'windrunner', sockets: [{ kind: 'decoration', material: 'ruby', quality: 4 }] });
    expect(stored(quiver.id)).toMatchObject({ slot: 'offhand', classId: 'ranger' });
    expect(stored(boots.id)?.variant).toBe(2);

    await adventureService.act(ws.id, { type: 'equip', itemId: bow.id, heroId: ranger.id });
    const drunk = await adventureService.act(ws.id, { type: 'drink', elixirId: 'might' });
    expect(drunk.snapshot.account.elixirs.might).toBe(0);
    expect(drunk.snapshot.account.activeElixirs.might).toBeTruthy();
    expect(heroOf(drunk.snapshot, qa.id).build?.powers).toEqual(['chain']);
    const fused = await adventureService.act(ws.id, { type: 'fuse-gems', gem: 'sapphire', quality: 1 });
    expect(fused.snapshot.account.materials).toMatchObject({ 'sapphire:1': 0, 'sapphire:2': 1 });
    await expect(adventureService.act(ws.id, { type: 'drink', elixirId: 'might' })).rejects.toThrow('elixir');
  });

  it('opens chests by itself after a battle and keeps the automation settings per guild and hero', async () => {
    const { ws, qa } = await team();
    const ranger = heroOf((await adventureService.state(ws.id)).snapshot, qa.id);
    expect(ranger.autoGear).toBe(true);
    const off = await adventureService.act(ws.id, { type: 'auto-gear', heroId: ranger.id, enabled: false });
    expect(heroOf(off.snapshot, qa.id).autoGear).toBe(false);
    const salvage = await adventureService.act(ws.id, { type: 'settings', settings: { autoSalvage: 'uncommon' } });
    expect(salvage.snapshot.account.settings).toMatchObject({ autoOpen: true, autoSalvage: 'uncommon' });

    const outcome = await adventureService.report(ws.id, report({ kills: { 'bug-beetle': 4 }, chests: [{ tier: 'white', level: 2, difficulty: 'normal', act: 1 }, { tier: 'blue', level: 2, difficulty: 'normal', act: 1 }] }));
    expect(outcome.opened.map((opened) => opened.tier).sort()).toEqual(['blue', 'white']);
    expect(outcome.snapshot.account.chests).toEqual([]);
    expect(Object.values(outcome.opened[0].equipped).every((heroId) => heroId !== ranger.id)).toBe(true);
    const again = await adventureService.state(ws.id);
    expect(heroOf(again.snapshot, qa.id).autoGear).toBe(false);
    expect(again.snapshot.account.settings.autoSalvage).toBe('uncommon');
  });

  it('balances a guild of repeated classes on request and keeps it balanced for new recruits', async () => {
    const { ws } = await team();
    for (const title of ['API', 'Infra']) await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title, payload: { provider: 'claude', command: 'true', args: [], role: 'Backend' } as never });
    const before = (await adventureService.state(ws.id)).snapshot;
    expect(before.heroes.filter((hero) => hero.classId === 'knight')).toHaveLength(2);
    const outcome = await adventureService.act(ws.id, { type: 'balance-guild' });
    expect((outcome.result as { changes: Array<{ to: string }> }).changes.map((change) => change.to)).toEqual(['cleric']);
    expect(outcome.snapshot.heroes.map((hero) => hero.classId).sort()).toEqual(['cleric', 'knight', 'maestro', 'ranger']);
    // A third backend agent joins in the class still missing.
    await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'DB', payload: { provider: 'codex', command: 'true', args: [], role: 'Database' } as never });
    await workspaceRepository.createNode({ workspaceId: ws.id, type: 'terminal', title: 'Auth', payload: { provider: 'codex', command: 'true', args: [], role: 'Security' } as never });
    const after = (await adventureService.state(ws.id)).snapshot;
    expect(after.heroes.filter((hero) => hero.classId === 'knight')).toHaveLength(2);
    expect(after.heroes.map((hero) => hero.classId)).toContain('artificer');
  });

  it('lets agents read the guild and act through the bridge as their live terminal, within their scope', async () => {
    const { ws, lead, qa } = await team();
    const token = await bridgeService.getOrCreateToken(ws.id);
    const sessions = [
      ptySessionManager.create({ command: '/bin/cat', cwd: ws.workingDir, workspaceId: ws.id, nodeId: qa.id, provider: 'codex', bridgeAgentToken: 'qa-terminal' }).id,
      ptySessionManager.create({ command: '/bin/cat', cwd: ws.workingDir, workspaceId: ws.id, nodeId: lead.id, provider: 'claude', bridgeAgentToken: 'lead-terminal' }).id,
    ];
    try {
      const controller = new BridgeController();
      const headers = (terminal: string | null, withToken = token): Record<string, string> => ({ 'content-type': 'application/json', authorization: `Bearer ${withToken}`, ...(terminal ? { 'x-orkestrai-agent-token': terminal } : {}) });
      const read = (terminal: string | null, from = '', withToken = token) => controller.adventureRead({ params: {}, request: new Request('http://localhost/api', { headers: headers(terminal, withToken) }), url: new URL(`http://localhost/api/agent-room/bridge/adventure${from ? `?from=${from}` : ''}`), locals: {} } as never) as Promise<Response>;
      const act = (terminal: string | null, from: string, action: unknown) => controller.adventureAct({ params: {}, request: new Request('http://localhost/api', { method: 'POST', headers: headers(terminal), body: JSON.stringify({ action, from }) }), url: new URL('http://localhost/api'), locals: {} } as never) as Promise<Response>;

      const view = (await (await read('qa-terminal')).json()).data;
      const ranger = view.heroes.find((hero: { yours: boolean }) => hero.yours);
      expect(ranger).toMatchObject({ classId: 'ranger', agent: 'QA' });
      expect(view.you.heroId).toBe(ranger.id);
      expect(view.you.gear.map((item: { slot: string }) => item.slot).sort()).toEqual(['armor', 'weapon']);
      const maestro = view.heroes.find((hero: { leader: boolean }) => hero.leader);

      // Without the terminal's own token, or claiming to be someone else, nothing happens.
      expect(await (await act(null, lead.id, { type: 'settings', settings: { autoOpen: false } })).json()).toMatchObject({ code: 'agent-identity' });
      const spoofed = await act('qa-terminal', lead.id, { type: 'settings', settings: { autoOpen: false } });
      expect(spoofed.status).toBe(403);
      expect(await spoofed.json()).toMatchObject({ code: 'agent-identity' });

      // A specialist changes its own hero, not another one, and not the guild.
      const own = await act('qa-terminal', qa.id, { type: 'auto-gear', heroId: ranger.id, enabled: false });
      expect(own.status).toBe(200);
      expect((await own.json()).data.view.heroes.find((hero: { id: string }) => hero.id === ranger.id).autoGear).toBe(false);
      expect(await (await act('qa-terminal', qa.id, { type: 'auto-gear', heroId: maestro.id, enabled: false })).json()).toMatchObject({ code: 'agent-scope' });
      expect(await (await act('qa-terminal', 'QA', { type: 'settings', settings: { autoOpen: false } })).json()).toMatchObject({ code: 'leader-only' });

      // The leader's terminal acts on the whole guild; malformed actions and a wrong workspace token are refused.
      expect((await act('lead-terminal', lead.id, { type: 'settings', settings: { autoOpen: false } })).status).toBe(200);
      expect((await act('lead-terminal', lead.id, { type: 'teleport' })).status).toBe(400);
      expect((await read('qa-terminal', '', 'wrong')).status).toBe(400);
    } finally {
      for (const id of sessions) ptySessionManager.kill(id);
    }
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
