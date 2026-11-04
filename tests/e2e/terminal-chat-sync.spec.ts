import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// A stand-in for an agent CLI: it reads a line from its terminal, works for a
// few seconds and answers, recording both in a Claude-style transcript.
const FAKE_AGENT = `
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
const flag = args.findIndex((arg) => arg === '--session-id' || arg === '--resume');
const session = flag >= 0 ? args[flag + 1] : crypto.randomUUID();
const dir = join(homedir(), '.claude', 'projects', realpathSync(process.cwd()).replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(dir, { recursive: true });
const file = join(dir, session + '.jsonl');
const record = (event) => appendFileSync(file, JSON.stringify({ ...event, sessionId: session, cwd: process.cwd(), timestamp: new Date().toISOString() }) + '\\n');
process.stdout.write('? for shortcuts\\r\\n> ');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const prompt = line.trim();
  if (!prompt) return;
  record({ type: 'user', message: { role: 'user', content: prompt } });
  let ticks = 0;
  const timer = setInterval(() => {
    process.stdout.write('.');
    if (++ticks < 12) return;
    clearInterval(timer);
    const answer = 'Resposta do agente: ' + prompt;
    record({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: answer }], stop_reason: 'end_turn' } });
    process.stdout.write('\\r\\n' + answer + '\\r\\n> ');
  }, 300);
});
`;

test('Conversation receives public terminal progress live during a long owner turn without a bridge post', async ({ page, request }) => {
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-public-progress-'));
  const script = join(dir, 'fake-agent.mjs');
  const progress = 'Progresso público: validando o deploy sem parar o turno.';
  // Reproduce a busy agent receiving the owner's message through an inbox
  // tool result, exactly as a real CLI does in the reported long turn.
  await writeFile(script, FAKE_AGENT
    .replace("import readline from 'node:readline';", `import readline from 'node:readline';\nimport { run as runBridge } from ${JSON.stringify(pathToFileURL(resolve('packages/orkestrai-cli/src/cli.js')).href)};`)
    .replace('let ticks = 0;', 'let ticks = 0; let checking = false; let announced = false;')
    .replace('setInterval(() => {', 'setInterval(async () => {')
    .replace('if (++ticks < 12) return;', `
      if (!checking && !announced) {
        checking = true;
        try {
          let batch;
          await runBridge(['inbox', '--json'], { out: value => { batch = JSON.parse(value); }, err: () => {} });
          if (batch?.items?.some(item => item.kind === 'owner')) {
            announced = true;
            record({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(progress)} }], stop_reason: null } });
          }
        } finally { checking = false; }
      }
      if (++ticks < 100) return;
    `));
  const shims = resolve('test-runtime', 'bin');
  await mkdir(shims, { recursive: true });
  const fakeClaude = join(shims, 'claude');
  await writeFile(fakeClaude, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  await chmod(fakeClaude, 0o755);
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Public progress live', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const lead = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Public Lead',
      payload: { provider: 'claude', maestro: true }, x: 80, y: 80, width: 720, height: 420 } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}&node=${lead.id}`);
    const terminal = page.locator(`.svelte-flow__node[data-id="${lead.id}"]`);
    await expect(terminal.locator('.xterm-rows')).toContainText('? for shortcuts', { timeout: 20_000 });
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('Execute o deploy e continue trabalhando.');
    await page.keyboard.press('Enter');
    await page.goto(`/chat?workspace=${workspace.id}&channel=${encodeURIComponent(`dm:${lead.id}`)}`);
    await page.locator('#chat-composer-input').fill('Qual o andamento do deploy?');
    await page.locator('#chat-composer-input').press('Enter');
    const update = page.getByTestId('chat-message').filter({ hasText: progress });
    await expect(update).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('chat-message').filter({ hasText: 'Resposta do agente:' })).toHaveCount(0);
    await page.reload();
    await expect(update).toHaveCount(1);
    await expect(update).toBeVisible();
  } finally {
    await request.delete(base);
    await rm(fakeClaude, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
});

test('a line typed in an agent terminal on the Canvas shows in Chat with the answer, and the agent shows as working', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-terminal-sync-'));
  const script = join(dir, 'fake-agent.mjs');
  await writeFile(script, FAKE_AGENT);
  // The e2e server puts its shim folder first on every terminal's PATH: this
  // `claude` answers like the CLI without an account or the network.
  const shims = resolve('test-runtime', 'bin');
  await mkdir(shims, { recursive: true });
  const fakeClaude = join(shims, 'claude');
  await writeFile(fakeClaude, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  await chmod(fakeClaude, 0o755);
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E terminal sync ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const lead = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Lead', x: 80, y: 80, width: 720, height: 420,
      payload: { provider: 'claude', maestro: true },
    } })).json()).data;

    await page.goto(`/canvas?workspace=${workspace.id}&node=${lead.id}`);
    const node = page.locator(`.svelte-flow__node[data-id="${lead.id}"]`);
    await expect(node.locator('.xterm-rows')).toContainText('? for shortcuts', { timeout: 20_000 });

    // Typed straight into the terminal, as the owner does.
    await node.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('Por que os dois agentes estao bloqueados?');
    await page.keyboard.press('Enter');

    // While the agent works, every view reports it working.
    await expect.poll(async () => {
      const agents = (await (await request.get(`${base}/control-center`)).json()).data.agents as Array<{ nodeId: string; state: string }>;
      return agents.find((agent) => agent.nodeId === lead.id)?.state;
    }, { timeout: 4_000 }).toBe('working');
    await expect(node.locator('.xterm-rows')).toContainText('Resposta do agente: Por que os dois agentes estao bloqueados?', { timeout: 15_000 });

    // The conversation records both lines (the answer once the transcript closes the turn).
    await expect.poll(async () => {
      const stored = (await (await request.get(`${base}/channels/${encodeURIComponent(`dm:${lead.id}`)}/messages`)).json()).data as Array<{ authorKind: string; body: string }>;
      return stored.map((message) => `${message.authorKind}: ${message.body}`).sort();
    }, { timeout: 20_000 }).toEqual([
      'agent: Resposta do agente: Por que os dois agentes estao bloqueados?',
      'owner: Por que os dois agentes estao bloqueados?',
    ]);

    // Chat shows the same conversation: the question and the answer.
    await page.goto(`/chat?workspace=${workspace.id}`);
    await page.getByRole('button', { name: /Lead/ }).first().click();
    const messages = page.getByTestId('chat-message');
    await expect(messages.filter({ hasText: 'Por que os dois agentes estao bloqueados?' }).first()).toBeVisible({ timeout: 20_000 });
    await expect(messages.filter({ hasText: 'Resposta do agente: Por que os dois agentes estao bloqueados?' })).toBeVisible({ timeout: 20_000 });

    // Focus shows the same conversation beside the agent.
    await page.goto(`/terminal?workspace=${workspace.id}&node=${lead.id}`);
    const panel = page.getByTestId('focus-agent-inspector').getByTestId('agent-chat-face');
    await expect(panel).toContainText('Por que os dois agentes estao bloqueados?', { timeout: 20_000 });
    await expect(panel).toContainText('Resposta do agente: Por que os dois agentes estao bloqueados?');
  } finally {
    await request.delete(base);
    await rm(fakeClaude, { force: true });
  }
});

test('Chat already open shows a terminal exchange live, without reloading', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-terminal-live-'));
  const script = join(dir, 'fake-agent.mjs');
  await writeFile(script, FAKE_AGENT);
  const shims = resolve('test-runtime', 'bin');
  await mkdir(shims, { recursive: true });
  const fakeClaude = join(shims, 'claude');
  await writeFile(fakeClaude, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  await chmod(fakeClaude, 0o755);
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E terminal live ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const context = await browser.newContext({ storageState: 'tests/e2e/storage-state.json', viewport: { width: 1440, height: 900 } });
  try {
    const lead = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Lead', x: 80, y: 80, width: 720, height: 420, payload: { provider: 'claude', maestro: true },
    } })).json()).data;
    const chat = await context.newPage();
    const canvas = await context.newPage();

    await canvas.goto(`/canvas?workspace=${workspace.id}&node=${lead.id}`);
    const node = canvas.locator(`.svelte-flow__node[data-id="${lead.id}"]`);
    await expect(node.locator('.xterm-rows')).toContainText('? for shortcuts', { timeout: 20_000 });

    await chat.goto(`/chat?workspace=${workspace.id}`);
    await chat.getByRole('button', { name: /Lead/ }).first().click();

    await node.locator('.xterm-helper-textarea').focus();
    await canvas.keyboard.type('Qual o estado do teste de carga?');
    await canvas.keyboard.press('Enter');

    const messages = chat.getByTestId('chat-message');
    await expect(messages.filter({ hasText: 'Qual o estado do teste de carga?' }).first()).toBeVisible({ timeout: 10_000 });
    await expect(messages.filter({ hasText: 'Resposta do agente: Qual o estado do teste de carga?' })).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
    await request.delete(base);
    await rm(fakeClaude, { force: true });
  }
});
