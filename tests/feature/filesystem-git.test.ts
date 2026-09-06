import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { gitService } from '$lib/modules/agent-room/application/services/GitService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

function makeGitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-git-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'teste@orkestrai.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Teste'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# repo\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'inicial'], { cwd: dir });
  return dir;
}

describe('FilesystemService + GitService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('lista diretorio confinado ao workspace e bloqueia fuga de path', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'fs', workingDir: dir });

    const entries = await filesystemService.list(workspace.id);
    expect(entries.map((entry) => entry.name)).toContain('README.md');
    expect(entries.find((entry) => entry.name === 'src')?.type).toBe('directory');
    expect(entries.some((entry) => entry.name === '.git')).toBe(false);

    await expect(filesystemService.list(workspace.id, '../../etc')).rejects.toThrow('fora do diretorio');
    await expect(filesystemService.read(workspace.id, '/etc/passwd')).rejects.toThrow('fora do diretorio');
  });

  it('le e escreve arquivos dentro do workspace', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'fs', workingDir: dir });

    const read = await filesystemService.read(workspace.id, 'src/index.ts');
    expect(read.content).toContain('export const a = 1');

    await filesystemService.write(workspace.id, 'src/index.ts', 'export const a = 2;\n');
    expect((await filesystemService.read(workspace.id, 'src/index.ts')).content).toContain('a = 2');
  });

  it('limita a leitura de arquivos grandes antes de enviar ao editor', async () => {
    const dir = makeGitRepo();
    writeFileSync(join(dir, 'large.log'), 'x'.repeat(600 * 1024));
    const workspace = await workspaceRepository.createWorkspace({ name: 'large-file', workingDir: dir });

    const read = await filesystemService.read(workspace.id, 'large.log');
    expect(read.truncated).toBe(true);
    expect(Buffer.byteLength(read.content)).toBe(512 * 1024);
  });

  it('classifica previews sem ler binarios como texto e mantem paths confinados', async () => {
    const dir = makeGitRepo();
    writeFileSync(join(dir, 'brief.md'), '# Brief\n');
    writeFileSync(join(dir, 'screen.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
    writeFileSync(join(dir, 'archive.bin'), Buffer.from([0x01, 0x00, 0x02]));
    writeFileSync(join(dir, 'Dockerfile'), 'FROM node:24\n');
    const workspace = await workspaceRepository.createWorkspace({ name: 'inspect', workingDir: dir });

    await expect(filesystemService.inspect(workspace.id, '../../etc/passwd')).rejects.toThrow('fora do diretorio');
    await expect(filesystemService.inspect(workspace.id, 'brief.md')).resolves.toMatchObject({
      kind: 'markdown',
      contentType: 'text/markdown',
      name: 'brief.md',
    });
    await expect(filesystemService.inspect(workspace.id, 'screen.png')).resolves.toMatchObject({
      kind: 'image',
      contentType: 'image/png',
    });
    await expect(filesystemService.inspect(workspace.id, 'archive.bin')).resolves.toMatchObject({
      kind: 'binary',
      contentType: 'application/octet-stream',
    });
    await expect(filesystemService.inspect(workspace.id, 'Dockerfile')).resolves.toMatchObject({
      kind: 'text',
      contentType: 'text/plain',
    });
  });

  it('status, diff, stage, unstage e discard', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'fs', workingDir: dir });

    writeFileSync(join(dir, 'README.md'), '# repo alterado\n');

    const status = await gitService.status(workspace.id);
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.revision).toHaveLength(64);
    expect(status.changes).toHaveLength(1);
    expect(status.changes[0]).toMatchObject({ path: 'README.md', previousPath: null, status: 'M', staged: false });

    const diff = await gitService.diff(workspace.id, 'README.md');
    expect(diff.diff).toContain('repo alterado');

    await gitService.stage(workspace.id, 'README.md');
    const staged = await gitService.status(workspace.id);
    expect(staged.changes[0].staged).toBe(true);

    await gitService.unstage(workspace.id, 'README.md');
    await gitService.discard(workspace.id, 'README.md');
    const clean = await gitService.status(workspace.id);
    expect(clean.changes).toHaveLength(0);
  });

  it('preserva estados parciais e entrega conteudo estruturado ao Monaco', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'structured-diff', workingDir: dir });

    writeFileSync(join(dir, 'README.md'), '# staged\n');
    await gitService.stage(workspace.id, 'README.md');
    writeFileSync(join(dir, 'README.md'), '# working\n');
    writeFileSync(join(dir, 'file with spaces.ts'), 'export const value = 1;\n');

    const status = await gitService.status(workspace.id);
    expect(status.changes.filter((change) => change.path === 'README.md')).toEqual([
      expect.objectContaining({ id: 'staged:README.md', status: 'M', staged: true }),
      expect.objectContaining({ id: 'unstaged:README.md', status: 'M', staged: false }),
    ]);
    expect(status.changes).toContainEqual(expect.objectContaining({ path: 'file with spaces.ts', status: '?', staged: false }));

    const staged = await gitService.fileDiff(workspace.id, 'README.md', true);
    expect(staged).toMatchObject({ original: '# repo\n', modified: '# staged\n', language: 'markdown', binary: false });
    const working = await gitService.fileDiff(workspace.id, 'README.md', false);
    expect(working).toMatchObject({ original: '# staged\n', modified: '# working\n', staged: false });
  });

  it('nao envia conteudo binario ao editor de diff', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'binary-diff', workingDir: dir });
    writeFileSync(join(dir, 'image.bin'), Buffer.from([0, 1, 2, 3]));

    const result = await gitService.fileDiff(workspace.id, 'image.bin', false);
    expect(result.binary).toBe(true);
    expect(result.original).toBe('');
    expect(result.modified).toBe('');
  });

  it('limita cada lado de um diff grande sem carregar o arquivo inteiro', async () => {
    const dir = makeGitRepo();
    writeFileSync(join(dir, 'large.txt'), 'a'.repeat(1_100_000));
    execFileSync('git', ['add', 'large.txt'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'large fixture'], { cwd: dir });
    writeFileSync(join(dir, 'large.txt'), 'b'.repeat(1_200_000));
    const workspace = await workspaceRepository.createWorkspace({ name: 'large-diff', workingDir: dir });

    const result = await gitService.fileDiff(workspace.id, 'large.txt', false);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.original)).toBeLessThanOrEqual(1_000_000);
    expect(Buffer.byteLength(result.modified)).toBeLessThanOrEqual(1_000_000);
  });

  it('status em diretorio sem repo retorna isRepo false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-nogit-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'fs', workingDir: dir });
    const status = await gitService.status(workspace.id);
    expect(status.isRepo).toBe(false);
    expect(status.changes).toEqual([]);
  });

  it('entrega grafo, branches, worktrees e operacoes revisionadas', async () => {
    const dir = makeGitRepo();
    execFileSync('git', ['branch', 'review'], { cwd: dir });
    execFileSync('git', ['tag', 'v0.1.0'], { cwd: dir });
    const workspace = await workspaceRepository.createWorkspace({ name: 'git-client', workingDir: dir });

    const snapshot = await gitService.workspaceSnapshot(workspace.id);
    expect(snapshot.status.branch).toBe('main');
    expect(snapshot.commits[0]).toMatchObject({ subject: 'inicial', author: 'Teste' });
    expect(snapshot.branches.map((branch) => branch.name)).toEqual(expect.arrayContaining(['main', 'review']));
    expect(snapshot.tags).toContainEqual(expect.objectContaining({ name: 'v0.1.0' }));
    expect(snapshot.worktrees[0]).toMatchObject({ branch: 'main', detached: false });

    const preview = await gitService.previewOperation(workspace.id, { operation: 'checkout', ref: 'review', force: false, setUpstream: false });
    expect(preview.command).toEqual(['git', 'switch', 'review']);
    await gitService.executeOperation(workspace.id, {
      operation: 'checkout',
      ref: 'review',
      force: false,
      setUpstream: false,
      confirmed: false,
      expectedRevision: preview.revision,
    });
    expect((await gitService.status(workspace.id)).branch).toBe('review');
  });

  it('bloqueia operacao destrutiva sem confirmacao e revisao obsoleta', async () => {
    const dir = makeGitRepo();
    execFileSync('git', ['branch', 'discard-me'], { cwd: dir });
    const workspace = await workspaceRepository.createWorkspace({ name: 'git-guards', workingDir: dir });
    const preview = await gitService.previewOperation(workspace.id, { operation: 'deleteBranch', ref: 'discard-me', force: true, setUpstream: false });

    await expect(gitService.executeOperation(workspace.id, {
      operation: 'deleteBranch', ref: 'discard-me', force: true, setUpstream: false,
      confirmed: false, expectedRevision: preview.revision,
    })).rejects.toThrow('Confirme explicitamente');

    writeFileSync(join(dir, 'README.md'), '# changed\n');
    await expect(gitService.executeOperation(workspace.id, {
      operation: 'deleteBranch', ref: 'discard-me', force: true, setUpstream: false,
      confirmed: true, expectedRevision: preview.revision,
    })).rejects.toThrow('mudou desde a prévia');
  });

  it('rejeita nomes de tag e referencias de stash que poderiam virar opcoes Git', async () => {
    const dir = makeGitRepo();
    const workspace = await workspaceRepository.createWorkspace({ name: 'git-arguments', workingDir: dir });

    await expect(gitService.previewOperation(workspace.id, {
      operation: 'deleteTag', ref: '--contains', force: false, setUpstream: false,
    })).rejects.toThrow('Nome de tag Git inválido');

    await expect(gitService.previewOperation(workspace.id, {
      operation: 'stashPop', ref: '--index', force: false, setUpstream: false,
    })).rejects.toThrow('Referência de stash inválida');

    await expect(gitService.previewOperation(workspace.id, {
      operation: 'stashPop', ref: 'stash@{0}', force: false, setUpstream: false,
    })).resolves.toMatchObject({ command: ['git', 'stash', 'pop', 'stash@{0}'] });
  });
});
