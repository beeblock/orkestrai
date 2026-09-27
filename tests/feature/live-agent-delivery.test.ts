import { randomUUID } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { findPromptInTranscript, findReplyToPrompt } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { agentSessionService } from '$lib/modules/agent-room/application/services/AgentSessionService.js';

async function createLiveAgent(provider: string) {
  const args = provider === 'claude' ? ['--dangerously-skip-permissions'] : ['--dangerously-bypass-approvals-and-sandbox'];
  const workspace = await workspaceRepository.createWorkspace({ name: 'Isolated live bridge regression', workingDir: process.cwd() });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Live bridge recipient',
    payload: { provider, command: provider, args },
  });
  const ensured = await agentSessionService.ensure(workspace.id, node.id);
  return { workspace, node, session: ptySessionManager.get(ensured.sessionId)! };
}

// Explicit opt-in: uses the owner's already-authenticated CLI, never a fake TUI.
describe.skipIf(process.env.ORKESTRAI_TEST_LIVE_AGENTS !== '1')('real provider terminal delivery', () => {
  useSvelarTest({ refreshDatabase: true });
  it('confirms a Codex handoff queued during a long tool call, then delivers the next one', async () => {
    const manager = ptySessionManager;
    const { session } = await createLiveAgent('codex');
    let conversation: string | null = null;
    const deliver = async (prompt: string) => {
      const since = Date.now();
      await manager.writeWithConfirmedSubmit(session.id, prompt, { isAccepted: async () => {
        const match = await findPromptInTranscript('codex', process.cwd(), conversation, prompt, since);
        if (match) conversation = match.sessionId;
        return Boolean(match);
      } });
      return since;
    };
    try {
      expect(await manager.waitUntilInitialIdle(session.id, 30_000)).toBe(true);
      await deliver('Isolated terminal queue regression. Run only /bin/sleep 30 once, then reply WAIT_DONE. Do not read or change files, contact agents, or run any other commands.');
      await new Promise(resolve => setTimeout(resolve, 5_000));
      const marker = `ORKESTRAI_BUSY_${randomUUID().replaceAll('-', '')}`;
      const prompt = `Terminal regression. After your sleep tool finishes, reply exactly ${marker}. No tools, no files, no other action.`;
      const since = await deliver(prompt);
      let reply: unknown;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        reply = await findReplyToPrompt('codex', process.cwd(), conversation, prompt, since);
        if (reply) break;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      expect(JSON.stringify(reply)).toContain(marker);
      await deliver(`Final queue probe ${randomUUID()}. Reply OK only, no tools.`);
      console.log(`Codex busy handoff: confirmed exact turn and next submission in ${Date.now() - since} ms`);
    } finally { manager.kill(session.id); }
  }, 240_000);

  it.each(['codex', 'claude'])('accepts and answers two long %s handoffs without an attached renderer', async provider => {
    const manager = ptySessionManager;
    const { workspace, node, session } = await createLiveAgent(provider);
    let output = '';
    let restoredSessionId: string | undefined;
    let restoreSpy: ReturnType<typeof vi.spyOn> | undefined;
    manager.attach(session.id, chunk => { output = (output + chunk).slice(-12000); });
    try {
      expect(await manager.waitUntilInitialIdle(session.id, 30_000), 'provider must reach its actual composer').toBe(true);
      for (let i = 0; i < 2; i++) {
        const marker = `ORKESTRAI_DELIVERY_${randomUUID().replaceAll('-', '')}`;
        const prompt = `Terminal regression test. Do not call tools, read files, write files, or contact anyone. Reply with exactly ${marker}. `
          + 'Filler to reproduce a long multi-agent handoff; it requires no action. '.repeat(75);
        const since = Date.now();
        let conversation: string | null = null;
        await manager.writeWithConfirmedSubmit(session.id, prompt, { isAccepted: async () => {
          const match = await findPromptInTranscript(provider, process.cwd(), conversation, prompt, since);
          if (match) conversation = match.sessionId;
          return Boolean(match);
        } });
        expect(conversation, 'submission must exist in this provider transcript').toBeTruthy();
        let reply: unknown;
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          reply = await findReplyToPrompt(provider, process.cwd(), conversation, prompt, since);
          if (reply) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        expect(JSON.stringify(reply), 'reply must belong to the exact handoff, not a different conversation').toContain(marker);
        console.log(`${provider} handoff ${i + 1}: accepted and answered in ${Date.now() - since} ms`);
      }
      const marker = `ORKESTRAI_BRIDGE_${randomUUID().replaceAll('-', '')}`;
      const started = Date.now();
      const bridged = await bridgeService.ask(workspace.id, {
        to: node.id,
        message: `Terminal regression only. Do not call tools or modify anything. Reply with exactly ${marker}.`,
        timeoutMs: 60_000,
      });
      expect(bridged).toMatchObject({ replyConfirmed: true, deliveryState: 'replied' });
      expect(JSON.stringify(bridged)).toContain(marker);
      console.log(`${provider} real bridge ask: confirmed in ${Date.now() - started} ms`);
      const saved = await workspaceRepository.getNode(node.id);
      const payload = saved!.payload as Record<string, unknown>;
      expect(payload.agentSessionId).toBeTruthy();
      manager.kill(session.id);
      await workspaceRepository.updateNode(node.id, { payload: { ...payload, sessionId: undefined } as never });
      const resumedMarker = `ORKESTRAI_RESTORED_${randomUUID().replaceAll('-', '')}`;
      const originalEnsure = agentSessionService.ensure.bind(agentSessionService);
      restoreSpy = vi.spyOn(agentSessionService, 'ensure').mockImplementation(async (...parameters) => {
        const restored = await originalEnsure(...parameters);
        restoredSessionId = restored.sessionId;
        output = '';
        manager.attach(restored.sessionId, chunk => { output = (output + chunk).slice(-12000); });
        return restored;
      });
      try {
        const resumed = await bridgeService.ask(workspace.id, {
          to: node.id,
          message: `Isolated restart regression only. No tools or file changes. Reply exactly ${resumedMarker}.`,
          timeoutMs: 60_000,
          signal: AbortSignal.timeout(60_000),
        });
        expect(resumed).toMatchObject({ replyConfirmed: true, deliveryState: 'replied' });
        expect(resumed.reply).toContain(resumedMarker);
        expect((await workspaceRepository.getNode(node.id))!.payload).toMatchObject({ agentSessionId: payload.agentSessionId });
        console.log(`${provider} restart: resumed exact saved conversation and confirmed the reply`);
      } finally {
        restoredSessionId = ((await workspaceRepository.getNode(node.id))?.payload as { sessionId?: string })?.sessionId;
      }
    } catch (error) {
      console.log(`${provider} diagnostic terminal tail:`, stripVTControlCharacters(output).slice(-2000));
      throw error;
    } finally {
      restoreSpy?.mockRestore();
      manager.kill(session.id);
      if (restoredSessionId) manager.kill(restoredSessionId);
    }
  }, 180_000);
});
