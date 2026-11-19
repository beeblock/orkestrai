import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CodexStructuredDriver } from '$lib/modules/agent-room/application/adapters/codex-structured.js';
import { ClaudeStructuredDriver } from '$lib/modules/agent-room/application/adapters/claude-structured.js';
import type { StructuredAgentOptions } from '$lib/modules/agent-room/application/adapters/structured-types.js';

function setup() {
  const sessions = new Map<string, string>();
  const options: StructuredAgentOptions = {
    cwd: '/project', hostCwd: '/project', workspaceRoot: '/project', runtime: { kind: 'native' },
    env: { CODEX_HOME: '/profile-a', ORKESTRAI_AGENT_TOKEN: 'private' },
    model: 'test-model', effort: 'low', instructions: 'owner rules', launchArgs: [],
    bridgeMcp: { command: '/app/runtime', args: ['/app/cli', 'mcp'] },
    session: key => sessions.get(key) ?? null,
    saveSession: async (key, id) => { sessions.set(key, id); },
  };
  return { options, sessions };
}

describe('structured provider transports', () => {
  it('uses Codex JSON-RPC, isolates conversation keys, resumes and correlates exact turns', async () => {
    const { options, sessions } = setup();
    const requests: any[] = [];
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    let threads = 0;
    let turns = 0;
    const send = (frame: unknown) => child.stdout.write(JSON.stringify(frame) + '\n');
    child.stdin.on('data', chunk => {
      const message = JSON.parse(chunk.toString()); requests.push(message);
      if (!message.id) return;
      if (message.method === 'initialize') send({ id: message.id, result: {} });
      if (message.method === 'thread/start') send({ id: message.id, result: { thread: { id: `thread-${++threads}` } } });
      if (message.method === 'thread/resume') send({ id: message.id, result: { thread: { id: message.params.threadId } } });
      if (message.method === 'turn/start') {
        const turnId = `turn-${++turns}`; const threadId = message.params.threadId;
        send({ id: message.id, result: { turn: { id: turnId } } });
        send({ method: 'item/agentMessage/delta', params: { threadId, turnId: 'stale-turn', delta: 'PRIVATE OLD REPLY' } });
        send({ method: 'item/agentMessage/delta', params: { threadId: 'another-thread', turnId, delta: 'OTHER CHAT' } });
        send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', text: 'I am working' } } });
        send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', text: `answer ${turns}` } } });
        send({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
      }
    });
    const launch = vi.fn(() => child as any);
    const driver = new CodexStructuredDriver(options, launch);
    const accepted = vi.fn(); const output = vi.fn();
    const turn = (key: string) => driver.run({ prompt: 'hello\nsecond line', conversationKey: key, messageId: 'message', signal: new AbortController().signal, accepted, output });
    await expect(turn('owner')).resolves.toBe('answer 1');
    await expect(turn('binding:a')).resolves.toBe('answer 2');
    await expect(turn('owner')).resolves.toBe('answer 3');
    expect(sessions.size).toBe(2);
    expect(requests.filter(item => item.method === 'thread/start')).toHaveLength(2);
    expect(requests.filter(item => item.method === 'turn/start').every(item => item.params.input[0].text === 'hello\nsecond line')).toBe(true);
    expect(accepted).toHaveBeenCalledTimes(3);
    expect(output).not.toHaveBeenCalledWith('PRIVATE OLD REPLY');
    expect(launch).toHaveBeenCalledOnce();
    child.exitCode = 0 as any; child.emit('exit', 0);
    await driver.close();
  });

  it('uses the Claude SDK with the selected profile, native MCP tools and saved sessions', async () => {
    const { options, sessions } = setup();
    const close = vi.fn();
    const query = vi.fn(() => Object.assign((async function* () {
      yield { type: 'system', subtype: 'init', session_id: 'claude-session' };
      yield { type: 'assistant', session_id: 'claude-session', message: { content: [{ type: 'text', text: 'answer' }] } };
      yield { type: 'result', subtype: 'success', session_id: 'claude-session', is_error: false, result: 'final answer' };
    })(), { close }));
    const driver = new ClaudeStructuredDriver(options, query as any);
    const accepted = vi.fn();
    const run = () => driver.run({ prompt: 'exact prompt', conversationKey: 'owner', messageId: 'message', signal: new AbortController().signal, accepted, output: vi.fn() });
    await expect(run()).resolves.toBe('final answer');
    expect(sessions.get('owner')).toBe('claude-session');
    await run();
    expect((query.mock.calls as unknown as Array<[unknown]>)[1][0]).toMatchObject({ prompt: 'exact prompt', options: {
      resume: 'claude-session', env: options.env, settingSources: ['user', 'project', 'local'],
      mcpServers: { orkestrai: { command: '/app/runtime', args: ['/app/cli', 'mcp'] } },
    } });
    expect(accepted).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it('observes Codex exit after an output failure before releasing the native writer', async () => {
    const { options } = setup();
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null });
    const send = (frame: unknown) => child.stdout.write(JSON.stringify(frame) + '\n');
    child.stdin.on('data', chunk => {
      const m = JSON.parse(chunk.toString());
      if (m.method === 'initialize') send({ id: m.id, result: {} });
      if (m.method === 'thread/start') send({ id: m.id, result: { thread: { id: 'thread' } } });
      if (m.method === 'turn/start') {
        send({ id: m.id, result: { turn: { id: 'turn' } } });
        send({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'turn', delta: 'x'.repeat(2_000_001) } });
      }
    });
    let exited = false;
    child.stdin.on('finish', () => setTimeout(() => { exited = true; child.exitCode = 0 as never; child.emit('exit', 0); }, 15));
    const driver = new CodexStructuredDriver(options, () => child as never);
    await expect(driver.run({ prompt: 'test', conversationKey: 'owner', messageId: 'message', signal: new AbortController().signal, accepted: vi.fn(), output: vi.fn() })).rejects.toThrow('CODEX_OUTPUT_TOO_LARGE');
    expect(exited).toBe(true);
    await driver.close();
  });
});
