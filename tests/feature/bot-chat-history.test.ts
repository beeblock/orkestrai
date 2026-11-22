import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { personalBotService } from '$lib/modules/agent-room/application/services/PersonalBotService.js';
import { PersonalBotCommandDto } from '$lib/modules/agent-room/application/dto/PersonalBotCommandDto.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { workspaceAttachmentService } from '$lib/modules/agent-room/application/services/WorkspaceAttachmentService.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';

describe('personal bot local history keeps durable work and files', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  beforeEach(() => {
    vi.spyOn(workspaceService, 'get').mockImplementation(async id => (await workspaceRepository.getWorkspace(id))!);
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => {});
  });
  afterEach(async () => { agentInboxService.reset(); vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'bot-history-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'History', workingDir: root });
    const bot = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Assistant', payload: { personalBot: true, provider: 'codex', agentTransport: 'structured' } as never });
    const channel = `dm:${bot.id}`;
    const post = (body: string) => channelRepository.save({ workspaceId: workspace.id, channel, authorKind: 'owner', body });
    const execute = (input: unknown, actor: string | null = null) => personalBotService.execute(PersonalBotCommandDto.from(workspace.id, input, actor));
    return { root, workspace, bot, channel, post, execute };
  }

  it('hides only the selected message, emits its exact conversation and retains the durable record', async () => {
    const f = await fixture(), a = await f.post('Remove this'), b = await f.post('Keep this');
    const frames: any[] = [], previous = (globalThis as any).__orkestraiBroadcast;
    (globalThis as any).__orkestraiBroadcast = (frame: unknown) => frames.push(frame);
    try {
      await f.execute({ command: 'history_delete', channel: f.channel, messageId: a.id });
      expect((await channelRepository.list(f.workspace.id, f.channel)).map(m => m.id)).toEqual([b.id]);
      expect(await channelRepository.find(f.workspace.id, a.id)).toMatchObject({ body: 'Remove this', hiddenAt: expect.any(String) });
      expect(frames).toContainEqual(expect.objectContaining({ type: 'channelHistoryChanged', workspaceId: f.workspace.id, channel: f.channel, deletedId: a.id }));
      await f.execute({ command: 'history_delete', channel: f.channel, messageId: a.id }); // safe retry
    } finally { (globalThis as any).__orkestraiBroadcast = previous; }
  });

  it('keeps stored attachments owned after deletion and never removes the file', async () => {
    const f = await fixture(), id = uuidv7();
    const attachment = { id, kind: 'file' as const, name: 'report.pdf', path: `.orkestrai/attachments/${id}-report.pdf`, url: null, mimeType: 'application/pdf', size: 8 };
    await mkdir(join(f.root, '.orkestrai/attachments'), { recursive: true }); await writeFile(join(f.root, attachment.path), '%PDF-1.4');
    const saved = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'owner', body: 'Report', meta: { attachments: [attachment] } });
    await f.execute({ command: 'history_delete', channel: f.channel, messageId: saved.id });
    await workspaceAttachmentService.remove(f.workspace.id, { attachment } as never);
    expect(await readFile(join(f.root, attachment.path), 'utf8')).toBe('%PDF-1.4');
    expect(await channelRepository.referencesAttachment(f.workspace.id, id)).toBe(true);
  });

  it('withdraws a hidden queued request before restoring or starting any model', async () => {
    const f = await fixture();
    const saved = await channelService.postOwner(f.workspace.id, f.channel, { body: 'Never start this request' });
    expect(await controlCenterRepository.inboxEnvelopes(f.bot.id, ['queued'])).toHaveLength(1);
    const other = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'Other bot', payload: { personalBot: true, provider: 'codex' } as never });
    await channelService.postOwner(f.workspace.id, `dm:${other.id}`, { body: 'Independent request remains queued' });
    vi.mocked(agentInboxService.kick).mockRestore();
    await f.execute({ command: 'history_delete', channel: f.channel, messageId: saved.message.id });
    await agentInboxService.sweepNow();
    expect(await controlCenterRepository.inboxEnvelopes(f.bot.id, ['queued', 'sent', 'delivered'])).toEqual([]);
    expect(await controlCenterRepository.inboxEnvelopes(f.bot.id, ['failed'])).toMatchObject([{ metadata: { cancelled: true, cancelReason: 'history_hidden' } }]);
    expect(await controlCenterRepository.inboxEnvelopes(other.id, ['queued'])).toHaveLength(1);
  });

  it('clears atomically through the selected cursor, retains pending questions and accepts later tied-time posts', async () => {
    const f = await fixture(), instant = '2026-11-22T12:00:00.000Z';
    const target = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'owner', body: 'Before clear', createdAt: instant }, '01955555-ffff-7fff-8fff-ffffffffffff');
    const question = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'agent', kind: 'question', body: 'Still needs a decision', createdAt: instant }, '01955555-0002-7002-8002-000000000002');
    await f.execute({ command: 'history_clear', channel: f.channel, throughMessageId: target.id });
    const later = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'owner', body: 'New after clear', createdAt: instant }, '01955555-0001-7001-8001-000000000001');
    expect((await channelRepository.list(f.workspace.id, f.channel)).map(m => m.id).sort()).toEqual([question.id, later.id].sort());
    expect(await channelRepository.openQuestions(f.workspace.id)).toMatchObject([{ id: question.id, answeredAt: null }]);
    await expect(f.execute({ command: 'history_delete', channel: f.channel, messageId: question.id })).rejects.toThrow('QUESTION_OPEN');
  });

  it('still delivers a committed owner decision after its local answer bubble is hidden', async () => {
    const f = await fixture();
    const answer = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'owner', kind: 'answer', body: 'Confirmed decision remains deliverable' });
    await agentInboxService.enqueueDeferred({ workspaceId: f.workspace.id, toNodeId: f.bot.id, kind: 'owner', fromNodeId: null,
      content: answer.body, metadata: { channelMessageId: answer.id, channel: f.channel } });
    await f.execute({ command: 'history_delete', channel: f.channel, messageId: answer.id });
    const claimed = await agentInboxService.claim(f.workspace.id, f.bot.id);
    expect(claimed.items).toHaveLength(1); expect(claimed.items[0].content).toContain('Confirmed decision');
    expect(await controlCenterRepository.inboxEnvelopes(f.bot.id, ['delivered'])).toHaveLength(1);
  });

  it('retains external deduplication and rejects another agent or conversation', async () => {
    const f = await fixture(), bindingId = uuidv7();
    const external = await channelRepository.save({ workspaceId: f.workspace.id, channel: f.channel, authorKind: 'external', body: 'Inbound', meta: { bindingId, externalId: 'chat:platform-message' } });
    await f.execute({ command: 'history_delete', channel: f.channel, messageId: external.id }, f.bot.id);
    expect(await channelRepository.findExternal(f.workspace.id, f.channel, bindingId, 'chat:platform-message')).toMatchObject({ id: external.id, hiddenAt: expect.any(String) });
    await expect(f.execute({ command: 'history_delete', channel: f.channel, messageId: external.id }, uuidv7())).rejects.toThrow('BOT_ACTOR_MISMATCH');
    await expect(f.execute({ command: 'history_delete', channel: `dm:${uuidv7()}`, messageId: external.id })).rejects.toThrow('PERSONAL_BOT_NOT_FOUND');
    const other = await fixture();
    await expect(other.execute({ command: 'history_delete', channel: other.channel, messageId: external.id })).rejects.toThrow('MESSAGE_NOT_FOUND');
  });

  it('exposes history through the bridge only with the live actor and its active assigned task', async () => {
    const f = await fixture(), saved = await f.post('Owner-authorized local cleanup');
    vi.spyOn(bridgeService, 'resolveWorkspaceByToken').mockResolvedValue(f.workspace);
    const actor = vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockReturnValue(null);
    const request = (taskId?: string) => ({ url: new URL('http://localhost/api/agent-room/bridge/bots'), params: {}, request: new Request('http://localhost/api/agent-room/bridge/bots', {
      method: 'POST', headers: { authorization: 'Bearer fixture', 'x-orkestrai-agent-token': 'fixture-actor', 'content-type': 'application/json' },
      body: JSON.stringify({ ...(taskId ? { taskId } : {}), input: { command: 'history_delete', channel: f.channel, messageId: saved.id } }) }) });
    const controller = new BridgeController();
    expect((await controller.bots(request())).status).toBe(403);
    actor.mockReturnValue(f.bot.id);
    expect((await controller.bots(request())).status).toBe(403);
    const taskId = uuidv7(), now = new Date().toISOString();
    await AgentBoardTask.create({ id: taskId, workspace_id: f.workspace.id, title: 'Clean local history', status: 'doing', assignee_node_id: f.bot.id, created_by: 'user', created_at: now, updated_at: now });
    const response = await controller.bots(request(taskId));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await channelRepository.find(f.workspace.id, saved.id)).toMatchObject({ hiddenAt: expect.any(String) });
  });

  it('allows group members to clean their group while rejecting outsiders and preserving another conversation', async () => {
    const f = await fixture();
    const peer = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'Group peer', payload: { personalBot: true, provider: 'claude', agentTransport: 'structured' } as never });
    const group = await f.execute({ command: 'group_create', settings: { title: 'Personal group', instructions: '', memberIds: [f.bot.id, peer.id], coordinatorId: f.bot.id } }) as { id: string };
    const channel = `botgroup:${group.id}`;
    const shared = await channelRepository.save({ workspaceId: f.workspace.id, channel, authorKind: 'agent', authorNodeId: peer.id, body: 'Shared conversation' });
    const privateMessage = await f.post('Private conversation stays');
    await expect(f.execute({ command: 'history_clear', channel, throughMessageId: shared.id }, uuidv7())).rejects.toThrow('MEMBERSHIP_REQUIRED');
    await f.execute({ command: 'history_clear', channel, throughMessageId: shared.id }, peer.id);
    expect(await personalBotService.messages(f.workspace.id, group.id)).toEqual([]);
    expect((await channelRepository.list(f.workspace.id, f.channel)).map(m => m.id)).toContain(privateMessage.id);
  });
});
