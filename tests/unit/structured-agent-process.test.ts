import { describe, expect, it, vi } from 'vitest';
import { StructuredAgentProcess, type StructuredTurn } from '$lib/modules/agent-room/infrastructure/pty/StructuredAgentProcess.ts';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('programmatic agent output surface', () => {
  it('submits an intact multiline prompt without any PTY writer or Enter', async () => {
    let finish!: (text: string) => void;
    const run = vi.fn((turn: StructuredTurn) => {
      turn.accepted('native-session', 'native-turn');
      return new Promise<string>(resolve => { finish = resolve; });
    });
    const process = new StructuredAgentProcess({ run, close: vi.fn() });
    const spawn = vi.fn();
    const manager = new PtySessionManager(spawn);
    const session = manager.create({ command: 'codex', cwd: '/tmp', workspaceId: 'workspace', nodeId: 'bot',
      provider: 'codex', bridgeAgentToken: 'private-agent-token', structuredProcess: process });
    expect(spawn).not.toHaveBeenCalled();
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(true);
    const prompt = 'first line\n\n[pasted content]\nLast line 🐈';
    const receipt = await manager.submitStructured(session.id, prompt, 'binding:chat-a', 'message-a');
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ prompt, conversationKey: 'binding:chat-a' }));
    expect(receipt).toMatchObject({ sessionId: 'native-session', turnId: 'native-turn' });
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(false);
    expect(manager.resolveBridgeAgent('workspace', 'private-agent-token')).toBe('bot');
    expect(manager.resolveBridgeAgent('another-workspace', 'private-agent-token')).toBeNull();
    expect(JSON.stringify(manager.list())).not.toContain('private-agent-token');
    await expect(manager.submitStructured(session.id, 'another', 'binding:chat-b', 'message-b')).rejects.toThrow('BUSY');
    finish('final answer');
    await expect(receipt.completion).resolves.toBe('final answer');
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(true);
    manager.kill(session.id);
    await manager.waitForStructuredShutdown('workspace', 'bot');
    expect(manager.get(session.id)).toBeNull();
    expect(manager.resolveBridgeAgent('workspace', 'private-agent-token')).toBeNull();
  });

  it('waits for actual driver shutdown before releasing the conversation writer', async () => {
    let exit!: () => void;
    const process = new StructuredAgentProcess({ run: vi.fn(), close: () => new Promise<void>(resolve => { exit = resolve; }) });
    const listener = vi.fn();
    process.onExit(listener);
    process.kill();
    expect(listener).not.toHaveBeenCalled();
    exit();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
  });

  it('rejects a missing native receipt and bounds prompts', async () => {
    const process = new StructuredAgentProcess({ run: async () => 'not acknowledged', close: vi.fn() });
    await expect(process.submit('hello')).rejects.toThrow('RECEIPT_MISSING');
    await expect(process.submit('x'.repeat(512_001))).rejects.toThrow('INPUT_INVALID');
  });
});
