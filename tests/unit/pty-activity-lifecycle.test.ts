import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

type Recorded = { state: string; nodeId: string };
const hook = globalThis as unknown as { __orkestraiRecordActivity?: (input: Recorded) => void };

describe('PTY activity lifecycle', () => {
  const sessions: string[] = [];
  afterEach(() => {
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
    delete hook.__orkestraiRecordActivity;
  });

  it.skipIf(process.platform === 'win32')('reports idle again when output after a quiet spell stops', async () => {
    const states: string[] = [];
    hook.__orkestraiRecordActivity = (input) => {
      if (input.nodeId === 'lifecycle-node') states.push(input.state);
    };
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'echo ready; sleep 3.2; echo again; sleep 30'],
      cwd: tmpdir(),
      workspaceId: 'lifecycle-workspace',
      nodeId: 'lifecycle-node',
    });
    sessions.push(session.id);
    // spawn -> starting, ready -> working, 2.5 s quiet -> idle, "again" -> working, 2.5 s quiet -> idle.
    await new Promise((resolve) => setTimeout(resolve, 6_600));
    expect(states).toEqual(['starting', 'working', 'idle', 'working', 'idle']);
  }, 12_000);

  it.skipIf(process.platform === 'win32')('treats the repaint after a resize as no work', async () => {
    const states: string[] = [];
    hook.__orkestraiRecordActivity = (input) => {
      if (input.nodeId === 'repaint-node') states.push(input.state);
    };
    // The shell answers SIGWINCH by printing, like a TUI repainting its screen.
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', "trap 'echo repaint' WINCH; echo ready; while true; do sleep 0.2; done"],
      cwd: tmpdir(),
      workspaceId: 'repaint-workspace',
      nodeId: 'repaint-node',
    });
    sessions.push(session.id);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(states).toEqual(['starting', 'working', 'idle']);
    ptySessionManager.resize(session.id, 100, 30);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(ptySessionManager.get(session.id)?.exited).toBe(false);
    expect(states).toEqual(['starting', 'working', 'idle']);
  }, 12_000);
});
