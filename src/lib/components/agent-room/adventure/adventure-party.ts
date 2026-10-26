import type { AgentActivitySnapshot, AgentActivityState } from '$lib/modules/agent-room/domain/types.js';
import { buildHeroes, deployHeroes, type HeroBuild } from '$lib/modules/agent-room/domain/adventure/build.js';
import type { PartyActivity, PartyMember } from '$lib/modules/agent-room/domain/adventure/simulation.js';
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

/** A hero as the screens show it: the save's record, its live state and its numbers right now. */
export type HeroView = SnapshotHero & { activity: PartyActivity; deployed: boolean; build: HeroBuild };

/**
 * The formation from the save and the agents' live states: who fights (the
 * owner's picks, then whoever is working), their activity, and builds
 * recomputed with the formation's auras, so the strip reacts the moment an
 * agent starts or stops working without waiting for the server.
 */
export function lineup(snapshot: AdventureSnapshot, live: Record<string, AgentActivitySnapshot>): { heroes: HeroView[]; members: PartyMember[] } {
  const activity = (hero: SnapshotHero) => {
    const status = live[hero.nodeId];
    return status ? partyActivity(status.state, status.sessionAlive) : hero.working ? 'working' : 'offline';
  };
  const deployed = deployHeroes(
    snapshot.heroes.map((hero) => ({ nodeId: hero.nodeId, leader: hero.leader, working: activity(hero) === 'working' })),
    snapshot.account.formation,
    snapshot.limits.formation,
  );
  const builds = buildHeroes(
    snapshot.heroes.map((hero) => ({ nodeId: hero.nodeId, classId: hero.classId, level: hero.level, xp: hero.xp, skills: hero.skills, actives: hero.actives, deployed: deployed.includes(hero.nodeId) })),
    snapshot.items,
    snapshot.account.runes,
    snapshot.account.killsByMonster,
  );
  const heroes = snapshot.heroes.map((hero) => ({ ...hero, activity: activity(hero), deployed: deployed.includes(hero.nodeId), build: builds[hero.nodeId] }));
  const members = deployed
    .map((nodeId) => heroes.find((hero) => hero.nodeId === nodeId))
    .filter((hero): hero is HeroView => Boolean(hero))
    .map((hero) => ({ id: hero.nodeId, classId: hero.classId, leader: hero.leader, activity: hero.activity, level: hero.level, profile: hero.build.profile, actives: hero.build.actives }));
  return { heroes, members };
}
