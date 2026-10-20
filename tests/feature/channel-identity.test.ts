import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { channelBridgeService } from '$lib/modules/agent-room/application/services/ChannelBridgeService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

function event(path: string, token: string, agentToken: string | null, body: unknown) {
  const url = new URL(`http://localhost/api/agent-room/bridge/${path}`);
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(agentToken ? { 'x-orkestrai-agent-token': agentToken } : {}) },
      body: JSON.stringify(body),
    }),
    params: {},
    url,
  };
}

async function team() {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-identity-'));
  const workspace = await workspaceRepository.createWorkspace({ name: 'identity', workingDir: dir });
  const leader = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Lead', payload: { provider: 'claude', maestro: true } });
  const web = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Web', payload: { provider: 'codex' } });
  return { workspace, leader, web, dir };
}

describe('who speaks in the Conversa', () => {
  useSvelarTest({ refreshDatabase: true });
  const sessions: string[] = [];

  afterEach(() => {
    for (const session of sessions.splice(0)) ptySessionManager.kill(session);
    vi.restoreAllMocks();
  });

  it('sends back to an external chat only a reply that cites its message', async () => {
    const { workspace, web } = await team();
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const mirror = vi.spyOn(channelBridgeService, 'mirrorReply').mockResolvedValue();
    const external = await channelService.postExternal(workspace.id, web.id, { body: 'Status do deploy?', via: 'telegram', bindingId: 'binding-1', sender: '@ana', externalId: '10' });
    const owner = (await channelService.postOwner(workspace.id, `dm:${web.id}`, { body: 'Qual a senha do staging?' })).message;

    // A reply to the owner never leaves the app.
    await channelService.postAgent(workspace.id, web.id, { body: 'A senha está no cofre.' });
    expect(mirror).not.toHaveBeenCalled();
    await expect(channelService.postAgent(workspace.id, web.id, { body: 'x', replyToId: owner.id })).rejects.toThrow('chat externo');
    await expect(channelService.postAgent(workspace.id, web.id, { body: 'x', channel: 'team', replyToId: external.id })).rejects.toThrow('chat externo');

    const reply = await channelService.postAgent(workspace.id, web.id, { body: 'Deploy concluído.', replyToId: external.id });
    expect(reply.replyToId).toBe(external.id);
    await vi.waitFor(() => expect(mirror).toHaveBeenCalledWith(workspace.id, web.id, reply.id, 'Deploy concluído.', 'binding-1'));
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it('stores an external message once when the chat is read again, and fails when the agent did not get it', async () => {
    const { workspace, web } = await team();
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockRejectedValueOnce(new Error('database is locked'));
    const input = { body: 'Status?', via: 'telegram' as const, bindingId: 'binding-1', sender: '@ana', externalId: '10' };
    await expect(channelService.postExternal(workspace.id, web.id, input)).rejects.toThrow('caixa de entrada');
    enqueue.mockResolvedValue({} as never);
    const message = await channelService.postExternal(workspace.id, web.id, input);
    const stored = (await channelRepository.list(workspace.id, `dm:${web.id}`)).filter((entry) => entry.authorKind === 'external');
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(message.id);
    expect(enqueue.mock.calls.at(-1)?.[0]).toMatchObject({ content: expect.stringContaining(`orkestrai post --reply-to ${message.id}`), dedupKey: 'external:binding-1:10' });
  });

  it('closes and escalates questions only as the terminal that calls, never as a name in the request', async () => {
    const { workspace, leader, web, dir } = await team();
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const token = await bridgeService.getOrCreateToken(workspace.id);
    for (const [nodeId, agentToken] of [[leader.id, 'leader-terminal-token'], [web.id, 'web-terminal-token']] as const) {
      const pty = ptySessionManager.create({ command: '/bin/cat', cwd: dir, workspaceId: workspace.id, nodeId, provider: 'codex', bridgeAgentToken: agentToken, env: { ORKESTRAI_AGENT_TOKEN: agentToken } });
      sessions.push(pty.id);
    }
    const controller = new BridgeController();
    const ask = async (question: string) => (await (await controller.askOwner(event('ask-owner', token, 'web-terminal-token', { from: 'Lead', question }) as never) as Response).json()).data;

    // The asking terminal is the author, whatever `from` says.
    const first = await ask('Posso usar Redis?');
    expect(first.routedTo).toBe('leader');
    expect((await channelRepository.find(workspace.id, first.questionId))?.authorNodeId).toBe(web.id);

    const spoofed = await controller.escalateQuestion(event('escalate-question', token, null, { from: 'Lead', questionId: first.questionId, note: 'Só o dono' }) as never) as Response;
    expect(spoofed.status).toBe(403);
    const teammate = await controller.escalateQuestion(event('escalate-question', token, 'web-terminal-token', { from: 'Lead', questionId: first.questionId, note: 'Só o dono' }) as never) as Response;
    expect(teammate.status).toBe(400);
    expect((await channelRepository.find(workspace.id, first.questionId))?.meta.awaiting).toBe('leader');
    const escalated = await controller.escalateQuestion(event('escalate-question', token, 'leader-terminal-token', { from: 'Web', questionId: first.questionId, note: 'Só o dono' }) as never) as Response;
    expect(escalated.status, await escalated.clone().text()).toBe(200);
    expect((await channelRepository.find(workspace.id, first.questionId))?.meta.awaiting).toBe('owner');

    const second = await ask('Posso usar Postgres?');
    const forged = await controller.closeQuestion(event('close-question', token, null, { from: 'Lead', questionId: second.questionId, answer: 'Sim' }) as never) as Response;
    expect(forged.status).toBe(403);
    expect((await channelRepository.find(workspace.id, second.questionId))?.answeredAt).toBeNull();
    const closed = await controller.closeQuestion(event('close-question', token, 'leader-terminal-token', { from: 'Web', questionId: second.questionId, answer: 'Sim, Postgres.' }) as never) as Response;
    expect(closed.status, await closed.clone().text()).toBe(200);
    const answer = (await channelRepository.list(workspace.id, `dm:${web.id}`)).find((message) => message.kind === 'answer');
    expect(answer).toMatchObject({ authorNodeId: leader.id, meta: { closedBy: 'leader', authorTitle: 'Lead' } });

    // A post from a live terminal is that terminal's, whatever `from` says.
    const posted = await controller.channelPost(event('channel', token, 'web-terminal-token', { from: 'Lead', message: 'Pronto.' }) as never) as Response;
    expect(posted.status).toBe(201);
    expect((await channelRepository.list(workspace.id, `dm:${web.id}`)).some((message) => message.body === 'Pronto.' && message.authorNodeId === web.id)).toBe(true);
  });

  it('keeps a question open when its answer cannot reach the agent, so the same answer can be sent again', async () => {
    const { workspace, leader } = await team();
    const { attentionService } = await import('$lib/modules/agent-room/application/services/AttentionService.js');
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    // The leader's own question goes to the owner and waits in Needs you.
    const question = await channelService.askOwner(workspace.id, { nodeId: leader.id, title: 'Lead' }, { question: 'Publico a versão?', options: ['Sim', 'Não'] });
    const open = async () => (await attentionService.list({ workspaceId: workspace.id, limit: 20 })).filter((item) => item.sourceId === question.id && item.status !== 'resolved');
    expect(await open()).toHaveLength(1);

    enqueue.mockRejectedValueOnce(new Error('database is locked'));
    await expect(channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'Sim', replyToId: question.id })).rejects.toThrow('continua aberta');
    expect((await channelRepository.find(workspace.id, question.id))?.answeredAt).toBeNull();
    expect((await channelRepository.list(workspace.id, `dm:${leader.id}`)).some((message) => message.kind === 'answer')).toBe(false);
    expect(await open()).toHaveLength(1);

    const retried = await channelService.postOwner(workspace.id, `dm:${leader.id}`, { body: 'Sim', replyToId: question.id });
    expect(retried.delivered).toEqual([{ nodeId: leader.id, ok: true }]);
    expect((await channelRepository.find(workspace.id, question.id))?.answeredAt).toBeTruthy();
    expect(await open()).toHaveLength(0);
  });

  it('lets only one of two answers at the same moment close a question', async () => {
    const { workspace, web } = await team();
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const question = await channelService.askOwner(workspace.id, { nodeId: web.id, title: 'Web' }, { question: 'Redis ou Postgres?' });
    const results = await Promise.all([
      channelRepository.markAnswered(workspace.id, question.id),
      channelRepository.markAnswered(workspace.id, question.id),
      channelRepository.markAnswered(workspace.id, question.id),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await channelRepository.markAnswered('other-workspace', question.id)).toBe(false);
  });

  it('keeps a teammate question open when the leader decision cannot reach the teammate', async () => {
    const { workspace, leader, web } = await team();
    const enqueue = vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const question = await channelService.askOwner(workspace.id, { nodeId: web.id, title: 'Web' }, { question: 'Posso usar Redis?' });
    enqueue.mockRejectedValueOnce(new Error('disk I/O error'));
    await expect(channelService.closeQuestion(workspace.id, question.id, { nodeId: leader.id, title: 'Lead' }, { body: 'Sim.' })).rejects.toThrow('continua aberta');
    expect((await channelRepository.find(workspace.id, question.id))?.answeredAt).toBeNull();
    const closed = await channelService.closeQuestion(workspace.id, question.id, { nodeId: leader.id, title: 'Lead' }, { body: 'Sim.' });
    expect(closed.delivered).toBe(true);
    // The asker withdrawing its own question needs no delivery.
    const second = await channelService.askOwner(workspace.id, { nodeId: web.id, title: 'Web' }, { question: 'Ainda preciso disso?' });
    enqueue.mockRejectedValue(new Error('down'));
    expect((await channelService.closeQuestion(workspace.id, second.id, { nodeId: web.id, title: 'Web' }, { body: 'Não preciso mais.' })).delivered).toBe(false);
  });
});
