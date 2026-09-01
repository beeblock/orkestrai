import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { WorkspaceService, workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { UpdateWorkspaceDto } from '$lib/modules/agent-room/application/dto/WorkspaceDtos.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

describe('WorkspaceService — provisionamento da ponte', () => {
  useSvelarTest({ refreshDatabase: true });

  it('compartilha o provisionamento concorrente do mesmo workspace', async () => {
    const service = new WorkspaceService() as unknown as {
      ensureProvisioned: (workspace: unknown) => Promise<void>;
      provisionWorkspace: (workspace: unknown) => Promise<void>;
      provisionInFlight: Map<string, Promise<void>>;
    };
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => (finish = resolve));
    let calls = 0;
    service.provisionWorkspace = async () => {
      calls += 1;
      await pending;
    };
    const workspace = { id: 'protected-workspace', workingDir: '/protected' };

    const first = service.ensureProvisioned(workspace);
    const second = service.ensureProvisioned(workspace);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
    expect(service.provisionInFlight.size).toBe(1);
    finish();
    await Promise.all([first, second]);
    expect(service.provisionInFlight.size).toBe(0);
  });

  it('nao deixa a permissao pendente de um workspace bloquear os demais', async () => {
    const service = new WorkspaceService() as unknown as {
      ensureProvisioned: (workspace: unknown) => Promise<void>;
      provisionWorkspace: (workspace: { id: string }) => Promise<void>;
    };
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    service.provisionWorkspace = async (workspace) => {
      started.push(workspace.id);
      await new Promise<void>((resolve) => releases.set(workspace.id, resolve));
    };

    const first = service.ensureProvisioned({ id: 'protected-a', workingDir: '/protected/a' });
    const second = service.ensureProvisioned({ id: 'protected-b', workingDir: '/protected/b' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toEqual(['protected-a', 'protected-b']);
    releases.get('protected-b')?.();
    await second;
    releases.get('protected-a')?.();
    await first;
  });

  it('provisiona skill e token ao criar o workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-new-'));
    const workspace = await workspaceService.create({ name: 'novo', workingDir: dir, icon: null, instructions: null });

    expect(workspace.id).toBeTruthy();
    expect(workspace.repositoryRoots).toEqual([]);
    expect(existsSync(join(dir, '.orkestrai', 'workspace.json'))).toBe(true);
    expect(existsSync(join(dir, '.claude', 'skills', 'orkestrai', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.cline', 'skills', 'orkestrai', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, '.agents', 'skills', 'orkestrai', 'SKILL.md'))).toBe(true);
    // AGENTS.md portavel + os formatos MCP proprios de cada provider.
    const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('<!-- orkestrai:begin -->');
    expect(agentsMd).toContain('orkestrai ask');
    const opencode = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'));
    expect(opencode.mcp.orkestrai).toMatchObject({
      type: 'local',
      command: [process.execPath, join(process.cwd(), 'packages', 'orkestrai-cli', 'bin', 'orkestrai.js'), 'mcp'],
      enabled: true,
    });
    for (const path of ['.mcp.json', '.cursor/mcp.json', '.cline/mcp.json', '.agents/mcp_config.json']) {
      const config = JSON.parse(readFileSync(join(dir, path), 'utf8'));
      expect(config.mcpServers.orkestrai.command).toBe(process.execPath);
      expect(config.mcpServers.orkestrai.args.at(-1)).toBe('mcp');
      if (path === '.mcp.json') {
        expect(config.mcpServers.figma).toEqual({ type: 'http', url: 'https://mcp.figma.com/mcp' });
      } else if (path === '.cursor/mcp.json') {
        expect(config.mcpServers.figma).toEqual({ url: 'https://mcp.figma.com/mcp' });
      } else {
        expect(config.mcpServers.figma).toBeUndefined();
      }
    }
  });

  it('preserva conteudo do usuario no AGENTS.md ao atualizar o bloco', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-merge-'));
    const { writeFileSync: write } = await import('node:fs');
    write(join(dir, 'AGENTS.md'), '# Meu projeto\n\nRegras minhas aqui.\n');
    const workspace = await workspaceService.create({ name: 'merge', workingDir: dir, icon: null, instructions: null });

    const agentsMd = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agentsMd).toContain('Regras minhas aqui.');
    expect(agentsMd).toContain('<!-- orkestrai:begin -->');
    expect(workspace.id).toBeTruthy();
  });

  it('preserva AGENTS.md e CLAUDE.md do usuario ao sincronizar instrucoes de preset', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-instructions-'));
    writeFileSync(join(dir, 'AGENTS.md'), '# Product rules\n\nNever rewrite this section.\n');
    writeFileSync(join(dir, 'CLAUDE.md'), '# Claude rules\n\nKeep this too.\n');

    const workspace = await workspaceService.create({
      name: 'instructions',
      workingDir: dir,
      icon: null,
      instructions: 'Team instructions.',
      syncAgentInstructionFiles: true,
    });
    await workspaceService.update(workspace.id, new UpdateWorkspaceDto({
      instructions: 'Updated team instructions.',
      syncAgentInstructionFiles: true,
    }));

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(agents).toContain('# Product rules');
    expect(agents).toContain('Never rewrite this section.');
    expect(agents).toContain('Updated team instructions.');
    expect(agents).not.toContain('\nTeam instructions.\n');
    expect(agents).toContain('<!-- orkestrai:begin -->');
    expect(claude).toContain('# Claude rules');
    expect(claude).toContain('Keep this too.');
    expect(claude).toContain('Updated team instructions.');
  });

  it('migrates legacy whole-file instructions into a managed block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-legacy-instructions-'));
    writeFileSync(join(dir, 'AGENTS.md'), 'Old managed instructions.\n');
    const workspace = await workspaceRepository.createWorkspace({
      name: 'legacy instructions',
      workingDir: dir,
      instructions: 'Old managed instructions.',
      syncAgentInstructionFiles: false,
    });

    await workspaceService.update(workspace.id, new UpdateWorkspaceDto({ instructions: 'New managed instructions.' }));

    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    expect(agents.match(/Old managed instructions\./g)).toBeNull();
    expect(agents).toContain('<!-- orkestrai:workspace-instructions:begin -->');
    expect(agents).toContain('New managed instructions.');
    expect(agents).toContain('<!-- orkestrai:begin -->');
  });

  it('preserva servidores MCP configurados pelo usuario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-mcp-'));
    const { mkdirSync: mkdir, writeFileSync: write } = await import('node:fs');
    mkdir(join(dir, '.cursor'), { recursive: true });
    write(
      join(dir, '.cursor', 'mcp.json'),
      `${JSON.stringify({ mcpServers: { custom: { command: 'custom-server', args: ['serve'] } } }, null, 2)}\n`
    );

    await workspaceService.create({ name: 'mcp-merge', workingDir: dir, icon: null, instructions: null });

    const config = JSON.parse(readFileSync(join(dir, '.cursor', 'mcp.json'), 'utf8'));
    expect(config.mcpServers.custom).toEqual({ command: 'custom-server', args: ['serve'] });
    expect(config.mcpServers.orkestrai.command).toBe(process.execPath);
    expect(config.mcpServers.figma.url).toBe('https://mcp.figma.com/mcp');
  });

  it('repara skill e token ao abrir workspace antigo (sem provisionamento)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-old-'));
    // Criado direto no repositorio: simula workspace de versao antiga do app.
    const workspace = await workspaceRepository.createWorkspace({ name: 'antigo', workingDir: dir });
    expect(existsSync(join(dir, '.orkestrai', 'workspace.json'))).toBe(false);

    await workspaceService.get(workspace.id);

    expect(existsSync(join(dir, '.orkestrai', 'workspace.json'))).toBe(true);
    const skillPath = join(dir, '.claude', 'skills', 'orkestrai', 'SKILL.md');
    expect(existsSync(skillPath)).toBe(true);
    const skill = readFileSync(skillPath, 'utf8');
    expect(skill).toContain('Modo Maestro');
    expect(skill).toContain('ORKESTRAI_NODE_ID');

    const config = JSON.parse(readFileSync(join(dir, '.orkestrai', 'workspace.json'), 'utf8'));
    expect(config.token).toBeTruthy();
  });

  it('atualiza skill com conteudo antigo ao abrir o workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-prov-stale-'));
    const workspace = await workspaceService.create({ name: 'stale', workingDir: dir, icon: null, instructions: null });
    // Envelhece a skill (simula template de versao anterior).
    const skillPath = join(dir, '.claude', 'skills', 'orkestrai', 'SKILL.md');
    const { writeFileSync: write, mkdirSync: mkdir } = await import('node:fs');
    mkdir(join(dir, '.claude', 'skills', 'orkestrai'), { recursive: true });
    write(skillPath, '---\nname: orkestrai-bridge\n---\nskill antiga\n');

    const staleService = new (await import('$lib/modules/agent-room/application/services/WorkspaceService.js')).WorkspaceService();
    await staleService.get(workspace.id);

    const skill = readFileSync(skillPath, 'utf8');
    expect(skill).toContain('Modo Maestro');
    expect(skill).not.toContain('skill antiga');
  });
});
