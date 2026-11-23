import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import { botFailureText } from '$lib/modules/agent-room/domain/bot-failure.js';
import { BotWorkflowService } from '$lib/modules/agent-room/application/services/BotWorkflowService.js';
import { botWorkflowRepository } from '$lib/modules/agent-room/infrastructure/repositories/BotWorkflowRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { botSafetyService } from '$lib/modules/agent-room/application/services/BotSafetyService.js';
import { personalBotService } from '$lib/modules/agent-room/application/services/PersonalBotService.js';
import { PersonalBotCommandDto } from '$lib/modules/agent-room/application/dto/PersonalBotCommandDto.js';
import { workspaceService } from '$lib/modules/agent-room/application/services/WorkspaceService.js';

const roots: string[] = [];
describe('durable owner bot sequences', () => {
  useSvelarTest({ refreshDatabase: true });
  beforeEach(() => {
    vi.spyOn(agentInboxService, 'kick').mockImplementation(() => {});
    vi.spyOn(workspaceService, 'get').mockImplementation(async id => (await workspaceRepository.getWorkspace(id))!);
  });
  afterEach(async () => { agentInboxService.reset(); vi.restoreAllMocks(); for (const path of roots.splice(0)) await rm(path, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'bot-workflow-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Bot stages', workingDir: root });
    const workers = await Promise.all(['Investigate', 'Validate'].map(title => workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title, payload: { provider: 'codex' } as never })));
    const plan = { trigger: '/bug', acknowledgment: 'Received. I will investigate, validate and return here.', steps: workers.map((node, index) => ({ nodeId: node.id, instructions: index ? 'Independently validate the previous result before accepting.' : 'Investigate and implement the request.' })) };
    const bot = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Jarvis', payload: { personalBot: true, provider: 'claude', agentTransport: 'structured', botWorkflow: plan } as never });
    const service = new BotWorkflowService();
    const post = () => channelService.postOwner(workspace.id, `dm:${bot.id}`, { body: '/bug fix the reported behavior' });
    return { workspace, workers, bot, plan, service, post };
  }
  async function finish(f: Awaited<ReturnType<typeof fixture>>, source: string, index: number, result?: string) {
    const run = (await botWorkflowRepository.find(source))!, stage = run.steps[index];
    await agentInboxService.claim(f.workspace.id, f.workers[index].id);
    await taskBoardService.update(f.workspace.id, stage.taskId!, { status: 'done', notifyCompletion: false });
    await agentInboxService.routeReply(stage.messageId, result ?? `Stage ${index + 1} actually validated.`, { source: 'explicit', responderNodeId: f.workers[index].id });
  }
  it('creates one card at a time, waits for exact answer AND accepted card, then returns once to the originating chat', async () => {
    const f = await fixture(), { message } = await f.post();
    await f.service.sweep();
    let run = (await botWorkflowRepository.find(message.id))!;
    expect(run.state).toBe('waiting'); expect(run.index).toBe(0);
    expect(await taskBoardService.list(f.workspace.id)).toHaveLength(1);
    expect(await controlCenterRepository.inboxEnvelopes(f.bot.id, ['queued'])).toHaveLength(0);
    await agentInboxService.claim(f.workspace.id, f.workers[0].id);
    await expect(agentInboxService.routeReply(run.steps[0].messageId, 'I received it.', { source: 'explicit', responderNodeId: f.workers[0].id })).rejects.toThrow('CARD_NOT_ACCEPTED');
    await f.service.sweep();
    expect((await botWorkflowRepository.find(message.id))!.index).toBe(0);
    await taskBoardService.update(f.workspace.id, run.steps[0].taskId!, { status: 'done', notifyCompletion: false });
    await agentInboxService.routeReply(run.steps[0].messageId, 'Investigated and validated.', { source: 'explicit', responderNodeId: f.workers[0].id });
    await f.service.sweep();
    run = (await botWorkflowRepository.find(message.id))!;
    expect(run.index).toBe(1); expect(await taskBoardService.list(f.workspace.id)).toHaveLength(2);
    await finish(f, message.id, 1); await f.service.sweep(); await f.service.sweep();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('completed');
    const replies = (await channelRepository.list(f.workspace.id, `dm:${f.bot.id}`)).filter(row => row.authorKind === 'agent');
    expect(replies.map(row => row.body).sort()).toEqual([f.plan.acknowledgment, 'Stage 2 actually validated.'].sort());
    expect((await channelRepository.find(f.workspace.id, message.id))!.meta.botWorkflow).toMatchObject({ state: 'completed', index: 2, total: 2 });
  });
  it('restores from durable stage identities without creating another task, message or model turn', async () => {
    const f = await fixture(), { message } = await f.post(); await f.service.sweep();
    const first = (await botWorkflowRepository.find(message.id))!;
    const restarted = new BotWorkflowService(); await restarted.sweep(); await restarted.sweep();
    expect((await botWorkflowRepository.find(message.id))!.steps).toEqual(first.steps);
    expect(await taskBoardService.list(f.workspace.id)).toHaveLength(1);
    expect(await controlCenterRepository.inboxEnvelopes(f.workers[0].id, ['queued'])).toHaveLength(1);
    expect((await channelRepository.list(f.workspace.id, `dm:${f.bot.id}`)).filter(row => row.authorKind === 'agent')).toHaveLength(1);
  });
  it('requires owner authentication before a queued phone workflow can touch the Canvas', async () => {
    const f = await fixture();
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'external', body: '/bug run arbitrary work', meta: { bindingId: uuidv7(), ownerProof: 'forged' } });
    expect(await f.service.enqueue(source, f.bot.payload as never, false)).toBe(false);
    expect(await f.service.enqueue(source, f.bot.payload as never, true)).toBe(true);
    await f.service.sweep();
    expect((await botWorkflowRepository.find(source.id))!.state).toBe('cancelled');
    expect(await taskBoardService.list(f.workspace.id)).toHaveLength(0);
    expect(await controlCenterRepository.inboxEnvelopes(f.workers[0].id, ['queued'])).toHaveLength(0);
  });
  it('does not confuse a quoted trigger or an ordinary conversation with a configured command', async () => {
    const f = await fixture();
    const source = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'owner', body: 'Please review this quote', meta: { quote: { text: '/bug run now' } } });
    expect(await f.service.enqueue(source, f.bot.payload as never, true)).toBe(false);
    expect(await f.service.validate(f.workspace.id, f.bot.id, f.plan)).toEqual(f.plan);
    await expect(f.service.validate(f.workspace.id, f.bot.id, { ...f.plan, steps: [{ nodeId: f.bot.id, instructions: 'Loop' }] })).rejects.toThrow('TARGET_INVALID');
    await expect(f.service.validate(f.workspace.id, f.bot.id, { ...f.plan, steps: [{ nodeId: uuidv7(), instructions: 'Foreign agent' }] })).rejects.toThrow('TARGET_INVALID');
  });
  it('withdraws a still-unaccepted stage and never starts a later stage when the owner stops the sequence', async () => {
    const f = await fixture(), { message } = await f.post(); await f.service.sweep();
    await f.service.cancel(f.workspace.id, f.bot.id, message.id);
    expect((await agentInboxService.claim(f.workspace.id, f.workers[0].id)).items).toEqual([]);
    await f.service.sweep();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('cancelled');
    expect(await taskBoardService.list(f.workspace.id)).toHaveLength(1);
    expect(await controlCenterRepository.inboxEnvelopes(f.workers[1].id, ['queued'])).toHaveLength(0);
    await expect(f.service.cancel(f.workspace.id, f.workers[0].id, message.id)).rejects.toThrow('NOT_FOUND');
  });
  it('keeps independent requests progressing while an earlier stage waits for an agent', async () => {
    const f = await fixture(), one = await f.post(), two = await f.post(); await f.service.sweep();
    expect((await botWorkflowRepository.find(one.message.id))!.steps[0].taskId).toBeTruthy();
    expect((await botWorkflowRepository.find(two.message.id))!.steps[0].taskId).toBeTruthy();
    const pending = await controlCenterRepository.inboxEnvelopes(f.workers[0].id, ['queued']);
    expect(pending).toHaveLength(2);
    expect((await agentInboxService.claim(f.workspace.id, f.workers[0].id)).items).toHaveLength(1);
  });
  it('honors a workspace suspension without creating tasks and resumes the same request after it ends', async () => {
    const f = await fixture(), { message } = await f.post();
    await workspaceRepository.setWorkspaceSuspended(f.workspace.id, true);
    await f.service.sweep(); expect(await taskBoardService.list(f.workspace.id)).toHaveLength(0);
    await workspaceRepository.setWorkspaceSuspended(f.workspace.id, false);
    await f.service.sweep(); expect((await botWorkflowRepository.find(message.id))!.steps[0].taskId).toBeTruthy();
  });
  it('does not execute a request deleted from local history before its first stage starts', async () => {
    const f = await fixture(), { message } = await f.post();
    await channelRepository.hideHistory(f.workspace.id, `dm:${f.bot.id}`, message.id, false);
    await f.service.sweep(); expect(await taskBoardService.list(f.workspace.id)).toHaveLength(0);
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('cancelled');
  });
  it('does not re-read the secure owner vault while an already dispatched stage is merely waiting', async () => {
    const f = await fixture(), { message } = await f.post(); await f.service.sweep();
    const check = vi.spyOn(botSafetyService, 'ownerSource');
    await f.service.sweep(); await f.service.sweep();
    expect(check).not.toHaveBeenCalled();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('waiting');
  });

  it('withdraws a queued stage when its request is deleted before receipt, without starting another model', async () => {
    const f = await fixture(), { message } = await f.post(); await f.service.sweep();
    await channelRepository.hideHistory(f.workspace.id, `dm:${f.bot.id}`, message.id, false);
    await f.service.sweep();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('cancelled');
    expect((await agentInboxService.claim(f.workspace.id, f.workers[0].id)).items).toEqual([]);
    expect((await taskBoardService.list(f.workspace.id))[0]).toMatchObject({ status: 'blocked', assigneeNodeId: null });
  });
  it('normalizes a completed WSL stage file into a native attachment before returning it through a native bot', async () => {
    const f = await fixture();
    await writeFile(join(f.workspace.workingDir, 'report.pdf'), '%PDF-1.4\n%%EOF');
    await workspaceRepository.updateNode(f.workers[0].id, { payload: { ...f.workers[0].payload, executionRuntime: { kind: 'wsl', distribution: 'Ubuntu', linuxWorkingDir: '/home/image-stage' } } as never });
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, botWorkflow: { ...f.plan, steps: [f.plan.steps[0]] } } as never });
    const { message } = await f.post(); await f.service.sweep();
    await finish(f, message.id, 0, '[Report](</home/image-stage/report.pdf>)');
    await f.service.sweep();
    const run = (await botWorkflowRepository.find(message.id))!;
    const result = (await channelRepository.find(f.workspace.id, run.finalId))!;
    expect(result).toMatchObject({ meta: { artifacts: [{ path: 'report.pdf', mimeType: 'application/pdf', sha256: expect.any(String) }] } });
    expect(result.body).not.toContain('/home/image-stage');
  });

  it('releases a definitively failed stage so another request to the same agent can start', async () => {
    const f = await fixture(), one = await f.post(); await f.service.sweep();
    const first = (await botWorkflowRepository.find(one.message.id))!;
    await controlCenterService.recordInboxTransition(first.steps[0].messageId, { state: 'failed', error: 'fixture delivery failed' });
    await f.service.sweep();
    expect((await botWorkflowRepository.find(one.message.id))!.state).toBe('failed');
    expect((await taskBoardService.read(f.workspace.id, first.steps[0].taskId!)).status).toBe('blocked');
    const two = await f.post(); await f.service.sweep();
    expect((await agentInboxService.claim(f.workspace.id, f.workers[0].id)).items.map(item => item.messageId)).toEqual([(await botWorkflowRepository.find(two.message.id))!.steps[0].messageId]);
  });

  it('reports a removed stage card instead of silently retrying it forever', async () => {
    const f = await fixture(), { message } = await f.post(); await f.service.sweep();
    const run = (await botWorkflowRepository.find(message.id))!;
    await taskBoardService.remove(f.workspace.id, run.steps[0].taskId!);
    await f.service.sweep();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('failed');
    expect((await channelRepository.find(f.workspace.id, run.errorId))!.body).toBeTruthy();
  });

  it('uses the same channel frame contract as the existing chat for live progress', async () => {
    const f = await fixture(), frames = vi.fn();
    vi.stubGlobal('__orkestraiBroadcast', frames);
    try {
      await f.post(); frames.mockClear(); await f.service.sweep();
      const messages = frames.mock.calls.map(call => call[0]).filter(frame => frame.type === 'channelMessage');
      expect(messages.length).toBeGreaterThan(0);
      for (const frame of messages) expect(frame.channel).toBe(frame.message.channel);
    } finally { vi.unstubAllGlobals(); }
  });
  it('starts one lightweight supervisor timer and stops it cleanly', async () => {
    vi.useFakeTimers();
    const service = new BotWorkflowService(); vi.spyOn(service, 'sweep').mockResolvedValue(undefined);
    try {
      const before = vi.getTimerCount(); service.start(); service.start();
      expect(vi.getTimerCount()).toBe(before + 1); service.stop(); expect(vi.getTimerCount()).toBe(before);
    } finally { service.stop(); vi.useRealTimers(); }
  });

  it.each([false, true])('recovers the final reply after a temporary failure (already written: %s)', async alreadyWritten => {
    const f = await fixture();
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, botWorkflow: { ...f.plan, steps: [f.plan.steps[0]] } } as never });
    const { message } = await f.post(); await f.service.sweep(); await finish(f, message.id, 0);
    const before = (await botWorkflowRepository.find(message.id))!;
    const realPost = channelService.postStructuredResult.bind(channelService);
    let fail = true;
    vi.spyOn(channelService, 'postStructuredResult').mockImplementation(async (...args) => {
      if (args[4] === before.finalId && fail) { fail = false; if (alreadyWritten) await realPost(...args); throw new Error('Temporary write/response failure'); }
      return realPost(...args);
    });
    await f.service.sweep(); expect((await botWorkflowRepository.find(message.id))!.index).toBe(1);
    await new BotWorkflowService().sweep();
    expect((await botWorkflowRepository.find(message.id))!.state).toBe('completed');
    expect((await channelRepository.list(f.workspace.id, `dm:${f.bot.id}`)).filter(row => row.id === before.finalId)).toHaveLength(1);
    expect(await taskBoardService.list(f.workspace.id)).toHaveLength(1);
  });
  it('asks for an unavailable quoted file instead of starting a paid stage without its input', async () => {
    const f = await fixture(), { message } = await f.post();
    await channelRepository.mergeMeta(f.workspace.id, message.id, { quote: { id: 'expired', kind: 'document', text: 'details.pdf', unavailable: true, unavailableReason: 'download_failed' } });
    await f.service.sweep();
    const run = (await botWorkflowRepository.find(message.id))!;
    expect(run.state).toBe('failed'); expect(await taskBoardService.list(f.workspace.id)).toHaveLength(0);
    expect(await controlCenterRepository.inboxEnvelopes(f.workers[0].id, ['queued'])).toHaveLength(0);
    expect((await channelRepository.find(f.workspace.id, run.errorId))!.body).toBe(botFailureText('attachment'));
  });

  it('reports a missing final artifact instead of leaving a fully accepted sequence retrying forever', async () => {
    const f = await fixture();
    await workspaceRepository.updateNode(f.bot.id, { payload: { ...f.bot.payload, botWorkflow: { ...f.plan, steps: [f.plan.steps[0]] } } as never });
    const { message } = await f.post(); await f.service.sweep(); await finish(f, message.id, 0, '[PDF](missing.pdf)');
    await f.service.sweep();
    const run = (await botWorkflowRepository.find(message.id))!;
    expect(run.state).toBe('failed');
    expect((await channelRepository.find(f.workspace.id, run.errorId))!.body).toBe(botFailureText('attachment'));
    expect(await channelRepository.find(f.workspace.id, run.finalId)).toBeNull();
  });

});
