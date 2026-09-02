import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node-pty';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';

beforeEach(() => {
  vi.spyOn(agentSessionService, 'ensure').mockImplementation(async (_workspaceId, nodeId) => ({
    nodeId,
    sessionId: `test-session-${nodeId}`,
    state: 'started',
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function createWorkspaceWithTerminal() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'bridge', workingDir: '/tmp' });
  const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
  const terminal = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Gato',
    payload: { command: '/bin/cat', sessionId: session.id },
  });
  return { workspace, terminal, session };
}

describe('BridgeService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('gera token por workspace, persiste e resolve por token', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'w', workingDir: '/tmp' });
    const token = await bridgeService.getOrCreateToken(workspace.id);
    expect(token).toHaveLength(48);

    const again = await bridgeService.getOrCreateToken(workspace.id);
    expect(again).toBe(token);

    const resolved = await bridgeService.resolveWorkspaceByToken(token);
    expect(resolved.id).toBe(workspace.id);

    await expect(bridgeService.resolveWorkspaceByToken('token-errado')).rejects.toThrow('inválido');
  });

  it('provisiona launcher e MCP usando caminhos Linux em workspaces WSL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-wsl-'));
    try {
      const workspace = await workspaceRepository.createWorkspace({
        name: 'wsl',
        workingDir: dir,
        runtimeKind: 'wsl',
        wslDistribution: 'Ubuntu-24.04',
        wslWorkingDir: '/home/dev/project',
      });
      const token = await bridgeService.getOrCreateToken(workspace.id);
      await bridgeService.provisionSkill(workspace, token);

      const launcher = await readFile(join(dir, '.orkestrai', 'bin', 'orkestrai'), 'utf8');
      const mcp = JSON.parse(await readFile(join(dir, '.mcp.json'), 'utf8'));
      expect(launcher).toContain('runtime="$(wslpath -u');
      expect(launcher).toContain('exec "$runtime"');
      expect(mcp.mcpServers.orkestrai).toEqual({
        command: 'wsl.exe',
        args: [
          '--distribution',
          'Ubuntu-24.04',
          '--exec',
          '/bin/sh',
          '/home/dev/project/.orkestrai/bin/orkestrai',
          'mcp',
        ],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('lista agentes do workspace com estado da sessao', async () => {
    const { workspace, terminal, session } = await createWorkspaceWithTerminal();
    const agents = await bridgeService.listAgents(workspace.id);
    expect(agents).toHaveLength(1);
    expect(agents[0].title).toBe('Gato');
    expect(agents[0].sessionAlive).toBe(true);
    ptySessionManager.kill(session.id);
    terminal.id && (await workspaceRepository.deleteNode(terminal.id));
  });

  it('infers a restored agent identity only from its assigned workspace task', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'activity', workingDir: '/tmp' });
    const terminal = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Acceptance Lead',
      payload: { command: 'codex', provider: 'codex' },
    });
    const assigned = await taskBoardService.create(workspace.id, {
      title: 'Review architecture',
      assigneeNodeId: terminal.id,
      createdBy: 'test',
      dispatch: false,
    });
    const unassigned = await taskBoardService.create(workspace.id, {
      title: 'Unassigned review',
      createdBy: 'test',
      dispatch: false,
    });

    const result = await bridgeService.reportActivity(workspace.id, {
      state: 'working',
      action: 'Reviewing architecture and test coverage',
      taskId: assigned.id,
    });
    expect(result).toMatchObject({ recorded: true, nodeId: terminal.id, state: 'working' });
    expect(await controlCenterRepository.listActivity(workspace.id)).toContainEqual(
      expect.objectContaining({ nodeId: terminal.id, state: 'working', taskId: assigned.id }),
    );

    await expect(bridgeService.reportActivity(workspace.id, {
      state: 'working',
      taskId: unassigned.id,
    })).rejects.toThrow('não tem responsável');
  });

  it('ask envia mensagem ao PTY e retorna a resposta apos silencio', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();

    const result = await bridgeService.ask(workspace.id, {
      to: 'Gato',
      message: 'ping-ponte',
      timeoutMs: 15_000,
    });

    expect(result.to).toBe('Gato');
    expect(result.timedOut).toBe(false);
    expect(result.delivered).toBe(true);
    expect(result.replyConfirmed).toBe(true);
    expect(result.reply).toContain('ping-ponte');
    expect(result.messageId).toBeTruthy();
    expect(result.deliveryState).toBe('replied');
    expect((await controlCenterService.snapshot(workspace.id)).communications[0].events.map((event) => event.state)).toEqual([
      'queued',
      'sent',
      'delivered',
      'acknowledged',
      'replied',
    ]);
    ptySessionManager.kill(session.id);
  });

  it('serializa mensagens concorrentes destinadas ao mesmo terminal', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();

    const [first, second] = await Promise.all([
      bridgeService.ask(workspace.id, { to: 'Gato', message: 'primeira-mensagem', timeoutMs: 15_000 }),
      bridgeService.ask(workspace.id, { to: 'Gato', message: 'segunda-mensagem', timeoutMs: 15_000 }),
    ]);

    expect(first.reply).toContain('primeira-mensagem');
    expect(first.reply).not.toContain('segunda-mensagem');
    expect(second.reply).toContain('segunda-mensagem');
    expect(second.reply).not.toContain('primeira-mensagem');
    ptySessionManager.kill(session.id);
  }, 20_000);

  it('ask funciona nos dois sentidos entre terminais Claude e Codex', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'duplex', workingDir: '/tmp' });
    const claudeSession = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const codexSession = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Claude',
      payload: { command: '/bin/cat', sessionId: claudeSession.id, maestro: true },
    });
    await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { command: '/bin/cat', sessionId: codexSession.id },
    });

    const toCodex = await bridgeService.ask(workspace.id, { to: 'Codex', from: 'Claude', message: 'claude-para-codex', timeoutMs: 15_000 });
    const toClaude = await bridgeService.ask(workspace.id, { to: 'Claude', from: 'Codex', message: 'codex-para-claude', timeoutMs: 15_000 });
    expect(toCodex).toMatchObject({ delivered: true, replyConfirmed: true, timedOut: false });
    expect(toCodex.reply).toContain('claude-para-codex');
    expect(toClaude).toMatchObject({ delivered: true, replyConfirmed: true, timedOut: false });
    expect(toClaude.reply).toContain('codex-para-claude');

    ptySessionManager.kill(claudeSession.id);
    ptySessionManager.kill(codexSession.id);
  }, 20_000);

  it('ask falha claro para agente inexistente', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();
    await expect(bridgeService.ask(workspace.id, { to: 'NaoExiste', message: 'oi' })).rejects.toThrow('não encontrado');
    ptySessionManager.kill(session.id);
  });

  it('le, escreve e edita notas por substring', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'w', workingDir: '/tmp' });
    const note = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'note',
      payload: { content: 'versao 1 do plano' },
    });

    const read = await bridgeService.readNote(workspace.id, note.id);
    expect(read.content).toBe('versao 1 do plano');

    await bridgeService.writeNote(workspace.id, note.id, 'versao 2 do plano inteiro');
    expect((await bridgeService.readNote(workspace.id, note.id)).content).toContain('versao 2');

    await bridgeService.editNote(workspace.id, note.id, 'versao 2', 'versao 3');
    expect((await bridgeService.readNote(workspace.id, note.id)).content).toBe('versao 3 do plano inteiro');

    await expect(bridgeService.editNote(workspace.id, note.id, 'inexistente', 'x')).rejects.toThrow('não encontrado');
  });

  it('notas conectadas a um agente via aresta', async () => {
    const { workspace, terminal, session } = await createWorkspaceWithTerminal();
    const note = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note', payload: { content: '' } });
    const otherTerminal = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
    await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: terminal.id, targetNodeId: note.id });
    await workspaceRepository.createEdge({ workspaceId: workspace.id, sourceNodeId: otherTerminal.id, targetNodeId: note.id });

    expect(await bridgeService.notesForAgent(workspace.id, terminal.id)).toEqual([note.id]);
    expect(await bridgeService.listNotes(workspace.id, terminal.id)).toEqual([
      expect.objectContaining({ nodeId: note.id, title: 'Nota', preview: '' }),
    ]);
    ptySessionManager.kill(session.id);
  });
});

describe('Modo Maestro', () => {
  useSvelarTest({ refreshDatabase: true });

  async function setupMaestro(maestro: boolean) {
    const workspace = await workspaceRepository.createWorkspace({ name: 'maestro-ws', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Lider',
      payload: { command: 'claude', provider: 'claude', maestro },
    });
    return { workspace, leader };
  }

  it('recruta, conecta e dispensa com permissao de maestro', async () => {
    const { workspace, leader } = await setupMaestro(true);

    const recruited = await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Recruta', provider: 'kimi' });
    expect(recruited.title).toBe('Recruta');
    const nodes = await workspaceRepository.listNodes(workspace.id);
    expect(nodes).toHaveLength(2);
    const recrutaNode = nodes.find((node) => node.id === recruited.nodeId)!;
    expect((recrutaNode.payload as { command?: string }).command).toBe('kimi');

    const connection = await bridgeService.connectNodes(workspace.id, { from: 'Lider', to: 'Recruta' });
    expect(connection.from).toBe('Lider');
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(1);

    const dismissed = await bridgeService.dismiss(workspace.id, { from: 'Lider', target: 'Recruta' });
    expect(dismissed.dismissed).toBe('Recruta');
    expect(await workspaceRepository.listNodes(workspace.id)).toHaveLength(1);
    leader.id && expect((await workspaceRepository.listNodes(workspace.id))[0].id).toBe(leader.id);
  });

  it('recruta no andar ativo solicitado e rejeita andar encerrado', async () => {
    const { workspace } = await setupMaestro(true);
    const floor = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspace.id,
      name: 'Checkout',
      branch: 'orkestrai/checkout',
      path: '/tmp/checkout',
      status: 'active',
    });
    const floorId = String(floor.getAttribute('id'));

    const recruited = await bridgeService.recruit(workspace.id, {
      from: 'Lider',
      title: 'Frontend',
      provider: 'codex',
      floorId,
    });
    expect((await workspaceRepository.getNode(recruited.nodeId))?.floorId).toBe(floorId);

    await AgentFloor.query().where('id', floorId).update({ status: 'landed' });
    await expect(bridgeService.recruit(workspace.id, {
      from: 'Lider',
      title: 'QA',
      provider: 'kimi',
      floorId,
    })).rejects.toThrow('Andar ativo');
  });

  it('herda o andar do maestro e só confirma depois de ativar a sessão', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'wsl-floor', workingDir: '/tmp' });
    const floor = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspace.id,
      name: 'WSL team',
      branch: 'orkestrai/wsl-team',
      path: '/tmp/wsl-team',
      status: 'active',
    });
    const floorId = String(floor.getAttribute('id'));
    const leader = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Lider WSL',
      payload: { command: 'claude', provider: 'claude', maestro: true },
      floorId,
    });

    const recruited = await bridgeService.recruit(workspace.id, {
      from: 'Lider WSL',
      title: 'Dev WSL',
      provider: 'codex',
    });

    expect(recruited).toMatchObject({ sessionState: 'started' });
    expect(agentSessionService.ensure).toHaveBeenCalledWith(workspace.id, recruited.nodeId);
    expect((await workspaceRepository.getNode(recruited.nodeId))?.floorId).toBe(floorId);
    const edges = await workspaceRepository.listEdges(workspace.id);
    expect(edges.some((edge) => edge.sourceNodeId === leader.id && edge.targetNodeId === recruited.nodeId)).toBe(true);
  });

  it('remove o nó e a aresta quando a sessão do recruta não inicia', async () => {
    const { workspace, leader } = await setupMaestro(true);
    vi.mocked(agentSessionService.ensure).mockRejectedValueOnce(new Error('WSL_COMMAND_NOT_FOUND'));

    await expect(bridgeService.recruit(workspace.id, {
      from: 'Lider',
      title: 'Agente quebrado',
      provider: 'codex',
    })).rejects.toThrow('WSL_COMMAND_NOT_FOUND');

    expect((await workspaceRepository.listNodes(workspace.id)).map((node) => node.id)).toEqual([leader.id]);
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(0);
  });

  it('bloqueia acoes sem Modo Maestro ativo', async () => {
    const { workspace } = await setupMaestro(false);
    await expect(bridgeService.recruit(workspace.id, { from: 'Lider', title: 'X' })).rejects.toThrow('Modo Maestro');
    await expect(bridgeService.connectNodes(workspace.id, { from: 'Lider', to: 'Lider' })).rejects.toThrow('Modo Maestro');
    await expect(bridgeService.dismiss(workspace.id, { from: 'Lider', target: 'Lider' })).rejects.toThrow('Modo Maestro');
  });

  it('maestro nao pode dispensar a si mesmo', async () => {
    const { workspace } = await setupMaestro(true);
    await expect(bridgeService.dismiss(workspace.id, { from: 'Lider', target: 'Lider' })).rejects.toThrow('si mesmo');
  });

  it('replace substitui recruta preservando o no', async () => {
    const { workspace } = await setupMaestro(true);
    const recruited = await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Recruta', provider: 'codex' });
    const replaced = await bridgeService.recruit(workspace.id, {
      from: 'Lider',
      title: 'Recruta',
      provider: 'claude',
      replace: 'Recruta',
    });
    expect(replaced.replaced).toBe(true);
    expect(replaced.nodeId).toBe(recruited.nodeId);
    const node = await workspaceRepository.getNode(recruited.nodeId);
    expect((node!.payload as { command?: string }).command).toBe('claude');
    expect((node!.payload as { provider?: string }).provider).toBe('claude');
    expect((node!.payload as { sessionId?: string; agentSessionId?: string }).sessionId).toBeUndefined();
    expect((node!.payload as { agentSessionId?: string }).agentSessionId).toBeUndefined();
  });

  it('rejeita provider desconhecido em vez de criar um shell sem agente', async () => {
    const { workspace } = await setupMaestro(true);
    await expect(
      bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Invalido', provider: 'nao-existe' })
    ).rejects.toThrow('Provider desconhecido');
  });

  it('recruta nasce conectado ao maestro e com titulo curto', async () => {
    const { workspace, leader } = await setupMaestro(true);
    const longTitle = 'Arquiteto frontend scaffold Vite+ReactTS, estrutura de pastas, estado global, integracao final do time';
    const recruited = await bridgeService.recruit(workspace.id, { from: 'Lider', title: longTitle, provider: 'kimi' });

    expect(recruited.title!.length).toBeLessThanOrEqual(48);
    expect(recruited.title).toContain('…');

    const edges = await workspaceRepository.listEdges(workspace.id);
    expect(edges).toHaveLength(1);
    expect([edges[0].sourceNodeId, edges[0].targetNodeId].sort()).toEqual([leader.id, recruited.nodeId].sort());
  });

  it('nota com --connect all conecta a todos os agentes', async () => {
    const { workspace } = await setupMaestro(true);
    await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'A1', provider: 'kimi' });
    await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'A2', provider: 'codex' });

    const note = await bridgeService.createNote(workspace.id, { title: 'Spec', content: 'x', connect: 'all' });
    expect(note.connectedTo).toBe('todos os agentes');
    // 2 edges do recruit + 3 da nota (lider + 2 recrutas)
    expect(await workspaceRepository.listEdges(workspace.id)).toHaveLength(2 + 3);
  });

  it('nota sem destino conecta somente ao autor mesmo com roles repetidas', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'creative-flows', workingDir: '/tmp' });
    const author = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Diretor Criativo',
      payload: { command: 'codex', provider: 'codex' },
    });
    const other = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Diretor Criativo',
      payload: { command: 'codex', provider: 'codex' },
    });

    const note = await bridgeService.createNote(workspace.id, {
      title: 'Direção visual',
      content: 'Paleta e referências deste fluxo.',
      from: author.id,
    });

    expect(note.connectedTo).toBe('Diretor Criativo');
    const noteEdges = (await workspaceRepository.listEdges(workspace.id)).filter(
      (edge) => edge.sourceNodeId === note.nodeId || edge.targetNodeId === note.nodeId,
    );
    expect(noteEdges).toHaveLength(1);
    expect([noteEdges[0].sourceNodeId, noteEdges[0].targetNodeId]).toContain(author.id);
    expect([noteEdges[0].sourceNodeId, noteEdges[0].targetNodeId]).not.toContain(other.id);
  });

  it('nota sem identidade nem destino permanece sem conexoes', async () => {
    const { workspace } = await setupMaestro(true);
    await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Outro Diretor', provider: 'codex' });

    const note = await bridgeService.createNote(workspace.id, { title: 'Nota manual' });

    expect(note.connectedTo).toBeNull();
    const noteEdges = (await workspaceRepository.listEdges(workspace.id)).filter(
      (edge) => edge.sourceNodeId === note.nodeId || edge.targetNodeId === note.nodeId,
    );
    expect(noteEdges).toHaveLength(0);
  });

  it('valida o autor antes de persistir uma nota', async () => {
    const { workspace } = await setupMaestro(true);
    const before = (await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'note');

    await expect(bridgeService.createNote(workspace.id, {
      title: 'Nota que não deve existir',
      from: 'agente-inexistente',
    })).rejects.toThrow();

    const after = (await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'note');
    expect(after).toHaveLength(before.length);
  });

  it('quadro de tarefas aparece sozinho na primeira tarefa (idempotente)', async () => {
    const { workspace } = await setupMaestro(true);
    expect((await workspaceRepository.listNodes(workspace.id)).some((node) => node.type === 'tasks')).toBe(false);

    await bridgeService.ensureTasksBoard(workspace.id);
    await bridgeService.ensureTasksBoard(workspace.id);

    const nodes = await workspaceRepository.listNodes(workspace.id);
    expect(nodes.filter((node) => node.type === 'tasks')).toHaveLength(1);
  });

  it('portal create exige maestro, cria no com url e conecta', async () => {
    const { workspace, leader } = await setupMaestro(true);
    const portal = await bridgeService.createPortal(workspace.id, { from: 'Lider', url: 'localhost:5173' });
    expect(portal.url).toBe('http://localhost:5173');
    expect(portal.connectedTo).toBe('Lider');

    const node = await workspaceRepository.getNode(portal.nodeId);
    expect(node!.type).toBe('portal');
    expect((node!.payload as { url?: string }).url).toBe('http://localhost:5173');

    const edges = await workspaceRepository.listEdges(workspace.id);
    expect(edges).toHaveLength(1);
    expect([edges[0].sourceNodeId, edges[0].targetNodeId].sort()).toEqual([leader.id, portal.nodeId].sort());
  });

  it('lista todos os portais e explicita a conexao relativa ao agente', async () => {
    const { workspace, leader } = await setupMaestro(true);
    const connected = await bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      title: 'Aplicacao',
      url: 'localhost:5173',
    });
    const available = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'portal',
      title: 'Documentacao',
      payload: { url: 'https://docs.example.test' },
    });

    expect(await bridgeService.listPortals(workspace.id, leader.id)).toEqual([
      expect.objectContaining({ id: connected.nodeId, title: 'Aplicacao', connected: true }),
      expect.objectContaining({ id: available.id, title: 'Documentacao', connected: false }),
    ]);
  });

  it('reutiliza a mesma URL e exige intencao explicita para criar outro portal', async () => {
    const { workspace } = await setupMaestro(true);
    const original = await bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      title: 'Aplicacao',
      url: 'http://localhost:5173',
    });
    const reused = await bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      title: 'Duplicado',
      url: 'http://localhost:5173/',
    });

    expect(reused).toMatchObject({ nodeId: original.nodeId, title: 'Aplicacao', reused: true });
    await expect(bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      url: 'http://localhost:4173',
    })).rejects.toThrow('já possui portal');

    const additional = await bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      title: 'Documentacao',
      url: 'http://localhost:4173',
      forceNew: true,
    });
    expect(additional.reused).toBe(false);
    expect((await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'portal')).toHaveLength(2);
  });

  it('rejeita esquemas e credenciais que nao podem ser persistidos em portal', async () => {
    const { workspace } = await setupMaestro(true);
    await expect(bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      url: 'file:///tmp/secret',
    })).rejects.toThrow('HTTP ou HTTPS');
    await expect(bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      url: 'https://user:password@example.test',
    })).rejects.toThrow('não pode conter credenciais');
  });

  it('resolve portal por nome unico e rejeita nomes ambiguos', async () => {
    const { workspace } = await setupMaestro(true);
    const first = await bridgeService.createPortal(workspace.id, {
      from: 'Lider',
      title: 'Checkout',
      url: 'http://localhost:5173',
    });
    expect((await bridgeService.resolvePortal(workspace.id, 'Checkout')).id).toBe(first.nodeId);
    expect((await bridgeService.resolvePortal(workspace.id, 'Check')).id).toBe(first.nodeId);

    await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'portal',
      title: 'Checkout',
      payload: { url: 'http://localhost:4173' },
    });
    await expect(bridgeService.resolvePortal(workspace.id, 'Checkout')).rejects.toThrow('mais de um portal');
  });

  it('ask cria aresta entre os agentes que conversam', async () => {
    const { workspace, leader } = await setupMaestro(true);
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    await workspaceRepository.updateNode(leader.id, { payload: { command: '/bin/cat', maestro: true, sessionId: session.id } });
    const recruited = await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Recruta', provider: 'kimi' });
    const sessionB = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    await workspaceRepository.updateNode(recruited.nodeId, { payload: { command: '/bin/cat', sessionId: sessionB.id } });

    const before = await workspaceRepository.listEdges(workspace.id);
    await bridgeService.ask(workspace.id, { to: 'Recruta', message: 'ping', from: 'Lider', timeoutMs: 15_000 });
    const after = await workspaceRepository.listEdges(workspace.id);

    expect(after.length).toBe(before.length); // aresta do recruit ja cobre o par (dedup)
    expect(after.some((edge) => [edge.sourceNodeId, edge.targetNodeId].includes(recruited.nodeId))).toBe(true);
    ptySessionManager.kill(session.id);
    ptySessionManager.kill(sessionB.id);
  });
});

describe('titulos de agente (roteamento do ask)', () => {
  useSvelarTest({ refreshDatabase: true });

  it('ask com titulo duplicado falha com orientacao clara', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'dup', workingDir: '/tmp' });
    for (const title of ['Claude', 'Claude']) {
      const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
      await workspaceRepository.createNode({
        workspaceId: workspace.id,
        type: 'terminal',
        title,
        payload: { command: '/bin/cat', provider: 'claude', sessionId: session.id },
      });
    }
    await expect(bridgeService.ask(workspace.id, { to: 'Claude', message: 'oi' })).rejects.toThrow('agentes chamados');
    // limpa as sessoes criadas no loop
    const nodes = await workspaceRepository.listNodes(workspace.id);
    for (const node of nodes) {
      const sessionId = (node.payload as { sessionId?: string }).sessionId;
      if (sessionId) ptySessionManager.kill(sessionId);
    }
  });

  it('recruit gera titulo unico automaticamente', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'uniq', workingDir: '/tmp' });
    await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Lider',
      payload: { command: 'claude', provider: 'claude', maestro: true },
    });
    const first = await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Dev', provider: 'kimi' });
    const second = await bridgeService.recruit(workspace.id, { from: 'Lider', title: 'Dev', provider: 'kimi' });
    expect(first.title).toBe('Dev');
    expect(second.title).toBe('Dev 2');
  });
});
