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

describe('inbox delivery during a running agent turn', () => {
  useSvelarTest({ refreshDatabase: true });

  it.skipIf(process.platform === 'win32')('types messages into a working Codex, waits out its question and keeps idle notices for the boundary', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'ork-inbox-mid-turn-')));
    const home = join(root, 'home');
    const conversation = uuidv7();
    const dir = join(home, '.codex/sessions/2026/11/08');
    await mkdir(dir, { recursive: true });
    const transcript = join(dir, `rollout-${conversation}.jsonl`);
    const received = join(root, 'received.txt');
    await writeFile(transcript, JSON.stringify({ type: 'session_meta', payload: { id: conversation, cwd: root } }) + '\n');
    await writeFile(received, '');
    const script = join(root, 'terminal.mjs');
    // A real PTY speaking Codex's OSC 7501 and rollout format, without a provider
    // account, tools or model usage. It persists each prompt it reads, as Codex
    // records a steer, and logs whether the turn was running when it arrived.
    await writeFile(script, `
      import {appendFileSync} from 'node:fs';
      import {createInterface} from 'node:readline';
      const file = ${JSON.stringify(transcript)}, received = ${JSON.stringify(received)};
      const record = e => appendFileSync(file, JSON.stringify({timestamp:new Date().toISOString(), ...e})+'\\n');
      const state = s => process.stdout.write('\\x1b]7501;state=' + s + '\\x1b\\\\');
      let phase = 'idle', spinner = null;
      process.stdout.write('\\x1b[?2004h› ');
      state('idle:app=codex');
      createInterface({input:process.stdin}).on('line', raw => {
        const line = raw.replaceAll('\\x1b[200~', '').replaceAll('\\x1b[201~', '').trim();
        appendFileSync(received, phase + ' ' + line + '\\n');
        record({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:line}]}});
        if (phase !== 'idle') return;
        phase = 'working';
        record({type:'event_msg',payload:{type:'task_started',turn_id:'t'}});
        state('working:app=codex');
        spinner = setInterval(() => process.stdout.write('.'), 150);
        if (!line.includes('START_LONG')) { finish(300); return; }
        setTimeout(() => { phase = 'blocked'; state('blocked:app=codex:kind=question'); }, 4000);
        setTimeout(() => { phase = 'working'; state('working:app=codex'); }, 7000);
        finish(10000);
      });
      function finish(ms) {
        setTimeout(() => {
          clearInterval(spinner); phase = 'idle';
          record({type:'event_msg',payload:{type:'task_complete',turn_id:'t',last_agent_message:'Done'}});
          state('done:app=codex'); process.stdout.write('\\r\\n› ');
        }, ms);
      }
    `);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Isolated mid-turn inbox', workingDir: root });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Recipient', payload: { provider: 'codex', command: process.execPath, agentSessionId: conversation } });
    const session = ptySessionManager.create({ command: process.execPath, args: [script], cwd: root, provider: 'codex',
      workspaceId: workspace.id, nodeId: node.id, transcriptHome: home, transcriptCwd: root, agentSessionId: conversation,
      env: { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, CODEX_HOME: join(home, '.codex') },
    });
    await workspaceRepository.updateNode(node.id, { payload: { provider: 'codex', command: process.execPath, sessionId: session.id, agentSessionId: conversation } });
    agentInboxService.reset();
    const lines = async () => (await readFile(received, 'utf8')).trim().split('\n').filter(Boolean);
    try {
      await vi.waitFor(() => expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(true), { timeout: 6000 });
      await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'owner', content: 'START_LONG' });
      await vi.waitFor(async () => expect((await lines()).some(line => line.startsWith('idle ') && line.includes('START_LONG'))).toBe(true), { timeout: 6000 });
      await vi.waitFor(() => expect(ptySessionManager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(true), { timeout: 6000 });
      expect(ptySessionManager.canAcceptAutomaticMessage(session.id)).toBe(false);

      const reply = await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'reply', content: 'MID_TURN_REPLY' });
      const notice = await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'leader_supervision', content: 'IDLE_NOTICE', metadata: { oneWay: true, wake: false } });
      await vi.waitFor(async () => expect((await lines()).find(line => line.includes('MID_TURN_REPLY'))).toMatch(/^working /), { timeout: 3500 });
      await vi.waitFor(async () => expect(await controlCenterRepository.findEnvelope(reply.id)).toMatchObject({ state: 'delivered', metadata: { duringTurn: true } }), { timeout: 4000 });

      // An open question has the input focus: nothing is typed until it closes.
      await vi.waitFor(() => expect(ptySessionManager.canAcceptAutomaticMessageDuringTurn(session.id)).toBe(false), { timeout: 6000 });
      const blocked = await agentInboxService.enqueue({ workspaceId: workspace.id, toNodeId: node.id, kind: 'ask', content: 'AFTER_QUESTION' });
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect((await lines()).some(line => line.includes('AFTER_QUESTION'))).toBe(false);
      await vi.waitFor(async () => expect((await lines()).find(line => line.includes('AFTER_QUESTION'))).toMatch(/^working /), { timeout: 6000 });

      // The idle-restart notice waits for the boundary, then arrives exactly once.
      expect((await lines()).some(line => line.includes('IDLE_NOTICE'))).toBe(false);
      await vi.waitFor(async () => expect((await lines()).find(line => line.includes('IDLE_NOTICE'))).toMatch(/^idle /), { timeout: 15000 });
      await vi.waitFor(async () => expect(await controlCenterRepository.findEnvelope(notice.id)).toMatchObject({ state: 'delivered' }), { timeout: 4000 });
      expect(await controlCenterRepository.findEnvelope(blocked.id)).toMatchObject({ state: 'delivered', metadata: { duringTurn: true } });
      const all = await lines();
      for (const marker of ['START_LONG', 'MID_TURN_REPLY', 'AFTER_QUESTION', 'IDLE_NOTICE']) expect(all.filter(line => line.includes(marker)), marker).toHaveLength(1);
      expect(all.some(line => line.startsWith('blocked '))).toBe(false);
    } finally {
      ptySessionManager.kill(session.id);
      agentInboxService.reset();
      await rm(root, { recursive: true, force: true });
    }
  }, 45_000);
});
