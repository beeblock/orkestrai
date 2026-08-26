import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { presetService } from '$lib/modules/agent-room/application/services/PresetService.js';
import { roleService } from '$lib/modules/agent-room/application/services/RoleService.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { boardColumnService } from '$lib/modules/agent-room/application/services/BoardColumnService.js';
import { mcpService } from '$lib/modules/agent-room/application/services/McpService.js';
import { workspaceGroupService } from '$lib/modules/agent-room/application/services/WorkspaceGroupService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('PresetService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('snapshot + apply em workspace novo: time, arestas, roles, rotinas e nota instanciados sem runtime', async () => {
    // Monta um workspace completo: lider + dev conectados, nota, role, rotina.
    const sourceDir = mkdtempSync(join(tmpdir(), 'orkestrai-preset-src-'));
    const source = await workspaceRepository.createWorkspace({ name: 'Origem', workingDir: sourceDir });
    const leader = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'terminal',
      title: 'Lider',
      payload: { command: 'claude', provider: 'claude', maestro: true, sessionId: 'sessao-viva', agentSessionId: 'abc' },
    });
    const dev = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'terminal',
      title: 'Dev',
      payload: { command: 'codex', provider: 'codex' },
    });
    const note = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'note',
      title: 'Bootstrap',
      payload: { content: 'scaffold com o framework X' },
    });
    await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: leader.id, targetNodeId: dev.id });
    await workspaceRepository.createEdge({ workspaceId: source.id, sourceNodeId: note.id, targetNodeId: leader.id });
    await roleService.save(source.id, { name: 'Revisor', color: '#123456', prompt: 'so revisa' });
    mkdirSync(join(sourceDir, '.agents', 'skills', 'svelar'), { recursive: true });
    writeFileSync(join(sourceDir, '.agents', 'skills', 'svelar', 'SKILL.md'), '# Svelar\n\nSiga as convencoes do framework.\n');
    await routineService.create({ workspaceId: source.id, targetNodeId: leader.id, prompt: 'verifique o quadro', intervalMinutes: 5 });
    // Tarefa-template vinculada ao lider + nota, e MCP extra no projeto.
    await taskBoardService.create(source.id, { title: 'Montar a base', description: 'Leia a spec completa antes de implementar.', assigneeNodeId: leader.id, noteId: note.id, createdBy: 'user', dispatch: false });
    await mcpService.add(source.id, { name: 'web', command: 'uvx', args: ['mcp-web'] });

    const preset = await presetService.createFromWorkspace(source.id, { name: 'Time Svelar', description: 'framework proprio' });
    expect(preset.agents).toBe(2);

    // Aplica num workspace NOVO (outra pasta).
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-preset-'));
    const applied = await presetService.apply(preset.id, { name: 'Projeto Novo', workingDir: dir });
    expect(applied.nodes).toBe(3);
    expect(applied.edges).toBe(2);
    expect(applied.roles).toBe(1);
    expect(applied.routines).toBe(1);

    const nodes = await workspaceRepository.listNodes(applied.workspaceId);
    const newLeader = nodes.find((node) => node.title === 'Lider');
    expect(newLeader).toBeTruthy();
    const leaderPayload = newLeader!.payload as Record<string, unknown>;
    // Runtime NAO viaja: sem sessao PTY nem session-id da CLI.
    expect(leaderPayload.sessionId).toBeUndefined();
    expect(leaderPayload.agentSessionId).toBeUndefined();
    expect(leaderPayload.maestro).toBe(true);
    expect(leaderPayload.args).toContain('--dangerously-skip-permissions');
    const newDev = nodes.find((node) => node.title === 'Dev');
    expect((newDev!.payload as { args?: string[] }).args).toContain('--dangerously-bypass-approvals-and-sandbox');

    // Arestas apontam para os NOVOS ids.
    const edges = await workspaceRepository.listEdges(applied.workspaceId);
    const ids = new Set(nodes.map((node) => node.id));
    for (const edge of edges) {
      expect(ids.has(edge.sourceNodeId)).toBe(true);
      expect(ids.has(edge.targetNodeId)).toBe(true);
    }

    // Role instalada no destino; rotina aponta para o NOVO lider.
    expect(await roleService.get(applied.workspaceId, 'Revisor')).toBeTruthy();
    const routines = await routineService.list(applied.workspaceId);
    expect(routines[0].targetNodeId).toBe(newLeader!.id);

    // Tarefa-template instanciada com responsavel e nota pelos NOVOS ids;
    // MCP extra aplicado no .mcp.json do projeto de destino.
    const tasks = await taskBoardService.list(applied.workspaceId);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Montar a base');
    expect(tasks[0].description).toBe('Leia a spec completa antes de implementar.');
    expect(tasks[0].status).toBe('doing');
    expect(tasks[0].assigneeNodeId).toBe(newLeader!.id);
    const newNote = nodes.find((node) => node.title === 'Bootstrap');
    expect(tasks[0].noteId).toBe(newNote!.id);
    const mcps = await mcpService.list(applied.workspaceId);
    expect(mcps.some((server) => server.name === 'web')).toBe(true);
    expect(existsSync(join(dir, '.agents', 'skills', 'svelar', 'SKILL.md'))).toBe(true);

    // Workspace destino com nome/pasta do usuario (nao do preset).
    const workspace = await workspaceRepository.getWorkspace(applied.workspaceId);
    expect(workspace!.name).toBe('Projeto Novo');
    expect(workspace!.workingDir).toBe(dir);
    expect(existsSync(join(dir, '.orkestrai', 'workspace.json'))).toBe(true);
  });

  it('aplicar em workspace existente soma o time sem apagar o que existe', async () => {
    const source = await workspaceRepository.createWorkspace({ name: 'Base', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({
      workspaceId: source.id,
      type: 'terminal',
      title: 'QA',
      x: 100,
      payload: { command: 'kimi', provider: 'kimi' },
    });
    const preset = await presetService.createFromWorkspace(source.id, { name: 'QA Solo' });

    const target = await workspaceRepository.createWorkspace({ name: 'Existente', workingDir: '/tmp' });
    const mine = await workspaceRepository.createNode({ workspaceId: target.id, type: 'note', title: 'Minha nota', x: 0 });
    const applied = await presetService.apply(preset.id, { workspaceId: target.id });

    const nodes = await workspaceRepository.listNodes(target.id);
    expect(nodes.some((node) => node.id === mine.id)).toBe(true); // existente intacto
    const qa = nodes.find((node) => node.title === 'QA');
    expect(qa).toBeTruthy();
    expect(qa!.id).not.toBe(agent.id); // id novo
    expect(qa!.x).toBeGreaterThan(100); // offset para nao colidir
    expect(applied.nodes).toBe(1);
  });

  it('remove preset', async () => {
    const source = await workspaceRepository.createWorkspace({ name: 'Tmp', workingDir: '/tmp' });
    const preset = await presetService.createFromWorkspace(source.id, { name: 'Descartavel' });
    expect(await presetService.remove(preset.id)).toBe(true);
    expect(await presetService.list()).toHaveLength(0);
  });

  it('lists and applies localized builtin presets without persisting them', async () => {
    const presets = await presetService.list({ includeBuiltin: true, locale: 'en' });
    expect(presets.filter((preset) => preset.builtin)).toHaveLength(10);
    const svelar = presets.find((preset) => preset.id === 'builtin:svelar-team');
    expect(svelar?.name).toBe('Svelar team');

    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-builtin-'));
    const applied = await presetService.apply('builtin:svelar-team', { name: 'Svelar App', workingDir: dir, locale: 'en' });
    expect(applied.nodes).toBe(6);
    expect(applied.roles).toBe(4);
    expect(applied.tasks).toBe(1);
    expect(applied.skills).toBe(2);
    expect(existsSync(join(dir, '.agents', 'skills', 'svelar', 'SKILL.md'))).toBe(true);
    const workspace = await workspaceRepository.getWorkspace(applied.workspaceId);
    expect(workspace?.instructions).toContain('Team prepared to deliver Svelar');
    expect(workspace?.syncAgentInstructionFiles).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, '.orkestrai', 'workspace.json'))).toBe(true);

    const roles = await roleService.list(applied.workspaceId);
    expect(roles).toHaveLength(4);
    expect(roles.every((role) => role.prompt.length > 700)).toBe(true);
    expect(roles[0].prompt).toContain('Kanban');

    const initialTasks = await taskBoardService.list(applied.workspaceId);
    expect(initialTasks).toHaveLength(1);
    expect(initialTasks[0].assigneeNodeId).toBeNull();
    expect(initialTasks[0].description.length).toBeGreaterThan(40);

    const nodes = await workspaceRepository.listNodes(applied.workspaceId);
    const argsFor = (provider: string) => {
      const terminal = nodes.find(
        (node) => node.type === 'terminal' && (node.payload as { provider?: string }).provider === provider
      );
      return (terminal?.payload as { args?: string[] } | undefined)?.args;
    };
    expect(argsFor('claude')).toContain('--dangerously-skip-permissions');
    expect(argsFor('codex')).toContain('--dangerously-bypass-approvals-and-sandbox');
    expect(argsFor('kimi')).toContain('--auto');

    const roleArgsFor = (provider: string) => {
      const terminal = nodes.find(
        (node) => node.type === 'terminal' && (node.payload as { provider?: string }).provider === provider
      );
      return (terminal?.payload as { initialRoleArgs?: string[] } | undefined)?.initialRoleArgs;
    };
    expect(roleArgsFor('claude')?.[0]).toBe('--append-system-prompt');
    expect(roleArgsFor('codex')?.[0]).toBe('-c');
    expect(roleArgsFor('codex')?.[1]).toContain('developer_instructions=');
    expect(roleArgsFor('kimi')?.[0]).toBe('--agent-file');
    expect(roleArgsFor('kimi')?.[1]).toContain('.orkestrai/roles/');
  });

  it('creates a preset workspace directly in the selected destination group', async () => {
    const group = await workspaceGroupService.create({ name: 'Preset projects' });
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-preset-group-'));

    const applied = await presetService.apply('builtin:svelar-team', {
      name: 'Grouped Svelar app',
      workingDir: dir,
      locale: 'en',
      groupId: group.id,
    });

    expect(await workspaceRepository.getWorkspace(applied.workspaceId)).toMatchObject({
      groupId: group.id,
      position: 0,
    });
  });

  it('installs the Orkestrai contributing consensus team and its complete workflow', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-contributing-'));
    const applied = await presetService.apply('builtin:orkestrai-contributing', {
      name: 'Contribuição Orkestrai',
      workingDir: dir,
      locale: 'pt-BR',
    });

    expect(applied.nodes).toBe(12);
    expect(applied.roles).toBe(6);
    expect(applied.tasks).toBe(1);
    expect(applied.columns).toBe(3);
    expect(applied.skills).toBe(6);

    const nodes = await workspaceRepository.listNodes(applied.workspaceId);
    expect(nodes.filter((node) => node.type === 'terminal')).toHaveLength(6);
    const flow = nodes.find((node) => node.type === 'flow');
    expect(flow).toBeTruthy();
    expect((flow!.payload as { steps?: unknown[] }).steps).toHaveLength(7);
    expect(nodes.find((node) => node.title === 'Oráculo Codex')).toBeTruthy();
    expect(nodes.find((node) => node.title === 'Oráculo Kimi')).toBeTruthy();

    const columns = await boardColumnService.list(applied.workspaceId);
    expect(columns.map((column) => column.key)).toEqual(['todo', 'planned', 'doing', 'review', 'validation', 'done']);
    expect(columns.map((column) => column.name)).toEqual(['Entrada', 'Planejado', 'Em andamento', 'Revisão', 'Validação', 'Feito']);
    const tasks = await taskBoardService.list(applied.workspaceId);
    expect(tasks[0].noteTitle).toBe('Protocolo de consenso');
    expect(existsSync(join(dir, '.agents', 'skills', 'orkestrai-contributing', 'SKILL.md'))).toBe(true);
  });

  it('starts non-development teams with localized workflow stages', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-campaign-'));
    const applied = await presetService.apply('builtin:campaign-launch', {
      name: 'Campanha',
      workingDir: dir,
      locale: 'pt-BR',
    });
    const columns = await boardColumnService.list(applied.workspaceId);
    expect(columns.map((column) => column.name)).toEqual(['Briefing', 'Planejado', 'Produção', 'Aprovação', 'Publicado']);
    expect((await taskBoardService.list(applied.workspaceId))[0].status).toBe('todo');
  });

  it('exports, imports, and versions checksum-protected Team Packs', async () => {
    const source = await workspaceRepository.createWorkspace({ name: 'Pack source', workingDir: mkdtempSync(join(tmpdir(), 'orkestrai-pack-source-')) });
    await workspaceRepository.createNode({ workspaceId: source.id, type: 'terminal', title: 'Lead', payload: { provider: 'codex', maestro: true } });
    const created = await presetService.createFromWorkspace(source.id, { name: 'Product team', description: 'A complete team' });
    expect(created.version).toBe('1.0.0');
    expect((await presetService.revisions(created.id))).toHaveLength(1);

    const published = await presetService.publish(created.id, { version: '1.1.0', releaseNotes: 'Add review guidance.' });
    expect(published.version).toBe('1.1.0');
    expect((await presetService.revisions(created.id)).map((item) => item.version)).toEqual(['1.1.0', '1.0.0']);

    const bundle = await presetService.exportPack(created.id, 'en');
    expect(bundle).toMatchObject({ format: 'orkestrai-team-pack', schemaVersion: 1, manifest: { version: '1.1.0' } });
    const imported = await presetService.importPack(bundle);
    expect(imported).toMatchObject({ name: 'Product team', version: '1.1.0' });
    await expect(presetService.importPack({ ...bundle, data: { ...bundle.data, createdAt: '2030-01-01T00:00:00.000Z' } })).rejects.toThrow('Checksum');
    await expect(presetService.publish(created.id, { version: '1.0.5' })).rejects.toThrow('maior');
  });
});
