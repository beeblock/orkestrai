import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, win32 } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import type { Floor, HookCommand, Workspace, WorkspaceHooks } from '../../domain/types.js';
import { AgentFloor } from '../../domain/models/AgentFloor.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.ts';
import { agentEnv, IS_WIN } from '../../infrastructure/agent-path.js';
import { buildWorkspaceRuntimeLaunch, guestWorkingDirectory, workspaceExecutionRuntime } from '../../infrastructure/WslRuntime.js';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 60_000;

export type FloorAudit = {
  floorId: string; name: string; branch: string; path: string;
  target: string; merged: boolean; safeToRemove: boolean;
  blockers: string[]; revision: string; head: string | null;
  integration: 'ancestor' | 'patch_equivalent' | 'diverged' | 'unknown';
  changes: { tracked: number; untracked: number; ignored: number; samples: string[]; truncated: boolean };
};

/** Shared process budget: opening several panels must not spawn hundreds of Git processes. */
const gitSlots: Array<() => void> = [];
let activeGit = 0;
export async function withFloorGitSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeGit >= 4) await new Promise<void>((resume) => gitSlots.push(resume));
  else activeGit++;
  try { return await run(); }
  finally {
    const next = gitSlots.shift();
    if (next) next();
    else activeGit--;
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapFloor(model: AgentFloor): Floor {
  return {
    id: model.getAttribute('id'),
    workspaceId: model.getAttribute('workspace_id'),
    name: model.getAttribute('name'),
    branch: model.getAttribute('branch'),
    path: model.getAttribute('path'),
    status: model.getAttribute('status'),
    createdAt: toIso(model.getAttribute('created_at')),
    updatedAt: toIso(model.getAttribute('updated_at')),
  };
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'andar'
  );
}

/**
 * Andares via git worktree: cada andar e um checkout isolado do repo do
 * workspace em `.orkestrai/floors/<slug>` com sua propria branch.
 * Aterrissagem = merge da branch do andar de volta no checkout principal.
 */
/** Avisa o canvas para recarregar o workspace (via broadcast WS global). */
function notifyWorkspaceChanged(workspaceId: string) {
  const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
  broadcast?.({ type: 'workspaceChanged', workspaceId });
}

export class FloorService {
  private mutations = new Set<string>();
  private audits = new Map<string, Promise<FloorAudit[]>>();

  private async exclusive<T>(workspaceId: string, run: () => Promise<T>): Promise<T> {
    const workspace = await this.workspace(workspaceId);
    const key = await realpath(workspace.workingDir);
    if (this.mutations.has(key)) throw new Error('Outra operacao de andar esta em andamento neste repositorio.');
    this.mutations.add(key);
    try { return await run(); } finally { this.mutations.delete(key); }
  }

  async requireFloor(workspaceId: string, id: string): Promise<Floor> {
    const floor = await this.get(id);
    if (!floor || floor.workspaceId !== workspaceId) throw new Error('Andar nao encontrado neste workspace.');
    return floor;
  }

  private async workspace(workspaceId: string): Promise<Workspace> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace nao encontrado.');
    return workspace;
  }

  private async git(workspace: Workspace, cwd: string, args: string[]): Promise<string> {
    const launch = buildWorkspaceRuntimeLaunch({ workspace, command: 'git', args, hostCwd: cwd, hostEnv: agentEnv() });
    const { stdout } = await withFloorGitSlot(() => execFileAsync(launch.command, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    }));
    return stdout;
  }

  private async assertRepo(workspace: Workspace) {
    try {
      await this.git(workspace, workspace.workingDir, ['rev-parse', '--is-inside-work-tree']);
    } catch {
      throw new Error('O diretorio do workspace nao e um repositorio git.');
    }
    // Os worktrees vivem em .orkestrai/floors dentro do repo; exclui localmente
    // (info/exclude) para o andar nao sujar o status do checkout principal.
    try {
      const { appendFileSync, existsSync, readFileSync } = await import('node:fs');
      const excludePath = resolve(workspace.workingDir, '.git', 'info', 'exclude');
      const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
      if (!current.includes('.orkestrai')) {
        appendFileSync(excludePath, '\n.orkestrai/\n');
      }
    } catch {
      // exclude e conveniencia; nao bloqueia
    }
  }

  async list(workspaceId: string): Promise<Floor[]> {
    const rows = await AgentFloor.query()
      .where('workspace_id', workspaceId)
      .whereIn('status', ['active', 'landed', 'deleted'])
      .orderBy('created_at', 'asc')
      .get();
    // Legacy versions marked floors landed/deleted even when removal failed.
    // Async, bounded probes also avoid blocking PTY input on slow WSL/UNC paths.
    const floors = rows.map(mapFloor);
    const visible = await Promise.all(floors.map((floor) => floor.status === 'active'
      ? true : withFloorGitSlot(() => access(floor.path).then(() => true, () => false))));
    return floors.filter((_, index) => visible[index]);
  }

  /** One bounded native audit, instead of one model/tool round trip per Git check. No hooks or writes. */
  async audit(workspaceId: string): Promise<FloorAudit[]> {
    const existing = this.audits.get(workspaceId);
    if (existing) return existing;
    const pending = this.loadAudit(workspaceId).finally(() => {
      if (this.audits.get(workspaceId) === pending) this.audits.delete(workspaceId);
    });
    this.audits.set(workspaceId, pending);
    return pending;
  }

  private async loadAudit(workspaceId: string): Promise<FloorAudit[]> {
    const workspace = await this.workspace(workspaceId);
    const [floors, context] = await Promise.all([this.list(workspaceId), this.auditContext(workspace)]);
    return Promise.all(floors.map((floor) => this.inspectFloor(floor, workspace, context)));
  }

  private async auditContext(workspace: Workspace) {
    const [target, targetHead, nodes, tasks] = await Promise.all([
      this.currentBranch(workspace),
      this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', 'HEAD']),
      workspaceRepository.listNodes(workspace.id),
      AgentBoardTask.query().where('workspace_id', workspace.id).whereNull('archived_at').where('status', '!=', 'done').get(),
    ]);
    return { target, targetHead: targetHead.trim(), nodes, tasks };
  }

  private async assertFloorPath(floor: Floor, workspace: Workspace) {
    const pathApi = workspace.runtimeKind === 'wsl' ? win32 : { resolve, dirname };
    const expectedParent = pathApi.resolve(workspace.workingDir, '.orkestrai', 'floors');
    if (pathApi.dirname(pathApi.resolve(floor.path)) !== expectedParent) throw new Error('Caminho do andar fora da pasta de worktrees.');
    // A symlinked floor or parent must never redirect a cleanup outside this workspace.
    const [actual, parent, root] = await Promise.all([realpath(floor.path), realpath(expectedParent), realpath(workspace.workingDir)]);
    if (parent !== pathApi.resolve(root, '.orkestrai', 'floors') || pathApi.dirname(actual) !== parent
      || actual !== pathApi.resolve(parent, pathApi === win32 ? win32.basename(floor.path) : floor.path.split('/').at(-1)!)) {
      throw new Error('Caminho do andar redirecionado.');
    }
    const [rootCommon, floorCommon, branch] = await Promise.all([
      this.git(workspace, workspace.workingDir, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.git(workspace, floor.path, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
      this.git(workspace, floor.path, ['branch', '--show-current']),
    ]);
    if (rootCommon.trim() !== floorCommon.trim() || branch.trim() !== floor.branch) throw new Error('Worktree ou branch nao corresponde ao andar registrado.');
  }

  private async inspectFloor(floor: Floor, workspace: Workspace, context: Awaited<ReturnType<FloorService['auditContext']>>): Promise<FloorAudit> {
    const blockers: string[] = [];
    let head: string | null = null;
    let merged = false;
    let integration: FloorAudit['integration'] = 'unknown';
    const changes: FloorAudit['changes'] = { tracked: 0, untracked: 0, ignored: 0, samples: [], truncated: false };
    let status = '';
    try {
      await this.assertFloorPath(floor, workspace);
      [head, status] = await Promise.all([
        this.git(workspace, floor.path, ['rev-parse', '--verify', 'HEAD']).then((value) => value.trim()),
        this.git(workspace, floor.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching']),
      ]);
      // Git status AND non-forced worktree removal honor these index flags.
      // They can hide valuable local edits, so a clean status is not sufficient.
      const indexFlags = await this.git(workspace, floor.path, ['ls-files', '-v', '-z']);
      if (indexFlags.split('\0').some((entry) => /^[a-zS] /.test(entry))) blockers.push('hidden_index_flags');
      const records = status.split('\0').filter(Boolean);
      for (let index = 0; index < records.length; index++) {
        const record = records[index];
        const state = record.slice(0, 2);
        changes[state === '??' ? 'untracked' : state === '!!' ? 'ignored' : 'tracked']++;
        if (changes.samples.length < 20) changes.samples.push(record);
        else changes.truncated = true;
        if (/[RC]/.test(state)) index++; // porcelain -z rename has a second path
      }
      if (status) blockers.push('local_changes_or_untracked_or_ignored_files');
      try {
        await this.git(workspace, workspace.workingDir, ['merge-base', '--is-ancestor', head, context.targetHead]);
        merged = true;
        integration = 'ancestor';
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error;
        const patches = (await this.git(workspace, workspace.workingDir, ['cherry', context.targetHead, head])).trim().split('\n').filter(Boolean);
        // Patch equivalence is useful evidence, not permission to discard the branch.
        integration = patches.length > 0 && patches.every((line) => line.startsWith('- ')) ? 'patch_equivalent' : 'diverged';
        blockers.push('unmerged_commits_review_required');
      }
      const floorNodes = context.nodes.filter((node) => node.floorId === floor.id);
      const ids = new Set(floorNodes.map((node) => node.id));
      if (context.tasks.some((task) => ids.has(String(task.getAttribute('assignee_node_id'))))) blockers.push('pending_tasks');
      const sessions = ptySessionManager.list();
      if (sessions.some((session) => !session.exited && (ids.has(session.nodeId ?? '')
        || session.cwd === floor.path || session.cwd.startsWith(`${floor.path}/`) || session.cwd.startsWith(`${floor.path}\\`)))
        || floorNodes.some((node) => {
          const id = (node.payload as { sessionId?: string }).sessionId;
          const session = id ? ptySessionManager.get(id) : null;
          return session && !session.exited;
        })) blockers.push('live_terminal');
    } catch {
      blockers.push('unavailable_or_mismatched_worktree');
    }
    const revision = createHash('sha256').update(JSON.stringify([floor.id, floor.path, floor.branch, context.target, context.targetHead, head, status, blockers])).digest('hex');
    return { floorId: floor.id, name: floor.name, branch: floor.branch, path: floor.path, target: context.target,
      merged, safeToRemove: merged && !blockers.length, blockers, revision, head, integration, changes };
  }

  /** Explicit, revision-bound cleanup. Branches are retained; blocked floors are never forced. */
  async cleanup(workspaceId: string, entries: Array<{ floorId: string; revision: string }>) {
    if (!entries.length || entries.length > 100 || new Set(entries.map((entry) => entry.floorId)).size !== entries.length) throw new Error('Selecione de 1 a 100 andares distintos.');
    // Validate every scope before any mutation, including mixed-workspace requests.
    await Promise.all(entries.map((entry) => this.requireFloor(workspaceId, entry.floorId)));
    return this.exclusive(workspaceId, async () => {
      const results: Array<{ floorId: string; removed: boolean; error?: string }> = [];
      for (const entry of entries) {
        try {
          await this.removeChecked(entry.floorId, false, entry.revision);
          results.push({ floorId: entry.floorId, removed: true });
        } catch (error) {
          results.push({ floorId: entry.floorId, removed: false, error: error instanceof Error ? error.message : 'Falha na limpeza.' });
        }
      }
      return results;
    });
  }

  async get(id: string): Promise<Floor | null> {
    const model = await AgentFloor.find(id);
    return model ? mapFloor(model) : null;
  }

  /**
   * Cria um andar: branch nova (ou existente) + worktree + registro.
   * cloneLayout duplica os nos do terreo para o andar.
   */
  async create(
    workspaceId: string,
    input: { name: string; branch?: string; existingBranch?: boolean; cloneLayout?: boolean }
  ): Promise<Floor> {
    return this.exclusive(workspaceId, () => this.createChecked(workspaceId, input));
  }

  private async createChecked(workspaceId: string, input: { name: string; branch?: string; existingBranch?: boolean; cloneLayout?: boolean }): Promise<Floor> {
    const workspace = await this.workspace(workspaceId);
    await this.assertRepo(workspace);

    const name = input.name.trim();
    if (!name) throw new Error('Informe o nome do andar.');
    const branch = input.branch?.trim() || `orkestrai/${slugify(name)}`;
    await this.git(workspace, workspace.workingDir, ['check-ref-format', '--branch', branch]);
    const floorPath = workspace.runtimeKind === 'wsl'
      ? win32.resolve(workspace.workingDir, '.orkestrai', 'floors', slugify(name))
      : resolve(workspace.workingDir, '.orkestrai', 'floors', slugify(name));

    if (existsSync(floorPath)) throw new Error(`Ja existe um andar em ${floorPath}.`);

    const args = input.existingBranch
      ? ['worktree', 'add', floorPath, branch]
      : ['worktree', 'add', '-b', branch, floorPath];
    await this.git(workspace, workspace.workingDir, args);

    const model = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspaceId,
      name,
      branch,
      path: floorPath,
      status: 'active',
    });
    const floor = mapFloor(model);

    if (input.cloneLayout) {
      const groundNodes = await workspaceRepository.listNodes(workspaceId, null);
      const clonedIds = new Map<string, string>();
      for (const node of groundNodes) {
        const payload: Record<string, unknown> = {
          ...(node.payload as Record<string, unknown>),
          floorCloneOfNodeId: node.id,
        };
        if (node.type === 'terminal') {
          delete payload.sessionId;
          delete payload.agentSessionId;
          payload.resumeRecovery = false;
        }
        const cloned = await workspaceRepository.createNode({
          workspaceId,
          type: node.type,
          title: node.title,
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          zIndex: node.zIndex,
          payload,
          floorId: floor.id,
        });
        clonedIds.set(node.id, cloned.id);
      }
      const { creativeStoryboardService } = await import('$lib/modules/creative-media/application/services/CreativeStoryboardService.js');
      for (const node of groundNodes.filter(item => item.type === 'storyboard')) await creativeStoryboardService.clone(workspaceId, node.id, workspaceId, clonedIds.get(node.id)!, clonedIds);
      const { creativeSequenceService } = await import('$lib/modules/creative-media/application/services/CreativeSequenceService.js');
      for (const node of groundNodes.filter(item => item.type === 'sequence')) await creativeSequenceService.clone(workspaceId, node.id, workspaceId, clonedIds.get(node.id)!, clonedIds);
    }

    const hooks = workspace.hooks;
    if (hooks.autoRunSetup && hooks.setup?.length) {
      await this.runHooks(floor, workspace, hooks.setup).catch(() => {});
    }

    notifyWorkspaceChanged(workspaceId);
    return floor;
  }

  async rename(id: string, name: string): Promise<Floor> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const next = name.trim();
    if (!next) throw new Error('O nome do andar nao pode ficar vazio.');
    await AgentFloor.query().where('id', id).update({ name: next });
    return (await this.get(id))!;
  }

  /** Preview da aterrissagem: stats do diff e conflitos potenciais. */
  async landingPreview(id: string, targetBranch?: string) {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);
    const target = targetBranch || (await this.currentBranch(workspace));

    await this.validateBranch(workspace, target);
    await this.assertFloorPath(floor, workspace);
    const stat = await this.git(workspace, workspace.workingDir, ['diff', '--stat', `${target}...${floor.branch}`]);
    let conflicts: string[] = [];
    try {
      const mergeTree = await this.git(workspace, workspace.workingDir, ['merge-tree', '--write-tree', '--name-only', target, floor.branch]);
      if (!mergeTree.trim()) throw new Error('Git nao retornou a previa de merge.');
    } catch (error) {
      // merge-tree exits 1 for conflicts; stdout still contains the paths.
      const result = error as { code?: unknown; stdout?: string };
      if (result.code !== 1 || !result.stdout?.trim()) throw error;
      conflicts = result.stdout.split('\n\n')[0].split('\n').slice(1).filter(Boolean);
      if (!conflicts.length) throw error;
    }

    const dirty = (await this.git(workspace, workspace.workingDir, ['status', '--porcelain'])).trim().length > 0;

    return {
      floor: floor.name,
      from: floor.branch,
      to: target,
      stat: stat.trim(),
      conflicts,
      targetDirty: dirty,
    };
  }

  /** Aterrissa: faz merge da branch do andar na branch alvo do checkout principal. */
  async land(id: string, targetBranch?: string): Promise<{ merged: boolean; branch: string; into: string }> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    return this.exclusive(floor.workspaceId, () => this.landChecked(id, targetBranch));
  }

  private async landChecked(id: string, targetBranch?: string): Promise<{ merged: boolean; branch: string; into: string }> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);

    // Never abort a merge/cherry-pick that predates this operation.
    for (const ref of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
      let pending = false;
      try {
        await this.git(workspace, workspace.workingDir, ['rev-parse', '--verify', '--quiet', ref]);
        pending = true;
      } catch (error) {
        if ((error as { code?: unknown }).code !== 1) throw error;
      }
      if (pending) throw new Error('O checkout principal ja tem uma integracao em andamento. Conclua-a antes de aterrissar.');
    }

    const dirty = (await this.git(workspace, workspace.workingDir, ['status', '--porcelain'])).trim();
    if (dirty) throw new Error('O checkout principal tem alteracoes nao commitadas. Commit ou descarte antes de aterrissar.');

    const target = targetBranch || (await this.currentBranch(workspace));
    await this.validateBranch(workspace, target);
    await this.assertFloorPath(floor, workspace);
    if ((await this.git(workspace, floor.path, ['status', '--porcelain', '--untracked-files=all'])).trim()) {
      throw new Error('O andar tem alteracoes nao commitadas. Preserve e revise essas alteracoes antes de aterrissar.');
    }
    if (targetBranch && targetBranch !== (await this.currentBranch(workspace))) {
      await this.git(workspace, workspace.workingDir, ['checkout', targetBranch]);
    }

    try {
      await this.git(workspace, workspace.workingDir, ['merge', '--no-ff', '--no-edit', floor.branch]);
    } catch (error) {
      // Lista os arquivos em conflito antes de abortar para o chamador
      // (humano ou agente lider) saber o que precisa de resolucao.
      const conflicted = (await this.git(workspace, workspace.workingDir, ['diff', '--name-only', '--diff-filter=U']).catch(() => ''))
        .split('\n')
        .filter(Boolean);
      await this.git(workspace, workspace.workingDir, ['merge', '--abort']).catch(() => {});
      const files = conflicted.length ? ` Arquivos em conflito: ${conflicted.join(', ')}.` : '';
      throw new Error(`Conflito ao aterrissar ${floor.branch} em ${target}.${files} Atribua a resolucao a um agente do andar ou resolva no editor/terminal.`);
    }

    try {
      await this.removeChecked(id, false, undefined, 'landed');
    } catch (error) {
      notifyWorkspaceChanged(floor.workspaceId);
      throw new Error(`Merge concluido em ${target}; limpeza do andar pendente. ${error instanceof Error ? error.message : ''}`);
    }
    notifyWorkspaceChanged(floor.workspaceId);
    return { merged: true, branch: floor.branch, into: target };
  }

  /** Exclui o andar (worktree + opcionalmente a branch). */
  async remove(id: string, deleteBranch = false, revision?: string): Promise<{ removed: boolean; branchDeleted?: boolean; warning?: string }> {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    return this.exclusive(floor.workspaceId, () => this.removeChecked(id, deleteBranch, revision));
  }

  private async removeChecked(id: string, deleteBranch: boolean, revision?: string, finalStatus = 'deleted') {
    const floor = await this.get(id);
    if (!floor) throw new Error('Andar nao encontrado.');
    const workspace = await this.workspace(floor.workspaceId);

    const inspect = async () => this.inspectFloor(floor, workspace, await this.auditContext(workspace));
    const before = await inspect();
    if (revision && before.revision !== revision) throw new Error('O andar mudou desde a auditoria. Consulte floor_audit novamente.');
    if (!before.safeToRemove) throw new Error(`Andar preservado: ${before.blockers.join(', ')}.`);

    const hooks = workspace.hooks;
    if (hooks.teardown?.length) {
      const results = await this.runHooks(floor, workspace, hooks.teardown);
      if (results.some((result) => !result.ok)) throw new Error('Hook de teardown falhou; andar preservado.');
    }

    // Hooks and other agents can change a checkout after the first check.
    const after = await inspect();
    if (!after.safeToRemove || after.revision !== before.revision) throw new Error('O andar mudou durante a limpeza; worktree preservada.');
    await this.git(workspace, workspace.workingDir, ['worktree', 'remove', floor.path]);
    await this.retireFloorNodes(floor);
    await AgentFloor.query().where('id', id).update({ status: finalStatus });
    notifyWorkspaceChanged(floor.workspaceId);
    if (deleteBranch) {
      try {
        await this.git(workspace, workspace.workingDir, ['branch', '-d', '--', floor.branch]);
        return { removed: true, branchDeleted: true };
      } catch {
        return { removed: true, branchDeleted: false, warning: 'Worktree removida, mas o Git recusou excluir a branch; branch preservada.' };
      }
    }
    return { removed: true };
  }

  /** Executa comandos de hook no diretorio do andar com as variaveis $ORKESTRAI_*. */
  async runHooks(floor: Floor, workspace: Workspace, commands: HookCommand[]): Promise<Array<{ command: string; ok: boolean; output: string }>> {
    const runtime = workspaceExecutionRuntime(workspace);
    const env = {
      ...agentEnv(),
      ORKESTRAI_FLOOR_NAME: floor.name,
      ORKESTRAI_BRANCH_NAME: floor.branch,
      ORKESTRAI_FLOOR_PATH: runtime.kind === 'wsl'
        ? guestWorkingDirectory(runtime, floor.path, workspace.workingDir)
        : floor.path,
      ORKESTRAI_ROOT_PATH: runtime.kind === 'wsl' ? runtime.linuxWorkingDir : workspace.workingDir,
      ORKESTRAI_PROJECT_NAME: workspace.name,
    };
    const results = [];
    for (const { command } of commands) {
      try {
        // WSL hooks must execute in the selected distribution. Native Windows
        // keeps cmd.exe while Unix workspaces use /bin/sh.
        const [shell, shellArgs] = IS_WIN && runtime.kind === 'native'
          ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', command]]
          : ['/bin/sh', ['-c', command]];
        const launch = buildWorkspaceRuntimeLaunch({
          workspace,
          command: shell,
          args: shellArgs,
          hostCwd: floor.path,
          hostEnv: env,
          forwardEnvToWsl: [
            'ORKESTRAI_FLOOR_NAME',
            'ORKESTRAI_BRANCH_NAME',
            'ORKESTRAI_FLOOR_PATH',
            'ORKESTRAI_PROJECT_NAME',
          ],
        });
        const { stdout, stderr } = await execFileAsync(launch.command, launch.args, {
          cwd: launch.cwd,
          env: launch.env,
          timeout: 120_000,
          windowsHide: true,
        });
        results.push({ command, ok: true, output: (stdout + stderr).trim() });
      } catch (error) {
        results.push({ command, ok: false, output: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  async hooksFor(workspaceId: string): Promise<WorkspaceHooks> {
    const workspace = await this.workspace(workspaceId);
    return workspace.hooks;
  }

  async saveHooks(workspaceId: string, hooks: WorkspaceHooks): Promise<WorkspaceHooks> {
    await this.workspace(workspaceId);
    await workspaceRepository.updateWorkspace(workspaceId, { hooks });
    return hooks;
  }

  private async currentBranch(workspace: Workspace): Promise<string> {
    const branch = (await this.git(workspace, workspace.workingDir, ['branch', '--show-current'])).trim();
    if (!branch) throw new Error('Checkout principal em detached HEAD. Selecione a branch de integracao.');
    return branch;
  }

  private async validateBranch(workspace: Workspace, branch: string) {
    await this.git(workspace, workspace.workingDir, ['check-ref-format', '--branch', branch]);
    await this.git(workspace, workspace.workingDir, ['show-ref', '--verify', `refs/heads/${branch}`]);
  }

  private async retireFloorNodes(floor: Floor): Promise<void> {
    const [floorNodes, workspaceNodes] = await Promise.all([
      workspaceRepository.listNodes(floor.workspaceId, floor.id, true, true),
      workspaceRepository.listNodes(floor.workspaceId, undefined, true, true),
    ]);
    const sharedSessionIds = new Set(
      workspaceNodes
        .filter((node) => node.floorId !== floor.id)
        .flatMap((node) => {
          const sessionId = (node.payload as { sessionId?: unknown }).sessionId;
          return typeof sessionId === 'string' ? [sessionId] : [];
        }),
    );
    for (const node of floorNodes) {
      const sessionId = (node.payload as { sessionId?: unknown }).sessionId;
      if (typeof sessionId === 'string' && !sharedSessionIds.has(sessionId)) {
        ptySessionManager.kill(sessionId);
      }
    }
    await workspaceRepository.archiveFloorNodes(floor.workspaceId, floor.id);
  }
}

export const floorService = new FloorService();
