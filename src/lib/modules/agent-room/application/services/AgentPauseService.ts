import { platform } from 'node:os';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';

export type AgentPauseResult = { paused: boolean; nodeIds: string[]; supported: boolean };

/**
 * Pause all / Resume all: freezes the agents' process trees in place (no
 * conversation is lost) and resumes them exactly where they stopped.
 */
export class AgentPauseService {
  async setPaused(workspaceId: string, paused: boolean, nodeIds?: string[]): Promise<AgentPauseResult> {
    if (platform() === 'win32') return { paused, nodeIds: [], supported: false };
    const requested = nodeIds?.length ? new Set(nodeIds) : null;
    const nodes = (await workspaceRepository.listNodes(workspaceId, undefined, false, true))
      .filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider))
      .filter((node) => !requested || requested.has(node.id));
    const changed: string[] = [];
    for (const node of nodes) {
      if (ptySessionManager.setNodePaused(workspaceId, node.id, paused) > 0) changed.push(node.id);
    }
    return { paused, nodeIds: changed, supported: true };
  }

  pausedNodeIds(workspaceId: string): string[] {
    return ptySessionManager.pausedNodes(workspaceId);
  }
}

export const agentPauseService = new AgentPauseService();
