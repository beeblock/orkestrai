import { afterEach, describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

async function written(sessionId: string, workspaceId: string, nodeId: string, text: string): Promise<void> {
  const before = (ptySessionManager.outputTail(workspaceId, nodeId, 100_000) ?? '').split(text).length;
  ptySessionManager.write(sessionId, `${text}\n`);
  const deadline = Date.now() + 5_000;
  // `cat` echoes the typed line and prints it again.
  while ((ptySessionManager.outputTail(workspaceId, nodeId, 100_000) ?? '').split(text).length < before + 2) {
    if (Date.now() > deadline) throw new Error('The terminal did not echo the text.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('a loop goal belongs to the run that asked for it', () => {
  useSvelarTest({ refreshDatabase: true });
  const sessions: string[] = [];
  afterEach(() => {
    for (const session of sessions.splice(0)) ptySessionManager.kill(session);
  });

  it('stops a loop only on goal text written after its latest prompt, in the same terminal', { timeout: 30_000 }, async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'loop', workingDir: '/tmp' });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Dev', payload: { provider: 'codex' } });
    const first = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', workspaceId: workspace.id, nodeId: node.id });
    sessions.push(first.id);
    const routine = {
      id: '01a15042-3362-7000-8000-0000000000f1', workspaceId: workspace.id, name: 'Testes', enabled: true,
      triggerType: 'schedule', triggerConfig: { goal: 'ALL TESTS PASS', intervalMinutes: 5 },
      actionType: 'prompt_agent', actionConfig: { targetNodeId: node.id, prompt: 'Rode os testes e diga ALL TESTS PASS quando passarem.' },
      lastRunAt: new Date().toISOString(),
    };
    const retire = (routineService as unknown as { retireIfGoalMet: (value: unknown) => Promise<boolean> }).retireIfGoalMet.bind(routineService);
    const marks = (globalThis as { __orkestraiLoopRunMarks?: Map<string, { sessionId: string; length: number }> }).__orkestraiLoopRunMarks!;

    // An earlier run already printed the goal.
    await written(first.id, workspace.id, node.id, 'Rodada anterior: ALL TESTS PASS');
    expect(await retire(routine)).toBe(false);
    marks.set(routine.id, ptySessionManager.outputMark(workspace.id, node.id)!);
    expect(await retire(routine)).toBe(false);
    await written(first.id, workspace.id, node.id, 'ainda falhando: 2 testes');
    expect(await retire(routine)).toBe(false);

    // Written after this run's prompt: the loop is done.
    await written(first.id, workspace.id, node.id, 'ALL TESTS PASS');
    expect(await retire(routine)).toBe(true);
    expect(marks.has(routine.id)).toBe(false);

    // A restarted terminal is another conversation: an older mark proves nothing there.
    marks.set(routine.id, ptySessionManager.outputMark(workspace.id, node.id)!);
    ptySessionManager.kill(first.id);
    const second = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp', workspaceId: workspace.id, nodeId: node.id });
    sessions.push(second.id);
    await written(second.id, workspace.id, node.id, 'ALL TESTS PASS');
    expect(await retire(routine)).toBe(false);
  });
});
