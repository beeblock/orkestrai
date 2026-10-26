import { describe, expect, it } from 'vitest';
import { heroClassFor, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import { buildHeroes } from '$lib/modules/agent-room/domain/adventure/build.js';
import { rollItem, SLOTS, type Item, type Rarity } from '$lib/modules/agent-room/domain/adventure/items.js';
import { autoAllocate } from '$lib/modules/agent-room/domain/adventure/skills.js';
import {
  completeQuest, configureAdventure, createAdventure, drainReport, stepAdventure,
  type AdventureEvent, type AdventureState, type PartyActivity, type PartyMember,
} from '$lib/modules/agent-room/domain/adventure/simulation.js';
import { positionAt, WAVES_PER_STAGE } from '$lib/modules/agent-room/domain/adventure/world.js';
import { lineup, partyActivity } from '$lib/components/agent-room/adventure/adventure-party.js';
import type { AgentActivitySnapshot } from '$lib/modules/agent-room/domain/types.js';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Heroes of a level wearing a full set of gear of that level and rarity. */
function party(classes: HeroClassId[], level: number, rarity: Rarity | null, activity: PartyActivity = 'working'): PartyMember[] {
  const rng = seeded(level * 31 + classes.length);
  const items: Item[] = [];
  classes.forEach((classId, index) => {
    if (!rarity) return;
    for (const slot of SLOTS) {
      items.push({ ...rollItem(rng, { level, rarity, slot, classId }), id: `${index}-${slot}`, location: 'equipped', heroNodeId: `h${index}`, locked: false, createdAt: '' });
    }
  });
  const builds = buildHeroes(classes.map((classId, index) => ({ nodeId: `h${index}`, classId, level, xp: 0, skills: autoAllocate(classId, level, {}), actives: [], deployed: true })), items, {}, {});
  return classes.map((classId, index) => ({
    id: `h${index}`, classId, leader: classId === 'maestro', activity, level,
    profile: builds[`h${index}`].profile, actives: builds[`h${index}`].actives,
  }));
}

function run(state: AdventureState, members: PartyMember[], ms: number): AdventureEvent[] {
  const events: AdventureEvent[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 100) events.push(...stepAdventure(state, members, 100));
  return events;
}

describe('adventure battle', () => {
  it('camps while nobody works and freezes the monsters', () => {
    const state = createAdventure({}, 1);
    const events = run(state, party(['knight'], 1, 'common', 'idle'), 5_000);
    expect(state.mode).toBe('camp');
    expect(events.some((event) => event.type === 'wave')).toBe(false);
    expect(drainReport(state).elapsedMs).toBe(0);
  });

  it('clears waves and stages, advances, and reports experience per hero', () => {
    const state = createAdventure({}, 2);
    const members = party(['knight', 'ranger', 'cleric'], 3, 'rare');
    const events = run(state, members, 120_000);
    const clears = events.filter((event) => event.type === 'stage-clear');
    expect(clears.length).toBeGreaterThan(0);
    expect(state.position.stage).toBeGreaterThan(1);
    const report = drainReport(state);
    expect(Object.keys(report.xp).sort()).toEqual(['h0', 'h1', 'h2']);
    expect(report.gold).toBeGreaterThan(0);
    expect(report.stages[0]).toMatchObject({ difficulty: 'normal', act: 1, stage: 1, result: 'clear' });
    expect(drainReport(state).gold).toBe(0);
  });

  it('farms the same stage when auto-advance is off', () => {
    const state = createAdventure({ rules: { autoAdvance: false } }, 3);
    run(state, party(['knight', 'ranger'], 5, 'rare'), 90_000);
    expect(state.position).toEqual(positionAt('normal', 0));
    expect(drainReport(state).stages.length).toBeGreaterThan(0);
  });

  it('casts the actives the heroes learned', () => {
    const state = createAdventure({}, 4);
    const events = run(state, party(['sorceress', 'cleric', 'maestro'], 10, 'rare'), 60_000);
    const actions = new Set(events.flatMap((event) => (event.type === 'special' ? [event.action] : [])));
    expect(actions.has('meteor')).toBe(true);
    expect(actions.has('anthem')).toBe(true);
  });

  it('lets every working hero of a large party fight, the knight included', () => {
    const members = party(['knight', 'artificer', 'ranger', 'sorceress', 'cleric', 'maestro'], 5, 'uncommon');
    const state = createAdventure({}, 7);
    const events = run(state, members, 60_000);
    const attackers = new Set(events.flatMap((event) => (event.type === 'attack' || event.type === 'special' ? [event.heroId] : [])));
    expect([...attackers].sort()).toEqual(members.map((hero) => hero.id).sort());
  });

  it('knocks heroes out against far stronger monsters, revives them and falls back a stage', () => {
    const state = createAdventure({ position: positionAt('normal', 30), rules: { cleared: 30, reviveMs: 3_000 } }, 5);
    const events = run(state, party(['ranger', 'sorceress'], 1, null), 90_000);
    expect(events.some((event) => event.type === 'hero-down')).toBe(true);
    expect(events.some((event) => event.type === 'stage-fail')).toBe(true);
    expect(state.position.stage + (state.position.act - 1) * 10 - 1).toBeLessThan(30);
  });

  it('retries the same stage after a loss when auto-retry is on', () => {
    const state = createAdventure({ position: positionAt('normal', 30), rules: { autoRetry: true, cleared: 30 } }, 6);
    run(state, party(['ranger'], 1, null), 60_000);
    expect(state.position).toEqual(positionAt('normal', 30));
  });

  it('drops chests and lets travel restart the stage elsewhere', () => {
    const state = createAdventure({ position: positionAt('normal', 9) }, 8);
    const events = run(state, party(['knight', 'ranger', 'cleric'], 14, 'epic'), 240_000);
    // The act boss always leaves a red chest.
    expect(events.some((event) => event.type === 'chest' && event.tier === 'red')).toBe(true);
    configureAdventure(state, {}, positionAt('normal', 0));
    expect(state.position).toEqual(positionAt('normal', 0));
    expect(state.wave).toBe(0);
  });

  it('finished work strikes every monster on the road', () => {
    const state = createAdventure({}, 9);
    const members = party(['knight'], 1, 'common');
    run(state, members, 3_000);
    const before = state.enemies.reduce((sum, enemy) => sum + enemy.hp, 0);
    const events = completeQuest(state, 'Ship it');
    expect(events[0]).toEqual({ type: 'quest', title: 'Ship it' });
    expect(state.enemies.reduce((sum, enemy) => sum + enemy.hp, 0)).toBeLessThan(before);
  });

  it('resumes the same battle from the same inputs', () => {
    const a = createAdventure({}, 42);
    const b = createAdventure({}, 42);
    const members = party(['knight', 'ranger'], 4, 'rare');
    run(a, members, 20_000);
    run(b, members, 20_000);
    expect(a.enemies.map((enemy) => [enemy.monsterId, Math.round(enemy.hp)])).toEqual(b.enemies.map((enemy) => [enemy.monsterId, Math.round(enemy.hp)]));
    expect(a.wave).toBe(b.wave);
    expect(WAVES_PER_STAGE).toBe(5);
  });
});

describe('adventure balance', () => {
  // A party geared at its level (rare items) holds its region; the same party
  // twenty levels into harder country, still in its own gear, cannot.
  for (const level of [5, 25, 45]) {
    it(`a level ${level} party in level ${level} gear clears level ${level} stages`, () => {
      const state = createAdventure({ position: positionAt('normal', level - 1), rules: { autoAdvance: false, cleared: level - 1 } }, level);
      const events = run(state, party(['knight', 'ranger', 'cleric'], level, 'rare'), 180_000);
      expect(events.filter((event) => event.type === 'stage-clear').length).toBeGreaterThan(0);
      expect(events.some((event) => event.type === 'stage-fail')).toBe(false);
    });
  }

  it('the same party twenty levels above its gear loses', () => {
    const state = createAdventure({ position: positionAt('normal', 44), rules: { autoAdvance: false, autoRetry: true, cleared: 44 } }, 77);
    const events = run(state, party(['knight', 'ranger', 'cleric'], 25, 'rare'), 180_000);
    expect(events.some((event) => event.type === 'stage-fail')).toBe(true);
  });
});

describe('adventure party', () => {
  it('reads each agent state as a hero activity', () => {
    expect(partyActivity('working', true)).toBe('working');
    expect(partyActivity('waiting_permission', true)).toBe('attention');
    expect(partyActivity('error', true)).toBe('stunned');
    expect(partyActivity('idle', true)).toBe('idle');
    expect(partyActivity('working', false)).toBe('offline');
  });

  it('fields the owner\'s picks first, then whoever is working, up to the formation slots', () => {
    const hero = (nodeId: string, leader = false) => ({ nodeId, chosenClass: null, level: 3, xp: 0, skills: {}, actives: [], autoSkills: true, kills: 0, title: nodeId, role: null, leader, working: false, classId: 'knight' as HeroClassId, build: null, deployed: false });
    const snapshot = {
      account: { formation: ['bench'], runes: {}, killsByMonster: {} },
      heroes: [hero('lead', true), hero('qa'), hero('api'), hero('bench')],
      items: [],
      limits: { formation: 3 },
    } as never;
    const live = { qa: { state: 'working', sessionAlive: true }, api: { state: 'working', sessionAlive: true }, lead: { state: 'idle', sessionAlive: true } } as unknown as Record<string, AgentActivitySnapshot>;
    const { heroes, members } = lineup(snapshot, live);
    expect(members.map((member) => member.id)).toEqual(['bench', 'qa', 'api']);
    expect(heroes.find((entry) => entry.nodeId === 'lead')?.deployed).toBe(false);
    expect(members.find((member) => member.id === 'qa')?.activity).toBe('working');
    expect(members.find((member) => member.id === 'bench')?.activity).toBe('offline');
  });

  it('infers a class from the role and honors the owner pick', () => {
    expect(heroClassFor({ nodeId: 'a', title: 'API', role: 'Backend dev', leader: false })).toBe('knight');
    expect(heroClassFor({ nodeId: 'b', title: 'QA', leader: false })).toBe('ranger');
    expect(heroClassFor({ nodeId: 'c', title: 'Lead', leader: true })).toBe('maestro');
    expect(heroClassFor({ nodeId: 'f', title: 'QA', leader: false, chosen: 'artificer' })).toBe('artificer');
    expect(heroClassFor({ nodeId: 'g', title: 'Zé', leader: false, chosen: 'maestro' })).not.toBe('maestro');
  });
});
