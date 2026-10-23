import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

describe('inbox recovery at a real terminal turn boundary', () => {
  useSvelarTest({ refreshDatabase: true });

  it.skipIf(process.platform === 'win32')('delivers the next message without manual input when the first exact receipt is missing', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ork-inbox-boundary-')));
    const home = join(root, 'home');
    const conversation = uuidv7();
    const dir = join(home, '.codex/sessions/2026/10/23');
    await mkdir(dir, { recursive: true });
    const transcript = join(dir, `rollout-${conversation}.jsonl`);
    const received = join(root, 'received.txt');
    await writeFile(transcript, JSON.stringify({ type: 'session_meta', payload: { id: conversation, cwd: root } }) + '\n');
    await writeFile(received, '');
    const script = join(root, 'terminal.mjs');
    // A real PTY and transcript, without a provider account, tools or model usage.
    // Simulate a CLI that persisted a normalized envelope instead of the exact
    // handoff. Its next turn is provably finished, while exact matching fails.
    await writeFile(script, `
      import {appendFileSync} from 'node:fs';
      import {createInterface} from 'node:readline';
      const file = ${JSON.stringify(transcript)}, received = ${JSON.stringify(received)};
      const record = e => appendFileSync(file, JSON.stringify({timestamp:new Date().toISOString(), ...e})+'\\n');
      console.log('Ready');
      createInterface({input:process.stdin}).on('line', line => {
        appendFileSync(received, line+'\\n');
        record({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'CLI-normalized envelope'}]}});
        record({type:'event_msg',payload:{type:'task_started'}});
        setTimeout(() => {record({type:'event_msg',payload:{type:'task_complete',last_agent_message:'Done'}});console.log('Done; ready');},100);
      });
    `);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Isolated inbox boundary', workingDir: root });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Recipient', payload: { provider: 'codex', command: process.execPath, agentSessionId: conversation } });
    const session = ptySessionManager.create({ command: process.execPath, args: [script], cwd: root, provider: 'codex',
      workspaceId: workspace.id, nodeId: node.id, transcriptHome: home, transcriptCwd: root, agentSessionId: conversation,
      env: { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, CODEX_HOME: join(home, '.codex') },
    });
    await workspaceRepository.updateNode(node.id, { payload: { provider: 'codex', command: process.execPath, sessionId: session.id, agentSessionId: conversation } });
    const write = ptySessionManager.writeWithConfirmedSubmit.bind(ptySessionManager);
    const bound = vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit').mockImplementation((id, text, options) => write(id, text, { ...options, confirmationWindowMs: 10_000, maxAttempts: 1 }));
    agentInboxService.reset();
    try {
      await vi.waitFor(() => expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true), { timeout: 6000 });
      const first = await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'owner', content: 'FIRST_HANDOFF' });
      await vi.waitFor(async () => expect(await readFile(received, 'utf8')).toContain('FIRST_HANDOFF'), { timeout: 5000 });
      await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'owner', content: 'SECOND_HANDOFF' });
      const queuedAt = Date.now();
      await vi.waitFor(async () => expect(await readFile(received, 'utf8')).toContain('SECOND_HANDOFF'), { timeout: 8000 });
      expect(Date.now() - queuedAt).toBeLessThan(10_000);
      const lines = (await readFile(received, 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines.filter(line => line.includes('FIRST_HANDOFF'))).toHaveLength(1);
      console.log(`Inbox recovered without manual input in ${Date.now() - queuedAt} ms; first prompt typed once`);
      // Composer recovery is not a false exact receipt for the first message.
      expect(await controlCenterRepository.findEnvelope(first.id)).toMatchObject({ state: 'sent', metadata: { unconfirmed: true } });
      await agentInboxService.sweepNow();
    } finally {
      ptySessionManager.kill(session.id);
      bound.mockRestore();
      agentInboxService.reset();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
