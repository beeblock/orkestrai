import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { agentTerminalDeliveryService } from '$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { roleService } from '$lib/modules/agent-room/application/services/RoleService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager, type PtySessionInfo } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

type FakeSession = PtySessionInfo & { ready: boolean };

describe('Agent inbox', () => {
  useSvelarTest({ refreshDatabase: true });

  const sessions = new Map<string, FakeSession>();
  const prompts: Array<{ nodeId: string; message: string }> = [];
  let replies: Map<string, string>;

  async function team() {
    const workspace = await workspaceRepository.createWorkspace({ name: 'inbox', workingDir: '/tmp' });
    const nodes: Record<string, string> = {};
    for (const title of ['Lider', 'Web', 'Mobile']) {
      const sessionId = uuidv7();
      const node = await workspaceRepository.createNode({
        workspaceId: workspace.id,
        type: 'terminal',
        title,
        payload: { command: 'codex', provider: 'codex', sessionId, maestro: title === 'Lider' },
      });
      sessions.set(sessionId, {
        id: sessionId, workspaceId: workspace.id, nodeId: node.id, provider: 'codex', command: 'codex', args: [],
        cols: 80, rows: 24, cwd: '/tmp', transcriptCwd: '/tmp', runtimeKey: 'native', agentSessionId: `conversation-${title}`,
        createdAt: new Date(Date.now() - 600_000).toISOString(), lastActivityAt: new Date().toISOString(),
        exited: false, exitCode: null, waiting: true, hasOutput: true, ready: true,
      });
      nodes[title] = node.id;
    }
    return { workspace, nodes };
  }

  function session(nodeId: string): FakeSession {
    return [...sessions.values()].find((item) => item.nodeId === nodeId)!;
  }

  beforeEach(() => {
    sessions.clear();
    prompts.length = 0;
    replies = new Map();
    agentInboxService.reset();
    vi.spyOn(ptySessionManager, 'get').mockImplementation((id) => sessions.get(id) ?? null);
    vi.spyOn(ptySessionManager, 'canAcceptAutomaticMessage').mockImplementation((id) => Boolean(sessions.get(id)?.ready));
    vi.spyOn(transcript, 'latestTurnComplete').mockResolvedValue(true);
    vi.spyOn(transcript, 'findPromptInTranscript').mockResolvedValue(null);
    vi.spyOn(transcript, 'findReplyToPrompt').mockImplementation(async (_provider, _cwd, sessionId, prompt) => {
      const text = [...replies.entries()].find(([key]) => sessionId === key && prompt.length > 0)?.[1];
      return text ? { sessionId: String(sessionId), text, complete: true } : null;
    });
    vi.spyOn(agentTerminalDeliveryService, 'deliver').mockImplementation(async (input) => {
      prompts.push({ nodeId: input.nodeId, message: input.message });
    });
  });

  afterEach(async () => {
    // Let in-flight drains finish against this test's mocks before resetting.
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    agentInboxService.reset();
    vi.restoreAllMocks();
  });

  it('delivers to an idle agent and returns the answer from its transcript', async () => {
    const { workspace, nodes } = await team();
    const pending = bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint usar?', timeoutMs: 10_000 });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    expect(prompts[0].message).toMatch(/^\[orkestrai:message:[0-9a-f-]+\] Mensagem de Web: Qual endpoint usar\?/);
    expect(prompts[0].message).toContain('orkestrai reply');
    replies.set('conversation-Lider', 'Use /api/v2/company.');
    await agentInboxService.sweepNow();
    await expect(pending).resolves.toMatchObject({ deliveryState: 'replied', replyConfirmed: true, reply: 'Use /api/v2/company.', inbox: true });
  });

  it('never blocks the sender on a busy agent and delivers everything in one prompt at its turn boundary', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const startedAt = Date.now();
    const [web, mobile] = await Promise.all([
      bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Backend pronto para revisão', busyGraceMs: 50 }),
      bridgeService.ask(workspace.id, { from: nodes.Mobile, to: nodes.Lider, message: 'Mobile pronto para revisão', busyGraceMs: 50 }),
    ]);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
    expect(web).toMatchObject({ deliveryState: 'queued', delivered: false, inbox: true });
    expect(mobile).toMatchObject({ deliveryState: 'queued', delivered: false, inbox: true });
    expect(prompts).toHaveLength(0);

    session(nodes.Lider).ready = true;
    await agentInboxService.drain(workspace.id, nodes.Lider);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].message).toContain('[orkestrai:inbox] 2 mensagens');
    expect(prompts[0].message).toContain('Backend pronto para revisão');
    expect(prompts[0].message).toContain('Mobile pronto para revisão');
    const delivered = await controlCenterRepository.inboxEnvelopes(nodes.Lider, ['delivered']);
    expect(delivered.map((envelope) => envelope.id).sort()).toEqual([web.messageId, mobile.messageId].sort());
  });

  it('routes a late answer to the asker inbox instead of losing it', async () => {
    const { workspace, nodes } = await team();
    const result = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Posso integrar?', timeoutMs: 1_000 });
    expect(result).toMatchObject({ deliveryState: 'delivered', replyConfirmed: false, timedOut: true, inbox: true });

    replies.set('conversation-Lider', 'Sim, integre o andar web.');
    await agentInboxService.sweepNow();
    const original = await controlCenterRepository.findEnvelope(result.messageId);
    expect(original).toMatchObject({ state: 'replied', reply: 'Sim, integre o andar web.' });
    await vi.waitFor(() => expect(prompts.find((prompt) => prompt.nodeId === nodes.Web)?.message)
      .toContain(`Resposta de Lider à sua mensagem ${result.messageId}: Sim, integre o andar web.`));
  });

  it('answers a blocked asker without typing the answer into its terminal again', async () => {
    const { workspace, nodes } = await team();
    const leaderAsk = bridgeService.ask(workspace.id, { from: nodes.Lider, to: nodes.Web, message: 'Revise o contrato', timeoutMs: 10_000 });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    const answer = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Contrato revisado: ok' });
    expect(answer).toMatchObject({ deliveryState: 'delivered', answeredMessageId: expect.any(String) });
    await expect(leaderAsk).resolves.toMatchObject({ deliveryState: 'replied', reply: 'Contrato revisado: ok' });
    expect(prompts.filter((prompt) => prompt.nodeId === nodes.Lider)).toHaveLength(0);
    // The consumed message stays answerable with an explicit reply.
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: answer.messageId, message: 'Obrigado' }))
      .resolves.toMatchObject({ via: 'inbox' });
  });

  it('records an explicit reply exactly once and only from the recipient', async () => {
    const { workspace, nodes } = await team();
    const pending = bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Aprovado?', timeoutMs: 10_000 });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    const messageId = /\[orkestrai:message:([0-9a-f-]+)\]/.exec(prompts[0].message)![1];
    await expect(bridgeService.reply(workspace.id, { from: nodes.Mobile, messageId, message: 'Eu respondo' })).rejects.toThrow('destinatário');
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId, message: 'Aprovado.' })).resolves.toMatchObject({ via: 'waiter' });
    await expect(pending).resolves.toMatchObject({ reply: 'Aprovado.', replyConfirmed: true });
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId, message: 'De novo' })).resolves.toMatchObject({ alreadyAnswered: true });
  });

  it('routes an explicit answer to a reply back to its sender', async () => {
    const { workspace, nodes } = await team();
    const question = await bridgeService.ask(workspace.id, { from: nodes.Lider, to: nodes.Web, message: 'Contrato pronto?', timeoutMs: 1_000 });
    await bridgeService.reply(workspace.id, { from: nodes.Web, messageId: question.messageId, message: 'Sim, GET /api/company.' });
    const [replyToLeader] = await controlCenterRepository.inboxEnvelopes(nodes.Lider, ['queued', 'sent', 'delivered']);
    expect(replyToLeader).toMatchObject({ kind: 'reply', fromNodeId: nodes.Web });
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: replyToLeader.id, message: 'Aprovado, falta o epoch guard.' }))
      .resolves.toMatchObject({ via: 'inbox', to: 'Web' });
    await vi.waitFor(async () => {
      const toWeb = await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered']);
      expect(toWeb.some((envelope) => envelope.kind === 'reply' && envelope.content.includes('Aprovado, falta o epoch guard.'))).toBe(true);
    });
  });

  it('hands pending items to a busy agent through any bridge call and never types them afterwards', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Web).ready = false;
    const queued = await bridgeService.ask(workspace.id, { from: nodes.Lider, to: nodes.Web, message: 'Inclua o upload do logo', busyGraceMs: 50 });
    expect(await agentInboxService.pendingCount(nodes.Web)).toBe(1);
    const claimed = await bridgeService.claimInbox(workspace.id, nodes.Web);
    expect(claimed.items).toEqual([expect.objectContaining({ messageId: queued.messageId, fromTitle: 'Lider', content: 'Inclua o upload do logo', kind: 'ask' })]);
    expect(claimed.remaining).toBe(0);
    session(nodes.Web).ready = true;
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(prompts).toHaveLength(0);
  });

  it('cancels a task message when its task closes before the recipient is free', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Web).ready = false;
    const task = await taskBoardService.create(workspace.id, { title: 'Logo da empresa', assigneeNodeId: nodes.Web, dispatch: false });
    const queued = await bridgeService.ask(workspace.id, { from: nodes.Lider, to: nodes.Web, message: 'Ajuste o contraste', taskId: task.id, busyGraceMs: 50 });
    await taskBoardService.update(workspace.id, task.id, { status: 'done', notifyCompletion: false });
    session(nodes.Web).ready = true;
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(prompts.filter((prompt) => prompt.message.includes('Ajuste o contraste'))).toHaveLength(0);
    expect(await controlCenterRepository.findEnvelope(queued.messageId)).toMatchObject({ state: 'failed', metadata: expect.objectContaining({ cancelled: true }) });
  });

  it('reconciles a late provider confirmation without sending the prompt twice', async () => {
    const { workspace, nodes } = await team();
    vi.mocked(agentTerminalDeliveryService.deliver).mockImplementationOnce(async (input) => {
      prompts.push({ nodeId: input.nodeId, message: input.message });
      throw new Error('Transcript confirmation timed out. Delivery is uncertain; inspect the terminal before retrying.');
    });
    const result = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Status do build?', timeoutMs: 1_000 });
    expect(result.deliveryState).toBe('delivered');
    expect(await controlCenterRepository.findEnvelope(result.messageId)).toMatchObject({ state: 'sent', metadata: expect.objectContaining({ unconfirmed: true }) });
    vi.mocked(transcript.findPromptInTranscript).mockResolvedValue({ sessionId: 'conversation-Lider' });
    await agentInboxService.sweepNow();
    expect(await controlCenterRepository.findEnvelope(result.messageId)).toMatchObject({ state: 'delivered' });
    expect(prompts).toHaveLength(1);
  });

  it('never types a submitted prompt again when the provider is slow to record it', async () => {
    const { workspace, nodes } = await team();
    vi.mocked(agentTerminalDeliveryService.deliver).mockImplementationOnce(async (input) => {
      prompts.push({ nodeId: input.nodeId, message: input.message });
      throw new Error('Transcript confirmation timed out. Delivery is uncertain; inspect the terminal before retrying.');
    });
    const result = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Revisão longa', timeoutMs: 1_000 });
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000);
    try {
      await agentInboxService.sweepNow();
    } finally {
      clock.mockRestore();
    }
    expect(await controlCenterRepository.findEnvelope(result.messageId)).toMatchObject({ state: 'delivered', metadata: expect.objectContaining({ confirmation: 'unverified' }) });
    await agentInboxService.drain(workspace.id, nodes.Lider);
    expect(prompts).toHaveLength(1);
  });

  it('requeues an attempt that never reached the provider and delivers it on the next pass', async () => {
    const { workspace, nodes } = await team();
    vi.mocked(agentTerminalDeliveryService.deliver).mockRejectedValueOnce(new Error('Terminal delivery queue timed out. The message was not submitted.'));
    const result = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Revisar PR', timeoutMs: 1_000 });
    await vi.waitFor(async () => expect(await controlCenterRepository.findEnvelope(result.messageId)).toMatchObject({ state: 'queued', attempts: 1 }));
    await agentInboxService.drain(workspace.id, nodes.Lider);
    expect(prompts).toHaveLength(1);
    expect(await controlCenterRepository.findEnvelope(result.messageId)).toMatchObject({ state: 'delivered' });
  });

  it('withdraws a still-queued message when the caller cancels', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const controller = new AbortController();
    const pending = bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Pergunta cancelada', signal: controller.signal, busyGraceMs: 5_000 });
    await vi.waitFor(async () => expect(await agentInboxService.pendingCount(nodes.Lider)).toBe(1));
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(await agentInboxService.pendingCount(nodes.Lider)).toBe(0);
  });

  it('records an unreachable recipient as a failed message without marking it as an error', async () => {
    const { workspace, nodes } = await team();
    sessions.delete(session(nodes.Mobile).id);
    await workspaceRepository.updateNode(nodes.Mobile, { payload: { command: 'codex', provider: 'codex' } });
    await expect(bridgeService.ask(workspace.id, { from: nodes.Lider, to: nodes.Mobile, message: 'Você está aí?' })).rejects.toThrow();
    const failed = (await controlCenterRepository.listDeliveries(workspace.id)).filter((event) => event.state === 'failed');
    expect(failed).toHaveLength(1);
    expect((await controlCenterRepository.latestActivity(nodes.Mobile))?.state).not.toBe('error');
  });
  it('resumes a task only when the agent was cut off mid-turn by the previous process', async () => {
    const { workspace, nodes } = await team();
    const task = await taskBoardService.create(workspace.id, { title: 'Currency symbol upload', assigneeNodeId: nodes.Web, dispatch: false });
    const toWeb = () => prompts.filter((prompt) => prompt.nodeId === nodes.Web);
    const turns = vi.mocked(transcript.latestTurnComplete);
    const recover = (sessionId: string) => taskBoardService.recoverBlockedTask({
      workspaceId: workspace.id, nodeId: nodes.Web, taskId: task.id, sessionId, previousState: 'working', previousAction: 'Wiring the upload',
    });

    // The turn finished before the restart: nothing to resume.
    turns.mockResolvedValue(true);
    await recover(session(nodes.Web).id);
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(toWeb()).toHaveLength(0);

    // The old process died mid-turn: open without the live start, released with it.
    const restarted = { ...session(nodes.Web), id: uuidv7(), createdAt: new Date().toISOString() };
    sessions.set(restarted.id, restarted);
    await workspaceRepository.updateNode(nodes.Web, { payload: { command: 'codex', provider: 'codex', sessionId: restarted.id } });
    turns.mockImplementation(async (_provider, _cwd, _id, options) => Boolean(options?.processStartedAt));
    await expect(agentInboxService.interruptedTurn(workspace.id, nodes.Web, restarted.id)).resolves.toBe(true);
    await recover(restarted.id);
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(toWeb()).toHaveLength(1);
    expect(toWeb()[0].message).toContain('automatic task recovery');
    expect(toWeb()[0].message).toContain('ended in the middle of this task');
    expect(toWeb()[0].message).toContain('Currency symbol upload');
  });
  it('tells a restored agent to continue a card once, whichever resume path arrives first', async () => {
    const { workspace, nodes } = await team();
    const first = await taskBoardService.create(workspace.id, { title: 'Company logo backend', assigneeNodeId: nodes.Web, dispatch: false });
    const second = await taskBoardService.create(workspace.id, { title: 'Company bio backend', assigneeNodeId: nodes.Web, dispatch: false });
    vi.spyOn(ptySessionManager, 'waitUntilIdle').mockResolvedValue(true);
    vi.mocked(transcript.latestTurnComplete).mockImplementation(async (_provider, _cwd, _id, options) => Boolean(options?.processStartedAt));
    const sessionId = session(nodes.Web).id;
    const toWeb = () => prompts.filter((prompt) => prompt.nodeId === nodes.Web);
    const recover = (taskId: string) => taskBoardService.recoverBlockedTask({
      workspaceId: workspace.id, nodeId: nodes.Web, taskId, sessionId, previousState: 'working', previousAction: null,
    });

    // The recovery of the first card reaches the terminal before the canvas resume.
    await recover(first.id);
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(toWeb().filter((prompt) => prompt.message.includes('automatic task recovery'))).toHaveLength(1);
    await expect(agentInboxService.recoveryDelivered(nodes.Web, first.id, sessionId)).resolves.toBe(true);

    // The second card's recovery is still queued (the agent is busy) when the canvas resume is typed.
    session(nodes.Web).ready = false;
    await recover(second.id);
    const result = await roleService.applyToTerminal(workspace.id, nodes.Web, 'resume');
    expect(result.tasksDelivered).toBe(1);
    const resume = toWeb().find((prompt) => prompt.message.startsWith('[retomada do workspace]'))!;
    expect(resume.message).toContain('Company bio backend');
    expect(resume.message).not.toContain('Company logo backend');
    const [withdrawn] = await controlCenterRepository.inboxByDedupKey(nodes.Web, `task-recovery:${second.id}:${sessionId}`);
    expect(withdrawn).toMatchObject({ state: 'failed', metadata: expect.objectContaining({ cancelled: true, cancelReason: 'superseded' }) });
    session(nodes.Web).ready = true;
    await agentInboxService.drain(workspace.id, nodes.Web);
    expect(toWeb().filter((prompt) => prompt.message.includes('automatic task recovery'))).toHaveLength(1);
  });

  it('records and forwards concurrent answers to the same message exactly once', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const asked = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint?', busyGraceMs: 20 });
    const answers = await Promise.all([
      bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: asked.messageId, message: 'Use /api/v2.' }),
      bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: asked.messageId, message: 'Use /api/v3.' }),
    ]);
    expect(answers.filter((answer) => answer.via === 'inbox')).toHaveLength(1);
    expect(answers.filter((answer) => answer.alreadyAnswered)).toHaveLength(1);
    const forwarded = await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered']);
    expect(forwarded.filter((envelope) => envelope.kind === 'reply')).toHaveLength(1);
  });

  it('keeps delivering to other agents while one terminal is slow to accept a prompt', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    session(nodes.Mobile).ready = false;
    await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Revisa o backend?', busyGraceMs: 20 });
    await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Mobile, message: 'Revisa o mobile?', busyGraceMs: 20 });
    let releaseLeader!: () => void;
    vi.mocked(agentTerminalDeliveryService.deliver).mockImplementation(async (input) => {
      if (input.nodeId === nodes.Lider) await new Promise<void>((resolvePromise) => { releaseLeader = resolvePromise; });
      prompts.push({ nodeId: input.nodeId, message: input.message });
    });
    session(nodes.Lider).ready = true;
    session(nodes.Mobile).ready = true;
    await (agentInboxService as unknown as { sweep(): Promise<void> }).sweep();
    await vi.waitFor(() => expect(prompts.map((prompt) => prompt.nodeId)).toContain(nodes.Mobile));
    expect(prompts.map((prompt) => prompt.nodeId)).not.toContain(nodes.Lider);
    releaseLeader();
    await vi.waitFor(() => expect(prompts.map((prompt) => prompt.nodeId)).toContain(nodes.Lider));
  });

  it('still captures the answer to a question delivered before a restart, without typing it again', async () => {
    const { workspace, nodes } = await team();
    const pending = bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint?', timeoutMs: 200, busyGraceMs: 20 });
    await vi.waitFor(() => expect(prompts).toHaveLength(1));
    await pending.catch(() => undefined);
    const [asked] = await controlCenterRepository.inboxEnvelopes(nodes.Lider, ['delivered']);
    expect(asked).toBeTruthy();

    // Restart: dispatcher memory is gone and the agent resumes in a new terminal.
    agentInboxService.reset();
    const restarted = { ...session(nodes.Lider), id: uuidv7(), createdAt: new Date().toISOString() };
    sessions.set(restarted.id, restarted);
    await workspaceRepository.updateNode(nodes.Lider, { payload: { command: 'codex', provider: 'codex', sessionId: restarted.id, maestro: true } });
    agentInboxService.start();
    await vi.waitFor(() => expect((agentInboxService as unknown as { replyWatches: Map<string, unknown> }).replyWatches.size).toBe(1));

    replies.set('conversation-Lider', 'Use /api/v2/company.');
    await agentInboxService.sweepNow();
    expect(await controlCenterRepository.findEnvelope(asked.id)).toMatchObject({ state: 'replied', reply: 'Use /api/v2/company.' });
    const toWeb = await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered']);
    expect(toWeb.some((envelope) => envelope.kind === 'reply' && envelope.content.includes('Use /api/v2/company.'))).toBe(true);
    // The question itself was never typed into the leader's terminal again.
    expect(prompts.filter((prompt) => prompt.nodeId === nodes.Lider)).toHaveLength(1);
  });

  it('forwards a recorded answer later when writing it to the asker inbox failed', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const asked = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint?', busyGraceMs: 20 });
    const enqueue = agentInboxService.enqueue.bind(agentInboxService);
    const spy = vi.spyOn(agentInboxService, 'enqueue').mockImplementationOnce(async () => { throw new Error('database is locked'); });
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: asked.messageId, message: 'Use /api/v2.' })).rejects.toThrow('database is locked');
    expect(await controlCenterRepository.findEnvelope(asked.messageId)).toMatchObject({ state: 'replied', metadata: expect.objectContaining({ forwardPending: true }) });
    spy.mockImplementation(enqueue);

    // Retrying the same answer forwards it once; it is not recorded twice.
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: asked.messageId, message: 'Use /api/v2.' }))
      .resolves.toMatchObject({ via: 'inbox' });
    await agentInboxService.sweepNow();
    const forwarded = (await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered'])).filter((envelope) => envelope.kind === 'reply');
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].content).toContain('Use /api/v2.');
    expect(await controlCenterRepository.findEnvelope(asked.messageId)).toMatchObject({ metadata: expect.objectContaining({ forwardPending: false }) });
  });

  it('recovers a pending forward without any retry, from the dispatcher sweep', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const asked = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint?', busyGraceMs: 20 });
    vi.spyOn(agentInboxService, 'enqueue').mockImplementationOnce(async () => { throw new Error('disk I/O error'); });
    await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: asked.messageId, message: 'Use /api/v3.' })).rejects.toThrow();
    vi.mocked(agentInboxService.enqueue).mockRestore();
    await agentInboxService.sweepNow();
    const forwarded = (await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered'])).filter((envelope) => envelope.kind === 'reply');
    expect(forwarded).toHaveLength(1);
  });

  it.each(['notice first', 'first question answered'])('restores reply capture for a batch after a restart (%s)', async (shape) => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    let answered: string | null = null;
    if (shape === 'notice first') {
      await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: nodes.Lider, kind: 'handoff', content: 'Aviso: build verde.', metadata: { wake: false } });
    } else {
      answered = (await bridgeService.ask(workspace.id, { from: nodes.Mobile, to: nodes.Lider, message: 'Pode revisar o mobile?', busyGraceMs: 20 })).messageId;
    }
    const asked = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Qual endpoint?', busyGraceMs: 20 });
    session(nodes.Lider).ready = true;
    await agentInboxService.drain(workspace.id, nodes.Lider);
    expect(prompts.filter((prompt) => prompt.nodeId === nodes.Lider)).toHaveLength(1);
    if (answered) await bridgeService.reply(workspace.id, { from: nodes.Lider, messageId: answered, message: 'Sim, revisado.' });

    agentInboxService.reset();
    const restarted = { ...session(nodes.Lider), id: uuidv7(), createdAt: new Date().toISOString() };
    sessions.set(restarted.id, restarted);
    await workspaceRepository.updateNode(nodes.Lider, { payload: { command: 'codex', provider: 'codex', sessionId: restarted.id, maestro: true } });
    agentInboxService.start();
    await vi.waitFor(() => expect((agentInboxService as unknown as { replyWatches: Map<string, unknown> }).replyWatches.size).toBe(1));
    replies.set('conversation-Lider', 'Use /api/v2/company.');
    await agentInboxService.sweepNow();
    expect(await controlCenterRepository.findEnvelope(asked.messageId)).toMatchObject({ state: 'replied', reply: 'Use /api/v2/company.' });
    expect(prompts.filter((prompt) => prompt.nodeId === nodes.Lider)).toHaveLength(1);
  });

  it('releases the asker in seconds when an idle recipient does not answer right away', async () => {
    const { workspace, nodes } = await team();
    const startedAt = Date.now();
    // Default wait: the asker is never held for minutes by a delivered question.
    const result = await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: 'Revisa o backend?' });
    expect(Date.now() - startedAt).toBeLessThan(12_000);
    expect(result).toMatchObject({ inbox: true, delivered: true, replyConfirmed: false });
  }, 20_000);

  it('keeps retrying pending forwards after a failed lookup and pages through all of them', async () => {
    const { workspace, nodes } = await team();
    session(nodes.Lider).ready = false;
    const asked: string[] = [];
    for (const question of ['Endpoint?', 'Schema?', 'Prazo?']) {
      asked.push((await bridgeService.ask(workspace.id, { from: nodes.Web, to: nodes.Lider, message: question, busyGraceMs: 20 })).messageId);
    }
    const spy = vi.spyOn(agentInboxService, 'enqueue').mockImplementation(async () => { throw new Error('database is locked'); });
    for (const messageId of asked) {
      await expect(bridgeService.reply(workspace.id, { from: nodes.Lider, messageId, message: `Resposta ${messageId.slice(-4)}` })).rejects.toThrow();
    }
    spy.mockRestore();

    // A failed lookup must leave the recovery armed for the next sweep.
    const lookup = vi.spyOn(controlCenterRepository, 'pendingForwards').mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    await agentInboxService.sweepNow();
    expect((agentInboxService as unknown as { forwardsPending: boolean }).forwardsPending).toBe(true);
    lookup.mockRestore();

    // Pages of two still reach the third pending forward.
    await (agentInboxService as unknown as { recoverForwards(pageSize: number): Promise<void> }).recoverForwards(2);
    const forwarded = (await controlCenterRepository.inboxEnvelopes(nodes.Web, ['queued', 'sent', 'delivered'])).filter((envelope) => envelope.kind === 'reply');
    expect(forwarded).toHaveLength(3);
    expect((agentInboxService as unknown as { forwardsPending: boolean }).forwardsPending).toBe(false);
  });
});
