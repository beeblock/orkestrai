import { constants as fsConstants, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, posix, resolve } from 'node:path';
import { homedir } from 'node:os';
import { agentStorageRoots } from '../../infrastructure/transcript/AgentStorageRoots.js';
import { profileSessionContinuityService } from './ProfileSessionContinuityService.js';
import { profileTransitions } from '../../infrastructure/pty/ProfileTransitions.js';
import { Connection } from '@beeblock/svelar/database';
import type { CanvasNodePayload, TerminalNodePayload, Workspace, WorkspaceRepositoryRoot } from '../../domain/types.js';
import { findFreeCanvasPosition } from '../../domain/canvas-placement.js';
import { isTeamAgentNode, occupiedOnFloor } from '../../domain/canvas-floors.js';
import { executionRuntimeKey } from '../../domain/runtime.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { defaultShell } from '../../infrastructure/workspace.js';
import { restoreAgentLaunchSelection } from '../../infrastructure/transcript/AgentLaunchSelection.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentSessionTracker, agentSessionTrackerForRuntime } from '../../infrastructure/pty/AgentSessionTracker.ts';
import { bridgeService } from './BridgeService.js';
import { designDocumentService } from './DesignDocumentService.js';
import { roleService } from './RoleService.js';
import { providerProfileService } from './ProviderProfileService.js';
import { floorService } from './FloorService.js';
import { controlCenterService } from './ControlCenterService.js';
import { codeGraphIndexService } from './CodeGraphIndexService.js';
import { computerService } from './ComputerService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { portalProfileFromPayload } from './ManagedPortalService.js';
import { workspaceGroupService } from './WorkspaceGroupService.js';
import { agentLearningService } from './AgentLearningService.js';
import { attentionService } from './AttentionService.js';
import { CreateWorkspaceDto } from '../dto/WorkspaceDtos.js';
import type {
  CreateCanvasEdgeDto,
  ChangeTerminalProviderDto,
  ChangeTerminalRuntimeDto,
  CreateCanvasNodeDto,
  UpdateCanvasEdgeDto,
  UpdateCanvasNodeDto,
  UpdateWorkspaceDto,
} from '../dto/WorkspaceDtos.js';
import { getAgentAdapter, materializeInteractiveAgentCommand } from '../adapters/registry.js';
import {
  resolveTerminalRuntimeOverride,
  resolveWslTrackingContext,
  resolveWorkspaceRuntime,
  terminalExecutionRuntime,
  withWorkspaceExecutionRuntime,
  wslHostPath,
  workspaceExecutionRuntime,
} from '../../infrastructure/WslRuntime.js';

type WorkspaceProvisionState = {
  checked: Set<string>;
  inFlight: Map<string, Promise<void>>;
};

const WORKSPACE_PROVISION_STATE = Symbol.for('orkestrai.workspaceProvisionState');
const WORKSPACE_INSTRUCTIONS_BEGIN = '<!-- orkestrai:workspace-instructions:begin -->';
const WORKSPACE_INSTRUCTIONS_END = '<!-- orkestrai:workspace-instructions:end -->';
const WORKSPACE_INSTRUCTIONS_PATTERN = /<!-- orkestrai:workspace-instructions:begin -->[\s\S]*?<!-- orkestrai:workspace-instructions:end -->/;

function managedInstructionBlock(instructions: string): string {
  return `${WORKSPACE_INSTRUCTIONS_BEGIN}\n${instructions}\n${WORKSPACE_INSTRUCTIONS_END}`;
}

function mergeInstructionFile(current: string, instructions: string | null, legacyInstructions?: string | null): string {
  const block = instructions ? managedInstructionBlock(instructions) : '';
  if (WORKSPACE_INSTRUCTIONS_PATTERN.test(current)) {
    const next = current.replace(WORKSPACE_INSTRUCTIONS_PATTERN, block);
    return `${next.trimEnd()}${next.trim() ? '\n' : ''}`;
  }

  const trimmed = current.trim();
  const knownLegacy = [instructions, legacyInstructions].filter((value): value is string => Boolean(value));
  if (trimmed && knownLegacy.includes(trimmed)) return block ? `${block}\n` : '';
  if (!block) return current;

  const bridgeMarker = current.indexOf('<!-- orkestrai:begin -->');
  if (bridgeMarker > 0 && knownLegacy.includes(current.slice(0, bridgeMarker).trim())) {
    return `${block}\n\n${current.slice(bridgeMarker).trimStart()}`;
  }
  return `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${block}\n`;
}

function workspaceProvisionState(): WorkspaceProvisionState {
  const globals = globalThis as typeof globalThis & {
    [WORKSPACE_PROVISION_STATE]?: WorkspaceProvisionState;
  };
  return globals[WORKSPACE_PROVISION_STATE] ??= {
    checked: new Set<string>(),
    inFlight: new Map<string, Promise<void>>(),
  };
}

/**
 * Servico de aplicacao de workspaces e canvas: valida diretorios,
 * sincroniza CLAUDE.md/AGENTS.md e delega ao WorkspaceRepository.
 */
export class WorkspaceService {
  private provisionState = workspaceProvisionState();
  /** Workspaces ja verificados neste processo (evita statSync a cada chamada). */
  private provisionChecked = this.provisionState.checked;
  /** Uma restauracao carrega nos/arestas/andares em paralelo. Compartilhar a
      mesma verificacao evita ocupar todo o pool fs enquanto o macOS aguarda TCC. */
  private provisionInFlight = this.provisionState.inFlight;

  /**
   * Avisa o canvas que a estrutura mudou (no/aresta criada ou removida FORA da
   * pagina — tours, CLI, API): sem isso o no so aparecia ao sair e voltar ao
   * workspace. So mudancas ESTRUTURAIS — updateNode fica de fora de proposito
   * (arrastar/redimensionar dispararia reloads em tempestade).
   */
  private notifyStructureChanged(workspaceId: string): void {
    const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
    broadcast?.({ type: 'workspaceChanged', workspaceId });
  }

  async list() {
    return workspaceRepository.listWorkspaces();
  }

  async get(id: string) {
    const workspace = await workspaceRepository.getWorkspace(id);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    await this.ensureProvisioned(workspace);
    return workspace;
  }

  async resumeWorkspace(id: string) {
    const existing = await workspaceRepository.getWorkspace(id);
    if (!existing) throw new Error('Workspace nao encontrado.');
    const workspace = existing.suspendedAt
      ? await workspaceRepository.setWorkspaceSuspended(id, false)
      : existing;
    if (!workspace) throw new Error('Workspace nao encontrado.');
    await this.ensureProvisioned(workspace);
    return workspace;
  }

  /**
   * Reparo idempotente: workspaces criados antes do provisionamento zero-config
   * (ou cujos arquivos foram apagados) recuperam skill + token da ponte ao
   * serem abertos — sem isso o lider nascia sem saber que e orquestrador.
   * Skill com conteudo antigo e regravada (o template evolui com o app).
   */
  private async ensureProvisioned(workspace: Workspace) {
    if (this.provisionChecked.has(workspace.id)) return;
    const inFlight = this.provisionInFlight.get(workspace.id);
    if (inFlight) return inFlight;

    // A permissao de uma pasta protegida pode ficar aguardando o usuario por
    // tempo indeterminado. Workspaces distintos precisam continuar abrindo;
    // chamadas repetidas do mesmo workspace ainda compartilham esta promise.
    const provisioning = this.provisionWorkspace(workspace);
    this.provisionInFlight.set(workspace.id, provisioning);
    try {
      await provisioning;
    } finally {
      if (this.provisionInFlight.get(workspace.id) === provisioning) {
        this.provisionInFlight.delete(workspace.id);
      }
    }
  }

  private async provisionWorkspace(workspace: Workspace) {
    if (workspace.runtimeKind === 'wsl') {
      await resolveWorkspaceRuntime({
        runtimeKind: 'wsl',
        workingDir: workspace.workingDir,
        wslDistribution: workspace.wslDistribution,
        wslWorkingDir: workspace.wslWorkingDir,
      });
    }
    // Downloads/Documents/Desktop podem exigir consentimento TCC no macOS.
    // Uma unica checagem assincrona deixa threads livres enquanto o dialogo do
    // sistema aguarda o usuario; chamadas concorrentes esgotavam o pool fs.
    await access(workspace.workingDir, fsConstants.R_OK | fsConstants.W_OK);
    const skillPath = resolve(workspace.workingDir, '.claude', 'skills', 'orkestrai', 'SKILL.md');
    const bridgeRuntime = await this.preferredBridgeRuntime(workspace);
    const cliEntry = process.env.ORKESTRAI_CLI_JS ?? resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js');
    const [skillCurrent, hasConfig, agentsMdCurrent, hasWslLauncher] = await Promise.all([
      readFile(skillPath, 'utf8').then((content) => content === bridgeService.bridgeSkillContent()).catch(() => false),
      access(resolve(workspace.workingDir, '.orkestrai', 'workspace.json')).then(() => true).catch(() => false),
      readFile(resolve(workspace.workingDir, 'AGENTS.md'), 'utf8').catch(() => ''),
      bridgeRuntime?.kind === 'wsl'
        ? readFile(resolve(workspace.workingDir, '.orkestrai', 'bin', 'orkestrai'), 'utf8')
            .then((content) => content.includes('orkestrai:wsl-console-launcher-v2') && content.includes(cliEntry))
            .catch(() => false)
        : Promise.resolve(true),
    ]);
    // Bloco AGENTS.md (codex/kimi/opencode) entrou depois — workspaces antigos
    // so ganham os arquivos novos se o reparo verificar o marcador tambem.
    const hasAgentsMd = agentsMdCurrent.includes('<!-- orkestrai:begin -->');
    if (skillCurrent && hasConfig && hasAgentsMd && hasWslLauncher) {
      this.provisionChecked.add(workspace.id);
      return;
    }
    const token = await bridgeService.getOrCreateToken(workspace.id).catch(() => null);
    if (!token) return;
    await bridgeService.provisionSkill(workspace, token, bridgeRuntime ?? undefined);
    this.provisionChecked.add(workspace.id);
  }

  async create(dto: CreateWorkspaceDto) {
    if (dto.groupId) await workspaceGroupService.assertExists(dto.groupId);
    const resolvedRuntime = await resolveWorkspaceRuntime({
      runtimeKind: dto.runtimeKind,
      workingDir: dto.workingDir,
      wslDistribution: dto.wslDistribution,
      wslWorkingDir: dto.wslWorkingDir,
    });
    const workingDir = this.assertWorkingDir(resolvedRuntime.workingDir);
    const workspace = await workspaceRepository.createWorkspace({
      name: dto.name,
      workingDir,
      icon: dto.icon,
      instructions: dto.instructions,
      runtimeKind: resolvedRuntime.runtime.kind,
      wslDistribution: resolvedRuntime.runtime.kind === 'wsl' ? resolvedRuntime.runtime.distribution : null,
      wslWorkingDir: resolvedRuntime.runtime.kind === 'wsl' ? resolvedRuntime.runtime.linuxWorkingDir : null,
      syncAgentInstructionFiles: dto.syncAgentInstructionFiles,
      hooks: dto.hooks,
      repositoryRoots: this.assertRepositoryRoots(dto.repositoryRoots),
      codeIntelligenceMode: dto.codeIntelligenceMode,
      groupId: dto.groupId,
    });
    this.writeInstructionFiles(workspace);
    // Provisiona a ponte (token + skill) ja no nascimento do workspace:
    // qualquer agente criado depois nasce sabendo usar a CLI orkestrai,
    // sem o usuario precisar conectar nada antes (fluxo zero-config).
    const token = await bridgeService.getOrCreateToken(workspace.id).catch(() => null);
    if (token) await bridgeService.provisionSkill(workspace, token, workspaceExecutionRuntime(workspace));
    return workspace;
  }

  async update(id: string, dto: UpdateWorkspaceDto) {
    // Read directly so a user can repair a WSL workspace whose old distro or
    // path is no longer available. get() intentionally validates/provisions it.
    const existing = await workspaceRepository.getWorkspace(id);
    if (!existing) throw new Error('Workspace nao encontrado.');
    const resolvedRuntime = await resolveWorkspaceRuntime({
      runtimeKind: dto.changes.runtimeKind ?? existing.runtimeKind,
      workingDir: dto.changes.workingDir ?? existing.workingDir,
      wslDistribution: dto.changes.wslDistribution === undefined ? existing.wslDistribution : dto.changes.wslDistribution,
      wslWorkingDir: dto.changes.wslWorkingDir === undefined ? existing.wslWorkingDir : dto.changes.wslWorkingDir,
    });
    const workingDir = this.assertWorkingDir(resolvedRuntime.workingDir);
    const repositoryRoots = dto.changes.repositoryRoots === undefined
      ? existing.repositoryRoots
      : this.assertRepositoryRoots(dto.changes.repositoryRoots);
    const runtimeChanged =
      existing.runtimeKind !== resolvedRuntime.runtime.kind ||
      existing.workingDir !== workingDir ||
      (resolvedRuntime.runtime.kind === 'wsl' && (
        existing.wslDistribution !== resolvedRuntime.runtime.distribution ||
        existing.wslWorkingDir !== resolvedRuntime.runtime.linuxWorkingDir
      ));
    const repositoryRootsChanged = JSON.stringify(existing.repositoryRoots) !== JSON.stringify(repositoryRoots);
    const codeIntelligenceModeChanged = dto.changes.codeIntelligenceMode !== undefined
      && dto.changes.codeIntelligenceMode !== existing.codeIntelligenceMode;
    if (runtimeChanged) await this.unloadWorkspaceSessions(id);
    const workspace = await workspaceRepository.updateWorkspace(id, {
      ...dto.changes,
      workingDir,
      runtimeKind: resolvedRuntime.runtime.kind,
      wslDistribution: resolvedRuntime.runtime.kind === 'wsl' ? resolvedRuntime.runtime.distribution : null,
      wslWorkingDir: resolvedRuntime.runtime.kind === 'wsl' ? resolvedRuntime.runtime.linuxWorkingDir : null,
      repositoryRoots,
    });
    if (!workspace) throw new Error('Workspace nao encontrado.');
    if (codeIntelligenceModeChanged) await codeGraphIndexService.applyWorkspaceMode(workspace);
    if (runtimeChanged || repositoryRootsChanged) this.provisionChecked.delete(id);
    this.writeInstructionFiles(workspace, existing.instructions);
    if (runtimeChanged || repositoryRootsChanged) await this.reprovisionBridge(workspace);
    else await this.ensureProvisioned(workspace);
    return workspace;
  }

  async remove(id: string) {
    const { creativeMediaRepository } = await import('$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js');
    if (await creativeMediaRepository.activeForWorkspace(id)) throw new Error('creative_workflow_busy');
    ptySessionManager.killWorkspace(id);
    await controlCenterService.settleWorkspace(id);
    const deleted = await workspaceRepository.deleteWorkspace(id);
    if (!deleted) throw new Error('Workspace nao encontrado.');
    await creativeMediaRepository.removeWorkspace(id);
    return { deleted: true };
  }

  // -- Nos -----------------------------------------------------------------

  async listBoardNodeSummaries(workspaceId: string) {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace not found.');
    return workspaceRepository.listBoardNodeSummaries(workspaceId);
  }

  async listNodes(workspaceId: string) {
    const workspace = await this.get(workspaceId);
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return Promise.all(nodes.map(async (node) => {
      if (node.type !== 'terminal') return node;
      let payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
      let changed = this.normalizeTerminalShell(workspace, payload);
      const executionRuntime = terminalExecutionRuntime(workspace, payload as never);
      const storedSessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;
      let storedPty = storedSessionId ? ptySessionManager.get(storedSessionId) : null;
      if (storedPty && ((storedPty.workspaceId && storedPty.workspaceId !== workspace.id)
        || (storedPty.nodeId && storedPty.nodeId !== node.id))) storedPty = null;
      const agentSessionId = typeof payload.agentSessionId === 'string' ? payload.agentSessionId : null;
      const provider = typeof payload.provider === 'string' ? payload.provider : null;
      const liveNodeSessions = ptySessionManager.listLiveForNode(workspace.id, node.id);
      let compatibleNodeSessions = liveNodeSessions.filter((session) => (
        session.command === payload.command
        && (session.provider ?? null) === provider
        && session.runtimeKey === executionRuntimeKey(executionRuntime)
      ));
      if (!compatibleNodeSessions.length && provider && agentSessionId) {
        const conversationSession = ptySessionManager.listLiveForAgentSession(provider, agentSessionId).find(
          (session) => session.command === payload.command
            && session.runtimeKey === executionRuntimeKey(executionRuntime),
        );
        if (conversationSession && ptySessionManager.claimNode(conversationSession.id, workspace.id, node.id)) {
          compatibleNodeSessions = [conversationSession];
        }
      }
      if (compatibleNodeSessions.length) {
        // Hibernacao/reload pode deixar o processo vivo depois que o renderer
        // perdeu o sessionId. Reassocie o PTY original e elimine duplicatas.
        const canonical = compatibleNodeSessions[0];
        ptySessionManager.killNode(workspace.id, node.id, canonical.id);
        if (provider && agentSessionId) ptySessionManager.killAgentSession(provider, agentSessionId, { workspaceId, nodeId: node.id }, canonical.id);
        storedPty = canonical;
        if (storedSessionId !== canonical.id) {
          payload.sessionId = canonical.id;
          changed = true;
        }
      } else {
        if (liveNodeSessions.length) {
          ptySessionManager.killNode(workspace.id, node.id);
          storedPty = null;
        }
        if (storedSessionId && (!storedPty || storedPty.exited)) {
          delete payload.sessionId;
          // A PTY e efemera. Sem um agentSessionId confirmado no storage da CLI,
          // tentar --last/--continue e especulativo e falha em conversas vazias.
          // O renderer inicia uma conversa limpa; ids confirmados seguem pelo
          // resume exato, tanto no Windows quanto dentro do WSL.
          payload.resumeRecovery = false;
          changed = true;
        }
      }
      const currentWorkingDir = typeof payload.currentWorkingDir === 'string' ? payload.currentWorkingDir : null;
      if (currentWorkingDir && !provider && executionRuntime.kind === 'native') {
        try {
          if (!statSync(currentWorkingDir).isDirectory()) throw new Error('not_directory');
        } catch {
          delete payload.currentWorkingDir;
          changed = true;
        }
      }
      if (executionRuntime.kind === 'wsl' && (!storedPty || storedPty.exited) && payload.resumeRecovery && !agentSessionId) {
        payload.resumeRecovery = false;
        changed = true;
      }
      if (agentSessionId && provider && (!storedPty || storedPty.exited)) {
        let resumable: boolean | null = null;
        try {
          let tracker = agentSessionTracker;
          // Claude stores a conversation under the folder it was launched in:
          // a Floor agent's transcript lives under the Floor, not the workspace.
          const floor = node.floorId ? await floorService.get(node.floorId).catch(() => null) : null;
          let trackingCwd = floor?.path ?? workspace.workingDir;
          let trackingHome: string | undefined;
          let linuxHome: string | undefined;
          if (executionRuntime.kind === 'wsl') {
            const hostCwd = floor?.path ?? workspace.workingDir;
            const context = await resolveWslTrackingContext({ runtime: executionRuntime, hostCwd, workspaceRoot: workspace.workingDir });
            trackingCwd = context.linuxWorkingDir;
            trackingHome = context.homeHostPath;
            linuxHome = context.linuxHomePath;
          }
          const profileEnv = typeof payload.profileId === 'string'
            ? await providerProfileService.resolveEnv(payload.profileId, provider, { runtimeHome: linuxHome }) : {};
          const env = payload.env as Record<string, string> | undefined;
          const roots = agentStorageRoots({ ...(executionRuntime.kind === 'native' ? process.env : {}), ...env, ...profileEnv }, trackingCwd,
            executionRuntime.kind === 'wsl' ? path => wslHostPath(executionRuntime.distribution, path) : null);
          if (trackingHome || Object.keys(roots).length) tracker = agentSessionTrackerForRuntime(
            executionRuntime.kind === 'wsl' ? `${executionRuntime.distribution}:${trackingHome}` : 'native',
            trackingHome ?? homedir(), executionRuntime.kind === 'wsl' ? posix.normalize : null, roots);
          resumable = tracker.isAgentSessionResumable(
            getAgentAdapter(provider).sessionStorage,
            trackingCwd,
            agentSessionId,
          );
          if (resumable !== false) {
            const codexHome = profileEnv.CODEX_HOME ?? env?.CODEX_HOME ?? (executionRuntime.kind === 'native' ? process.env.CODEX_HOME : undefined);
            const selected = await restoreAgentLaunchSelection(payload, trackingCwd, { homeDir: trackingHome, posixCwd: executionRuntime.kind === 'wsl',
              codexHome: codexHome && executionRuntime.kind === 'wsl' ? wslHostPath(executionRuntime.distribution, codexHome) : codexHome });
            if (selected !== payload) { payload = selected; changed = true; }
          }
        } catch {
          // Providers removidos ou desconhecidos nao devem impedir a abertura do workspace.
        }
        if (resumable === false) {
          delete payload.agentSessionId;
          payload.resumeRecovery = false;
          changed = true;
        }
      }
      const roleName = typeof payload.role === 'string' ? payload.role : null;
      const role = roleName ? await roleService.launchContext(workspaceId, roleName).catch(() => null) : null;
      const materialized = materializeInteractiveAgentCommand(payload, role);
      if (materialized.changed) {
        payload = materialized.payload;
        changed = true;
      }
      if (!changed) return node;
      return (await workspaceRepository.updateNode(node.id, { payload: payload as never })) ?? node;
    }));
  }

  async createNode(dto: CreateCanvasNodeDto) {
    const workspace = await this.get(dto.workspaceId);
    if (dto.type === 'sequence') {
      const { creativeSequenceService } = await import('$lib/modules/creative-media/application/services/CreativeSequenceService.js');
      const result = await creativeSequenceService.execute(dto.workspaceId, { command: 'create', title: dto.title || 'Video sequence', floorId: dto.floorId }, { type: 'user' }) as { nodeId: string };
      const created = await workspaceRepository.updateNode(result.nodeId, { ...(dto.x !== undefined ? { x: dto.x } : {}), ...(dto.y !== undefined ? { y: dto.y } : {}), ...(dto.width !== undefined ? { width: Math.max(560, dto.width) } : {}), ...(dto.height !== undefined ? { height: Math.max(440, dto.height) } : {}) });
      if (!created) throw new Error('creative_sequence_not_found');
      return created;
    }
    if (dto.type === 'storyboard') {
      const { creativeStoryboardService } = await import('$lib/modules/creative-media/application/services/CreativeStoryboardService.js');
      const result = await creativeStoryboardService.execute(dto.workspaceId, { command: 'create', title: dto.title || 'Storyboard', floorId: dto.floorId, ...(dto.x !== undefined && dto.y !== undefined ? { position: { x: dto.x, y: dto.y } } : {}) }, { type: 'user' });
      if (!('nodeId' in result)) throw new Error('creative_request_failed');
      const created = await workspaceRepository.updateNode(result.nodeId, { ...(dto.width !== undefined ? { width: Math.max(540, dto.width) } : {}), ...(dto.height !== undefined ? { height: Math.max(380, dto.height) } : {}) });
      if (!created) throw new Error('creative_storyboard_not_found');
      return created;
    }
    const existingNodes = await workspaceRepository.listNodes(dto.workspaceId);
    if (dto.type === 'device' || dto.type === 'computer') {
      const existing = existingNodes.find((node) => node.type === dto.type);
      if (existing) return existing;
    }
    const payload = dto.type === 'terminal'
      ? await this.normalizeTerminalPayloadRuntime(workspace, dto.payload)
      : dto.payload;
    if (dto.type === 'terminal') {
      const terminalPayload = (payload ?? {}) as Record<string, unknown>;
      const provider = typeof terminalPayload.provider === 'string' ? terminalPayload.provider : null;
      if (terminalPayload.profileId && !provider) throw new Error('A provider profile requires an agent provider.');
      if (provider) {
        const leader = existingNodes.find((node) => node.type === 'terminal' && (node.payload as TerminalNodePayload).maestro);
        const profileId = await providerProfileService.resolveCreationProfile(provider, terminalPayload.profileId, leader?.payload as TerminalNodePayload | undefined);
        if (profileId !== null || Object.hasOwn(terminalPayload, 'profileId')) terminalPayload.profileId = profileId;
      }
    }
    const floorId = dto.floorId ?? null;
    if (floorId) {
      const floor = await floorService.get(floorId);
      if (!floor || floor.workspaceId !== dto.workspaceId || floor.status !== 'active') throw new Error('Andar não encontrado neste workspace.');
    }
    const width = dto.width ?? 560;
    const height = dto.height ?? 360;
    // An agent on a floor also shows on the ground floor, so it avoids both views.
    const occupied = floorId && isTeamAgentNode({ type: dto.type, payload })
      ? [...occupiedOnFloor(existingNodes, floorId), ...occupiedOnFloor(existingNodes, null)]
      : occupiedOnFloor(existingNodes, floorId);
    const position = dto.x === undefined || dto.y === undefined
      ? findFreeCanvasPosition(occupied, {
          x: dto.x ?? 80,
          y: dto.y ?? 80,
          width,
          height,
        })
      : { x: dto.x, y: dto.y };
    const node = await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: dto.type,
      title: dto.title,
      x: position.x,
      y: position.y,
      width,
      height,
      zIndex: dto.zIndex,
      payload,
      floorId,
    });
    if (node.type === 'terminal' && terminalExecutionRuntime(workspace, node.payload as never).kind === 'wsl') {
      await this.reprovisionBridge(workspace);
    }
    this.notifyStructureChanged(dto.workspaceId);
    return node;
  }

  async updateNode(dto: UpdateCanvasNodeDto) {
    const existing = await workspaceRepository.getNode(dto.nodeId);
    if (!existing) throw new Error('No nao encontrado.');
    let changes = dto.changes;
    if (existing.type === 'sequence') {
      const { creativeSequenceService } = await import('$lib/modules/creative-media/application/services/CreativeSequenceService.js');
      const current = await creativeSequenceService.read(existing.workspaceId, existing.id);
      if (typeof changes.title === 'string' && changes.title !== current.document.title) await creativeSequenceService.execute(existing.workspaceId, { command: 'apply', nodeId: existing.id, revision: current.revision, operations: [{ type: 'settings', title: changes.title }] }, { type: 'user' });
      changes = { ...changes, payload: undefined };
    }
    if (existing.type === 'storyboard') {
      const { creativeStoryboardService } = await import('$lib/modules/creative-media/application/services/CreativeStoryboardService.js');
      const current = (await creativeStoryboardService.read(existing.workspaceId, existing.id)).storyboard;
      if (typeof changes.title === 'string' && changes.title !== current.document.title) await creativeStoryboardService.execute(existing.workspaceId, { command: 'apply', nodeId: existing.id, revision: current.revision, operations: [{ type: 'rename', title: changes.title }] }, { type: 'user' });
      changes = { ...changes, payload: undefined };
    }
    const portalBefore = existing.type === 'portal' ? portalProfileFromPayload(existing.payload) : null;
    const portalAfter = portalBefore && changes.payload ? portalProfileFromPayload({ ...existing.payload, ...changes.payload }) : null;
    if (existing.type === 'terminal' && changes.payload) {
      const payload = { ...(changes.payload as Record<string, unknown>) };
      const currentRuntime = (existing.payload as { executionRuntime?: unknown } | null)?.executionRuntime;
      // Runtime changes must pass through changeTerminalRuntime so the PTY,
      // provider availability, resume metadata, and bridge stay consistent.
      if (currentRuntime == null) delete payload.executionRuntime;
      else payload.executionRuntime = currentRuntime;
      changes = {
        ...changes,
        payload: payload as CanvasNodePayload,
      };
    }
    const node = await workspaceRepository.updateNode(dto.nodeId, changes, { mergePortalPayload: existing.type === 'portal' });
    if (!node) throw new Error('No nao encontrado.');
    if (portalAfter && JSON.stringify(portalBefore) !== JSON.stringify(portalAfter)) {
      await autonomyPolicyService.recordSemanticEffect({ workspaceId:node.workspaceId, capability:'browser', operation:'portal:grant_changed',
        actorType:'user', target:node.id, input:{ before:portalBefore, after:portalAfter } }, { grant:portalAfter });
    }
    if (existing.type === 'design' && typeof changes.title === 'string' && node.title !== existing.title) {
      await designDocumentService.renameDocument(node.workspaceId, node.id, changes.title);
    }
    if (['note', 'document', 'image', 'design', 'codeGraph'].includes(node.type) && (changes.title !== undefined || changes.payload !== undefined)) {
      (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'knowledgeChanged', workspaceId: node.workspaceId });
    }
    return node;
  }

  private killTerminalSessions(workspaceId: string, nodeId: string, payload: Record<string, unknown>): number {
    let killed = ptySessionManager.killNode(workspaceId, nodeId);
    const provider = typeof payload.provider === 'string' ? payload.provider : null;
    const agentSessionId = typeof payload.agentSessionId === 'string' ? payload.agentSessionId : null;
    if (provider && agentSessionId) killed += ptySessionManager.killAgentSession(provider, agentSessionId, { workspaceId, nodeId });
    const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;
    const session = sessionId ? ptySessionManager.get(sessionId) : null;
    if (session && !session.exited && ptySessionManager.claimNode(session.id, workspaceId, nodeId)) {
      ptySessionManager.kill(session.id);
      killed += 1;
    }
    return killed;
  }

  /** Recarrega UM terminal: mata a sessao PTY e limpa o sessionId — o no
      recria a sessao com resume (o contexto volta, util apos suspensao ou
      atualizacao da CLI do provider). */
  async reloadNode(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId) throw new Error('No nao encontrado.');
    let payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
    const live = typeof payload.sessionId === 'string' ? ptySessionManager.get(payload.sessionId) : null;
    if (live && payload.provider === 'codex') {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (!workspace) throw new Error('Workspace nao encontrado.');
      const executionRuntime = terminalExecutionRuntime(workspace, payload as never);
      const context = executionRuntime.kind === 'wsl'
        ? await resolveWslTrackingContext({ runtime: executionRuntime, hostCwd: live.cwd, workspaceRoot: workspace.workingDir }) : null;
      const profileEnv = typeof payload.profileId === 'string'
        ? await providerProfileService.resolveEnv(payload.profileId, 'codex', { runtimeHome: context?.linuxHomePath }) : {};
      const codexHome = profileEnv.CODEX_HOME ?? (payload.env as Record<string, string> | undefined)?.CODEX_HOME
        ?? (executionRuntime.kind === 'native' ? process.env.CODEX_HOME : undefined);
      payload = await restoreAgentLaunchSelection(payload, live.transcriptCwd ?? live.cwd, {
        homeDir: live.transcriptHome ?? undefined, posixCwd: executionRuntime.kind === 'wsl',
        codexHome: codexHome && executionRuntime.kind === 'wsl' ? wslHostPath(executionRuntime.distribution, codexHome) : codexHome,
      });
    }
    this.killTerminalSessions(workspaceId, nodeId, payload);
    delete payload.sessionId;
    await workspaceRepository.updateNode(nodeId, { payload: payload as never });
    return { reloaded: true };
  }

  /** Serialize account changes so two requests cannot branch the same conversation. */
  async changeTerminalProvider(dto: ChangeTerminalProviderDto) {
    const locks = profileTransitions();
    const previous = locks.get(dto.nodeId) ?? Promise.resolve();
    const restart = { needed: false };
    const next = previous.catch(() => {}).then(() => this.changeTerminalProviderOnce(dto, restart));
    locks.set(dto.nodeId, next);
    try {
      const result = await next;
      if (locks.get(dto.nodeId) === next) locks.delete(dto.nodeId);
      if (restart.needed) {
        const { agentSessionService } = await import('./AgentSessionService.js');
        const resumed = await agentSessionService.ensure(dto.workspaceId, dto.nodeId, { requireResume: true });
        // Use the existing recovery queue/deduplication, including in Chat where
        // no canvas terminal is mounted to restart or nudge this agent.
        const { taskBoardService } = await import('./TaskBoardService.js');
        for (const task of (await taskBoardService.list(dto.workspaceId)).filter(task => task.assigneeNodeId === dto.nodeId && !['todo', 'done'].includes(task.status))) {
          await taskBoardService.recoverBlockedTask({ workspaceId: dto.workspaceId, nodeId: dto.nodeId, taskId: task.id,
            sessionId: resumed.sessionId, previousState: 'error', previousAction: 'Owner-authorized account change' });
        }
      }
      return result;
    } catch (error) {
      if (locks.get(dto.nodeId) === next) locks.delete(dto.nodeId);
      if ((error as { profileRestartRequired?: boolean }).profileRestartRequired) {
        const { agentSessionService } = await import('./AgentSessionService.js');
        await agentSessionService.ensure(dto.workspaceId, dto.nodeId, { requireResume: true }).catch(() => {
          console.warn('[profile-change] The previous conversation is preserved; its process could not restart.');
        });
      }
      throw error;
    } finally { if (locks.get(dto.nodeId) === next) locks.delete(dto.nodeId); }
  }

  /** Troca o provider preservando a identidade visual e organizacional do nó. */
  private async changeTerminalProviderOnce(dto: ChangeTerminalProviderDto, restart: { needed: boolean }) {
    const node = await workspaceRepository.getNode(dto.nodeId);
    if (!node || node.workspaceId !== dto.workspaceId || node.type !== 'terminal') {
      throw new Error('Terminal não encontrado neste workspace.');
    }
    const adapter = getAgentAdapter(dto.provider);
    const workspace = await this.get(dto.workspaceId);
    const detection = await withWorkspaceExecutionRuntime(
      terminalExecutionRuntime(workspace, node.payload as never),
      () => adapter.detect(),
    );
    const configured = node.payload as TerminalNodePayload;
    const runtime = terminalExecutionRuntime(workspace, configured);
    const customAvailable = configured.provider === adapter.id && runtime.kind === 'native' && typeof configured.command === 'string'
      && isAbsolute(configured.command) && await access(configured.command, fsConstants.X_OK).then(() => true, () => false);
    if (!detection.installed && !customAvailable) throw new Error(`${adapter.displayName} não está disponível neste dispositivo.`);
    // Validate now, but resolve the environment only at PTY spawn time. It may
    // contain credentials and therefore must never enter the persisted payload.
    if (dto.profileId) await providerProfileService.resolveEnv(dto.profileId, adapter.id);

    const current = { ...((node.payload ?? {}) as Record<string, unknown>) };
    const sameProvider = current.provider === adapter.id;
    if (sameProvider && (current.profileId ?? null) === (dto.profileId ?? null)) return node;
    const storedSession = typeof current.sessionId === 'string' ? ptySessionManager.get(current.sessionId) : null;
    if (storedSession && ((storedSession.workspaceId && storedSession.workspaceId !== dto.workspaceId)
      || (storedSession.nodeId && storedSession.nodeId !== node.id))) throw new Error('PROFILE_SESSION_OWNERSHIP_CONFLICT');
    const candidates = ptySessionManager.listLiveForNode(dto.workspaceId, node.id).filter(session =>
      session.provider === current.provider && (session.profileId ?? null) === (current.profileId ?? null));
    if (!storedSession && candidates.length > 1) throw new Error('PROFILE_SESSION_CHANGED');
    const session = storedSession ?? candidates[0] ?? null;
    if (sameProvider && adapter.supportsProfileSessionTransfer && storedSession
      && (storedSession.provider !== current.provider || (storedSession.profileId ?? null) !== (current.profileId ?? null))) throw new Error('PROFILE_SESSION_CHANGED');
    const conversationId = session?.agentSessionId ?? (typeof current.agentSessionId === 'string' ? current.agentSessionId : null);
    const preserving = sameProvider && adapter.supportsProfileSessionTransfer && conversationId;
    if (sameProvider && session && ptySessionManager.hasUnsubmittedOwnerInput(session.id)) throw new Error('PROFILE_SESSION_OWNER_DRAFT');
    let transfer: { commit: () => Promise<void> } | null = null;
    if (preserving) {
      const runtime = terminalExecutionRuntime(workspace, current as TerminalNodePayload);
      const floor = node.floorId ? await floorService.get(node.floorId) : null;
      const hostCwd = floor?.path ?? workspace.workingDir;
      const context = runtime.kind === 'wsl'
        ? await resolveWslTrackingContext({ runtime, hostCwd, workspaceRoot: workspace.workingDir }) : null;
      const cwd = context?.linuxWorkingDir ?? hostCwd;
      const previousEnv = typeof current.profileId === 'string'
        ? await providerProfileService.resolveEnv(current.profileId, adapter.id, { runtimeHome: context?.linuxHomePath }) : {};
      const nextEnv = dto.profileId
        ? await providerProfileService.resolveEnv(dto.profileId, adapter.id, { runtimeHome: context?.linuxHomePath }) : {};
      const baseEnv = { ...(runtime.kind === 'native' ? process.env : {}), ...(current.env as Record<string, string> | undefined) };
      const mapPath = runtime.kind === 'wsl' ? (path: string) => wslHostPath(runtime.distribution, path) : null;
      const sourceRoots = { ...agentStorageRoots({ ...baseEnv, ...previousEnv }, cwd, mapPath),
        ...(session && !session.exited ? ptySessionManager.transcriptStorageRoots(session.id) : {}) };
      const targetPayloadEnv = { ...(current.env as Record<string, string> | undefined) };
      if (adapter.profileStrategy.kind === 'configDir') delete targetPayloadEnv[adapter.profileStrategy.envVar];
      const targetRoots = agentStorageRoots({ ...(runtime.kind === 'native' ? process.env : {}), ...targetPayloadEnv, ...nextEnv }, cwd, mapPath);
      transfer = await profileSessionContinuityService.prepare({ sessionId: conversationId!, cwd,
        posixCwd: runtime.kind === 'wsl', homeDir: context?.homeHostPath,
        sourceRoot: sourceRoots.claudeConfigDir, targetRoot: targetRoots.claudeConfigDir });
    }
    const wasLive = Boolean(session && !session.exited);
    restart.needed = Boolean(wasLive && preserving);
    const exited = preserving && session ? ptySessionManager.whenExited(session.id) : Promise.resolve();
    this.killTerminalSessions(dto.workspaceId, node.id, current);
    try {
      await exited;
      await transfer?.commit();
      const latest = await workspaceRepository.getNode(node.id);
      const latestPayload = (latest?.payload ?? {}) as Record<string, unknown>;
      if (!latest || latest.workspaceId !== dto.workspaceId || latestPayload.provider !== current.provider
        || (latestPayload.profileId ?? null) !== (current.profileId ?? null)
        || (latestPayload.agentSessionId ?? null) !== (current.agentSessionId ?? null)) throw new Error('PROFILE_SESSION_CHANGED');
      const command = adapter.interactiveCommand();
      const env = { ...(sameProvider ? latestPayload.env as Record<string, string> | undefined : {}), ...command.env };
      if (sameProvider) {
        for (const key of adapter.profileAuthenticationEnvKeys ?? []) delete env[key];
        if (adapter.profileStrategy.kind === 'configDir') delete env[adapter.profileStrategy.envVar];
      }
      let payload: Record<string, unknown> = {
        ...latestPayload,
        provider: adapter.id,
        profileId: dto.profileId,
        command: sameProvider && typeof latestPayload.command === 'string' ? latestPayload.command : command.command,
        args: sameProvider && Array.isArray(latestPayload.args) ? [...latestPayload.args] : [...command.args],
        ...(Object.keys(env).length ? { env } : {}),
      };
      delete payload.sessionId;
      if (preserving) { payload.agentSessionId = conversationId; payload.resumeRecovery = false; }
      else delete payload.agentSessionId;
      if (!Object.keys(env).length) delete payload.env;
      if (!dto.profileId) delete payload.profileId;
      const roleName = typeof payload.role === 'string' ? payload.role : null;
      const role = roleName ? await roleService.launchContext(dto.workspaceId, roleName).catch(() => null) : null;
      payload = materializeInteractiveAgentCommand(payload, role).payload;
      if (sameProvider && typeof latestPayload.command === 'string') payload.command = latestPayload.command;

      const updated = await workspaceRepository.updateNode(node.id, { payload: payload as never });
      this.notifyStructureChanged(dto.workspaceId);
      return updated;
    } catch (error) {
      // Restart only after this transition has rejected, so wake requests cannot
      // race the copy or deadlock awaiting their own profile change.
      if (wasLive && error instanceof Error && error.message !== 'PROFILE_SESSION_STOP_TIMEOUT') {
        Object.assign(error, { profileRestartRequired: true });
      }
      throw error;
    }
  }

  async changeTerminalRuntime(dto: ChangeTerminalRuntimeDto) {
    const [workspace, node] = await Promise.all([
      this.get(dto.workspaceId),
      workspaceRepository.getNode(dto.nodeId),
    ]);
    if (!node || node.workspaceId !== dto.workspaceId || node.type !== 'terminal') {
      throw new Error('Terminal não encontrado neste workspace.');
    }
    const executionRuntime = await resolveTerminalRuntimeOverride({
      mode: dto.mode,
      workingDir: workspace.workingDir,
      wslDistribution: dto.wslDistribution,
      wslWorkingDir: dto.wslWorkingDir,
    });
    const payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
    const currentRuntime = terminalExecutionRuntime(workspace, node.payload as never);
    const nextRuntime = executionRuntime ?? workspaceExecutionRuntime(workspace);
    const provider = typeof payload.provider === 'string' ? payload.provider : null;
    if (provider) {
      const adapter = getAgentAdapter(provider);
      const detection = await withWorkspaceExecutionRuntime(nextRuntime, () => adapter.detect());
      if (!detection.installed) {
        throw new Error(`${adapter.displayName} não está disponível no ambiente selecionado.`);
      }
    }
    if (executionRuntimeKey(currentRuntime) !== executionRuntimeKey(nextRuntime)) {
      this.killTerminalSessions(dto.workspaceId, node.id, payload);
      delete payload.sessionId;
      delete payload.agentSessionId;
      payload.resumeRecovery = false;
    }
    if (executionRuntime) payload.executionRuntime = executionRuntime;
    else delete payload.executionRuntime;

    const updated = await workspaceRepository.updateNode(node.id, { payload: payload as never });
    if (!updated) throw new Error('Terminal não encontrado neste workspace.');
    await this.reprovisionBridge(workspace);
    this.notifyStructureChanged(dto.workspaceId);
    return updated;
  }

  async deleteNode(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId) throw new Error('No nao encontrado.');
    if (node.type === 'videoWorkflow') {
      const { creativeMediaRepository } = await import('$lib/modules/creative-media/infrastructure/repositories/CreativeMediaRepository.js');
      if (await creativeMediaRepository.activeForNodes(workspaceId, [nodeId])) throw new Error('creative_workflow_busy');
      await creativeMediaRepository.removeWorkflow(workspaceId, nodeId);
    }
    // Nota vinculada a tarefa do quadro NAO apaga pelo X do canvas: ela so sai
    // de verdade junto com a tarefa (ou quando desvinculada).
    if (node.type === 'note') {
      const linked = await AgentBoardTask.query().where('workspace_id', workspaceId).where('note_node_id', nodeId).get();
      if (linked.length > 0) {
        const titles = linked.map((task) => `"${task.getAttribute('title')}"`).join(', ');
        throw new Error(`Esta nota esta vinculada a ${linked.length === 1 ? 'tarefa' : 'tarefas'} do quadro: ${titles}. Desvincule ou apague a tarefa.`);
      }
    }
    if (node.type === 'device') {
      await (globalThis as typeof globalThis & {
        __orkestraiStopWorkspaceDevice?: (targetWorkspaceId: string) => Promise<void>;
      }).__orkestraiStopWorkspaceDevice?.(workspaceId).catch(() => undefined);
    }
    if (node.type === 'computer') await computerService.removeEvidence(workspaceId).catch(() => undefined);
    if (node.type === 'terminal') {
      this.killTerminalSessions(workspaceId, nodeId, { ...((node.payload ?? {}) as Record<string, unknown>) });
    }
    if (node.type === 'design') await designDocumentService.remove(workspaceId, nodeId);
    if (node.type === 'sequence') {
      const { creativeSequenceService } = await import('$lib/modules/creative-media/application/services/CreativeSequenceService.js');
      const current = await creativeSequenceService.read(workspaceId, nodeId);
      await creativeSequenceService.execute(workspaceId, { command: 'remove', nodeId, revision: current.revision }, { type: 'user' });
    }
    if (node.type === 'storyboard') {
      const { creativeStoryboardRepository } = await import('$lib/modules/creative-media/infrastructure/repositories/CreativeStoryboardRepository.js');
      await creativeStoryboardRepository.remove(workspaceId, nodeId);
    }
    await Connection.transaction(() => workspaceRepository.deleteNode(nodeId));
    await attentionService.resolveNode(workspaceId, nodeId).catch(() => 0);
    if (node.type === 'terminal') {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (workspace) await this.reprovisionBridge(workspace);
      await agentLearningService.settlePending(workspaceId, nodeId).catch(() => 0);
    }
    this.notifyStructureChanged(workspaceId);
    return { deleted: true };
  }

  // -- Arestas ---------------------------------------------------------------

  async listEdges(workspaceId: string) {
    await this.get(workspaceId);
    return workspaceRepository.listEdges(workspaceId);
  }

  async createEdge(dto: CreateCanvasEdgeDto) {
    const workspace = await this.get(dto.workspaceId);
    const [source, target] = await Promise.all([
      workspaceRepository.getNode(dto.sourceNodeId),
      workspaceRepository.getNode(dto.targetNodeId),
    ]);
    if (!source || source.workspaceId !== dto.workspaceId) throw new Error('No de origem nao encontrado.');
    if (!target || target.workspaceId !== dto.workspaceId) throw new Error('No de destino nao encontrado.');
    const edge = await workspaceRepository.createEdge({
      workspaceId: dto.workspaceId,
      sourceNodeId: dto.sourceNodeId,
      targetNodeId: dto.targetNodeId,
      style: dto.style,
    });

    // Conexao com terminal => provisiona a skill da ponte nos agentes.
    if (source.type === 'terminal' || target.type === 'terminal') {
      const token = await bridgeService.getOrCreateToken(workspace.id).catch(() => null);
      if (token) await bridgeService.provisionSkill(workspace, token, (await this.preferredBridgeRuntime(workspace)) ?? undefined);
    }

    this.notifyStructureChanged(dto.workspaceId);
    return edge;
  }

  async updateEdge(dto: UpdateCanvasEdgeDto) {
    const edge = await workspaceRepository.updateEdgeStyle(dto.edgeId, dto.style);
    if (!edge) throw new Error('Aresta nao encontrada.');
    return edge;
  }

  async deleteEdge(workspaceId: string, edgeId: string) {
    const edges = await workspaceRepository.listEdges(workspaceId);
    if (!edges.some((edge) => edge.id === edgeId)) throw new Error('Aresta nao encontrada.');
    await workspaceRepository.deleteEdge(edgeId);
    this.notifyStructureChanged(workspaceId);
    return { deleted: true };
  }

  /** Exporta o workspace completo (definicao + nos + arestas) como JSON. */
  async exportWorkspace(id: string) {
    const workspace = await this.get(id);
    const [nodes, edges] = await Promise.all([
      workspaceRepository.listNodes(id),
      workspaceRepository.listEdges(id),
    ]);
    return {
      format: 'orkestrai-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace: {
        name: workspace.name,
        workingDir: workspace.workingDir,
        runtimeKind: workspace.runtimeKind,
        wslDistribution: workspace.wslDistribution,
        wslWorkingDir: workspace.wslWorkingDir,
        icon: workspace.icon,
        instructions: workspace.instructions,
        syncAgentInstructionFiles: workspace.syncAgentInstructionFiles,
        codeIntelligenceMode: workspace.codeIntelligenceMode,
        hooks: workspace.hooks,
      },
      nodes: nodes.map((node) => ({
        type: node.type,
        title: node.title,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
        payload: node.payload,
      })),
      edges: edges.map((edge) => ({
        sourceIndex: nodes.findIndex((node) => node.id === edge.sourceNodeId),
        targetIndex: nodes.findIndex((node) => node.id === edge.targetNodeId),
        style: edge.style,
      })),
    };
  }

  /** Importa um workspace exportado (novo id; workingDir pode ser sobrescrito). */
  async importWorkspace(data: unknown, workingDirOverride?: string) {
    const parsed = data as {
      format?: string;
      workspace?: { name: string; workingDir: string; runtimeKind?: 'native' | 'wsl'; wslDistribution?: string | null; wslWorkingDir?: string | null; icon?: string | null; instructions?: string | null; syncAgentInstructionFiles?: boolean; codeIntelligenceMode?: 'assisted' | 'manual' | 'disabled'; hooks?: object };
      nodes?: Array<{ type: string; title?: string | null; x?: number; y?: number; width?: number; height?: number; zIndex?: number; payload?: object }>;
      edges?: Array<{ sourceIndex: number; targetIndex: number; style?: 'cord' | 'circuit' }>;
    };
    if (parsed.format !== 'orkestrai-workspace' || !parsed.workspace) {
      throw new Error('Arquivo nao e um workspace do Orkestrai (format: orkestrai-workspace).');
    }
    const info = parsed.workspace;
    const workingDir = workingDirOverride ?? info.workingDir;
    const workspace = await this.create(new CreateWorkspaceDto(
      `${info.name} (importado)`,
      workingDir,
      info.icon ?? null,
      info.instructions ?? null,
      info.runtimeKind ?? 'native',
      info.wslDistribution ?? null,
      info.wslWorkingDir ?? null,
      false,
      {},
      [],
      null,
      info.codeIntelligenceMode ?? 'assisted',
    ));
    if (info.syncAgentInstructionFiles || info.hooks) {
      await workspaceRepository.updateWorkspace(workspace.id, {
        syncAgentInstructionFiles: info.syncAgentInstructionFiles,
        hooks: (info.hooks as never) ?? {},
      });
    }

    const nodeIds: string[] = [];
    for (const node of parsed.nodes ?? []) {
      // Sessoes PTY nao viajam: terminais importados reiniciam limpos.
      const payload = { ...(node.payload as Record<string, unknown>) };
      delete payload.sessionId;
      const created = await workspaceRepository.createNode({
        workspaceId: workspace.id,
        type: node.type as never,
        title: node.title ?? null,
        x: node.x ?? 0,
        y: node.y ?? 0,
        width: node.width ?? 560,
        height: node.height ?? 360,
        zIndex: node.zIndex ?? 0,
        payload,
      });
      nodeIds.push(created.id);
    }
    for (const edge of parsed.edges ?? []) {
      const source = nodeIds[edge.sourceIndex];
      const target = nodeIds[edge.targetIndex];
      if (source && target) {
        await workspaceRepository.createEdge({
          workspaceId: workspace.id,
          sourceNodeId: source,
          targetNodeId: target,
          style: edge.style ?? 'cord',
        });
      }
    }
    return workspace;
  }

  /**
   * Descarrega o workspace: mata todas as sessoes PTY dos seus terminais e
   * limpa os sessionIds, liberando processos sem perder o layout.
   */
  async unloadWorkspace(id: string) {
    const workspace = await workspaceRepository.setWorkspaceSuspended(id, true);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    const result = await this.unloadWorkspaceSessions(id);
    this.notifyStructureChanged(id);
    return { ...result, workspace };
  }

  private async unloadWorkspaceSessions(id: string) {
    const nodes = await workspaceRepository.listNodes(id);
    let killed = ptySessionManager.killWorkspace(id);
    for (const node of nodes) {
      if (node.type !== 'terminal') continue;
      const payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
      killed += this.killTerminalSessions(id, node.id, payload);
      const next = { ...payload };
      delete next.sessionId;
      await workspaceRepository.updateNode(node.id, { payload: next as never });
    }
    return { unloaded: true, killedSessions: killed };
  }

  // -- Internos ----------------------------------------------------------------

  private async preferredBridgeRuntime(workspace: Workspace) {
    const workspaceRuntime = workspaceExecutionRuntime(workspace);
    if (workspaceRuntime.kind === 'wsl') return workspaceRuntime;
    const nodes = await workspaceRepository.listNodes(workspace.id);
    for (const node of nodes) {
      if (node.type !== 'terminal') continue;
      const runtime = terminalExecutionRuntime(workspace, node.payload as never);
      if (runtime.kind === 'wsl') return runtime;
    }
    return undefined;
  }

  private async reprovisionBridge(workspace: Workspace): Promise<void> {
    const token = await bridgeService.getOrCreateToken(workspace.id).catch(() => null);
    if (!token) return;
    await bridgeService.provisionSkill(
      workspace,
      token,
      (await this.preferredBridgeRuntime(workspace)) ?? { kind: 'native' },
    );
    this.provisionChecked.add(workspace.id);
  }

  private async normalizeTerminalPayloadRuntime(
    workspace: Workspace,
    input: CanvasNodePayload | undefined,
  ): Promise<CanvasNodePayload | undefined> {
    if (!input) return input;
    const payload = { ...(input as Record<string, unknown>) };
    if (Object.prototype.hasOwnProperty.call(payload, 'executionRuntime')) {
      const requested = payload.executionRuntime;
      if (requested == null) {
        delete payload.executionRuntime;
      } else {
        if (typeof requested !== 'object' || !('kind' in requested)) {
          throw new Error('Ambiente de execução inválido para o terminal.');
        }
        const runtime = requested as { kind?: string; distribution?: string; linuxWorkingDir?: string };
        if (runtime.kind !== 'native' && runtime.kind !== 'wsl') {
          throw new Error('Ambiente de execução inválido para o terminal.');
        }
        payload.executionRuntime = await resolveTerminalRuntimeOverride({
          mode: runtime.kind,
          workingDir: workspace.workingDir,
          wslDistribution: runtime.distribution,
          wslWorkingDir: runtime.linuxWorkingDir,
        });
      }
    }
    this.normalizeTerminalShell(workspace, payload);
    return payload;
  }

  private normalizeTerminalShell(workspace: Workspace, payload: Record<string, unknown>): boolean {
    if (typeof payload.provider === 'string' && payload.provider.trim()) return false;
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    const unavailableLegacyDefault = process.platform !== 'win32'
      && command === '/bin/zsh'
      && !existsSync(command);
    if (command && !unavailableLegacyDefault) return false;

    const runtime = terminalExecutionRuntime(workspace, payload as never);
    payload.command = defaultShell({ preferWsl: runtime.kind === 'wsl' });
    return true;
  }

  private assertWorkingDir(dir: string): string {
    const resolved = resolve(dir.trim());
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`Diretorio de trabalho nao existe: ${resolved}`);
    }
    return resolved;
  }

  private assertRepositoryRoots(roots: WorkspaceRepositoryRoot[] | undefined): WorkspaceRepositoryRoot[] {
    const paths = new Set<string>();
    const aliases = new Set<string>();
    return (roots ?? []).map((root) => {
      const alias = root.alias.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(alias)) throw new Error(`Invalid repository alias: ${root.alias}`);
      if (aliases.has(alias)) throw new Error(`Repository alias is registered more than once: @${alias}`);
      aliases.add(alias);
      const path = realpathSync(resolve(root.path.trim()));
      if (!statSync(path).isDirectory()) throw new Error(`Additional repository is not a directory: ${path}`);
      if (paths.has(path)) throw new Error(`Additional repository is registered more than once: ${path}`);
      paths.add(path);
      return { alias, path };
    });
  }

  /** Keeps workspace instructions in a bounded block without replacing user files. */
  private writeInstructionFiles(workspace: Workspace, legacyInstructions?: string | null) {
    const instructions = workspace.instructions?.trim() || null;
    try {
      const agentsPath = resolve(workspace.workingDir, 'AGENTS.md');
      const currentAgents = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
      const nextAgents = mergeInstructionFile(currentAgents, instructions, legacyInstructions?.trim() || null);
      if (nextAgents !== currentAgents) writeFileSync(agentsPath, nextAgents);

      const claudePath = resolve(workspace.workingDir, 'CLAUDE.md');
      const currentClaude = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
      const nextClaude = mergeInstructionFile(
        currentClaude,
        workspace.syncAgentInstructionFiles ? instructions : null,
        legacyInstructions?.trim() || null,
      );
      if (nextClaude !== currentClaude) writeFileSync(claudePath, nextClaude);
    } catch {
      // Diretorio sem permissao de escrita nao bloqueia o workspace.
    }
  }
}

export const workspaceService = new WorkspaceService();
