import type { AgentActivitySnapshot, AgentActivityState, TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';
import { heroClassFor, type HeroClassId } from '$lib/modules/agent-room/domain/adventure/catalog.js';
import type { PartyActivity, PartyMember } from '$lib/modules/agent-room/domain/adventure/simulation.js';

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

export type AgentNode = { id: string; title: string; payload: TerminalNodePayload };

export type PartyHero = PartyMember & { title: string; role: string | null; provider: string | null };

/**
 * The party of a workspace: one hero per agent (terminals with a provider),
 * the leader first as the Maestro, each in the class the owner picked or the
 * one its role suggests, fighting or resting as its agent works or waits.
 */
export function buildParty(nodes: readonly AgentNode[], live: Record<string, AgentActivitySnapshot>, chosen: Record<string, HeroClassId>): PartyHero[] {
  return nodes
    .filter((node) => Boolean(node.payload.provider))
    .map((node) => {
      const status = live[node.id];
      const leader = Boolean(node.payload.maestro);
      const classId = heroClassFor({ nodeId: node.id, title: node.title, role: node.payload.role ?? null, leader, chosen: chosen[node.id] ?? null });
      return {
        id: node.id,
        classId,
        leader,
        activity: partyActivity(status?.state, status?.sessionAlive ?? false),
        title: node.title,
        role: node.payload.role ?? null,
        provider: node.payload.provider ?? null,
      };
    })
    .sort((a, b) => Number(b.leader) - Number(a.leader));
}
