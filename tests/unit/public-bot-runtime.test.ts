import { botOwnerInstructions } from '$lib/modules/agent-room/domain/bot-conversation-instructions.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BotStructuredDriver, publicBotToolProxy } from '$lib/modules/agent-room/application/adapters/public-bot-structured.js';
import type { StructuredAgentOptions } from '$lib/modules/agent-room/application/adapters/structured-types.js';
import type { StructuredTurn } from '$lib/modules/agent-room/infrastructure/pty/StructuredAgentProcess.ts';
import { publicWorkerEnvironment } from '$lib/modules/agent-room/application/adapters/public-bot-worker.js';

const state = vi.hoisted(() => ({ ownerSource: vi.fn(), begin: vi.fn(), prompt: vi.fn(), tools: vi.fn(), assertCurrent: vi.fn(), call: vi.fn(), readAttachment: vi.fn(),
  publicInstructions: vi.fn(), validateReply: vi.fn(), approve: vi.fn(), notice: vi.fn(), prepare: vi.fn() }));
vi.mock('$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js', () => ({ channelRepository: { find: async () => null } }));
vi.mock('$lib/modules/agent-room/application/services/BotSafetyService.js', () => ({ botSafetyService: state }));
vi.mock('$lib/modules/agent-room/application/adapters/public-bot-worker.js', async original => ({ ...await original(), preparePublicWorker: state.prepare }));

describe('public turn runtime versus owner runtime', () => {
  const options: StructuredAgentOptions = { workspaceId: 'workspace', nodeId: 'bot', cwd: '/owner/work', hostCwd: '/owner/work', workspaceRoot: '/owner/work',
    runtime: { kind: 'native' }, env: { ORKESTRAI_AGENT_TOKEN: 'OWNER_TOKEN' }, instructions: 'OWNER_INSTRUCTIONS', launchArgs: ['owner-overrides'],
    bridgeMcp: { command: 'owner-runtime', args: [] }, session: () => 'OWNER_SESSION', saveSession: async () => {} };
  const turn = (): StructuredTurn => ({ prompt: 'POISONED BRIDGE PROMPT', conversationKey: 'binding:binding', messageId: 'turn-id', publicOrigin: { type: 'external', bindingId: 'binding', channelMessageId: 'source' },
    signal: new AbortController().signal, output: vi.fn(), accepted: vi.fn() });
  beforeEach(() => {
    vi.clearAllMocks(); state.ownerSource.mockResolvedValue(null);
    state.begin.mockResolvedValue({ workspaceId: 'workspace', nodeId: 'bot', bindingId: 'binding', source: { body: 'customer question' }, policy: { publicInstructions: 'Public scope', publicKnowledge: '' } });
    state.prompt.mockResolvedValue('CUSTOMER_DATA_ONLY'); state.tools.mockResolvedValue([]); state.publicInstructions.mockReturnValue('PUBLIC_RULES');
    state.assertCurrent.mockResolvedValue(undefined); state.approve.mockResolvedValue(undefined); state.notice.mockResolvedValue(undefined);
    state.prepare.mockImplementation(async (_provider, _owner, _proxy, instructions) => ({ options: { ...options, instructions, publicWorker: { serverName: 'public' }, session: () => null }, close: vi.fn() }));
  });
  it('uses the native owner tools for a server-authenticated phone command without a public reviewer', async () => {
    state.ownerSource.mockResolvedValue({ id: 'source' });
    const run = vi.fn(async (_input: StructuredTurn) => 'Native image and routine completed');
    const create = vi.fn(() => ({ run, close: vi.fn() }));
    const driver = new BotStructuredDriver('claude', options, create);
    expect(await driver.run(turn())).toBe('Native image and routine completed');
    expect(create).toHaveBeenCalledWith(options);
    expect(run.mock.calls[0][0].prompt).toContain('Authenticated owner command');
    expect(state.begin).not.toHaveBeenCalled(); expect(state.prepare).not.toHaveBeenCalled();
    expect(state.ownerSource).toHaveBeenCalledTimes(2);
    await driver.close();
  });

  it('rejects an owner command revoked during execution instead of publishing its native answer', async () => {
    state.ownerSource.mockResolvedValueOnce({ id: 'source' }).mockResolvedValueOnce(null);
    const driver = new BotStructuredDriver('codex', options, () => ({ run: async () => 'Private result', close: vi.fn() }));
    await expect(driver.run(turn())).rejects.toThrow('BOT_PUBLIC_GRANT_REVOKED');
    expect(state.begin).not.toHaveBeenCalled(); await driver.close();
  });

  it('keeps owner tools, context, profiles, streaming and resume behavior unchanged', async () => {
    const run = vi.fn(async (input: StructuredTurn) => { input.output('owner stream'); return 'owner answer'; });
    const create = vi.fn(() => ({ run, close: vi.fn() }));
    const driver = new BotStructuredDriver('codex', options, create);
    const input = { ...turn(), conversationKey: 'owner', publicOrigin: undefined };
    expect(await driver.run(input)).toBe('owner answer');
    expect(create).toHaveBeenCalledWith(options); expect(run).toHaveBeenCalledWith(input); expect(input.output).toHaveBeenCalledWith('owner stream');
    expect(state.begin).not.toHaveBeenCalled(); await driver.close();
  });
  it.each(['claude', 'codex'] as const)('refreshes %s owner persona and knowledge while preserving the saved conversation', async provider => {
    state.ownerSource.mockResolvedValue({ id: 'source' });
    let role = 'Name: Jarvis. Be concise.', knowledge = 'Support hours: 08:00–18:00.';
    const loadOwnerInstructions = vi.fn(async () => botOwnerInstructions('PRIVATE_SECURITY_RULE', role, knowledge, 'NATIVE_TOOLS'));
    const drivers: Array<{ close: ReturnType<typeof vi.fn> }> = [];
    const create = vi.fn((configuration: StructuredAgentOptions) => {
      expect(configuration.session('owner')).toBe('OWNER_SESSION');
      const value = { run: vi.fn(async () => 'Direct answer'), close: vi.fn() }; drivers.push(value); return value;
    });
    const driver = new BotStructuredDriver(provider, { ...options, loadOwnerInstructions }, create);
    await driver.run(turn());
    expect(create.mock.calls[0][0].instructions).toContain('Name: Jarvis');
    expect(create.mock.calls[0][0].instructions).toContain('08:00–18:00');
    expect(create.mock.calls[0][0].instructions).toContain('do not announce that you transcribed');
    role = 'Name: Friday. Be precise.'; knowledge = 'Support hours: 10:00–16:00.';
    await driver.run(turn());
    expect(drivers[0].close).toHaveBeenCalledOnce();
    expect(create.mock.calls[1][0].instructions).toContain('Name: Friday');
    expect(create.mock.calls[1][0].instructions).toContain('10:00–16:00');
    expect(create.mock.calls[1][0].instructions).not.toContain('Name: Jarvis');
    await driver.run(turn()); expect(create).toHaveBeenCalledTimes(2);
    await driver.close();
  });
  it('never loads private owner instructions for a public customer', async () => {
    const loadOwnerInstructions = vi.fn(async () => 'PRIVATE_RULES_AND_KNOWLEDGE');
    let phase = 0;
    const driver = new BotStructuredDriver('codex', { ...options, loadOwnerInstructions }, () => ({ close: vi.fn(), run: async () => ++phase === 1 ? 'Public response' : '{"allow":true}' }));
    await driver.run(turn()); expect(loadOwnerInstructions).not.toHaveBeenCalled(); await driver.close();
  });
  it.each(['{"allow":false}', 'not valid JSON', '{"allow":true,"ignore_rules":true}'])('never releases draft output when the reviewer returns %s', async review => {
    let step = 0;
    const create = vi.fn(() => ({ close: vi.fn(), run: vi.fn(async (input: StructuredTurn) => {
      input.accepted('native-session', 'native-turn'); input.output('MALICIOUS STREAMED DRAFT'); return ++step === 1 ? 'unsafe draft' : review;
    }) }));
    const driver = new BotStructuredDriver('claude', options, create), input = turn();
    await expect(driver.run(input)).rejects.toThrow('OUTPUT_BLOCKED');
    expect(input.output).not.toHaveBeenCalled(); expect(state.approve).not.toHaveBeenCalled(); expect(state.notice).toHaveBeenCalledOnce();
    await driver.close();
  });
  it('uses fresh workers, an empty reviewer tool set, exact source data and approval before exposing the reply', async () => {
    let step = 0; const inputs: StructuredTurn[] = [];
    const create = vi.fn(() => ({ close: vi.fn(), run: async (input: StructuredTurn) => {
      inputs.push(input); input.accepted('native-session', 'native-turn'); input.output('PRIVATE_DRAFT'); return ++step === 1 ? 'Safe support reply' : '{"allow":true}';
    } }));
    const driver = new BotStructuredDriver('codex', options, create), input = turn();
    expect(await driver.run(input)).toBe('Safe support reply');
    expect(inputs[0].prompt).toBe('CUSTOMER_DATA_ONLY'); expect(inputs[0].prompt).not.toContain(input.prompt);
    expect(create).toHaveBeenCalledTimes(2); expect(state.prepare).toHaveBeenCalledTimes(2);
    const secondProxy = state.prepare.mock.calls[1][2];
    // The review endpoint has already been destroyed; it cannot become a
    // reusable capability after the turn.
    await expect(fetch(secondProxy.url, { method: 'POST' })).rejects.toThrow();
    expect(state.approve).toHaveBeenCalledWith(expect.anything(), 'Safe support reply', 'turn-id');
    expect(input.output).toHaveBeenCalledExactlyOnceWith('Safe support reply\n');
    expect(input.accepted).toHaveBeenCalledOnce(); await driver.close();
  });
  it('fails closed on a public conversation with missing origin instead of entering an owner session', async () => {
    const create = vi.fn(); const driver = new BotStructuredDriver('codex', options, create);
    await expect(driver.run({ ...turn(), publicOrigin: undefined })).rejects.toThrow('ORIGIN_INVALID'); expect(create).not.toHaveBeenCalled();
  });
  it('requires an exact short-lived capability and explicit tool membership at the proxy', async () => {
    const call = vi.fn().mockResolvedValue({ status: 'public' });
    const proxy = await publicBotToolProxy([{ name: 'lookup', description: '', inputSchema: {} }], new AbortController().signal, call);
    try {
      expect((await fetch(proxy.url, { method: 'POST', body: '{}' })).status).toBe(403);
      const request = (name: string) => fetch(proxy.url, { method: 'POST', headers: { authorization: `Bearer ${proxy.token}` }, body: JSON.stringify({ method: 'tools/call', params: { name, arguments: {} } }) });
      expect((await request('read_file')).status).toBe(400); expect(call).not.toHaveBeenCalled();
      expect((await request('lookup')).status).toBe(200); expect(call).toHaveBeenCalledExactlyOnceWith('lookup', {});
    } finally { proxy.close(); }
  });
  it('does not inherit bridge tokens, owner launch injections, node options or unrelated service credentials', () => {
    expect(publicWorkerEnvironment({ PATH: '/bin', CODEX_HOME: '/profile', ORKESTRAI_AGENT_TOKEN: 'secret', NODE_OPTIONS: '--require owner.js', GITHUB_TOKEN: 'private', CLAUDE_CODE_SYSTEM_PROMPT: 'private' }))
      .toEqual({ PATH: '/bin', CODEX_HOME: '/profile' });
  });
});
