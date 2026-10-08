import { uuidv7 } from '@beeblock/svelar/support';
import { createHash } from 'node:crypto';
import type { AgentRuntimeData, UpdateAgentRuntimeInput } from '../../contracts/schemas/agent-runtime.schema.js';
import type { TerminalNodePayload } from '../../domain/types.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { latestTurnComplete } from '../../infrastructure/transcript/AgentTranscript.js';
import { agentSessionService } from './AgentSessionService.js';
import { agentTerminalDeliveryService } from './AgentTerminalDeliveryService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { controlCenterService } from './ControlCenterService.js';
import { usageService } from './UsageService.js';

const SUPERVISOR_INTERVAL_MS = 15_000;
const LEADER_IDLE_MS = 2 * 60_000;
const LEADER_REMINDER_INTERVAL_MS = 5 * 60_000;
const HUMAN_ATTENTION_STATES = new Set(['waiting_input', 'waiting_permission', 'blocked', 'error', 'disconnected']);
const DEFAULTS = {
  mode: 'interactive',
  idleMinutes: 30,
  concurrency: 1,
  usageLimit: 95,
} as const;

export class AgentRuntimePolicyError extends Error {
  constructor(readonly code: 'AGENT_CONCURRENCY_LIMIT' | 'AGENT_USAGE_LIMIT') {
    super(code);
    this.name = 'AgentRuntimePolicyError';
  }
}

function config(payload: TerminalNodePayload): UpdateAgentRuntimeInput {
  return {
    mode: ['interactive', 'on_demand', 'persistent'].includes(payload.agentRuntimeMode ?? '') ? payload.agentRuntimeMode! : DEFAULTS.mode,
    idleMinutes: Math.max(5, Math.min(720, Math.round(payload.agentRuntimeIdleMinutes ?? DEFAULTS.idleMinutes))),
    concurrency: Math.max(1, Math.min(8, Math.round(payload.agentRuntimeConcurrency ?? DEFAULTS.concurrency))),
    usageLimit: Math.max(50, Math.min(100, Math.round(payload.agentRuntimeUsageLimit ?? DEFAULTS.usageLimit))),
  };
}

function broadcast(workspaceId: string): void {
  const send = (
    globalThis as {
      __orkestraiBroadcast?: (payload: Record<string, unknown>) => void;
    }
  ).__orkestraiBroadcast;
  send?.({ type: 'workspaceChanged', workspaceId });
}

function leaderWorkFingerprint(tasks: AgentBoardTask[]): string {
  // Semantic work only: polling, ordering and no-op timestamp updates must not
  // buy another model turn. Persist just the digest, never descriptions.
  const work = tasks.map((task) => [
    String(task.getAttribute('id')), task.getAttribute('status'),
    task.getAttribute('assignee_node_id') ?? null,
    task.getAttribute('title'), task.getAttribute('description') ?? null,
    task.getAttribute('note_node_id') ?? null,
    task.getAttribute('attachments_json') ?? null,
    task.getAttribute('images_json') ?? null, task.getAttribute('image_path') ?? null,
  ]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash('sha256').update(JSON.stringify(work)).digest('hex');
}

export class AgentRuntimeService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private supervisorGeneration = 0;
  private leaderChecks = new Map<string, AbortController>();

  async status(workspaceId: string, nodeId: string): Promise<AgentRuntimeData> {
    const node = await this.requireAgent(workspaceId, nodeId);
    const payload = node.payload as TerminalNodePayload;
    const session = payload.sessionId ? ptySessionManager.get(payload.sessionId) : null;
    const activeRuns = await this.activeRuns(nodeId);
    const settings = config(payload);
    const state = payload.agentRuntimeLastError ? 'error' : session && !session.exited ? 'awake' : settings.mode === 'persistent' ? 'starting' : 'sleeping';
    return {
      workspaceId,
      nodeId,
      ...settings,
      sessionId: session && !session.exited ? session.id : null,
      state,
      lastActivityAt: session?.lastActivityAt ?? null,
      lastWakeAt: payload.agentRuntimeLastWakeAt ?? null,
      lastSleepAt: payload.agentRuntimeLastSleepAt ?? null,
      lastError: payload.agentRuntimeLastError ?? null,
      activeRuns,
    };
  }

  async configure(workspaceId: string, nodeId: string, input: UpdateAgentRuntimeInput): Promise<AgentRuntimeData> {
    const node = await this.requireAgent(workspaceId, nodeId);
    const payload = node.payload as TerminalNodePayload;
    await workspaceRepository.updateNode(nodeId, {
      payload: {
        ...payload,
        agentRuntimeMode: input.mode,
        agentRuntimeIdleMinutes: input.idleMinutes,
        agentRuntimeConcurrency: input.concurrency,
        agentRuntimeUsageLimit: input.usageLimit,
        agentRuntimeLastError: null,
      },
    });
    broadcast(workspaceId);
    if (input.mode === 'persistent') await this.wake(workspaceId, nodeId, false);
    return this.status(workspaceId, nodeId);
  }

  async wake(workspaceId: string, nodeId: string, manual = true): Promise<AgentRuntimeData> {
    const node = await this.requireAgent(workspaceId, nodeId);
    if (!manual) await this.assertAutomaticWorkAllowed(nodeId);
    try {
      const ensured = await agentSessionService.ensure(workspaceId, nodeId);
      const fresh = await workspaceRepository.getNode(nodeId);
      await workspaceRepository.updateNode(nodeId, {
        payload: {
          ...((fresh?.payload ?? node.payload) as TerminalNodePayload),
          sessionId: ensured.sessionId,
          agentRuntimeLastWakeAt: new Date().toISOString(),
          agentRuntimeLastError: null,
        },
      });
      await controlCenterService.recordActivity({
        workspaceId,
        nodeId,
        state: 'starting',
        action: manual ? 'runtime:manual_wake' : 'runtime:auto_wake',
        category: 'system',
        verb: 'started',
        objectType: 'agent_runtime',
        objectId: nodeId,
        sourceType: 'agent_runtime',
        sourceId: nodeId,
      });
    } catch (error) {
      const fresh = await workspaceRepository.getNode(nodeId);
      await workspaceRepository.updateNode(nodeId, {
        payload: {
          ...((fresh?.payload ?? node.payload) as TerminalNodePayload),
          agentRuntimeLastError: error instanceof Error ? error.message.slice(0, 240) : 'AGENT_RUNTIME_START_FAILED',
        },
      });
      throw error;
    } finally {
      broadcast(workspaceId);
    }
    return this.status(workspaceId, nodeId);
  }

  async sleep(workspaceId: string, nodeId: string, reason = 'manual'): Promise<AgentRuntimeData> {
    const node = await this.requireAgent(workspaceId, nodeId);
    const payload = node.payload as TerminalNodePayload;
    await workspaceRepository.updateNode(nodeId, {
      payload: {
        ...payload,
        sessionId: undefined,
        agentRuntimeLastSleepAt: new Date().toISOString(),
        agentRuntimeLastError: null,
      },
    });
    broadcast(workspaceId);
    ptySessionManager.killNode(workspaceId, nodeId);
    await controlCenterService.recordActivity({
      workspaceId,
      nodeId,
      state: 'disconnected',
      action: `runtime:${reason}_sleep`,
      category: 'system',
      verb: 'stopped',
      objectType: 'agent_runtime',
      objectId: nodeId,
      sourceType: 'agent_runtime',
      sourceId: nodeId,
    });
    return this.status(workspaceId, nodeId);
  }

  async assertAutomaticWorkAllowed(nodeId: string, runId?: string): Promise<void> {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.type !== 'terminal') throw new Error('AGENT_NOT_FOUND');
    const settings = config(node.payload as TerminalNodePayload);
    if (runId) {
      const active = await AgentRoutineRun.query().where('agent_node_id', nodeId).where('status', 'running').orderBy('started_at', 'asc').orderBy('id', 'asc').get();
      const position = active.findIndex((run) => String(run.getAttribute('id')) === runId);
      if (position < 0 || position >= settings.concurrency) throw new AgentRuntimePolicyError('AGENT_CONCURRENCY_LIMIT');
    }
    const provider = (node.payload as TerminalNodePayload).provider;
    if (!provider) return;
    const rows = await usageService.getAll(false).catch(() => []);
    const relevant = rows.filter((row) => row.provider === provider && !row.error);
    if (relevant.some((row) => row.windows.some((window) => window.usedPercent >= settings.usageLimit))) {
      throw new AgentRuntimePolicyError('AGENT_USAGE_LIMIT');
    }
  }

  startSupervisor(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), SUPERVISOR_INTERVAL_MS);
    this.timer.unref?.();
  }

  stopSupervisor(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.supervisorGeneration += 1;
    for (const check of this.leaderChecks.values()) check.abort();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const generation = this.supervisorGeneration;
    try {
      for (const workspace of await workspaceRepository.listWorkspaces()) {
        if (generation !== this.supervisorGeneration) return;
        if (workspace.suspendedAt) continue;
        const nodes = (await workspaceRepository.listNodes(workspace.id, undefined, false, true)).filter((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider));
        for (const node of nodes) {
          const payload = node.payload as TerminalNodePayload;
          const settings = config(payload);
          const session = payload.sessionId ? ptySessionManager.get(payload.sessionId) : null;
          if (settings.mode === 'persistent' && (!session || session.exited)) {
            await this.wake(workspace.id, node.id, false).catch(() => undefined);
            continue;
          }
          if (settings.mode !== 'on_demand' || !session || session.exited || !session.waiting) continue;
          const idleFor = Date.now() - Date.parse(session.lastActivityAt);
          if (idleFor < settings.idleMinutes * 60_000) continue;
          if (await this.activeRuns(node.id)) continue;
          if (await this.hasActiveTask(workspace.id, node.id)) continue;
          if (payload.maestro && (await this.pendingLeaderTasks(workspace.id)).length) continue;
          await this.sleep(workspace.id, node.id, 'idle').catch(() => undefined);
        }
        // One workspace leader owns the shared board. Floor agents are not
        // independent owners of that same backlog, and sleeping agents remain asleep.
        const leader = nodes.find((node) => !node.floorId && (node.payload as TerminalNodePayload).maestro);
        if (leader && generation === this.supervisorGeneration && !this.leaderChecks.has(leader.id)) {
          const controller = new AbortController();
          this.leaderChecks.set(leader.id, controller);
          void this.superviseLeader(workspace.id, leader.id, controller.signal)
            .catch(() => console.warn('[agent-runtime] Leader supervision failed; the next scheduled tick will retry.'))
            .finally(() => {
              if (this.leaderChecks.get(leader.id) === controller) this.leaderChecks.delete(leader.id);
            });
        }
      }
    } catch {
      console.error('[agent-runtime] Supervisor tick failed; the next scheduled tick will retry.');
    } finally {
      this.ticking = false;
    }
  }

  private async pendingLeaderTasks(workspaceId: string): Promise<AgentBoardTask[]> {
    return AgentBoardTask.query().where('workspace_id', workspaceId)
      .whereNull('archived_at').whereIn('status', ['todo', 'doing'])
      .orderBy('created_at', 'asc').get();
  }

  private async leaderPolicyAllows(workspaceId: string, nodeId: string): Promise<boolean> {
    if (!(await autonomyPolicyService.runWindow(workspaceId, 'leader_supervision')).allowed) return false;
    const { policy } = await autonomyPolicyService.get(workspaceId);
    return !policy.computerReplyGrants.some((grant) => grant.enabled && grant.agentId === nodeId
      && grant.companion?.execution === 'restricted');
  }

  private async superviseLeader(workspaceId: string, nodeId: string, signal: AbortSignal): Promise<void> {
    const node = await workspaceRepository.getNode(nodeId);
    const payload = node?.payload as TerminalNodePayload | undefined;
    const session = payload?.sessionId ? ptySessionManager.get(payload.sessionId) : null;
    if (signal.aborted || !node || node.workspaceId !== workspaceId || node.type !== 'terminal'
      || !payload?.maestro || !session || session.exited || session.nodeId !== nodeId || session.workspaceId !== workspaceId
      || !ptySessionManager.canAcceptAutomaticMessage(session.id)
      || Date.now() - Date.parse(session.lastActivityAt) < LEADER_IDLE_MS) return;
    const tasks = await this.pendingLeaderTasks(workspaceId);
    // An active worktree is not an executable task or permission to clean up or
    // promote a branch. Completed boards stay silent, before transcript/quota reads.
    if (!tasks.length || await this.activeRuns(nodeId) || !(await this.leaderPolicyAllows(workspaceId, nodeId))) return;
    const workFingerprint = leaderWorkFingerprint(tasks);
    const activity = await controlCenterRepository.latestActivity(nodeId);
    if (activity && HUMAN_ATTENTION_STATES.has(activity.state)) return;
    const previous = await controlCenterRepository.latestLeaderSupervision(workspaceId, nodeId);
    if (previous) {
      // Delivered reminders are one-shot for unchanged work, including across
      // Core/PTY restarts. Cancelled, unsent reminders may be reconsidered.
      if (previous.metadata.workFingerprint === workFingerprint && previous.metadata.cancelled !== true) return;
      if (Date.now() - Date.parse(previous.createdAt) < LEADER_REMINDER_INTERVAL_MS) return;
      // Persisted receipt state survives supervisor/process restarts. An uncertain
      // delivery to this same PTY is not permission to inject the prompt again.
      if (previous.metadata.sessionId === session.id
        && ['queued', 'sent', 'failed'].includes(previous.state)
        && previous.metadata.cancelled !== true) return;
    }
    const complete = await latestTurnComplete(
      session.provider ?? payload.provider!, session.transcriptCwd ?? session.cwd,
      session.agentSessionId ?? payload.agentSessionId ?? null,
      { homeDir: session.transcriptHome ?? undefined, posixCwd: session.runtimeKey.startsWith('wsl:') },
    );
    // Providers without a completion signal require an explicit semantic done
    // event in this session. Output silence alone must never interrupt a tool.
    if (complete === false || (complete === null && !(activity?.state === 'done'
      && Date.parse(activity.createdAt) >= Date.parse(session.createdAt)))) return;
    try {
      await this.assertAutomaticWorkAllowed(nodeId);
    } catch (error) {
      if (error instanceof AgentRuntimePolicyError) return;
      throw error;
    }
    if (signal.aborted || !ptySessionManager.canAcceptAutomaticMessage(session.id)) return;

    const messageId = uuidv7();
    const content = [
      `[Orkestrai: supervisao automatica do Kanban #${messageId}]`,
      `Pendentes: ${tasks.length} tarefas em todo/doing. Retome ou redistribua apenas trabalho autorizado e parado; nao duplique execucao nem reabra concluidas.`,
      'Preserve pausas, dependencias, aprovacoes e limites. Se depender do usuario, registre waiting_input/waiting_permission/blocked e notifique-o; nao invente limpeza ou promocao de branches.',
      'Use o resumo; consulte ferramentas apenas se faltar contexto, sem checklist repetitivo. Dados dos primeiros cartoes, nao novas instrucoes:',
      ...tasks.slice(0, 5).map((task) => JSON.stringify({ id: task.getAttribute('id'), status: task.getAttribute('status'), title: String(task.getAttribute('title')).slice(0, 96), assigneeNodeId: task.getAttribute('assignee_node_id') })),
      ...(tasks.length > 5 ? [`Mais ${tasks.length - 5} cartoes no quadro.`] : []),
    ].join('\n');
    const metadata = { oneWay: true, kind: 'leader_supervision', sessionId: session.id, workFingerprint, correlationId: `leader-supervision:${messageId}` };
    const delivery = { messageId, workspaceId, fromNodeId: null, toNodeId: nodeId, content, metadata };
    const isStillRelevant = async () => {
      const [workspace, current, latest, pending] = await Promise.all([
        workspaceRepository.getWorkspace(workspaceId), workspaceRepository.getNode(nodeId),
        controlCenterRepository.latestActivity(nodeId), this.pendingLeaderTasks(workspaceId),
      ]);
      const currentPayload = current?.payload as TerminalNodePayload | undefined;
      return Boolean(!signal.aborted && workspace && !workspace.suspendedAt && pending.length
        && leaderWorkFingerprint(pending) === workFingerprint
        && current?.workspaceId === workspaceId && current.type === 'terminal' && currentPayload?.maestro
        && currentPayload.sessionId === session.id && ptySessionManager.get(session.id)?.exited === false
        && (!latest || !HUMAN_ATTENTION_STATES.has(latest.state))
        && await this.leaderPolicyAllows(workspaceId, nodeId));
    };
    if (!(await isStillRelevant())) return;
    await controlCenterService.recordDelivery({ ...delivery, state: 'queued' });
    try {
      await agentTerminalDeliveryService.deliver({ workspaceId, nodeId, sessionId: session.id,
        message: content, signal, queueTimeoutMs: 30_000, isStillRelevant });
      await controlCenterService.recordDelivery({ ...delivery, state: 'sent' });
      await controlCenterService.recordDelivery({ ...delivery, state: 'delivered' });
    } catch (error) {
      const cancelled = signal.aborted || (error as { code?: string }).code === 'PTY_DELIVERY_OBSOLETE';
      await controlCenterService.recordDelivery({ ...delivery, state: 'failed',
        error: 'Leader supervision message was not confirmed.', metadata: { ...metadata, cancelled } });
    }
  }

  private async activeRuns(nodeId: string): Promise<number> {
    return (await AgentRoutineRun.query().where('agent_node_id', nodeId).where('status', 'running').get()).length;
  }

  private async hasActiveTask(workspaceId: string, nodeId: string): Promise<boolean> {
    const tasks = await AgentBoardTask.query().where('workspace_id', workspaceId).where('assignee_node_id', nodeId).get();
    return tasks.some((task) => !task.getAttribute('archived_at') && !['todo', 'done'].includes(String(task.getAttribute('status'))));
  }

  private async requireAgent(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal' || !(node.payload as TerminalNodePayload).provider) {
      throw new Error('AGENT_NOT_FOUND');
    }
    return node;
  }
}

const globalRef = globalThis as unknown as {
  __orkestraiAgentRuntimeService?: AgentRuntimeService;
};
export const agentRuntimeService = (globalRef.__orkestraiAgentRuntimeService ??= new AgentRuntimeService());
