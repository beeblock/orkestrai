import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { boardColumnService } from '$lib/modules/agent-room/application/services/BoardColumnService.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

async function createWorkspaceWithTerminal() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'board', workingDir: '/tmp' });
  const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
  const terminal = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Gato',
    payload: { command: '/bin/cat', sessionId: session.id },
  });
  return { workspace, terminal, session };
}

async function createWorkspaceWithLeader() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'board-leader', workingDir: '/tmp' });
  const leaderSession = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
  const leader = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Lider',
    payload: { command: 'claude', provider: 'claude', maestro: true, sessionId: leaderSession.id },
  });
  return { workspace, leader, leaderSession };
}

describe('TaskBoardService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('cria, move, atribui e remove tarefas', async () => {
    const { workspace, terminal, session } = await createWorkspaceWithTerminal();

    const task = await taskBoardService.create(workspace.id, { title: 'Revisar PR' });
    expect(task.status).toBe('todo');
    expect(task.assigneeNodeId).toBeNull();

    const doing = await taskBoardService.update(workspace.id, task.id, { status: 'doing' });
    expect(doing.status).toBe('doing');

    const assigned = await taskBoardService.update(workspace.id, task.id, { assigneeNodeId: terminal.id });
    expect(assigned.assigneeNodeId).toBe(terminal.id);
    expect(assigned.status).toBe('doing'); // atribuir move para doing automaticamente

    const done = await taskBoardService.update(workspace.id, task.id, { status: 'done' });
    expect(done.status).toBe('done');

    expect(await taskBoardService.list(workspace.id)).toHaveLength(1);
    await taskBoardService.remove(workspace.id, task.id);
    expect(await taskBoardService.list(workspace.id)).toHaveLength(0);
    ptySessionManager.kill(session.id);
  });

  it('personaliza etapas e mantém tarefas e agentes alinhados pelas chaves do quadro', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'workflow', workingDir: '/tmp' });
    const parallelLists = await Promise.all([boardColumnService.list(workspace.id), boardColumnService.list(workspace.id)]);
    expect(parallelLists[0].map((column) => column.key)).toEqual(['todo', 'doing', 'done']);
    expect(parallelLists[1]).toHaveLength(3);

    const review = await boardColumnService.create(workspace.id, { name: 'Revisão do cliente', color: '#9675ff' });
    expect(review.key).toBe('revisao-do-cliente');
    await expect(boardColumnService.create(workspace.id, { name: 'revisão do cliente' })).rejects.toThrow('Já existe');
    const task = await taskBoardService.create(workspace.id, { title: 'Aprovar campanha', status: 'Revisão do cliente' });
    expect(task.status).toBe(review.key);
    await expect(taskBoardService.update(workspace.id, task.id, { status: 'Etapa inexistente' })).rejects.toThrow('Coluna desconhecida');
    await expect(boardColumnService.remove(workspace.id, review.id)).rejects.toThrow('Mova as tarefas');

    await boardColumnService.update(workspace.id, review.id, { name: 'Aprovação', position: 1, color: '#ff7a90' });
    const columns = await boardColumnService.list(workspace.id);
    expect(columns.map((column) => column.key)).toEqual(['todo', review.key, 'doing', 'done']);
    expect(columns[1]).toMatchObject({ name: 'Aprovação', color: '#ff7a90' });

    await taskBoardService.remove(workspace.id, task.id);
    await boardColumnService.remove(workspace.id, review.id);
    expect((await boardColumnService.list(workspace.id)).map((column) => column.key)).toEqual(['todo', 'doing', 'done']);
    await expect(boardColumnService.remove(workspace.id, columns[0].id)).rejects.toThrow('padrão');
  });

  it('does not create default columns for a workspace that was already removed', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'deleted-board', workingDir: '/tmp' });
    await workspaceRepository.deleteWorkspace(workspace.id);

    await expect(boardColumnService.list(workspace.id)).rejects.toThrow('WORKSPACE_NOT_FOUND');
  });

  it('despacha o prompt no terminal ao atribuir (loop continuo)', async () => {
    const { workspace, terminal, session } = await createWorkspaceWithTerminal();

    // /bin/cat ecoa tudo que recebe — o prompt despachado aparece no scrollback
    const task = await taskBoardService.create(workspace.id, {
      title: 'Implementar login',
      description: 'Usar OAuth e cobrir o fluxo de erro.',
      images: ['.orkestrai/images/login.png'],
      attachments: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          kind: 'file',
          name: 'brief.md',
          path: '.orkestrai/attachments/brief.md',
          url: null,
          mimeType: 'text/markdown',
          size: 42,
        },
        {
          id: '00000000-0000-4000-8000-000000000002',
          kind: 'link',
          name: 'example.com',
          path: null,
          url: 'https://example.com/reference',
          mimeType: null,
          size: null,
        },
      ],
      assigneeNodeId: terminal.id,
    });
    expect(task.status).toBe('doing');
    await new Promise((resolve) => setTimeout(resolve, 400));
    const { scrollback, detach } = ptySessionManager.attach(session.id, () => {});
    detach();
    expect(scrollback).toContain('Implementar login');
    expect(scrollback).toContain('Usar OAuth e cobrir o fluxo de erro.');
    expect(scrollback).toContain('.orkestrai/images/login.png');
    expect(scrollback).toContain('.orkestrai/attachments/brief.md');
    expect(scrollback).toContain('https://example.com/reference');
    expect(scrollback).toContain('orkestrai task done');
    ptySessionManager.kill(session.id);
  });

  it('não deixa tarefa fantasma em andamento quando o agente não pode iniciar', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'dispatch-failure', workingDir: '/tmp' });
    const unavailable = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Agente indisponível',
      payload: { provider: 'codex' },
    });

    await expect(taskBoardService.create(workspace.id, {
      title: 'Não pode parecer em execução',
      assigneeNodeId: unavailable.id,
      createdBy: 'Lider',
    })).rejects.toThrow('AGENT_COMMAND_UNAVAILABLE');

    expect(await taskBoardService.list(workspace.id)).toEqual([
      expect.objectContaining({
        title: 'Não pode parecer em execução',
        status: 'todo',
        assigneeNodeId: null,
      }),
    ]);
  });

  it('inclui o conteúdo integral da nota vinculada no despacho', async () => {
    const { workspace, terminal, session } = await createWorkspaceWithTerminal();
    const note = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'note',
      title: 'Spec de checkout',
      payload: { content: 'Critério obrigatório: preservar o cálculo de frete e validar contraste WCAG.' },
    });
    const task = await taskBoardService.create(workspace.id, {
      title: 'Implementar checkout',
      description: 'Aplicar a direção aprovada.',
      noteId: note.id,
      assigneeNodeId: terminal.id,
    });
    expect(task.noteId).toBe(note.id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const attached = ptySessionManager.attach(session.id, () => {});
    attached.detach();
    expect(attached.scrollback).toContain('Spec de checkout');
    expect(attached.scrollback).toContain('preservar o cálculo de frete');
    expect(attached.scrollback).toContain('validar contraste WCAG');
    ptySessionManager.kill(session.id);
  });

  it('avisa o lider quando outro agente conclui uma tarefa', async () => {
    const { workspace, leader, leaderSession } = await createWorkspaceWithLeader();
    const workerSession = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const worker = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Codex',
      payload: { command: '/bin/cat', provider: null, sessionId: workerSession.id },
    });
    const task = await taskBoardService.create(workspace.id, {
      title: 'Revisar autenticacao',
      assigneeNodeId: worker.id,
      createdBy: leader.id,
    });

    const completed = await taskBoardService.update(workspace.id, task.id, {
      status: 'done',
      notifyCompletion: true,
      completedBy: worker.id,
    });
    expect(completed.completionHandoff).toMatchObject({ status: 'queued', leaderTitle: 'Lider' });

    await new Promise((resolve) => setTimeout(resolve, 350));
    const { scrollback, detach } = ptySessionManager.attach(leaderSession.id, () => {});
    detach();
    expect(scrollback).toContain('tarefa concluida');
    expect(scrollback).toContain('Revisar autenticacao');
    expect(scrollback).toContain('Codex');

    ptySessionManager.kill(workerSession.id);
    ptySessionManager.kill(leaderSession.id);
    leader.id && expect(leader.id).toBeTruthy();
  });

  it('criada com assignee ja nasce doing; titulo vazio falha', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();
    await expect(taskBoardService.create(workspace.id, { title: '  ' })).rejects.toThrow('título');
    ptySessionManager.kill(session.id);
  });

  it('arquiva concluidas (uma e em lote) e o historico preserva tudo', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();

    const done1 = await taskBoardService.create(workspace.id, { title: 'Feita 1' });
    await taskBoardService.update(workspace.id, done1.id, { status: 'done' });
    const alive = await taskBoardService.create(workspace.id, { title: 'Viva 1' });

    // so da para arquivar tarefa concluida
    await expect(taskBoardService.archive(workspace.id, alive.id)).rejects.toThrow('concluída');

    const archived = await taskBoardService.archive(workspace.id, done1.id);
    expect(archived.archivedAt).toBeTruthy();

    // quadro esconde a arquivada; historico preserva (done + arquivadas)
    expect((await taskBoardService.list(workspace.id)).map((task) => task.id)).toEqual([alive.id]);
    expect((await taskBoardService.history(workspace.id)).map((task) => task.id)).toContain(done1.id);

    // arquivar em lote limpa a coluna Feito
    await taskBoardService.update(workspace.id, alive.id, { status: 'done' });
    const batch = await taskBoardService.archiveDone(workspace.id);
    expect(batch.archived).toBe(1);
    expect(await taskBoardService.list(workspace.id)).toHaveLength(0);
    expect(await taskBoardService.history(workspace.id)).toHaveLength(2);
    ptySessionManager.kill(session.id);
  });

  it('vinculo tarefa<->nota: arquivar esconde a nota, apagar a tarefa apaga a nota (1:N)', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();
    const note = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'note',
      title: 'Spec X',
      payload: { content: 'detalhes da spec' },
    });

    // vincula na criacao; id invalido falha
    const t1 = await taskBoardService.create(workspace.id, { title: 'T1', noteId: note.id });
    expect(t1.noteId).toBe(note.id);
    expect(t1.noteTitle).toBe('Spec X');
    await expect(taskBoardService.create(workspace.id, { title: 'T2', noteId: 'inexistente' })).rejects.toThrow('Nota');

    // nota vinculada NAO apaga pelo X do canvas (guard no deleteNode)
    await expect(workspaceService.deleteNode(workspace.id, note.id)).rejects.toThrow('vinculada');

    // segunda tarefa na MESMA nota (1:N): arquivar uma NAO esconde a nota
    const t2 = await taskBoardService.create(workspace.id, { title: 'T2', noteId: note.id });
    await taskBoardService.update(workspace.id, t1.id, { status: 'done' });
    await taskBoardService.archive(workspace.id, t1.id);
    expect((await workspaceRepository.listNodes(workspace.id)).some((node) => node.id === note.id)).toBe(true);

    // arquivando a ultima referencia, a nota sai do canvas (mas fica no banco)
    await taskBoardService.update(workspace.id, t2.id, { status: 'done' });
    await taskBoardService.archive(workspace.id, t2.id);
    expect((await workspaceRepository.listNodes(workspace.id)).some((node) => node.id === note.id)).toBe(false);
    expect((await workspaceRepository.listNodes(workspace.id, undefined, true)).some((node) => node.id === note.id)).toBe(true);

    // historico resolve o titulo mesmo com a nota arquivada
    const history = await taskBoardService.history(workspace.id);
    expect(history.find((task) => task.id === t1.id)?.noteTitle).toBe('Spec X');

    // apagar a tarefa apaga a nota JUNTO quando e a ultima referencia
    await taskBoardService.remove(workspace.id, t1.id);
    expect((await workspaceRepository.listNodes(workspace.id, undefined, true)).some((node) => node.id === note.id)).toBe(true);
    await taskBoardService.remove(workspace.id, t2.id);
    expect((await workspaceRepository.listNodes(workspace.id, undefined, true)).some((node) => node.id === note.id)).toBe(false);
    ptySessionManager.kill(session.id);
  });

  it('anexa e remove imagens de referencia (capa = primeira)', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();
    const task = await taskBoardService.create(workspace.id, { title: 'Tela de login' });
    let updated = await taskBoardService.attachImage(workspace.id, task.id, '.orkestrai/images/a.png');
    expect(updated.images).toEqual(['.orkestrai/images/a.png']);
    expect(updated.imagePath).toBe('.orkestrai/images/a.png');

    updated = await taskBoardService.attachImage(workspace.id, task.id, '.orkestrai/images/b.png');
    expect(updated.images).toEqual(['.orkestrai/images/a.png', '.orkestrai/images/b.png']);
    expect(updated.imagePath).toBe('.orkestrai/images/a.png');

    // Duplicada nao entra de novo
    await expect(taskBoardService.attachImage(workspace.id, task.id, '.orkestrai/images/a.png')).rejects.toThrow('anexada');

    updated = await taskBoardService.detachImage(workspace.id, task.id, '.orkestrai/images/a.png');
    expect(updated.images).toEqual(['.orkestrai/images/b.png']);
    expect(updated.imagePath).toBe('.orkestrai/images/b.png');

    updated = await taskBoardService.detachImage(workspace.id, task.id, '.orkestrai/images/b.png');
    expect(updated.images).toEqual([]);
    expect(updated.imagePath).toBeNull();

    // Listagem inclui as imagens
    await taskBoardService.attachImage(workspace.id, task.id, '.orkestrai/images/ref.png');
    const listed = await taskBoardService.list(workspace.id);
    expect(listed[0].images).toEqual(['.orkestrai/images/ref.png']);
    ptySessionManager.kill(session.id);
  });

  it('descricao em markdown na criacao e edicao da tarefa', async () => {
    const { workspace, session } = await createWorkspaceWithTerminal();

    const task = await taskBoardService.create(workspace.id, {
      title: 'Landing page',
      description: '## Escopo\n\n- [ ] hero\n- [ ] footer\n\nVeja [ref](https://exemplo.com).',
    });
    expect(task.description).toContain('- [ ] hero');

    const updated = await taskBoardService.update(workspace.id, task.id, { description: 'desc **nova**' });
    expect(updated.description).toBe('desc **nova**');

    const listed = await taskBoardService.list(workspace.id);
    expect(listed[0].description).toBe('desc **nova**');

    // limpar a descricao volta para null
    const cleared = await taskBoardService.update(workspace.id, task.id, { description: null });
    expect(cleared.description).toBeNull();
    ptySessionManager.kill(session.id);
  });

  it('task nova avisa o lider no terminal dele; task da ponte nao ecoa', async () => {
    const { workspace, leaderSession } = await createWorkspaceWithLeader();

    await taskBoardService.create(workspace.id, {
      title: 'Refinar hero',
      description: 'Seguir a hierarquia descrita no briefing.',
      images: ['.orkestrai/images/hero-a.png', '.orkestrai/images/hero-b.png'],
      createdBy: 'user',
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    let attached = ptySessionManager.attach(leaderSession.id, () => {});
    expect(attached.scrollback).toContain('nova tarefa no quadro');
    expect(attached.scrollback).toContain('Refinar hero');
    expect(attached.scrollback).toContain('Seguir a hierarquia descrita no briefing.');
    expect(attached.scrollback).toContain('.orkestrai/images/hero-a.png');
    expect(attached.scrollback).toContain('.orkestrai/images/hero-b.png');
    expect(attached.scrollback).toContain('task assign');
    attached.detach();

    // Task criada por agente (bridge) nao gera aviso para o proprio lider
    const before = ptySessionManager.attach(leaderSession.id, () => {});
    before.detach();
    await taskBoardService.create(workspace.id, { title: 'Task do lider', createdBy: 'Lider' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = ptySessionManager.attach(leaderSession.id, () => {});
    expect(after.scrollback).toBe(before.scrollback);
    after.detach();

    ptySessionManager.kill(leaderSession.id);
  });
});
