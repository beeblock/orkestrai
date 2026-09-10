import type { AgentRuntimeData, UpdateAgentRuntimeInput } from '../../contracts/schemas/agent-runtime.schema.js';
import type { TerminalNodePayload } from '../../domain/types.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { agentSessionService } from './AgentSessionService.js';
import { controlCenterService } from './ControlCenterService.js';
import { usageService } from './UsageService.js';

const SUPERVISOR_INTERVAL_MS = 15_000;
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

export class AgentRuntimeService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

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
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const workspace of await workspaceRepository.listWorkspaces()) {
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
          await this.sleep(workspace.id, node.id, 'idle').catch(() => undefined);
        }
      }
    } catch {
      console.error('[agent-runtime] Supervisor tick failed; the next scheduled tick will retry.');
    } finally {
      this.ticking = false;
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
