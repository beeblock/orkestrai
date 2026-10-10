import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { floorService, withFloorGitSlot } from '$lib/modules/agent-room/application/services/FloorService.js';
import { floorOverviewService } from '$lib/modules/agent-room/application/services/FloorOverviewService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import * as diskGuard from '$lib/modules/agent-room/infrastructure/disk-guard.js';

const repos: string[] = [];

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-floor-'));
  repos.push(dir);
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'teste@orkestrai.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir });
  writeFileSync(join(dir, 'app.ts'), 'const v = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'inicial'], { cwd: dir });
  return dir;
}

function git(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('FloorService', () => {
  useSvelarTest({ refreshDatabase: true });
  // The host disk must not decide these tests; disk behavior is tested explicitly.
  beforeEach(() => {
    vi.spyOn(diskGuard, 'freeDiskBytes').mockResolvedValue(50 * 1024 ** 3);
    vi.spyOn(diskGuard, 'assertFreeDisk').mockResolvedValue();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('cria andar com worktree e branch, lista e renomeia', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });

    const floor = await floorService.create(workspace.id, { name: 'Fix login' });
    expect(floor.branch).toBe('orkestrai/fix-login');
    expect(git(dir, ['worktree', 'list'])).toContain('fix-login');
    expect(git(floor.path, ['branch', '--show-current']).trim()).toBe('orkestrai/fix-login');

    expect(await floorService.list(workspace.id)).toHaveLength(1);

    const renamed = await floorService.rename(floor.id, 'Fix login 2');
    expect(renamed.name).toBe('Fix login 2');

    await floorService.remove(floor.id, true);
    expect(await floorService.list(workspace.id)).toHaveLength(0);
    expect(git(dir, ['branch', '--list', 'orkestrai/*'])).not.toContain('fix-login');
  });

  it('clona layout do terreo quando pedido', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note', title: 'Nota terreo' });
    const terminal = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Agente terreo',
      payload: { provider: 'codex', sessionId: 'pty-ground', agentSessionId: 'conversation-ground' },
    });

    const floor = await floorService.create(workspace.id, { name: 'andar', cloneLayout: true });
    const floorNodes = await workspaceRepository.listNodes(workspace.id, floor.id);
    expect(floorNodes).toHaveLength(2);
    expect(floorNodes.every((node) => node.floorId === floor.id)).toBe(true);
    const terminalClone = floorNodes.find((node) => node.type === 'terminal')!;
    expect(terminalClone.payload).toMatchObject({ provider: 'codex', floorCloneOfNodeId: terminal.id, resumeRecovery: false });
    expect(terminalClone.payload).not.toHaveProperty('sessionId');
    expect(terminalClone.payload).not.toHaveProperty('agentSessionId');

    await floorService.remove(floor.id, true);
  });

  it('retira nos e edges do andar ao excluir sem apagar o historico', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const ground = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Lider' });
    const floor = await floorService.create(workspace.id, { name: 'temporario' });
    const worker = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      floorId: floor.id,
      type: 'terminal',
      title: 'Worker temporario',
    });
    await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: ground.id, targetNodeId: worker.id });

    await floorService.remove(floor.id, true);

    expect((await workspaceRepository.listNodes(workspace.id)).map((node) => node.id)).toEqual([ground.id]);
    expect(await workspaceRepository.listEdges(workspace.id)).toEqual([]);
    expect((await workspaceRepository.listNodes(workspace.id, floor.id, true, true)).map((node) => node.id)).toEqual([worker.id]);
  });

  it('aterrissa mudancas do andar na branch principal', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'feature' });

    writeFileSync(join(floor.path, 'app.ts'), 'const v = 2;\n');
    git(floor.path, ['add', '.']);
    git(floor.path, ['commit', '-m', 'muda v']);

    const preview = await floorService.landingPreview(floor.id);
    expect(preview.to).toBe('main');
    expect(preview.stat).toContain('app.ts');

    const landed = await floorService.land(floor.id);
    expect(landed.merged).toBe(true);
    expect(git(dir, ['log', '-1', '--format=%s'])).toContain('Merge');
    expect((await import('node:fs')).readFileSync(join(dir, 'app.ts'), 'utf8')).toContain('v = 2');
  });

  it('refuses a landing that conflicts with local changes and changes nothing', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'feature' });
    writeFileSync(join(floor.path, 'app.ts'), 'const v = 2;\n');
    git(floor.path, ['add', '.']);
    git(floor.path, ['commit', '-m', 'muda v']);

    writeFileSync(join(dir, 'app.ts'), 'const v = 99;\n');
    await expect(floorService.land(floor.id)).rejects.toThrow('Nenhum arquivo foi alterado');
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('const v = 99;\n');
    await expect(floorService.remove(floor.id, true)).rejects.toThrow('unmerged_commits_review_required');
    expect(existsSync(floor.path)).toBe(true);
  });

  it('starts a floor from the owner working tree without touching the owner index', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'app.ts'), 'const v = 1;\nconst local = true;\n');
    writeFileSync(join(dir, 'notes.md'), 'draft\n');
    const statusBefore = git(dir, ['status', '--porcelain']);
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'snapshot' });
    expect(floor).toMatchObject({ baseKind: 'snapshot', baseCommit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(readFileSync(join(floor.path, 'app.ts'), 'utf8')).toContain('const local = true;');
    expect(readFileSync(join(floor.path, 'notes.md'), 'utf8')).toBe('draft\n');
    expect(git(dir, ['status', '--porcelain'])).toBe(statusBefore);
    expect(git(dir, ['diff', '--cached', '--name-only'])).toBe('');
    expect(git(dir, ['log', '--oneline'])).not.toContain('snapshot');
  });

  it('removes an untouched snapshot floor and its branch like any merged floor', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'AGENTS.md'), 'provisioned\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'untouched' });
    expect(floor.baseKind).toBe('snapshot');
    const [audit] = await floorService.audit(workspace.id);
    expect(audit).toMatchObject({ merged: true, integration: 'unchanged', safeToRemove: true });
    await expect(floorService.remove(floor.id, true)).resolves.toMatchObject({ removed: true, branchDeleted: true });
    expect(git(dir, ['branch', '--list', floor.branch])).toBe('');
  });

  it('lands only the floor delta on a dirty main checkout as one commit and retires the floor', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'other.ts'), 'export const other = 1;\n');
    git(dir, ['add', 'other.ts']);
    git(dir, ['commit', '-m', 'other']);
    writeFileSync(join(dir, 'app.ts'), 'const v = 1;\nconst local = true;\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'delta' });
    writeFileSync(join(floor.path, 'feature.ts'), 'export const feature = 1;\n');
    writeFileSync(join(floor.path, 'app.ts'), 'const v = 1;\nconst local = true;\nconst floor = true;\n');
    // The owner's own staged work in an unrelated file must not ride along.
    writeFileSync(join(dir, 'other.ts'), 'export const other = 2;\n');
    git(dir, ['add', 'other.ts']);
    const headBefore = git(dir, ['rev-parse', 'HEAD']).trim();
    const preview = await floorService.landingPreview(floor.id);
    expect(preview).toMatchObject({ mode: 'patch', conflicts: [], targetDirty: true, pendingInFloor: 2 });

    const result = await floorService.land(floor.id, undefined, { message: 'feat(profile): add company bio' });
    expect(result).toMatchObject({ merged: true, mode: 'patch', files: 2, committedPending: expect.any(String), commit: expect.any(String), cleanup: 'removed' });
    expect(readFileSync(join(dir, 'feature.ts'), 'utf8')).toBe('export const feature = 1;\n');
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('const v = 1;\nconst local = true;\nconst floor = true;\n');
    expect(git(dir, ['rev-parse', 'HEAD^']).trim()).toBe(headBefore);
    expect(git(dir, ['rev-parse', 'HEAD']).trim()).toBe(result.commit);
    expect(git(dir, ['log', '-1', '--format=%s']).trim()).toBe('feat(profile): add company bio');
    expect(git(dir, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort()).toEqual(['app.ts', 'feature.ts']);
    expect(git(dir, ['status', '--porcelain']).trim()).toBe('M  other.ts');
    expect(existsSync(floor.path)).toBe(false);
    expect((await floorService.get(floor.id))?.status).toBe('landed');
  });

  it('retires an integrated floor that holds only build output, test reports and logs', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, '.gitignore'), 'test-results/\n*.log\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'ignore artifacts']);
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'artifacts' });
    mkdirSync(join(floor.path, 'test-results', 'run'), { recursive: true });
    writeFileSync(join(floor.path, 'test-results', 'run', 'trace.zip'), 'trace');
    writeFileSync(join(floor.path, 'e2e.log'), 'log');
    const [audit] = await floorService.audit(workspace.id);
    expect(audit).toMatchObject({ merged: true, safeToRemove: true, blockers: [] });
    expect(audit.changes.ignored).toBe(2);
    await expect(floorService.remove(floor.id)).resolves.toMatchObject({ removed: true });
    expect(existsSync(floor.path)).toBe(false);
  });

  it('keeps a floor where a process still runs, such as a preview server', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'preview' });
    const server = spawn('sleep', ['30'], { cwd: floor.path, stdio: 'ignore' });
    try {
      const [audit] = await floorService.audit(workspace.id);
      expect(audit.blockers).toContain('running_process');
      await expect(floorService.remove(floor.id)).rejects.toThrow('running_process');
      expect(existsSync(floor.path)).toBe(true);
    } finally {
      server.kill();
    }
  });

  it('retires integrated idle floors to make room before creating a new one', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const done = await floorService.create(workspace.id, { name: 'done-work' });
    vi.mocked(diskGuard.freeDiskBytes).mockResolvedValue(1024 ** 3);
    const next = await floorService.create(workspace.id, { name: 'next-work' });
    expect(existsSync(done.path)).toBe(false);
    expect((await floorService.get(done.id))?.status).toBe('landed');
    expect(existsSync(next.path)).toBe(true);
  });

  it('merges concurrent edits to different lines of the same file', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'app.ts'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    git(dir, ['commit', '-am', 'tres linhas']);
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'concurrent' });
    writeFileSync(join(floor.path, 'app.ts'), 'const a = 1;\nconst b = 2;\nconst c = 30;\n');
    writeFileSync(join(dir, 'app.ts'), 'const a = 10;\nconst b = 2;\nconst c = 3;\n');
    const result = await floorService.land(floor.id);
    expect(result).toMatchObject({ mode: 'patch', files: 1 });
    expect(readFileSync(join(dir, 'app.ts'), 'utf8')).toBe('const a = 10;\nconst b = 2;\nconst c = 30;\n');
  });

  it('shares installed dependencies through a link farm but keeps caches per floor', async () => {
    const dir = makeRepo();
    writeFileSync(join(dir, 'package.json'), '{"name":"app"}\n');
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'package']);
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1;\n');
    mkdirSync(join(dir, 'node_modules', '.vite'), { recursive: true });
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'deps' });
    expect(lstatSync(join(floor.path, 'node_modules', 'pkg')).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(floor.path, 'node_modules', 'pkg', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(existsSync(join(floor.path, 'node_modules', '.vite'))).toBe(false);
    const [audit] = await floorService.audit(workspace.id);
    expect(audit).toMatchObject({ merged: true, safeToRemove: true });
    await floorService.remove(floor.id);
    expect(existsSync(join(dir, 'node_modules', 'pkg', 'index.js'))).toBe(true);
  });

  it('commits a floor agent work when its task is finished', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'worker' });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Worker', floorId: floor.id, payload: { command: '/bin/cat' } });
    const task = await taskBoardService.create(workspace.id, { title: 'Implement upload', assigneeNodeId: agent.id, dispatch: false });
    writeFileSync(join(floor.path, 'upload.ts'), 'export const upload = true;\n');
    const done = await taskBoardService.update(workspace.id, task.id, { status: 'done', notifyCompletion: false });
    expect(done.completionFloor).toMatchObject({ id: floor.id, commit: expect.stringMatching(/^[0-9a-f]{40}$/) });
    expect(git(floor.path, ['log', '-1', '--format=%B'])).toContain(`Orkestrai-Task: ${task.id}`);
    expect(git(floor.path, ['status', '--porcelain'])).toBe('');
  });

  it('audits and cleans merged floors in one revision-bound batch, retaining branches', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const first = await floorService.create(workspace.id, { name: 'one' });
    const second = await floorService.create(workspace.id, { name: 'two' });
    const audit = await floorService.audit(workspace.id);
    expect(audit).toHaveLength(2);
    expect(audit.every((item) => item.safeToRemove && item.merged)).toBe(true);
    expect(await floorService.cleanup(workspace.id, audit)).toEqual([
      { floorId: first.id, removed: true }, { floorId: second.id, removed: true },
    ]);
    expect(existsSync(first.path)).toBe(false);
    expect(git(dir, ['branch', '--list'])).toContain(first.branch);
  });

  it.each(['tracked', 'untracked', 'ignored'])('preserves %s files even when HEAD is merged', async (kind) => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: kind });
    if (kind === 'ignored') writeFileSync(join(dir, '.git/info/exclude'), '.orkestrai/\nlocal-secret\n');
    writeFileSync(join(floor.path, kind === 'tracked' ? 'app.ts' : 'local-secret'), 'do not lose');
    const [audit] = await floorService.audit(workspace.id);
    expect(audit).toMatchObject({ merged: true, safeToRemove: false });
    await expect(floorService.remove(floor.id)).rejects.toThrow('local_changes');
    expect(existsSync(floor.path)).toBe(true);
    expect((await floorService.get(floor.id))?.status).toBe('active');
  });

  it.each(['--assume-unchanged', '--skip-worktree'])('preserves files hidden from Git status by %s', async (flag) => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'hidden-changes' });
    git(floor.path, ['update-index', flag, 'app.ts']);
    writeFileSync(join(floor.path, 'app.ts'), 'private local configuration');
    expect(git(floor.path, ['status', '--porcelain'])).toBe('');
    await expect(floorService.remove(floor.id)).rejects.toThrow('hidden_index_flags');
    expect(existsSync(join(floor.path, 'app.ts'))).toBe(true);
  });

  it('detects stale revisions and continues the batch without deleting the changed floor', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'changed' });
    const audit = await floorService.audit(workspace.id);
    writeFileSync(join(floor.path, 'new-file'), 'new work');
    expect(await floorService.cleanup(workspace.id, audit)).toEqual([
      expect.objectContaining({ floorId: floor.id, removed: false, error: expect.stringContaining('mudou') }),
    ]);
    expect(existsSync(floor.path)).toBe(true);
  });

  it('reports actual merge-tree conflicts instead of claiming a clean preview', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'conflict' });
    writeFileSync(join(floor.path, 'app.ts'), 'const v = 2;\n');
    git(floor.path, ['commit', '-am', 'floor change']);
    writeFileSync(join(dir, 'app.ts'), 'const v = 3;\n');
    git(dir, ['commit', '-am', 'root change']);
    expect((await floorService.landingPreview(floor.id)).conflicts).toEqual(['app.ts']);
    await expect(floorService.land(floor.id)).rejects.toThrow('app.ts');
    expect((await floorService.get(floor.id))?.status).toBe('active');
  });

  it('does not abort an integration that the user already started', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'pending-merge' });
    writeFileSync(join(floor.path, 'new-file'), 'feature');
    git(floor.path, ['add', '.']);
    git(floor.path, ['commit', '-m', 'feature']);
    git(dir, ['merge', '--no-ff', '--no-commit', floor.branch]);
    const pendingHead = git(dir, ['rev-parse', 'MERGE_HEAD']);
    await expect(floorService.land(floor.id)).rejects.toThrow('integracao em andamento');
    expect(git(dir, ['rev-parse', 'MERGE_HEAD'])).toBe(pendingHead);
  });

  it('does not archive floor nodes or hide Git removal failures', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'locked' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, floorId: floor.id, type: 'note', title: 'Keep' });
    git(dir, ['worktree', 'lock', floor.path]);
    await expect(floorService.remove(floor.id)).rejects.toThrow();
    expect((await floorService.get(floor.id))?.status).toBe('active');
    expect((await workspaceRepository.listNodes(workspace.id)).map((item) => item.id)).toContain(node.id);
  });

  it('keeps successfully merged but unremoved floors visible and permits a cleanup retry', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'retry' });
    git(dir, ['worktree', 'lock', floor.path]);
    await expect(floorService.land(floor.id)).resolves.toMatchObject({ merged: true, mode: 'merge', cleanup: 'pending' });
    expect(await floorService.list(workspace.id)).toHaveLength(1);
    git(dir, ['worktree', 'unlock', floor.path]);
    await floorService.cleanup(workspace.id, await floorService.audit(workspace.id));
    expect(await floorService.list(workspace.id)).toHaveLength(0);
  });

  it.each(['landed', 'deleted'])('recovers legacy %s records whose worktrees were never removed', async (status) => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'legacy', workingDir: makeRepo() });
    const floor = await floorService.create(workspace.id, { name: 'leftover' });
    await AgentFloor.query().where('id', floor.id).update({ status });
    const audit = await floorService.audit(workspace.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].safeToRemove).toBe(true);
    expect(await floorService.cleanup(workspace.id, audit)).toEqual([{ floorId: floor.id, removed: true }]);
    expect(await floorService.list(workspace.id)).toHaveLength(0);
  });

  it('rejects mixed-workspace cleanup before touching any floor', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: makeRepo() });
    const other = await workspaceRepository.createWorkspace({ name: 'other', workingDir: makeRepo() });
    const floor = await floorService.create(workspace.id, { name: 'ours' });
    const foreign = await floorService.create(other.id, { name: 'theirs' });
    const audit = [...await floorService.audit(workspace.id), ...await floorService.audit(other.id)];
    await expect(floorService.cleanup(workspace.id, audit)).rejects.toThrow('neste workspace');
    expect(existsSync(floor.path)).toBe(true);
    expect(existsSync(foreign.path)).toBe(true);
    await expect(floorService.requireFloor(workspace.id, foreign.id)).rejects.toThrow();
  });

  it('preserves worktrees used by a live terminal even if no floor node references it', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: makeRepo() });
    const floor = await floorService.create(workspace.id, { name: 'busy' });
    vi.spyOn(ptySessionManager, 'list').mockReturnValue([{ cwd: floor.path, exited: false }] as never);
    await expect(floorService.remove(floor.id)).rejects.toThrow('live_terminal');
  });

  it('refuses a persisted path outside managed floors', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: makeRepo() });
    const floor = await floorService.create(workspace.id, { name: 'invalid' });
    await AgentFloor.query().where('id', floor.id).update({ path: workspace.workingDir });
    await expect(floorService.remove(floor.id)).rejects.toThrow('unavailable');
    expect(existsSync(floor.path)).toBe(true);
  });

  it('shares simultaneous audits and overview scans but does not reuse stale results', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: makeRepo() });
    const floor = await floorService.create(workspace.id, { name: 'shared' });
    const list = vi.spyOn(floorService, 'list');
    const [first, second] = await Promise.all([floorService.audit(workspace.id), floorService.audit(workspace.id)]);
    expect(first).toBe(second);
    expect(list).toHaveBeenCalledTimes(1);
    await Promise.all([floorOverviewService.get(workspace.id), floorOverviewService.get(workspace.id)]);
    expect(list).toHaveBeenCalledTimes(2);
    writeFileSync(join(floor.path, 'new-file'), 'changed');
    expect((await floorService.audit(workspace.id))[0].safeToRemove).toBe(false);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('caps concurrent Floor Git work at four, releasing slots even after failures', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const work = Array.from({ length: 24 }, (_, index) => withFloorGitSlot(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((release) => releases.push(release));
      active--;
      if (index === 3) throw new Error('test failure');
    }).catch(() => undefined));
    for (let batch = 0; batch < 6; batch++) {
      await vi.waitFor(() => expect(releases).toHaveLength(4));
      for (const release of releases.splice(0)) release();
    }
    await Promise.all(work);
    expect(peak).toBe(4);
    expect(active).toBe(0);
    await expect(withFloorGitSlot(async () => 'ready')).resolves.toBe('ready');
  });

  it('audits 24 worktrees in a single native request', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'audit-benchmark', workingDir: makeRepo() });
    for (let index = 0; index < 24; index++) await floorService.create(workspace.id, { name: `batch-${index}` });
    const started = performance.now();
    const result = await floorService.audit(workspace.id);
    const elapsedMs = Math.round(performance.now() - started);
    expect(result).toHaveLength(24);
    expect(result.every((item) => item.safeToRemove)).toBe(true);
    console.info(`[floor-audit benchmark] 24 clean merged worktrees: ${elapsedMs} ms; one service call, maximum four Git processes.`);
  }, 30_000);

  it('hooks recebem variaveis ORKESTRAI_*', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'MeuProj', workingDir: dir });
    const floor = await floorService.create(workspace.id, { name: 'hooked' });

    const results = await floorService.runHooks(floor, workspace, [
      { command: 'echo "$ORKESTRAI_FLOOR_NAME|$ORKESTRAI_PROJECT_NAME|$ORKESTRAI_BRANCH_NAME"' },
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[0].output).toBe('hooked|MeuProj|orkestrai/hooked');

    await floorService.remove(floor.id, true);
  });

  it('salva e recupera hooks do workspace', async () => {
    const dir = makeRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'ws', workingDir: dir });
    await floorService.saveHooks(workspace.id, {
      setup: [{ command: 'npm install' }],
      autoRunSetup: true,
      teardown: [{ command: 'echo fim' }],
    });
    const hooks = await floorService.hooksFor(workspace.id);
    expect(hooks.setup).toHaveLength(1);
    expect(hooks.autoRunSetup).toBe(true);
    expect(hooks.teardown).toHaveLength(1);
  });
});
