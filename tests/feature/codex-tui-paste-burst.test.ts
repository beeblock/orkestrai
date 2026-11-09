import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node-pty';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { findPromptInTranscript } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';

// POSIX job control stands in for a CPU-starved TUI; native Windows runs the other real-CLI cases.
const enabled = process.env.ORKESTRAI_REAL_CODEX_TEST === '1' && process.platform !== 'win32';

/**
 * ConPTY gives Codex a paste as key events, so its paste-burst heuristic decides
 * whether Enter submits. A loaded machine reads the paste and Enter back to back,
 * however long the writer waited. This drives the real TUI that way and requires
 * the first Enter to submit, with a control that omits the flushing key.
 */
it.skipIf(!enabled)('submits a ConPTY-style Codex paste on the first Enter while the TUI reads input late', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-codex-burst-'));
  const home = join(root, 'home'), cwd = join(root, 'project'), codexHome = join(home, '.codex');
  await mkdir(codexHome, { recursive: true }); await mkdir(cwd);
  const primary: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url !== '/v1/responses' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4 * 1024 * 1024) { response.writeHead(413).end(); return; } }
    const body = JSON.parse(raw);
    const lastText = (body.input?.at(-1)?.content ?? []).map((item: any) => item.text ?? '').join('');
    if (lastText.startsWith('Fixture burst ')) primary.push(lastText.slice(0, 20));
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Local fixture OK' }] };
    for (const event of [{ type: 'response.created', response: { id: `resp_${Date.now()}` } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${Date.now()}`, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }]) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const resumes: Array<() => void> = [];
  let manager: PtySessionManager | null = null;

  async function deliverStarved(serial: number, keepFlush: boolean) {
    let output = '', liveSessionId: string | null = null;
    const writes: string[] = [];
    manager = new PtySessionManager(((command: string, args: string[], options: any) => {
      // Only an allowlist enters the CLI. Never read or forward the owner's accounts.
      const env: Record<string, string> = {};
      for (const key of ['PATH', 'LANG', 'TERM', 'TMPDIR']) if (options.env[key]) env[key] = options.env[key];
      Object.assign(env, { HOME: home, CODEX_HOME: codexHome, XDG_CONFIG_HOME: join(home, '.config'), NO_PROXY: '127.0.0.1,localhost',
        HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1' });
      const child = spawn(command, args, { ...options, env });
      const resume = () => { try { process.kill(-child.pid, 'SIGCONT'); } catch { /* exited */ } };
      resumes.push(resume);
      child.onData(chunk => {
        output = (output + chunk).slice(-65536);
        queueMicrotask(() => {
          if (!liveSessionId) return;
          if (chunk.includes('\x1b[6n')) manager!.writeHumanInput(liveSessionId, '\x1b[1;1R');
          if (/\x1b\[(?:0)?c/.test(chunk)) manager!.writeHumanInput(liveSessionId, '\x1b[?1;2c');
        });
      });
      const write = child.write.bind(child);
      child.write = (data: string) => {
        if (data.includes('Fixture burst ')) {
          // Like ConPTY for a console app: the paste arrives as plain keys, and the
          // starved TUI reads none of them until after Enter has been written too.
          process.kill(-child.pid, 'SIGSTOP');
          data = data.replaceAll('\x1b[200~', '').replaceAll('\x1b[201~', '');
        }
        if (data === '\x05' && !keepFlush) return;
        writes.push(data);
        write(data);
        if (data === '\r') setTimeout(resume, 2000);
      };
      return child;
    }) as never, () => {});
    const args = ['--no-alt-screen', '--model', 'gpt-6.1-sol', '-a', 'never', '-s', 'read-only',
      '-c', 'model_provider="fixture"', '-c', 'model_providers.fixture.name="Local fixture"',
      '-c', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`,
      '-c', 'model_providers.fixture.wire_api="responses"', '-c', 'model_providers.fixture.requires_openai_auth=false',
      '-c', 'model_providers.fixture.supports_websockets=false', '-c', 'check_for_update_on_startup=false',
      '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`];
    const session = manager.create({ command: process.env.ORKESTRAI_TEST_CODEX_BINARY ?? 'codex', args, cwd, provider: 'codex',
      env: { CODEX_HOME: codexHome, HOME: home } });
    liveSessionId = session.id;
    (manager as any).sessions.get(session.id).conptySubmitGuard = true;
    await expect.poll(() => output.includes('›'), { timeout: 30000, message: 'Codex did not reach its composer' }).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const message = `Fixture burst ${serial} ` + 'Leader to specialist handoff, local fixture only. '.repeat(40);
    const text = message.trim(), since = Date.now();
    const before = primary.length;
    let error: unknown = null;
    await manager.writeWithConfirmedSubmit(session.id, text, {
      confirmationWindowMs: 15000, maxAttempts: 1,
      // Exact receipt only: no Enter recovery may rescue the first submission here.
      isAccepted: async () => Boolean(await findPromptInTranscript('codex', cwd, null, text, since, { codexHome })),
    }).catch(cause => { error = cause; });
    return { error, submitted: primary.length > before, enters: writes.filter(data => data === '\r').length,
      badge: [...output.matchAll(/\[Pasted Content (\d+) chars\]/g)].at(-1)?.[1] ?? null, length: Array.from(text).length,
      flushBeforeEnter: writes[writes.indexOf('\r') - 1] === '\x05' };
  }

  try {
    const control = await deliverStarved(1, false);
    // Without the flushing key, Codex reads Enter inside the burst and keeps it as a newline.
    expect(control.submitted).toBe(false);
    expect(control.error).toBeTruthy();
    expect(control.badge).toBe(String(control.length + 1));
    manager!.killAll(); for (const resume of resumes) resume();

    const fixed = await deliverStarved(2, true);
    expect(fixed.error).toBeNull();
    expect(fixed.submitted).toBe(true);
    expect(fixed.enters).toBe(1);
    expect(fixed.flushBeforeEnter).toBe(true);
    console.info(JSON.stringify({ platform: process.platform, control: { ...control, error: String(control.error).slice(0, 80) }, fixed }));
  } finally {
    for (const resume of resumes) resume();
    manager?.killAll(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 }).catch(() => {});
  }
}, 150000);
