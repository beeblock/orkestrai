import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { terminalMirrorService } from '$lib/modules/agent-room/application/services/TerminalMirrorService.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

describe('terminal and Chat are one conversation', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(() => vi.restoreAllMocks());

  async function team() {
    const workspace = await workspaceRepository.createWorkspace({ name: 'mirror', workingDir: '/tmp' });
    const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Claude', payload: { provider: 'claude', maestro: true } });
    const dev = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Dev Infra', payload: { provider: 'codex' } });
    vi.spyOn(agentInboxService, 'transcriptFor').mockResolvedValue({ provider: 'claude', cwd: '/tmp', agentSessionId: 'conversation', options: {} });
    return { workspace, leader, dev };
  }

  it('records what the owner typed in the terminal and the agent answer in its direct conversation', async () => {
    const { workspace, leader } = await team();
    const enqueue = vi.spyOn(agentInboxService, 'enqueue');
    vi.spyOn(transcript, 'findReplyToPrompt').mockResolvedValueOnce(null).mockResolvedValue({ sessionId: 'conversation', text: 'Estão esperando a fila de testes.', complete: true });

    await terminalMirrorService.mirrorPrompt({ workspaceId: workspace.id, nodeId: leader.id, text: 'Por que os dois estão bloqueados?', at: Date.now() });
    const service = terminalMirrorService as unknown as { recordReply: (...args: unknown[]) => Promise<boolean> };
    let [prompt] = await channelRepository.list(workspace.id, `dm:${leader.id}`);
    expect(prompt).toMatchObject({ authorKind: 'owner', body: 'Por que os dois estão bloqueados?', meta: { via: 'terminal' } });
    // The leader itself is not told about its own conversation.
    expect(enqueue).not.toHaveBeenCalled();

    expect(await service.recordReply(workspace.id, leader.id, prompt.body, Date.now(), prompt.id, false)).toBe(false);
    expect(await service.recordReply(workspace.id, leader.id, prompt.body, Date.now(), prompt.id, false)).toBe(true);
    const [reply] = await channelRepository.list(workspace.id, `dm:${leader.id}`);
    expect(reply).toMatchObject({ authorKind: 'agent', authorNodeId: leader.id, body: 'Estão esperando a fila de testes.', meta: { via: 'terminal', promptId: prompt.id } });
    [prompt] = (await channelRepository.list(workspace.id, `dm:${leader.id}`)).slice(-1);
    expect(prompt.body).toBe('Por que os dois estão bloqueados?');
  });

  it('tells the leader what the owner typed to a teammate and ignores CLI menu answers', async () => {
    const { workspace, leader, dev } = await team();
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    await terminalMirrorService.mirrorPrompt({ workspaceId: workspace.id, nodeId: dev.id, text: '2', at: Date.now() });
    expect(await channelRepository.list(workspace.id, `dm:${dev.id}`)).toEqual([]);

    await terminalMirrorService.mirrorPrompt({ workspaceId: workspace.id, nodeId: dev.id, text: 'Pode rodar a rampa de 50k agora.', at: Date.now() });
    expect((await channelRepository.list(workspace.id, `dm:${dev.id}`)).map((message) => message.body)).toEqual(['Pode rodar a rampa de 50k agora.']);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ toNodeId: leader.id, kind: 'owner_copy', content: expect.stringContaining('o dono escreveu no terminal de Dev Infra: "Pode rodar a rampa de 50k agora."') }));
  });

  it('never repeats an earlier answer for a line it cannot find in the transcript', async () => {
    const { workspace, leader } = await team();
    vi.spyOn(transcript, 'findReplyToPrompt').mockResolvedValue(null);
    vi.spyOn(transcript, 'findPromptInTranscript').mockResolvedValue(null);
    vi.spyOn(transcript, 'latestTurnComplete').mockResolvedValue(true);
    vi.spyOn(transcript, 'lastReplyText').mockResolvedValue('Os testes passaram.');
    const sentAt = Date.now();
    const started = vi.spyOn(transcript, 'latestTurnStartedAt').mockResolvedValue(sentAt - 60_000);
    await terminalMirrorService.mirrorPrompt({ workspaceId: workspace.id, nodeId: leader.id, text: 'E o deploy?', at: sentAt });
    const service = terminalMirrorService as unknown as { recordReply: (...args: unknown[]) => Promise<boolean> };
    const [prompt] = await channelRepository.list(workspace.id, `dm:${leader.id}`);

    // The latest turn began before the line was sent: its answer is not this line's.
    expect(await service.recordReply(workspace.id, leader.id, prompt.body, sentAt, prompt.id, true)).toBe(false);
    started.mockResolvedValue(null);
    expect(await service.recordReply(workspace.id, leader.id, prompt.body, sentAt, prompt.id, true)).toBe(false);
    // Even a turn begun two seconds before the line is earlier work.
    started.mockResolvedValue(sentAt - 2_000);
    expect(await service.recordReply(workspace.id, leader.id, prompt.body, sentAt, prompt.id, true)).toBe(false);
    expect((await channelRepository.list(workspace.id, `dm:${leader.id}`)).filter((message) => message.authorKind === 'agent')).toHaveLength(0);

    started.mockResolvedValue(sentAt + 2_000);
    expect(await service.recordReply(workspace.id, leader.id, prompt.body, sentAt, prompt.id, true)).toBe(true);
    const [reply] = await channelRepository.list(workspace.id, `dm:${leader.id}`);
    expect(reply).toMatchObject({ authorKind: 'agent', body: 'Os testes passaram.', meta: { promptId: prompt.id } });
  });

  it('reads when the latest prompt of a transcript was written', () => {
    const claude = [
      JSON.stringify({ type: 'user', timestamp: '2026-10-20T12:00:00.000Z', message: { content: 'primeira' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-20T12:00:05.000Z', message: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } }),
      JSON.stringify({ type: 'user', timestamp: '2026-10-20T12:10:00.000Z', message: { content: 'segunda' } }),
      JSON.stringify({ type: 'assistant', timestamp: '2026-10-20T12:10:04.000Z', message: { content: [{ type: 'text', text: 'feito' }], stop_reason: 'end_turn' } }),
    ].join('\n');
    expect(transcript.parseLatestTurnStart('claude-project-jsonl', claude)).toBe(Date.parse('2026-10-20T12:10:00.000Z'));
    expect(transcript.parseLatestTurnStart('claude-project-jsonl', JSON.stringify({ type: 'user', message: { content: 'sem hora' } }))).toBeNull();
    expect(transcript.parseLatestTurnStart('opencode-session-json', claude)).toBeNull();
  });
});
