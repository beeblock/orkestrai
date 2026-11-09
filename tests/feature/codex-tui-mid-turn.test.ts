import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { findPromptInTranscript } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';

const enabled = process.env.ORKESTRAI_REAL_CODEX_TEST === '1';

/**
 * A person can type into Codex while it works; Enter steers the running turn.
 * The automatic delivery does the same mid-command and still requires the
 * exact prompt receipt, without a second Enter or a separate turn.
 */
it.skipIf(!enabled).each(['steer', 'interrupted'] as const)('delivers a message into a running real Codex turn and confirms its exact receipt (%s)', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-codex-mid-turn-'));
  const home = join(root, 'home'), cwd = join(root, 'project'), codexHome = join(home, '.codex');
  await mkdir(codexHome, { recursive: true }); await mkdir(cwd);
  const requests: Array<{ steer: boolean; toolOutput: boolean }> = [];
  let commandIssued = false;
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/responses' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4 * 1024 * 1024) { response.writeHead(413).end(); return; } }
    const body = JSON.parse(raw);
    const users = (body.input ?? []).filter((item: any) => item.type === 'message' && item.role === 'user')
      .map((item: any) => (item.content ?? []).map((part: any) => part.text ?? '').join(''));
    const primary = users.some((text: string) => text.startsWith('Fixture long task'));
    const toolOutput = (body.input ?? []).some((item: any) => item.type === 'function_call_output');
    const steer = users.some((text: string) => text.startsWith('Fixture mid-turn'));
    if (primary && !users.at(-1)?.startsWith('Generate a concise')) requests.push({ steer, toolOutput });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    // One long command keeps the turn running; the steer must join this turn.
    const item = primary && !toolOutput && !commandIssued && !users.at(-1)?.startsWith('Generate a concise')
      ? (commandIssued = true, { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'exec_command',
        arguments: JSON.stringify({ cmd: process.platform === 'win32' ? 'ping -n 13 127.0.0.1' : 'sleep 12', yield_time_ms: 30000 }) })
      : { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: steer ? 'Steer received' : 'Local fixture OK' }] };
    for (const event of [{ type: 'response.created', response: { id: `resp_${Date.now()}` } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${Date.now()}`, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }]) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let output = '', liveSessionId: string | null = null, rawWrite: ((data: string) => void) | null = null;
  const ownedChildren: Array<{ pid: number; exited: boolean }> = [];
  const manager = new PtySessionManager(((command: string, args: string[], options: any) => {
    // Only an allowlist enters the CLI. Never read or forward the owner's accounts.
    const allowed = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'TERM'];
    const env: Record<string, string> = {};
    for (const key of allowed) if (options.env[key]) env[key] = options.env[key];
    Object.assign(env, { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome,
      APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'),
      XDG_CONFIG_HOME: join(home, '.config'), NO_PROXY: '127.0.0.1,localhost',
      HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
    const child = spawn(command, args, { ...options, env });
    rawWrite = data => child.write(data);
    const owned = { pid: child.pid, exited: false }; ownedChildren.push(owned);
    child.onExit(() => { owned.exited = true; });
    child.onData(chunk => {
      output = (output + chunk).slice(-32768);
      queueMicrotask(() => {
        if (!liveSessionId) return;
        if (chunk.includes('\x1b[6n')) manager.writeHumanInput(liveSessionId, '\x1b[1;1R');
        if (/\x1b\[(?:0)?c/.test(chunk)) manager.writeHumanInput(liveSessionId, '\x1b[?1;2c');
      });
    });
    return child;
  }) as never, () => {});
  try {
    // The Canvas launches Codex without approvals; a known model family offers exec_command.
    const args = ['--no-alt-screen', '--model', 'gpt-5-codex', '--dangerously-bypass-approvals-and-sandbox',
      '-c', 'model_provider="fixture"', '-c', 'model_providers.fixture.name="Local fixture"',
      '-c', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`,
      '-c', 'model_providers.fixture.wire_api="responses"', '-c', 'model_providers.fixture.requires_openai_auth=false',
      '-c', 'model_providers.fixture.supports_websockets=false', '-c', 'check_for_update_on_startup=false',
      '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`];
    const session = manager.create({ command: process.env.ORKESTRAI_TEST_CODEX_BINARY ?? 'codex', args, cwd, provider: 'codex',
      env: { CODEX_HOME: codexHome, HOME: home, USERPROFILE: home } });
    liveSessionId = session.id;
    await expect.poll(() => output.includes('›'), { timeout: 30000, message: 'Codex did not reach its composer' }).toBe(true);
    await expect.poll(() => manager.canAcceptAutomaticMessage(session.id), { timeout: 20000 }).toBe(true);
    let exactId: string | null = null, recoveries = 0;
    const deliver = async (text: string, duringTurn: boolean) => {
      const since = Date.now();
      await manager.writeWithConfirmedSubmit(session.id, text, {
        confirmationWindowMs: 40000, maxAttempts: 1, duringTurn,
        isAccepted: async () => {
          const match = await findPromptInTranscript('codex', cwd, exactId, text, since, { codexHome });
          if (match) { exactId = match.sessionId; manager.bindAgentSession(session.id, exactId); }
          // As the delivery service does: an ended turn may have put the prompt back.
          else if (manager.automaticDeliveryDuringTurn(session.id) && manager.retryRestoredTurnInput(session.id)) recoveries++;
          return Boolean(match);
        },
      });
    };
    await deliver('Fixture long task: run the long command, then answer.', false);
    await expect.poll(() => commandIssued, { timeout: 15000 }).toBe(true);
    await expect.poll(() => manager.canAcceptAutomaticMessageDuringTurn(session.id), { timeout: 15000 }).toBe(true);
    expect(manager.canAcceptAutomaticMessage(session.id)).toBe(false);
    const enteredAt = Date.now();
    const steer = deliver(`Fixture mid-turn reply ${'Specialist result for the leader, sent while it works. '.repeat(25)}`.trim(), true);
    if (scenario === 'interrupted') {
      // Something other than the owner's keys stops the turn before the steer is
      // consumed; Codex puts the steer back into its composer.
      await expect.poll(() => manager.automaticDeliveryDuringTurn(session.id), { timeout: 10000 }).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 500));
      rawWrite!('\x1b');
    }
    await steer;
    const receiptMs = Date.now() - enteredAt;
    // Codex adds the steer to this turn's next model request: after the command,
    // or at once if the model was still streaming when it arrived.
    expect(requests.some(request => request.steer)).toBe(true);
    // The owner's terminal is never held after Enter.
    manager.writeHumanInput(session.id, 'x');
    expect(manager.get(session.id)?.inputDeferred).toBe(false);
    manager.writeHumanInput(session.id, '\x7f');
    const files = (await readdir(join(codexHome, 'sessions'), { recursive: true })).filter(name => String(name).endsWith('.jsonl'));
    const records = (await Promise.all(files.map(name => readFile(join(codexHome, 'sessions', String(name)), 'utf8'))))
      .join('\n').split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (scenario === 'steer') expect(records.filter(record => record.payload?.type === 'task_started')).toHaveLength(1);
    console.info(JSON.stringify({ platform: process.platform, scenario, receiptMs, recoveries, requests }));
  } catch (error) {
    process.stderr.write(`Codex mid-turn fixture failed: ${String(error)}\n${output.slice(-6000)}\n`);
    throw error;
  } finally {
    if (process.platform === 'win32') for (const child of ownedChildren) if (!child.exited && child.pid > 1) {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
    manager.killAll(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
  }
}, 150000);
