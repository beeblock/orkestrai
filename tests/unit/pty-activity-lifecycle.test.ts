import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

type Recorded = { state: string; nodeId: string };
const hook = globalThis as unknown as {
  __orkestraiRecordActivity?: (input: Recorded) => void;
  __orkestraiHumanPrompt?: (input: { nodeId: string; text: string }) => void;
};

describe('PTY activity lifecycle', () => {
  const sessions: string[] = [];
  afterEach(() => {
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
    delete hook.__orkestraiRecordActivity;
    delete hook.__orkestraiHumanPrompt;
  });

  it.skipIf(process.platform === 'win32')('reports working when the owner sends a line in the terminal and hands the line to Chat', async () => {
    const states: string[] = [];
    const lines: string[] = [];
    hook.__orkestraiRecordActivity = (input) => {
      if (input.nodeId === 'owner-node') states.push(input.state);
    };
    hook.__orkestraiHumanPrompt = (input) => {
      if (input.nodeId === 'owner-node') lines.push(input.text);
    };
    // An agent-like CLI: it waits for a line, then works quietly before answering.
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'echo ready; read line; sleep 4; echo "answer to $line"; sleep 30'],
      cwd: tmpdir(),
      workspaceId: 'owner-workspace',
      nodeId: 'owner-node',
      provider: 'codex',
    });
    sessions.push(session.id);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(states).toEqual(['starting', 'working', 'idle']);
    ptySessionManager.writeHumanInput(session.id, 'Por que estão bloqueados?\r');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(lines).toEqual(['Por que estão bloqueados?']);
    expect(states.at(-1)).toBe('working');
  }, 12_000);

  it.skipIf(process.platform === 'win32')('reports working once an automatic message is submitted to an idle agent', async () => {
    const states: string[] = [];
    hook.__orkestraiRecordActivity = (input) => {
      if (input.nodeId === 'inbox-node') states.push(input.state);
    };
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'echo ready; read line; sleep 30'],
      cwd: tmpdir(),
      workspaceId: 'inbox-workspace',
      nodeId: 'inbox-node',
      provider: 'codex',
    });
    sessions.push(session.id);
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    expect(states).toEqual(['starting', 'working', 'idle']);
    await ptySessionManager.writeWithConfirmedSubmit(session.id, 'Mensagem da fila', { submitDelayMs: 50, maxAttempts: 1 });
    expect(states.at(-1)).toBe('working');
  }, 12_000);

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
