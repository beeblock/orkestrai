import type { CreateDesignExplorationDto } from '../dto/CreateDesignExplorationDto.js';
import { designExplorationLayout } from '../../domain/design-exploration.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import {
  designExplorationRepository,
  type PersistedDesignExploration,
} from '../../infrastructure/repositories/DesignExplorationRepository.js';
import { taskBoardService } from './TaskBoardService.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';

function broadcast(workspaceId: string): void {
  const send = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId });
}

export type DesignExplorationResult = PersistedDesignExploration & {
  leaderNodeId: string | null;
  dispatched: boolean;
};

export class DesignExplorationService {
  async create(workspaceId: string, data: CreateDesignExplorationDto): Promise<DesignExplorationResult> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('workspace_not_found');
    const nodes = await workspaceRepository.listNodes(workspaceId, null);
    const terminals = nodes.filter((node) => node.type === 'terminal');
    const leader = terminals.find((node) => Boolean((node.payload as { maestro?: boolean }).maestro)) ?? null;
    if (data.executionMode === 'leader') {
      if (!leader || leader.id !== data.leaderNodeId) {
        throw new Error('leader_changed');
      }
      const sessionId = String((leader.payload as { sessionId?: string }).sessionId ?? '');
      if (!sessionId) throw new Error('leader_inactive');
      const session = ptySessionManager.get(sessionId);
      if (!session || session.exited) {
        throw new Error('leader_inactive');
      }
    }
    const created = await designExplorationRepository.create({
      workspaceId,
      data,
      layout: designExplorationLayout(nodes),
      existingTasksNode: nodes.find((node) => node.type === 'tasks') ?? null,
      terminals,
      leader,
    });

    let dispatched = false;
    if (data.executionMode === 'leader' && leader) {
      try {
        await taskBoardService.update(workspaceId, created.taskIds[0], { assigneeNodeId: leader.id });
        dispatched = true;
      } catch (error) {
        await designExplorationRepository.remove(created);
        broadcast(workspaceId);
        throw error;
      }
    } else {
      broadcast(workspaceId);
    }
    return { ...created, leaderNodeId: leader?.id ?? null, dispatched };
  }
}

export const designExplorationService = new DesignExplorationService();
