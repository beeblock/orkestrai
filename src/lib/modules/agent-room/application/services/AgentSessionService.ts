import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { agentSessionTracker, agentSessionTrackerForRuntime } from '../../infrastructure/pty/AgentSessionTracker.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { getAgentAdapter, hasAgentAdapter } from '../adapters/registry.js';
import { floorService } from './FloorService.js';
import { preflightWslLaunch, terminalExecutionRuntime } from '../../infrastructure/WslRuntime.js';
import type { WorkspaceExecutionRuntime } from '../../domain/types.js';
import { executionRuntimeKey } from '../../domain/runtime.js';
import { providerProfileService } from './ProviderProfileService.js';
import { codexMcpLaunchForRuntime, codexMcpOverrideArgs } from '../../infrastructure/codex-mcp-config.js';

type AgentNodePayload = {
  sessionId?: string;
  agentSessionId?: string;
  resumeRecovery?: boolean;
  provider?: string;
  profileId?: string | null;
  command?: string;
  args?: string[];
  initialRoleArgs?: string[];
  env?: Record<string, string>;
  executionRuntime?: WorkspaceExecutionRuntime | null;
};

export type EnsuredAgentSession = {
  nodeId: string;
  sessionId: string;
  state: 'existing' | 'started' | 'resumed';
};

function notifyWorkspaceChanged(workspaceId: string): void {
  const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  broadcast?.({ type: 'workspaceChanged', workspaceId });
}

export class AgentSessionService {
  async ensureByTitle(workspaceId: string, title: string): Promise<EnsuredAgentSession> {
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, true);
    const target = nodes.find((node) => node.type === 'terminal' && (node.title ?? '').trim() === title.trim());
    if (!target) throw new Error(`Agente "${title}" nao encontrado no canvas.`);
    return this.ensure(workspaceId, target.id);
  }

  async ensure(workspaceId: string, nodeId: string): Promise<EnsuredAgentSession> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');
    if (workspace.suspendedAt) throw new Error('WORKSPACE_SUSPENDED');
    const target = await workspaceRepository.getNode(nodeId);
    if (!target || target.workspaceId !== workspaceId || target.type !== 'terminal') {
      throw new Error('AGENT_NOT_FOUND');
    }
    const title = target.title ?? 'Terminal';
    const payload = (target.payload ?? {}) as AgentNodePayload;
    const runtime = terminalExecutionRuntime(workspace, payload);
    const liveNodeSessions = ptySessionManager.listLiveForNode(workspaceId, target.id);
    const compatibleLiveSession = liveNodeSessions.find(
      (session) => session.command === payload.command
        && (session.provider ?? null) === (payload.provider ?? null)
        && session.runtimeKey === executionRuntimeKey(runtime),
    );
    if (compatibleLiveSession) {
      ptySessionManager.killNode(workspaceId, target.id, compatibleLiveSession.id);
      if (payload.sessionId !== compatibleLiveSession.id) {
        await workspaceRepository.updateNode(target.id, {
          payload: { ...payload, sessionId: compatibleLiveSession.id } as never,
        });
        notifyWorkspaceChanged(workspaceId);
      }
      return { nodeId: target.id, sessionId: compatibleLiveSession.id, state: 'existing' };
    }
    if (liveNodeSessions.length) ptySessionManager.killNode(workspaceId, target.id);

    const existing = payload.sessionId ? ptySessionManager.get(payload.sessionId) : null;
    if (existing && !existing.exited) {
      return { nodeId: target.id, sessionId: existing.id, state: 'existing' };
    }
    if (!payload.command) throw new Error('AGENT_COMMAND_UNAVAILABLE');

    let cwd = workspace.workingDir;
    if (target.floorId) {
      const floor = await floorService.get(target.floorId);
      if (floor?.path) cwd = floor.path;
    }

    const adapter = payload.provider && hasAgentAdapter(payload.provider) ? getAgentAdapter(payload.provider) : null;
    const trackingStartedAt = Date.now();
    const wslContext = runtime.kind === 'wsl'
      ? await preflightWslLaunch({ runtime, command: payload.command, hostCwd: cwd, workspaceRoot: workspace.workingDir })
      : null;
    const tracker = wslContext && runtime.kind === 'wsl'
      ? agentSessionTrackerForRuntime(
          `${runtime.distribution}:${wslContext.homeHostPath}`,
          wslContext.homeHostPath,
          (candidate) => posix.normalize(candidate),
        )
      : agentSessionTracker;
    const trackingCwd = wslContext?.linuxWorkingDir ?? cwd;
    let resumableAgentSessionId = payload.agentSessionId ?? null;
    if (resumableAgentSessionId && adapter) {
      const valid = tracker.isAgentSessionResumable(adapter.sessionStorage, trackingCwd, resumableAgentSessionId);
      if (valid === false) resumableAgentSessionId = null;
    }
    const freshAgentSessionId = !resumableAgentSessionId && adapter?.freshSessionArgs ? randomUUID() : null;
    const conversationArgs = resumableAgentSessionId
      ? (adapter?.resumeArgs(resumableAgentSessionId) ?? [])
      : freshAgentSessionId
        ? adapter!.freshSessionArgs!(freshAgentSessionId)
        : [];
    if (freshAgentSessionId) tracker.claim(freshAgentSessionId);

    const profileEnv = payload.profileId && payload.provider
      ? await providerProfileService.resolveEnv(payload.profileId, payload.provider, {
          runtimeHome: wslContext?.linuxHomePath,
        })
      : {};
    const mcpArgs = payload.provider === 'codex'
      ? codexMcpOverrideArgs(codexMcpLaunchForRuntime(runtime))
      : [];
    const session = ptySessionManager.create({
      command: payload.command,
      args: [...(payload.args ?? []), ...mcpArgs, ...(!resumableAgentSessionId ? (payload.initialRoleArgs ?? []) : []), ...conversationArgs],
      cwd,
      label: title,
      workspace: workspace.name,
      workspaceId,
      nodeId: target.id,
      provider: payload.provider ?? null,
      env: {
        ...(payload.env ?? {}),
        ...profileEnv,
        ORKESTRAI_NODE_ID: target.id,
        ORKESTRAI_AGENT_TITLE: title,
      },
      forwardEnvToWsl: Object.keys(profileEnv),
      runtime,
      workspaceRoot: workspace.workingDir,
    });
    const activeAgentSessionId = resumableAgentSessionId;
    if (activeAgentSessionId) tracker.bind(session.id, activeAgentSessionId);
    const nextPayload: AgentNodePayload = {
      ...payload,
      sessionId: session.id,
      resumeRecovery: false,
    };
    if (activeAgentSessionId) nextPayload.agentSessionId = activeAgentSessionId;
    else delete nextPayload.agentSessionId;
    try {
      await workspaceRepository.updateNode(target.id, {
        payload: nextPayload as never,
      });
    } catch (error) {
      ptySessionManager.kill(session.id);
      throw error;
    }

    if (payload.provider && adapter && !activeAgentSessionId) {
      const reportAgentSession = (agentSessionId: string) => {
        tracker.bind(session.id, agentSessionId);
        void workspaceRepository.getNode(target.id).then((fresh) => {
          if (!fresh) return;
          if (String((fresh.payload as AgentNodePayload | null)?.sessionId ?? '') !== session.id) return;
          return workspaceRepository.updateNode(target.id, {
            payload: { ...((fresh.payload ?? {}) as object), sessionId: session.id, agentSessionId } as never,
          });
        }).then(() => notifyWorkspaceChanged(workspaceId)).catch(() => undefined);
      };
      if (freshAgentSessionId) {
        const watchingExpected = tracker.watchExpected(session.id, adapter.sessionStorage, trackingCwd, freshAgentSessionId, reportAgentSession);
        if (!watchingExpected) reportAgentSession(freshAgentSessionId);
      } else {
        tracker.watch(session.id, adapter.sessionStorage, trackingCwd, trackingStartedAt, reportAgentSession);
      }
    }
    notifyWorkspaceChanged(workspaceId);
    return {
      nodeId: target.id,
      sessionId: session.id,
      state: resumableAgentSessionId ? 'resumed' : 'started',
    };
  }
}

export const agentSessionService = new AgentSessionService();
