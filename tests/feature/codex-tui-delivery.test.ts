import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { findPromptInTranscript, latestTurnBoundary } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';

const enabled = process.env.ORKESTRAI_REAL_CODEX_TEST === '1';
const duration = process.env.ORKESTRAI_CODEX_SOAK_SCENARIO === 'canvas' ? 0
  : Math.max(0, Number(process.env.ORKESTRAI_CODEX_SOAK_SECONDS ?? 0)) * 1000;

it.skipIf(!enabled)('delivers through the real Codex TUI, including a missed Enter after sustained use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-codex-tui-'));
  const home = join(root, 'home'), cwd = join(root, 'project'), codexHome = join(home, '.codex');
  await mkdir(codexHome, { recursive: true }); await mkdir(cwd);
  let requests = 0, primaryRequests = 0, dropEnter = false, dropped = 0, output = '';
  const ownedChildren: Array<{ pid: number; exited: boolean }> = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/responses' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4 * 1024 * 1024) { response.writeHead(413).end(); return; } }
    const body = JSON.parse(raw); requests++;
    const last = body.input?.at(-1);
    const lastText = (last?.content ?? []).map((item: any) => item.text ?? '').join('');
    if (lastText.startsWith('Fixture delivery ')) primaryRequests++;
    console.info('Local Responses fixture', { request: requests, model: body.model, inputCount: body.input?.length,
      lastText: lastText.slice(0, 75) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = { id: `msg_${requests}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Local fixture OK' }] };
    for (const event of [{ type: 'response.created', response: { id: `resp_${requests}` } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }]) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  let liveSessionId: string | null = null;
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
    const owned = { pid: child.pid, exited: false }; ownedChildren.push(owned);
    child.onExit(() => { owned.exited = true; });
    child.onData(chunk => {
      output = (output + chunk).slice(-32768);
      // This isolated TUI has no xterm viewer. Supply the terminal cursor/device
      // reports that the real renderer normally answers (especially on Windows).
      // Use the same inbound path as xterm: bypassing it hid DSR replies
      // incorrectly counted as owner edits, which disabled lost-Enter recovery.
      queueMicrotask(() => {
        if (!liveSessionId) return;
        if (chunk.includes('\x1b[6n')) manager.writeHumanInput(liveSessionId, '\x1b[1;1R');
        if (/\x1b\[(?:0)?c/.test(chunk)) manager.writeHumanInput(liveSessionId, '\x1b[?1;2c');
      });
    });
    const write = child.write.bind(child);
    child.write = text => { if (dropEnter && text === '\r') { dropEnter = false; dropped++; } else write(text); };
    return child;
  }) as never, () => {});
  try {
    const args = ['--no-alt-screen', '--model', 'gpt-6.1-sol', '-a', 'never', '-s', 'read-only',
      '-c', 'model_provider="fixture"', '-c', 'model_providers.fixture.name="Local fixture"',
      '-c', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`,
      '-c', 'model_providers.fixture.wire_api="responses"', '-c', 'model_providers.fixture.requires_openai_auth=false',
      '-c', 'model_providers.fixture.supports_websockets=false', '-c', 'check_for_update_on_startup=false',
      '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`];
    const session = manager.create({ command: process.env.ORKESTRAI_TEST_CODEX_BINARY ?? 'codex', args, cwd, provider: 'codex',
      env: { CODEX_HOME: codexHome, HOME: home, USERPROFILE: home } });
    liveSessionId = session.id;
    await expect.poll(() => output.includes('›'), { timeout: 30000, message: 'Codex did not reach its composer' }).toBe(true)
      .catch(error => { throw new Error(`${error.message}\n${output.slice(-8000)}`); });
    await new Promise(resolve => setTimeout(resolve, 3000));
    let exactId: string | null = null, serial = 0;
    async function deliver(missEnter = false) {
      const message = `Fixture delivery ${++serial}\n` + 'A bounded local-only paste, no tools or external inference. '.repeat(150);
      const since = Date.now(); let submittedAt: number | null = null;
      dropEnter = missEnter;
      await manager.writeWithConfirmedSubmit(session.id, message.trim(), {
        confirmationWindowMs: 25000, maxAttempts: 1,
        onSubmitted: () => { submittedAt = manager.automaticDeliverySubmittedAt(session.id); },
        isAccepted: async () => {
          const match = await findPromptInTranscript('codex', cwd, exactId, message.trim(), since, { codexHome });
          if (match) { exactId = match.sessionId; manager.bindAgentSession(session.id, exactId); return true; }
          if (!exactId && submittedAt !== null) manager.retryPendingAutomaticPaste(session.id, submittedAt, Number.NaN);
          if (exactId && submittedAt !== null) {
            const boundary = await latestTurnBoundary('codex', cwd, exactId, { codexHome });
            if (boundary.ready && boundary.finishedAt !== null) manager.retryPendingAutomaticPaste(session.id, submittedAt, boundary.finishedAt);
          }
          return false;
        },
      }).catch(error => { throw new Error(`${error.message}\n${output.slice(-4000)}`); });
      await expect.poll(async () => exactId && (await latestTurnBoundary('codex', cwd, exactId, { codexHome })).ready,
        { timeout: 15000 }).toBe(true);
    }
    await deliver();
    const started = Date.now();
    while (Date.now() - started < duration) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, duration - (Date.now() - started))));
      await deliver();
      if (serial % 10 === 0) console.info(`Codex TUI soak: ${serial} exact receipts, ${Math.floor((Date.now() - started) / 1000)}s`);
    }
    await deliver(true); await deliver();
    expect(dropped).toBe(1); expect(primaryRequests).toBe(serial);
    console.info(JSON.stringify({ platform: process.platform, elapsedSeconds: Math.round((Date.now() - started) / 1000), exactReceipts: serial, requests, primaryRequests, recoveredEnter: dropped }));
  } catch (error) {
    // Cleanup failures must not hide the actual TUI/receipt failure.
    process.stderr.write(`Codex fixture failed: ${String(error)}\n${output.slice(-8000)}\n`);
    throw error;
  } finally {
    if (process.platform === 'win32') for (const child of ownedChildren) if (!child.exited && child.pid > 1) {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
    manager.killAll(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    // Allow Windows process handles to close before deleting private transcripts.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
      .catch(error => process.stderr.write(`Private fixture cleanup deferred to runner: ${error.code}\n`));
  }
}, duration + 150000);
