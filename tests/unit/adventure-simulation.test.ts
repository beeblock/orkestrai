import { describe, expect, it } from 'vitest';
import { heroClassFor, levelFromXp, stageOf, WAVES_PER_STAGE } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import { completeQuest, createAdventure, progressOf, stepAdventure, type PartyMember } from '$lib/modules/agent-room/domain/adventure/simulation.js';
import { buildParty, partyActivity, type AgentNode } from '$lib/components/agent-room/adventure/adventure-party.js';
import type { AgentActivitySnapshot } from '$lib/modules/agent-room/domain/types.js';

const knight = (activity: PartyMember['activity']): PartyMember => ({ id: 'k', classId: 'knight', leader: false, activity });
const ranger = (activity: PartyMember['activity']): PartyMember => ({ id: 'r', classId: 'ranger', leader: false, activity });

function run(state: ReturnType<typeof createAdventure>, party: PartyMember[], ms: number) {
  const events = [];
  for (let elapsed = 0; elapsed < ms; elapsed += 100) events.push(...stepAdventure(state, party, 100));
  return events;
}

describe('Adventure simulation', () => {
  it('camps and holds the monsters while nobody works', () => {
    const state = createAdventure();
    const events = run(state, [knight('idle'), ranger('offline')], 20_000);
    expect(state.mode).toBe('camp');
    expect(state.enemies).toHaveLength(0);
    expect(state.xp).toBe(0);
    expect(events.filter((event) => event.type === 'join')).toHaveLength(2);
    expect(state.heroes.find((hero) => hero.id === 'k')?.pose).toBe('rest');
  });

  it('fights waves while an agent works, earning experience and clearing stages', () => {
    const state = createAdventure();
    const events = run(state, [knight('working'), ranger('working')], 10 * 60_000);
    expect(events.some((event) => event.type === 'kill')).toBe(true);
    expect(state.xp).toBeGreaterThan(0);
    expect(state.gold).toBeGreaterThan(0);
    expect(events.some((event) => event.type === 'stage-clear')).toBe(true);
    expect(state.stageIndex).toBeGreaterThan(0);
    expect(state.wave).toBeLessThan(WAVES_PER_STAGE);
  });

  it('pauses the battle where it stands when work stops', () => {
    const state = createAdventure();
    run(state, [knight('working')], 3_000);
    const enemies = state.enemies.map((enemy) => ({ id: enemy.id, x: enemy.x, hp: enemy.hp }));
    expect(enemies.length).toBeGreaterThan(0);
    run(state, [knight('idle')], 10_000);
    expect(state.enemies.map((enemy) => ({ id: enemy.id, x: enemy.x, hp: enemy.hp }))).toEqual(enemies);
  });

  it('keeps a hero waiting for the owner out of the fight with its hand raised', () => {
    const state = createAdventure();
    const events = run(state, [knight('working'), ranger('attention')], 30_000);
    expect(state.heroes.find((hero) => hero.id === 'r')?.pose).toBe('alert');
    expect(events.filter((event) => event.type === 'attack' && event.heroId === 'r')).toHaveLength(0);
    expect(events.some((event) => event.type === 'attack' && event.heroId === 'k')).toBe(true);
  });

  it('pays a finished task and strikes every monster on the road', () => {
    const state = createAdventure();
    run(state, [knight('working')], 3_000);
    const before = state.enemies.map((enemy) => enemy.hp);
    const events = completeQuest(state, 'Tela de perfil');
    expect(events[0]).toMatchObject({ type: 'quest', title: 'Tela de perfil' });
    expect(state.quests).toBe(1);
    state.enemies.forEach((enemy, index) => expect(enemy.hp).toBeLessThan(before[index]));
  });

  it('is deterministic and resumes from its saved progress', () => {
    const party = [knight('working'), ranger('working'), { id: 'm', classId: 'maestro' as const, leader: true, activity: 'working' as const }];
    const first = createAdventure({}, 7);
    const second = createAdventure({}, 7);
    run(first, party, 60_000);
    run(second, party, 60_000);
    expect(progressOf(first)).toEqual(progressOf(second));
    const resumed = createAdventure(progressOf(first), 7);
    expect(progressOf(resumed)).toEqual(progressOf(first));
  });

  it('walks the road chapter by chapter', () => {
    expect(stageOf(0)).toMatchObject({ chapter: 1, stage: 1, lap: 0, biome: { id: 'repo-forest' } });
    expect(stageOf(5)).toMatchObject({ chapter: 2, stage: 3, biome: { id: 'deploy-desert', boss: 'loop-serpent' } });
    expect(stageOf(15)).toMatchObject({ chapter: 1, stage: 1, lap: 1 });
    expect(levelFromXp(0)).toEqual({ level: 1, into: 0, next: 40 });
  });
});

describe('hero classes', () => {
  it('makes the leader the Maestro and reads the other classes from each role', () => {
    expect(heroClassFor({ nodeId: 'a', title: 'Líder', leader: true })).toBe('maestro');
    expect(heroClassFor({ nodeId: 'b', title: 'QA Upload', leader: false })).toBe('ranger');
    expect(heroClassFor({ nodeId: 'c', title: 'Dev', role: 'Backend da API', leader: false })).toBe('knight');
    expect(heroClassFor({ nodeId: 'd', title: 'Frontend', leader: false })).toBe('sorceress');
    expect(heroClassFor({ nodeId: 'e', title: 'Docs', leader: false })).toBe('cleric');
    expect(heroClassFor({ nodeId: 'f', title: 'QA', leader: false, chosen: 'artificer' })).toBe('artificer');
    // The leader's class cannot be chosen for a teammate.
    expect(heroClassFor({ nodeId: 'g', title: 'Zé', leader: false, chosen: 'maestro' })).not.toBe('maestro');
  });
});

describe('adventure party', () => {
  it('reads each agent state as a hero activity', () => {
    expect(partyActivity('working', true)).toBe('working');
    expect(partyActivity('waiting_permission', true)).toBe('attention');
    expect(partyActivity('error', true)).toBe('stunned');
    expect(partyActivity('idle', true)).toBe('idle');
    // A closed terminal rests, whatever its last state was.
    expect(partyActivity('working', false)).toBe('offline');
  });

  it('puts the leader first as the Maestro and skips nodes without a provider', () => {
    const node = (id: string, title: string, payload: Record<string, unknown>): AgentNode => ({ id, title, payload: payload as AgentNode['payload'] });
    const live = { qa: { state: 'working', sessionAlive: true } as AgentActivitySnapshot };
    const party = buildParty([
      node('qa', 'QA', { provider: 'codex', role: 'QA engineer' }),
      node('shell', 'Shell', {}),
      node('lead', 'Lead', { provider: 'claude', maestro: true }),
    ], live, {});
    expect(party.map((hero) => [hero.id, hero.classId, hero.activity])).toEqual([
      ['lead', 'maestro', 'offline'],
      ['qa', 'ranger', 'working'],
    ]);
  });
});

describe('adventure formation', () => {
  it('lets every working hero of a large party fight, the knight included', () => {
    const classes = ['knight', 'artificer', 'ranger', 'sorceress', 'cleric', 'maestro'] as const;
    const party: PartyMember[] = classes.map((classId, index) => ({ id: `h${index}`, classId, leader: classId === 'maestro', activity: 'working' }));
    const state = createAdventure({ stageIndex: 0, wave: 0, xp: 0, gold: 0, kills: 0, bosses: 0, quests: 0 }, 7);
    const events = run(state, party, 60_000);
    const attackers = new Set(events.flatMap((event) => (event.type === 'attack' || event.type === 'special' ? [event.heroId] : [])));
    expect([...attackers].sort()).toEqual(party.map((hero) => hero.id).sort());
  });
});
