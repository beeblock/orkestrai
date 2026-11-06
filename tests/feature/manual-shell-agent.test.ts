import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { shellAgentService } from '$lib/modules/agent-room/application/services/ShellAgentService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';

const windows = process.platform === 'win32';
const quote = (value: string) => windows ? '"' + value + '"' : "'" + value.replaceAll("'", "'\\''") + "'";

async function fixture(answerDelay = 5500, saveReply = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ork-manual-agent-')));
  const project = join(root, 'another-project');
  await mkdir(project, { recursive: true });
  const home = join(root, 'home');
  const config = join(home, '.claude');
  const conversation = uuidv7();
  const dir = join(config, 'projects', project.replace(/[^a-zA-Z0-9]/g, '-'));
  await mkdir(dir, { recursive: true });
  const script = join(root, 'claude');
  await writeFile(script, `
    import {appendFileSync} from 'node:fs';
    import {createInterface} from 'node:readline';
    const file = ${JSON.stringify(join(dir, conversation + '.jsonl'))};
    const record = data => appendFileSync(file, JSON.stringify({sessionId:${JSON.stringify(conversation)},cwd:process.cwd(),timestamp:new Date().toISOString(),...data})+'\\n');
    console.log('FAKE_CLAUDE_READY');
    createInterface({input:process.stdin}).on('line', line => {
      line = line.replace(/\\x1b\\[20[01]~/g, '');
      if (${saveReply}) record({type:'user',message:{role:'user',content:line}});
      setTimeout(() => console.log('\\x1b[2J\\x1b[HRAW_SCREEN_GARBAGE   thinking...'), 200);
      setTimeout(() => {
        if (${saveReply}) record({type:'assistant',message:{role:'assistant',stop_reason:'end_turn',content:[{type:'thinking',thinking:'PRIVATE_REASONING'},{type:'text',text:'Clean answer for this exact question.'}]}});
        console.log('\\x1b[HRAW_SCREEN_GARBAGE prompt >');
      }, ${answerDelay});
    });
  `);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Manual Shell conversation', workingDir: root });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'CMD Claude', payload: { command: windows ? 'cmd.exe' : '/bin/bash' } });
  const session = ptySessionManager.create({ command: windows ? 'cmd.exe' : '/bin/bash', args: windows ? ['/Q'] : ['--noprofile', '--norc'], cwd: root,
    workspaceId: workspace.id, nodeId: node.id, transcriptHome: home,
    env: { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, XDG_CONFIG_HOME: home, CLAUDE_CONFIG_DIR: config, HISTFILE: '/dev/null' } });
  await workspaceRepository.updateNode(node.id, { payload: { command: windows ? 'cmd.exe' : '/bin/bash', sessionId: session.id } });
  let output = '';
  let exited = false;
  const attached = ptySessionManager.attach(session.id, data => { output += data; }, () => { exited = true; });
  const dispose = async () => {
    ptySessionManager.kill(session.id);
    try { await vi.waitFor(() => expect(exited).toBe(true), { timeout: 5000 }); }
    finally { attached.detach(); await rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); }
  };
  try {
    await vi.waitFor(() => expect(ptySessionManager.get(session.id)?.hasOutput).toBe(true), { timeout: 5000 });
    ptySessionManager.writeHumanInput(session.id, `cd ${windows ? "/d " : ""}${quote(project)}\r`);
    await vi.waitFor(() => expect(windows ? output.includes(project) : ptySessionManager.get(session.id)?.cwd === project).toBe(true), { timeout: 5000 });
    ptySessionManager.writeHumanInput(session.id, `${quote(process.execPath)} ${quote(script)}\r`);
    await vi.waitFor(() => expect(output).toContain('FAKE_CLAUDE_READY'), { timeout: 5000 });
    return { root, project, home, workspace, node, session, dispose };
  } catch (error) { await dispose(); throw error; }
}

describe('agents started manually inside a Shell', () => {
  useSvelarTest({ refreshDatabase: true });

  it('returns the structured Claude answer after cd, never the quiet TUI redraw', async () => {
    const f = await fixture();
    try {
      expect(await shellAgentService.detect(f.workspace.id, f.node.id, f.session.id)).toMatchObject({ provider: 'claude', cwd: f.project });
      const start = Date.now();
      const reply = await bridgeService.ask(f.workspace.id, { to: f.node.id, message: 'Give the clean status', timeoutMs: 12_000 });
      expect(reply).toMatchObject({ reply: 'Clean answer for this exact question.', replyConfirmed: true, delivered: true, timedOut: false });
      expect(Date.now() - start).toBeGreaterThan(5000);
      expect(JSON.stringify(reply)).not.toMatch(/RAW_SCREEN_GARBAGE|PRIVATE_REASONING/);
      expect((await workspaceRepository.getNode(f.node.id))?.payload).toEqual({ command: windows ? 'cmd.exe' : '/bin/bash', sessionId: f.session.id });
      expect(ptySessionManager.get(f.session.id)).toMatchObject({ provider: null, agentSessionId: null });
    } finally { await f.dispose(); }
  }, 30_000);

  it.each(['reply', 'ask'] as const)('returns a bridge %s to the native caller without forwarding a duplicate or waiting for TUI acknowledgement', async mode => {
    const f = await fixture(100, false);
    try {
      const sender = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'Native Claude', payload: { provider: 'claude' } });
      const messageId = uuidv7();
      const pending = bridgeService.ask(f.workspace.id, { from: sender.id, to: f.node.id, message: 'Reply through the bridge', messageId, timeoutMs: 8000 });
      await vi.waitFor(() => expect(agentInboxService.hasWaiter(messageId)).toBe(true), { timeout: 5000 });
      if (mode === 'reply') {
        const delivered = await bridgeService.reply(f.workspace.id, { from: f.node.id, messageId, message: 'Exact answer from the manually launched agent.' });
        expect(delivered.via).toBe('waiter');
      } else {
        const delivered = await bridgeService.ask(f.workspace.id, { from: f.node.id, to: sender.id, message: 'Exact answer from the manually launched agent.' });
        expect(delivered.answeredMessageId).toBe(messageId);
      }
      expect(await pending).toMatchObject({ reply: 'Exact answer from the manually launched agent.', replyConfirmed: true, delivered: true, timedOut: false });
      expect(await controlCenterRepository.countInbox(sender.id, ['queued'])).toBe(0);
      expect(agentInboxService.hasWaiter(messageId)).toBe(false);
    } finally { await f.dispose(); }
  }, 20_000);

  it('does not confirm terminal output when Claude has no matching transcript', async () => {
    const f = await fixture(100, false);
    try {
      const reply = await bridgeService.ask(f.workspace.id, { to: f.node.id, message: 'No saved reply', timeoutMs: 1500 });
      expect(reply).toMatchObject({ reply: '', replyConfirmed: false, delivered: true, timedOut: true });
    } finally { await f.dispose(); }
  }, 20_000);

  it('cancels a queued agent prompt if its child exits instead of executing it in the parent shell', async () => {
    const f = await fixture();
    const writes = vi.spyOn(ptySessionManager, 'writeWithConfirmedSubmit');
    const detect = shellAgentService.detect.bind(shellAgentService);
    const detection = vi.spyOn(shellAgentService, 'detect').mockImplementation(async (...args) => {
      // Reproduce Windows CIM latency on faster hosts without mocking identity.
      if (!windows) await new Promise(resolve => setTimeout(resolve, 500));
      return detect(...args);
    });
    try {
      const context = await shellAgentService.detect(f.workspace.id, f.node.id, f.session.id);
      expect(context).not.toBeNull();
      ptySessionManager.writeHumanInput(f.session.id, 'OWNER_DRAFT');
      const pending = bridgeService.ask(f.workspace.id, { to: f.node.id, message: 'Never run this as a shell command', timeoutMs: 2000 });
      const cancelled = expect(pending).rejects.toThrow(/obsolete|no longer|ativa|active/i);
      // A missing submit receipt also means "not queued yet". Wait until the
      // real writer has queued this handoff behind the owner's draft instead.
      await vi.waitFor(() => expect(writes).toHaveBeenCalledWith(
        f.session.id, expect.stringContaining('Never run this as a shell command'), expect.any(Object),
      ), { timeout: 5000 });
      expect(ptySessionManager.outputTail(f.workspace.id, f.node.id)).not.toContain('Never run this as a shell command');
      process.kill(Number(context!.processKey.split(':')[0]), 'SIGTERM');
      await cancelled;
      expect(ptySessionManager.hasUnsubmittedOwnerInput(f.session.id)).toBe(true);
      expect(ptySessionManager.outputTail(f.workspace.id, f.node.id)).not.toContain('Never run this as a shell command');
    } finally { writes.mockRestore(); detection.mockRestore(); await f.dispose(); }
  }, 15_000);

  it('does not adopt an agent from another node or workspace', async () => {
    const f = await fixture();
    try {
      expect(await shellAgentService.detect('another-workspace', f.node.id, f.session.id)).toBeNull();
      expect(await shellAgentService.detect(f.workspace.id, 'another-node', f.session.id)).toBeNull();
    } finally { await f.dispose(); }
  }, 15_000);
});
