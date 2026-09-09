import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

async function setup() {
  const workspace = await workspaceRepository.createWorkspace({ name: 'rotinas', workingDir: '/tmp' });
  const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
  const terminal = await workspaceRepository.createNode({
    workspaceId: workspace.id,
    type: 'terminal',
    title: 'Alvo',
    payload: { command: '/bin/cat', sessionId: session.id },
  });
  return { workspace, terminal, session };
}

describe('RoutineService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('cria rotina, dispara agora e registra historico', async () => {
    const { workspace, terminal, session } = await setup();

    let output = '';
    const { detach } = ptySessionManager.attach(session.id, (data) => {
      output += data;
    });

    const routine = await routineService.create({
      workspaceId: workspace.id,
      targetNodeId: terminal.id,
      prompt: '&& primeira etapa\n&& segunda etapa',
      intervalMinutes: 30,
    });

    const result = await routineService.runNow(routine.id);
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('2 step');

    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(output).toContain('primeira etapa');
    expect(output).toContain('segunda etapa');

    // Recorrente continua habilitada
    const routines = await routineService.list(workspace.id);
    expect(routines[0].enabled).toBe(true);
    expect(routines[0].runCount).toBe(1);

    const history = await routineService.history(routine.id);
    expect(history).toHaveLength(1);
    expect(history[0].ok).toBe(true);

    detach();
    ptySessionManager.kill(session.id);
  }, 10_000);

  it('rotina de execucao unica se desativa apos rodar', async () => {
    const { workspace, terminal, session } = await setup();
    const routine = await routineService.create({
      workspaceId: workspace.id,
      targetNodeId: terminal.id,
      prompt: 'uma vez',
    });
    await routineService.runNow(routine.id);
    const routines = await routineService.list(workspace.id);
    expect(routines[0].enabled).toBe(false);
    ptySessionManager.kill(session.id);
  });

  it('inicia uma nova sessao quando o agente nao tem PTY ativo', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'rotinas', workingDir: '/tmp' });
    const terminal = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Sem sessao',
      payload: { command: '/bin/cat' },
    });
    const routine = await routineService.create({
      workspaceId: workspace.id,
      targetNodeId: terminal.id,
      prompt: 'oi',
    });
    const result = await routineService.runNow(routine.id);
    expect(result.ok).toBe(true);
    expect(result.run.output).toMatchObject({ sessionState: 'started' });
    const node = await workspaceRepository.getNode(terminal.id);
    const sessionId = String((node?.payload as Record<string, unknown>).sessionId ?? '');
    expect(sessionId).not.toBe('');
    ptySessionManager.kill(sessionId);
  });

  it('valida alvo e prompt', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'rotinas', workingDir: '/tmp' });
    const note = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'note' });
    await expect(
      routineService.create({ workspaceId: workspace.id, targetNodeId: note.id, prompt: 'x' })
    ).rejects.toThrow('terminal');
    await expect(
      routineService.create({ workspaceId: workspace.id, targetNodeId: 'qualquer', prompt: ' ' })
    ).rejects.toThrow('prompt');
  });

  it('dueRoutines respeita intervalo e estado', async () => {
    const { workspace, terminal, session } = await setup();
    const recurring = await routineService.create({
      workspaceId: workspace.id,
      targetNodeId: terminal.id,
      prompt: 'recorrente',
      intervalMinutes: 60,
    });

    // Nunca rodou: esta devida
    let due = await routineService.dueRoutines();
    expect(due.map((routine) => routine.id)).toContain(recurring.id);

    // Apos rodar: nao esta devida (intervalo 60min)
    await routineService.runNow(recurring.id);
    due = await routineService.dueRoutines();
    expect(due.map((routine) => routine.id)).not.toContain(recurring.id);

    ptySessionManager.kill(session.id);
  });
});
