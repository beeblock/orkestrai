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
});
