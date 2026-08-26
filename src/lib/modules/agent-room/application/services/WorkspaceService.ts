import { constants as fsConstants, existsSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { posix, resolve } from 'node:path';
import type { CanvasNodePayload, Workspace, WorkspaceRepositoryRoot } from '../../domain/types.js';
import { executionRuntimeKey } from '../../domain/runtime.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentSessionTracker, agentSessionTrackerForRuntime } from '../../infrastructure/pty/AgentSessionTracker.ts';
import { bridgeService } from './BridgeService.js';
import { designDocumentService } from './DesignDocumentService.js';
import { roleService } from './RoleService.js';
import { providerProfileService } from './ProviderProfileService.js';
import { floorService } from './FloorService.js';
import { controlCenterService } from './ControlCenterService.js';
import { workspaceGroupService } from './WorkspaceGroupService.js';
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
  workspaceExecutionRuntime,
} from '../../infrastructure/WslRuntime.js';

type WorkspaceProvisionState = {
  checked: Set<string>;
  inFlight: Map<string, Promise<void>>;
};

const WORKSPACE_PROVISION_STATE = Symbol.for('orkestrai.workspaceProvisionState');

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
    const cliRuntime = process.env.ORKESTRAI_CLI_RUNTIME ?? process.execPath;
    const cliEntry = process.env.ORKESTRAI_CLI_JS ?? resolve(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js');
    const [skillCurrent, hasConfig, agentsMdCurrent, hasWslLauncher] = await Promise.all([
      readFile(skillPath, 'utf8').then((content) => content === bridgeService.bridgeSkillContent()).catch(() => false),
      access(resolve(workspace.workingDir, '.orkestrai', 'workspace.json')).then(() => true).catch(() => false),
      readFile(resolve(workspace.workingDir, 'AGENTS.md'), 'utf8').catch(() => ''),
      bridgeRuntime?.kind === 'wsl'
        ? readFile(resolve(workspace.workingDir, '.orkestrai', 'bin', 'orkestrai'), 'utf8')
            .then((content) => content.includes(cliRuntime) && content.includes(cliEntry))
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
    if (runtimeChanged || repositoryRootsChanged) this.provisionChecked.delete(id);
    this.writeInstructionFiles(workspace);
    if (runtimeChanged || repositoryRootsChanged) await this.reprovisionBridge(workspace);
    else await this.ensureProvisioned(workspace);
    return workspace;
  }

  async remove(id: string) {
    ptySessionManager.killWorkspace(id);
    await controlCenterService.settleWorkspace(id);
    const deleted = await workspaceRepository.deleteWorkspace(id);
    if (!deleted) throw new Error('Workspace nao encontrado.');
    return { deleted: true };
  }

  // -- Nos -----------------------------------------------------------------

  async listNodes(workspaceId: string) {
    const workspace = await this.get(workspaceId);
    const nodes = await workspaceRepository.listNodes(workspaceId);
    return Promise.all(nodes.map(async (node) => {
      if (node.type !== 'terminal') return node;
      let payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
      const executionRuntime = terminalExecutionRuntime(workspace, payload as never);
      let changed = false;
      const storedSessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;
      const storedPty = storedSessionId ? ptySessionManager.get(storedSessionId) : null;
      if (storedSessionId && (!storedPty || storedPty.exited)) {
        delete payload.sessionId;
        // A PTY e efemera. Sem um agentSessionId confirmado no storage da CLI,
        // tentar --last/--continue e especulativo e falha em conversas vazias.
        // O renderer inicia uma conversa limpa; ids confirmados seguem pelo
        // resume exato, tanto no Windows quanto dentro do WSL.
        payload.resumeRecovery = false;
        changed = true;
      }
      const agentSessionId = typeof payload.agentSessionId === 'string' ? payload.agentSessionId : null;
      const provider = typeof payload.provider === 'string' ? payload.provider : null;
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
          let trackingCwd = workspace.workingDir;
          if (executionRuntime.kind === 'wsl') {
            const floor = node.floorId ? await floorService.get(node.floorId) : null;
            const hostCwd = floor?.path ?? workspace.workingDir;
            const context = await resolveWslTrackingContext({ runtime: executionRuntime, hostCwd, workspaceRoot: workspace.workingDir });
            tracker = agentSessionTrackerForRuntime(
              `${executionRuntime.distribution}:${context.homeHostPath}`,
              context.homeHostPath,
              (candidate) => posix.normalize(candidate),
            );
            trackingCwd = context.linuxWorkingDir;
          }
          resumable = tracker.isAgentSessionResumable(
            getAgentAdapter(provider).sessionStorage,
            trackingCwd,
            agentSessionId,
          );
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
    if (dto.type === 'device') {
      const existing = (await workspaceRepository.listNodes(dto.workspaceId)).find((node) => node.type === 'device');
      if (existing) return existing;
    }
    const payload = dto.type === 'terminal'
      ? await this.normalizeTerminalPayloadRuntime(workspace, dto.payload)
      : dto.payload;
    if (dto.type === 'terminal') {
      const terminalPayload = (payload ?? {}) as Record<string, unknown>;
      const profileId = typeof terminalPayload.profileId === 'string' ? terminalPayload.profileId : null;
      const provider = typeof terminalPayload.provider === 'string' ? terminalPayload.provider : null;
      if (profileId && !provider) throw new Error('A provider profile requires an agent provider.');
      if (profileId && provider) await providerProfileService.assertCompatible(profileId, provider);
    }
    const node = await workspaceRepository.createNode({
      workspaceId: dto.workspaceId,
      type: dto.type,
      title: dto.title,
      x: dto.x,
      y: dto.y,
      width: dto.width,
      height: dto.height,
      zIndex: dto.zIndex,
      payload,
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
    const node = await workspaceRepository.updateNode(dto.nodeId, changes);
    if (!node) throw new Error('No nao encontrado.');
    if (existing.type === 'design' && typeof changes.title === 'string' && node.title !== existing.title) {
      await designDocumentService.renameDocument(node.workspaceId, node.id, changes.title);
    }
    return node;
  }

  /** Recarrega UM terminal: mata a sessao PTY e limpa o sessionId — o no
      recria a sessao com resume (o contexto volta, util apos suspensao ou
      atualizacao da CLI do provider). */
  async reloadNode(workspaceId: string, nodeId: string) {
    const node = await workspaceRepository.getNode(nodeId);
    if (!node || node.workspaceId !== workspaceId) throw new Error('No nao encontrado.');
    const payload = { ...((node.payload ?? {}) as Record<string, unknown>) };
    const sessionId = payload.sessionId as string | undefined;
    if (sessionId) ptySessionManager.kill(sessionId);
    delete payload.sessionId;
    await workspaceRepository.updateNode(nodeId, { payload: payload as never });
    return { reloaded: true };
  }

  /** Troca o provider preservando a identidade visual e organizacional do nó. */
  async changeTerminalProvider(dto: ChangeTerminalProviderDto) {
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
    if (!detection.installed) throw new Error(`${adapter.displayName} não está disponível neste dispositivo.`);
    // Validate now, but resolve the environment only at PTY spawn time. It may
    // contain credentials and therefore must never enter the persisted payload.
    if (dto.profileId) await providerProfileService.resolveEnv(dto.profileId, adapter.id);

    const current = { ...((node.payload ?? {}) as Record<string, unknown>) };
    const sessionId = typeof current.sessionId === 'string' ? current.sessionId : null;
    if (sessionId) ptySessionManager.kill(sessionId);
    const command = adapter.interactiveCommand();
    const env = { ...command.env };
    let payload: Record<string, unknown> = {
      ...current,
      provider: adapter.id,
      profileId: dto.profileId,
      command: command.command,
      args: [...command.args],
      ...(Object.keys(env).length ? { env } : {}),
    };
    delete payload.sessionId;
    delete payload.agentSessionId;
    if (!Object.keys(env).length) delete payload.env;
    if (!dto.profileId) delete payload.profileId;
    const roleName = typeof payload.role === 'string' ? payload.role : null;
    const role = roleName ? await roleService.launchContext(dto.workspaceId, roleName).catch(() => null) : null;
    payload = materializeInteractiveAgentCommand(payload, role).payload;

    const updated = await workspaceRepository.updateNode(node.id, { payload: payload as never });
    this.notifyStructureChanged(dto.workspaceId);
    return updated;
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
      const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null;
      if (sessionId) ptySessionManager.kill(sessionId);
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
    if (node.type === 'design') await designDocumentService.remove(workspaceId, nodeId);
    await workspaceRepository.deleteNode(nodeId);
    if (node.type === 'terminal') {
      const workspace = await workspaceRepository.getWorkspace(workspaceId);
      if (workspace) await this.reprovisionBridge(workspace);
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
      workspace?: { name: string; workingDir: string; runtimeKind?: 'native' | 'wsl'; wslDistribution?: string | null; wslWorkingDir?: string | null; icon?: string | null; instructions?: string | null; syncAgentInstructionFiles?: boolean; hooks?: object };
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
    await this.get(id);
    return this.unloadWorkspaceSessions(id);
  }

  private async unloadWorkspaceSessions(id: string) {
    const nodes = await workspaceRepository.listNodes(id);
    let killed = 0;
    for (const node of nodes) {
      const payload = node.payload as { sessionId?: string };
      if (!payload.sessionId) continue;
      ptySessionManager.kill(payload.sessionId);
      const next = { ...payload };
      delete next.sessionId;
      await workspaceRepository.updateNode(node.id, { payload: next });
      killed += 1;
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
    if (!input || !Object.prototype.hasOwnProperty.call(input, 'executionRuntime')) return input;
    const payload = { ...(input as Record<string, unknown>) };
    const requested = payload.executionRuntime;
    if (requested == null) {
      delete payload.executionRuntime;
      return payload;
    }
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
    return payload;
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

  /**
   * Escreve AGENTS.md com as instrucoes do workspace no working_dir.
   * Com syncAgentInstructionFiles, espelha em CLAUDE.md (Claude Code so le
   * CLAUDE.md; os demais agentes padronizaram AGENTS.md).
   */
  private writeInstructionFiles(workspace: Workspace) {
    const instructions = workspace.instructions?.trim();
    if (!instructions) return;
    try {
      writeFileSync(resolve(workspace.workingDir, 'AGENTS.md'), `${instructions}\n`);
      if (workspace.syncAgentInstructionFiles) {
        writeFileSync(resolve(workspace.workingDir, 'CLAUDE.md'), `${instructions}\n`);
      }
    } catch {
      // Diretorio sem permissao de escrita nao bloqueia o workspace.
    }
  }
}

export const workspaceService = new WorkspaceService();
