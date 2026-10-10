import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import type { TerminalNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { transcriptSizeBytes } from '../../infrastructure/transcript/AgentTranscript.js';
import { agentInboxService } from './AgentInboxService.js';
import { controlCenterService } from './ControlCenterService.js';
import { floorService } from './FloorService.js';

const MIB = 1024 * 1024;
const DEFAULT_LIMIT_MIB = 256;

export type RotatedSession = { workspaceId: string; nodeId: string; title: string; sizeBytes: number };

/**
 * Retires agent conversations whose transcript grew too large to resume well.
 *
 * A leader resumed for weeks reached a 1 GB transcript and compacted its
 * context a dozen times in four hours, carrying stale protocol along. When no
 * PTY is running for the node, the next start opens a fresh conversation with
 * the same role and receives a short handoff of the open work instead.
 */
export class AgentSessionRotationService {
  limitBytes(): number {
    const configured = Number(process.env.ORKESTRAI_SESSION_ROTATE_MB ?? DEFAULT_LIMIT_MIB);
    return (Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIMIT_MIB) * MIB;
  }

  async rotateOversized(): Promise<RotatedSession[]> {
    const limit = this.limitBytes();
    const rotated: RotatedSession[] = [];
    for (const workspace of await workspaceRepository.listWorkspaces()) {
      if (workspace.suspendedAt || workspace.runtimeKind === 'wsl') continue;
      const nodes = await workspaceRepository.listNodes(workspace.id, undefined, false, true);
      for (const node of nodes) {
        const payload = node.payload as TerminalNodePayload;
        if (node.type !== 'terminal' || !payload.provider || !payload.agentSessionId) continue;
        if (ptySessionManager.listLiveForNode(workspace.id, node.id).length) continue;
        let cwd = workspace.workingDir;
        if (node.floorId) {
          const floor = await floorService.get(node.floorId).catch(() => null);
          if (floor?.path) cwd = floor.path;
        }
        const sizeBytes = transcriptSizeBytes(payload.provider, cwd, payload.agentSessionId);
        if (sizeBytes === null || sizeBytes < limit) continue;
        const title = node.title ?? 'agente';
        const next: Record<string, unknown> = {
          ...payload,
          sessionHandoff: { previousAgentSessionId: payload.agentSessionId, rotatedAt: new Date().toISOString(), sizeBytes },
        };
        delete next.agentSessionId;
        await workspaceRepository.updateNode(node.id, { payload: next as never });
        await agentInboxService.enqueue({
          workspaceId: workspace.id,
          toNodeId: node.id,
          kind: 'handoff',
          content: await this.handoff(workspace.id, node.id, title, payload, sizeBytes),
          dedupKey: `session-handoff:${node.id}:${payload.agentSessionId}`,
          metadata: { wake: false, previousAgentSessionId: payload.agentSessionId },
        });
        await controlCenterService.recordActivity({
          workspaceId: workspace.id,
          nodeId: node.id,
          state: 'idle',
          action: 'system:session_rotated',
          category: 'system',
          verb: 'rotated',
          objectType: 'agent_session',
          objectId: payload.agentSessionId,
          outcome: `${Math.round(sizeBytes / MIB)} MB`,
          sourceType: 'agent_runtime',
          sourceId: node.id,
        }).catch(() => undefined);
        rotated.push({ workspaceId: workspace.id, nodeId: node.id, title, sizeBytes });
      }
    }
    return rotated;
  }

  private async handoff(workspaceId: string, nodeId: string, title: string, payload: TerminalNodePayload, sizeBytes: number): Promise<string> {
    const tasks = await AgentBoardTask.query().where('workspace_id', workspaceId).where('assignee_node_id', nodeId)
      .whereNull('archived_at').whereIn('status', ['todo', 'doing']).orderBy('updated_at', 'desc').limit(8).get();
    const statuses = await controlCenterRepository.latestSemanticActivities(nodeId, 3);
    const lines = [
      `[orkestrai:handoff] ${title}: sua conversa anterior (${Math.round(sizeBytes / MIB)} MB) foi encerrada para manter o contexto enxuto. Você continua com o mesmo papel${payload.role ? ` (${payload.role})` : ''}${payload.maestro ? ' de líder do workspace' : ''}.`,
      tasks.length
        ? `Tarefas abertas atribuídas a você: ${tasks.map((task) => `${task.getAttribute('title')} (${task.getAttribute('id')}, ${task.getAttribute('status')})`).join('; ')}.`
        : 'Nenhuma tarefa aberta atribuída a você.',
      statuses.length ? `Seus últimos status: ${statuses.map((status) => `${status.state}: ${String(status.action ?? '').slice(0, 200)}`).join(' | ')}.` : '',
      'Releia o quadro (orkestrai task list), a caixa de entrada (orkestrai inbox) e as notas vinculadas antes de agir. Continue o que está em andamento; não refaça entregas concluídas nem reabra tarefas done.',
    ];
    return lines.filter(Boolean).join(' ');
  }
}

export const agentSessionRotationService = new AgentSessionRotationService();
