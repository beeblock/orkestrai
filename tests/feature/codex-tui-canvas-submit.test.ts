import { codexAdapter } from '$lib/modules/agent-room/application/adapters/CodexAdapter.ts';
import { expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node-pty';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';
import { build as bundle } from 'esbuild';
import { chromium, type Browser, type Page } from '@playwright/test';
import { PtySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';
import { findPromptInTranscript, latestTurnBoundary } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.ts';

const enabled = process.env.ORKESTRAI_REAL_CODEX_TEST === '1';
const duration = Math.max(0, Number(process.env.ORKESTRAI_CODEX_SOAK_SECONDS ?? 0)) * 1000;

const views = process.env.ORKESTRAI_REAL_CODEX_BROWSER_TEST === '1' ? ['browser'] : ['canvas', 'conversation'];
it.skipIf(!enabled).each(views)('submits through the real Codex TUI with the %s view open', async view => {
  const viewDuration = process.env.ORKESTRAI_CODEX_SOAK_SCENARIO === 'canvas' && view !== 'canvas' ? 0 : duration;
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-codex-tui-'));
  const home = join(root, 'home'), cwd = join(root, 'project'), codexHome = join(home, '.codex');
  await mkdir(codexHome, { recursive: true }); await mkdir(cwd);
  let requests = 0, primaryRequests = 0, dropEnter = false, dropped = 0, output = '';
  let duringPaste: (() => void) | null = null;
  let plannedDrops = 0, resizes = 0, replays = 0;
  const ownerDraft = 'Human input kept separate from the automatic message';
  let ownerReceipts = 0, mixedInput = false;
  let browser: Browser | undefined, page: Page | undefined;
  let browserScript = '', browserReports = 0, browserKeys = 0, browserCursorReports = 0, browserMouseReports = 0;
  let liveSessionId: string | null = null;
  const viewerTimers: Array<ReturnType<typeof setTimeout>> = [];
  const ownedChildren: Array<{ pid: number; exited: boolean }> = [];
  const server = createServer(async (request, response) => {
    if (request.url === '/terminal') { response.writeHead(200, { 'content-type': 'text/html' }).end('<div id="first"></div><div id="second"></div><script src="/terminal.js"></script>'); return; }
    if (request.url === '/terminal.js') { response.writeHead(200, { 'content-type': 'application/javascript' }).end(browserScript); return; }
    if (request.url !== '/v1/responses' || request.method !== 'POST') { response.writeHead(404).end(); return; }
    let raw = ''; for await (const chunk of request) { raw += chunk; if (raw.length > 4 * 1024 * 1024) { response.writeHead(413).end(); return; } }
    const body = JSON.parse(raw); requests++;
    const last = body.input?.at(-1);
    const lastText = (last?.content ?? []).map((item: any) => item.text ?? '').join('');
    if (lastText.startsWith('Fixture delivery ')) primaryRequests++;
    if (lastText.startsWith('Fixture delivery ') && lastText.includes(ownerDraft)) mixedInput = true;
    console.info('Local Responses fixture', { request: requests, model: body.model, inputCount: body.input?.length,
      lastText: lastText.slice(0, 75) });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const offered = (body.tools ?? []).map((tool: any) => tool.name ?? tool.function?.name);
    const toolName = offered.includes('exec_command') ? 'exec_command' : 'shell_command';
    const runTool = lastText.startsWith('Fixture delivery ');
    const command = process.platform === 'win32' ? 'Write-Output "TOOL_PHASE_DONE"' : 'printf TOOL_PHASE_DONE';
    const item: any = runTool ? { id: `fc_${requests}`, type: 'function_call', call_id: `call_${requests}`, name: toolName,
      arguments: JSON.stringify(toolName === 'exec_command' ? { cmd: command } : { command }) } : { id: `msg_${requests}`, type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Local fixture OK' }] };
    for (const event of [{ type: 'response.created', response: { id: `resp_${requests}` } },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: `resp_${requests}`, status: 'completed', output: [item], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } } }]) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const sockets = new WebSocketServer({ server, path: '/terminal-input' });
  sockets.on('connection', socket => socket.on('message', raw => {
    const input = JSON.parse(raw.toString());
    if (!liveSessionId) return;
    if (input.source === 'terminal') browserReports++; else if (input.source === 'keyboard') browserKeys++;
    if (/^\x1b\[\d+;\d+R$/.test(input.data)) browserCursorReports++;
    if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(input.data)) browserMouseReports++;
    manager.writeHumanInput(liveSessionId, String(input.data), { source: input.source });
  }));
  if (view === 'browser') {
    const bundled = await bundle({ stdin: { contents: `
      import { Terminal } from '@xterm/xterm';
      import { bindTerminalInput, terminalInputFrame } from './src/lib/components/agent-room/terminal-input-buffer.ts';
      window.viewers=[];
      for(const id of ['first','second']) {
        const terminal=new Terminal({cols:40,rows:12,allowProposedApi:true});
        terminal.open(document.getElementById(id));
        const socket=new WebSocket('ws://'+location.host+'/terminal-input');
        bindTerminalInput(terminal,(data,source)=>{ if(socket.readyState===1) socket.send(JSON.stringify(terminalInputFrame('fixture',{data,imagePaste:false,source}))); });
        socket.onmessage=event=>terminal.write(JSON.parse(event.data).data);
        window.viewers.push({terminal,socket});
      }
    `, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife' });
    browserScript = bundled.outputFiles[0].text;
    browser = await chromium.launch({ headless: true }); page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/terminal`);
    await page.waitForFunction(() => (window as any).viewers?.every((viewer: any) => viewer.socket.readyState === 1));
  }
  const { Terminal } = await import('@xterm/headless');
  const terminal = new Terminal({ cols: 40, rows: 12, allowProposedApi: true, scrollback: 0 });
  const protocol: string[] = [];
  terminal.onData((data: string) => {
    protocol.push(Buffer.from(data).toString('hex'));
    if (liveSessionId) manager.writeHumanInput(liveSessionId, data, { source: 'terminal' });
  });
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
      // Conversation has no mounted xterm and sends no terminal-query replies.
      if (view === 'canvas') terminal.write(chunk);
      if (view === 'browser') for (const socket of sockets.clients) socket.send(JSON.stringify({ data: chunk }));
    });
    const write = child.write.bind(child);
    child.write = text => {
      if (dropEnter && text === '\r') { dropEnter = false; dropped++; }
      else write(text);
      if (duringPaste && text.includes('\x1b[200~')) {
        const change = duringPaste; duringPaste = null;
        viewerTimers.push(setTimeout(change, 100));
      }
    };
    return child;
  }) as never, () => {});
  try {
    const args = [...codexAdapter.interactiveCommand!({ model: 'gpt-6.1-sol' }).args,
      '-c', 'model_provider="fixture"', '-c', 'model_providers.fixture.name="Local fixture"',
      '-c', `model_providers.fixture.base_url="http://127.0.0.1:${port}/v1"`,
      '-c', 'model_providers.fixture.wire_api="responses"', '-c', 'model_providers.fixture.requires_openai_auth=false',
      '-c', 'model_providers.fixture.supports_websockets=false', '-c', 'check_for_update_on_startup=false',
      '-c', `projects.${JSON.stringify(cwd)}.trust_level="trusted"`];
    const session = manager.create({ command: process.env.ORKESTRAI_TEST_CODEX_BINARY ?? 'codex', args, cwd, provider: 'codex', cols: 40, rows: 12,
      env: { CODEX_HOME: codexHome, HOME: home, USERPROFILE: home } });
    liveSessionId = session.id;
    await expect.poll(() => output.includes('›'), { timeout: 30000, message: 'Codex did not reach its composer' }).toBe(true)
      .catch(error => { throw new Error(`${error.message}\n${output.slice(-8000)}`); });
    await new Promise(resolve => setTimeout(resolve, 3000));
    let exactId: string | null = null, serial = 0;
    async function deliver(missEnter = false, viewerChange?: 'resize' | 'resize-burst' | 'replay' | 'terminal-reports', typeWhileSending = false) {
      const message = `Fixture delivery ${++serial}\n` + 'A bounded local-only paste, no tools or external inference. '.repeat(150);
      const since = Date.now(); let submittedAt: number | null = null;
      dropEnter = missEnter;
      if (missEnter) plannedDrops++;
      duringPaste = typeWhileSending ? () => {
        manager.writeHumanInput(session.id, `${ownerDraft}\r`);
        // The pending-input status also reduces the mounted terminal height.
        viewerTimers.push(setTimeout(() => {
          resizes++; terminal.resize(40, 10); manager.resize(session.id, 40, 10);
        }, 16));
      } : viewerChange ? () => {
        if (viewerChange === 'terminal-reports') {
          // xterm onData also carries automatic reports, including duplicate
          // replies from multiple viewers and a delayed snapshot parse. None
          // may create a draft or disable recovery of the deliberately lost Enter.
          if (page) {
            void page.evaluate(() => { for (const {terminal} of (window as any).viewers) terminal.write('\x1b[6n\x1b[?1000h\x1b[?1006h'); })
              .then(() => page!.locator('#first .xterm-screen').click({position:{x:20,y:20}}));
          } else for (const data of ['\x1b[2;3R', '\x1b[2;3R', '\x1b[<0;12;5M', '\x1b[<0;12;5m']) {
              manager.writeHumanInput(session.id, data, { source: 'terminal' });
            }
          expect(manager.get(session.id)?.inputDeferred).toBe(false);
        } else if (viewerChange === 'resize' || viewerChange === 'resize-burst') {
          const resize = () => {
            const [cols, rows] = resizes++ % 2 ? [40, 12] : [72, 20];
            terminal.resize(cols, rows);
            manager.resize(session.id, cols, rows);
          };
          if (viewerChange === 'resize-burst') for (let tick = 0; tick < 12; tick++) viewerTimers.push(setTimeout(resize, tick * 180));
          else resize();
        } else if (view === 'canvas') { replays++; terminal.write(`\x1bc${manager.replay(session.id)}`); }
      } : null;
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
      }).catch(error => {
        const state = (manager as any).sessions.get(session.id);
        const pending = state?.lastSubmittedDelivery;
        console.info('Pending submit guards', { view, viewerChange, serial, nativeComposerState: state?.nativeComposerState,
          waiting: state?.waiting, humanComposerLength: state?.humanComposerLength,
          humanInputRevision: state?.humanInputRevision, pasteHumanRevision: pending?.humanInputRevision,
          retries: pending?.pasteRetryCount, awaitingDeliveryIdle: state?.awaitingDeliveryIdle });
        throw new Error(`${error.message}\n${output.slice(-12000)}`);
      });
      if (typeWhileSending) {
        await expect.poll(async () => {
          const match = await findPromptInTranscript('codex', cwd, exactId, ownerDraft, since, { codexHome });
          return Boolean(match);
        }, { timeout: 20000, message: 'Held owner input never reached its own turn' }).toBe(true);
        ownerReceipts++;
      }
      if (viewerChange === 'resize-burst') await new Promise(resolve => setTimeout(resolve, 2500));
      await expect.poll(async () => exactId && (await latestTurnBoundary('codex', cwd, exactId, { codexHome })).ready,
        { timeout: 15000 }).toBe(true);
    }
    await deliver(true, undefined, true);
    await deliver(true, 'terminal-reports');
    if (page) {
      expect(browserReports).toBeGreaterThanOrEqual(4);
      expect(browserCursorReports).toBeGreaterThanOrEqual(2);
      expect(browserMouseReports).toBeGreaterThanOrEqual(2);
      expect(manager.get(session.id)?.inputDeferred).toBe(false);
      // A real Enter from the browser must remain usable and retain the
      // automatic receipt identity, rather than become a held owner prompt.
      await page.locator('#first .xterm-helper-textarea').focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => browserKeys).toBeGreaterThan(0);
    }
    await deliver(false, 'resize-burst');
    const started = Date.now();
    while (Date.now() - started < viewDuration) {
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, viewDuration - (Date.now() - started))));
      const next = serial + 1;
      await deliver(next % 10 === 0, next % 3 === 0 ? 'resize' : view === 'canvas' && next % 5 === 0 ? 'replay' : undefined);
      if (serial % 10 === 0) console.info(`Codex TUI soak: ${serial} exact receipts, ${Math.floor((Date.now() - started) / 1000)}s`);
    }
    await deliver();
    await deliver(true, 'resize');
    if (view === 'canvas') await deliver(true, 'replay');
    await deliver();
    expect(dropped).toBe(plannedDrops); expect(primaryRequests).toBe(serial);
    expect(ownerReceipts).toBe(1); expect(mixedInput).toBe(false);
    console.info(JSON.stringify({ platform: process.platform, view, elapsedSeconds: Math.round((Date.now() - started) / 1000), exactReceipts: serial, requests, primaryRequests, recoveredEnter: dropped, resizes, replays, browserReports, browserKeys, browserCursorReports, browserMouseReports, ownerReceipts, mixedInput }));
  } catch (error) {
    // Cleanup failures must not hide the actual TUI/receipt failure.
    process.stderr.write(`Codex fixture failed: ${String(error)}\n${output.slice(-8000)}\n`);
    throw error;
  } finally {
    for (const timer of viewerTimers) clearTimeout(timer);
    if (process.platform === 'win32') for (const child of ownedChildren) if (!child.exited && child.pid > 1) {
      await promisify(execFile)('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true }).catch(() => {});
    }
    console.info('Terminal protocol replies:', protocol); terminal.dispose();
    manager.killAll(); await browser?.close();
    for (const socket of sockets.clients) socket.terminate();
    sockets.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    // Allow Windows process handles to close before deleting private transcripts.
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
      .catch(error => process.stderr.write(`Private fixture cleanup deferred to runner: ${error.code}\n`));
  }
}, duration + 240000);
