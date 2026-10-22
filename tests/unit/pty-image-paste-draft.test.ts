import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

const quiet = () => new Promise((resolve) => setTimeout(resolve, 3_000));

describe('Ctrl+V in an agent terminal', () => {
  const sessions: string[] = [];
  afterEach(() => {
    for (const id of sessions.splice(0)) ptySessionManager.kill(id);
  });

  it.skipIf(process.platform === 'win32')('holds automatic messages only for a pasted image, until the draft is cleared', async () => {
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'echo ready; sleep 60'],
      cwd: tmpdir(),
      workspaceId: 'paste-workspace',
      nodeId: 'paste-node',
      provider: 'codex',
    });
    sessions.push(session.id);
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
    // An empty or text-only clipboard: the CLI pastes nothing, so nothing is held.
    ptySessionManager.writeHumanInput(session.id, '\x16');
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
    // An image the app saw on the clipboard becomes the CLI's draft chip.
    ptySessionManager.writeHumanInput(session.id, '\x16', { imagePaste: true });
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(false);
    // Clearing the field (Ctrl+U) releases the queue.
    ptySessionManager.writeHumanInput(session.id, '\x15');
    await quiet();
    expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true);
  }, 20_000);
});
