import { Connection } from '@beeblock/svelar/database';
import { taskExecutionRepository, taskDependencies } from '../../infrastructure/repositories/TaskExecutionRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { latestTurnBoundary } from '../../infrastructure/transcript/AgentTranscript.js';
import type { AgentActivity, AgentMessageEnvelope, TerminalNodePayload } from '../../domain/types.js';

export class TaskExecutionService {
  private checks = new Set<string>();
  async validateDependencies(workspaceId: string, taskId: string, ids: string[]): Promise<void> {
    const visited = new Set<string>();
    const visit = async (id: string): Promise<void> => {
      if (id === taskId) throw new Error('Task dependencies cannot contain a cycle.');
      if (visited.has(id)) return;
      if (visited.size >= 2048) throw new Error('Task dependency graph exceeds the validation limit.');
      visited.add(id);
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', id).first();
      if (!task) throw new Error('Task dependency must belong to this workspace.');
      for (const dependency of taskDependencies(task)) await visit(dependency);
    };
    for (const id of ids) await visit(id);
  }
  async admit(envelope: AgentMessageEnvelope, sessionId: string | null): Promise<boolean> {
    if (!['task', 'task_recovery'].includes(envelope.kind)) return true;
    const taskId = typeof envelope.metadata.taskId === 'string' ? envelope.metadata.taskId : null;
    if (!taskId) return false;
    // Legacy idle reminders retain their bounded policy until an actual task dispatch adopts custody.
    if (envelope.kind === 'task_recovery' && envelope.metadata.idleNudge === true
      && !await taskExecutionRepository.current(envelope.workspaceId, taskId)) return true;
    if (!sessionId) {
      const node = await workspaceRepository.getNode(envelope.toNodeId);
      sessionId = (node?.payload as TerminalNodePayload | undefined)?.sessionId ?? null;
    }
    const previous = await taskExecutionRepository.current(envelope.workspaceId, taskId);
    if (previous && sessionId && previous.sessionId && previous.sessionId !== sessionId
      && ['dispatching', 'running'].includes(previous.state)) {
      const old = ptySessionManager.get(previous.sessionId);
      const live = ptySessionManager.get(sessionId);
      if ((!old || old.exited) && live && !live.exited && live.nodeId === envelope.toNodeId
        && live.workspaceId === envelope.workspaceId
        && (envelope.kind === 'task_recovery' || (previous.state === 'dispatching' && previous.envelopeId === envelope.id))) {
        await taskExecutionRepository.finish(previous, 'cancelled');
      }
    }
    const execution = await taskExecutionRepository.claim(envelope.workspaceId, taskId, envelope.toNodeId,
      sessionId, envelope.id, envelope.kind === 'task_recovery');
    if (!execution) return false;
    envelope.metadata = { ...envelope.metadata, executionId: execution.id };
    return true;
  }
  async changed(workspaceId: string, taskId: string, reported = false): Promise<void> {
    const execution = await taskExecutionRepository.current(workspaceId, taskId);
    if (!execution) { await this.pump(workspaceId); return; }
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', taskId).first();
    if (!task || task.getAttribute('archived_at') || ['todo', 'done'].includes(task.getAttribute('status'))
      || task.getAttribute('assignee_node_id') !== execution.nodeId) {
      await taskExecutionRepository.finish(execution, task?.getAttribute('status') === 'done' ? 'completed' : 'cancelled');
    } else if (reported) await taskExecutionRepository.park(execution, 'reported');
    await this.pump(workspaceId);
  }
  async activity(event: AgentActivity): Promise<void> {
    if (event.metadata.lifecycle || !event.taskId || !['blocked', 'waiting_input', 'waiting_permission', 'error'].includes(event.state)) return;
    const execution = await taskExecutionRepository.current(event.workspaceId, event.taskId);
    if (!execution || execution.nodeId !== event.nodeId) return;
    await taskExecutionRepository.park(execution, event.state.startsWith('waiting') ? 'waiting' : 'blocked');
    await this.pump(event.workspaceId);
  }
  async pump(workspaceId: string): Promise<void> {
    const { agentInboxService } = await import('./AgentInboxService.js');
    for (const nodeId of await taskExecutionRepository.pendingNodes(workspaceId)) agentInboxService.kick(workspaceId, nodeId);
  }
  /** Exact transcript completion, never output silence, makes an unresolved attempt actionable. */
  async observeStop(workspaceId: string, nodeId: string): Promise<void> {
    if (this.checks.has(nodeId)) return;
    this.checks.add(nodeId);
    try {
      const execution = await taskExecutionRepository.activeForNode(workspaceId, nodeId);
      if (!execution || execution.state !== 'running' || !execution.sessionId || !execution.claimedAt) return;
      const session = ptySessionManager.get(execution.sessionId);
      const node = await workspaceRepository.getNode(nodeId);
      const payload = node?.payload as TerminalNodePayload | undefined;
      if (!session || session.exited || !session.waiting || !session.provider || !node || node.workspaceId !== workspaceId
        || payload?.sessionId !== session.id) return;
      const boundary = await latestTurnBoundary(session.provider, session.transcriptCwd ?? session.cwd,
        session.agentSessionId ?? payload.agentSessionId ?? null, { ...ptySessionManager.transcriptStorageRoots(session.id),
          homeDir: session.transcriptHome ?? undefined, posixCwd: session.runtimeKey.startsWith('wsl:'), processStartedAt: Date.parse(session.createdAt) });
      if (boundary.ready !== true || boundary.finishedAt === null || boundary.finishedAt < Date.parse(execution.claimedAt)) return;
      const [activity] = await controlCenterRepository.latestSemanticActivities(nodeId, 1);
      if (activity?.taskId === execution.taskId && ['blocked', 'waiting_input', 'waiting_permission', 'error', 'done'].includes(activity.state)) return;
      if (await controlCenterRepository.openAsksFrom(nodeId, execution.claimedAt, execution.taskId)) return;
      const { autonomyPolicyService } = await import('./AutonomyPolicyService.js');
      if (!(await autonomyPolicyService.runWindow(workspaceId, 'leader_supervision')).allowed) return;
      const leader = (await workspaceRepository.listNodes(workspaceId, undefined, false, true))
        .find(candidate => candidate.type === 'terminal' && (candidate.payload as TerminalNodePayload).maestro);
      if (!leader || leader.id === nodeId) return;
      const { agentInboxService } = await import('./AgentInboxService.js');
      let release: (() => void) | undefined;
      await Connection.transaction(async () => {
        const current = await taskExecutionRepository.current(workspaceId, execution.taskId);
        if (!current || current.id !== execution.id || current.state !== 'running' || current.sessionId !== session.id) return;
        const live = ptySessionManager.get(session.id);
        if (!live || live.exited || !live.waiting) return;
        if (!await taskExecutionRepository.park(current, 'stopped', `${session.id}:${boundary.finishedAt}`)) return;
        const queued = await agentInboxService.enqueueDeferred({ workspaceId, toNodeId: leader.id, fromNodeId: nodeId,
          kind: 'task_stopped', taskId: execution.taskId, dedupKey: `execution-stop:${execution.id}:${boundary.finishedAt}`,
          content: `[orkestrai: execution stopped] ${node.title ?? nodeId} ended a turn without completing task ${execution.taskId} or reporting a blocker. Execution ${execution.id}. Review its evidence, answer a real question or intentionally resume/reassign this task; keep independent ready tasks moving. Do not implement it yourself or repeat an uncertain delivery.`,
          metadata: { oneWay: true, wake: true, executionId: execution.id, stopKey: `${session.id}:${boundary.finishedAt}` } });
        release = queued.release;
      });
      release?.();
      await this.pump(workspaceId);
    } finally { this.checks.delete(nodeId); }
  }
}
export const taskExecutionService = new TaskExecutionService();
