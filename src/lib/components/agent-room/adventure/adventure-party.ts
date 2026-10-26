import type { AgentActivitySnapshot, AgentActivityState } from '$lib/modules/agent-room/domain/types.js';
import { elixirStats } from '$lib/modules/agent-room/domain/adventure/artifacts.js';
import { buildHeroes, deployHeroes, type HeroBuild } from '$lib/modules/agent-room/domain/adventure/build.js';
import type { PartyActivity, PartyMember, Supporter } from '$lib/modules/agent-room/domain/adventure/simulation.js';
import type { AdventureSnapshot, SnapshotHero } from './adventure-client.js';

/** How a hero reads its agent's live state. */
export function partyActivity(state: AgentActivityState | null | undefined, sessionAlive: boolean): PartyActivity {
  if (!sessionAlive) return 'offline';
  switch (state) {
    case 'working':
    case 'starting': return 'working';
    case 'waiting_input':
    case 'waiting_permission': return 'attention';
    case 'blocked':
    case 'error': return 'stunned';
    case 'done': return 'done';
    case 'disconnected': return 'offline';
    default: return 'idle';
  }
}

/** A guild hero as the screens show it: its record, its agent's live state and its numbers right now. */
export type HeroView = SnapshotHero & { activity: PartyActivity; deployed: boolean; build: HeroBuild };

export type Lineup = {
  heroes: HeroView[];
  /** The formation, for the battle. */
  members: PartyMember[];
  /** Heroes outside the formation whose agents work: they learn at a reduced rate. */
  supporters: Supporter[];
  /** Whether any agent of the team is working: the battle only moves then. */
  teamActive: boolean;
};

export type LineupOptions = {
  /**
   * Heroes whose agents worked moments ago. They keep their place in the
   * formation as if still working, so a big team does not reshuffle the
   * party every time an agent ends a turn.
   */
  lingering?: ReadonlySet<string>;
};

/** How long a hero keeps its place in the formation after its agent stops working. */
export const FORMATION_LINGER_MS = 3 * 60_000;

/**
 * The formation from the guild and the agents' live states: who fights (the
 * owner's pins, then the heroes whose agents work, the Maestro, the other
 * agents' heroes and the resting guild), their activity, and builds
 * recomputed with the formation's auras, so the strip reacts the moment an
 * agent starts or stops working without waiting for the server.
 */
export function lineup(snapshot: AdventureSnapshot, live: Record<string, AgentActivitySnapshot>, options: LineupOptions = {}): Lineup {
  const activity = (hero: SnapshotHero): PartyActivity => {
    if (!hero.agent) return 'resting';
    const status = live[hero.agent.nodeId];
    return status ? partyActivity(status.state, status.sessionAlive) : hero.agent.working ? 'working' : 'idle';
  };
  const states = new Map(snapshot.heroes.map((hero) => [hero.id, activity(hero)]));
  const deployed = deployHeroes(
    snapshot.heroes.map((hero) => ({ heroId: hero.id, leader: hero.leader, working: states.get(hero.id) === 'working' || Boolean(options.lingering?.has(hero.id)), present: Boolean(hero.agent), level: hero.level })),
    snapshot.account.formation,
    snapshot.limits.formation,
  );
  const builds = buildHeroes(
    snapshot.heroes.map((hero) => ({ heroId: hero.id, classId: hero.classId, level: hero.level, paragon: hero.paragon, xp: hero.xp, skills: hero.skills, actives: hero.actives, deployed: deployed.includes(hero.id) })),
    snapshot.items,
    snapshot.account.runes,
    snapshot.account.killsByMonster,
    elixirStats(snapshot.account.activeElixirs, Date.now()),
  );
  const heroes = snapshot.heroes.map((hero) => ({ ...hero, activity: states.get(hero.id)!, deployed: deployed.includes(hero.id), build: builds[hero.id] }));
  const members = deployed
    .map((heroId) => heroes.find((hero) => hero.id === heroId))
    .filter((hero): hero is HeroView => Boolean(hero))
    .map((hero) => ({ id: hero.id, classId: hero.classId, leader: hero.leader, activity: hero.activity, level: hero.level, profile: hero.build.profile, actives: hero.build.actives, powers: hero.build.powers }));
  const supporters = heroes
    .filter((hero) => !hero.deployed && hero.activity === 'working')
    .map((hero) => ({ id: hero.id, level: hero.level, xpMultiplier: hero.build.profile.xpMultiplier }));
  return { heroes, members, supporters, teamActive: heroes.some((hero) => hero.activity === 'working') };
}
