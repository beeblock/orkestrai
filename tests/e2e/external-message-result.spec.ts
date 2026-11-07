import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

test('external ask has a durable scoped result instead of a nonexistent Canvas inbox', async ({ page, request }) => {
  test.setTimeout(60_000);
  const dir = await mkdtemp(join(tmpdir(), 'ork-external-e2e-'));
  const script = join(dir, 'local-agent.mjs');
  const shim = resolve('test-runtime/bin/claude');
  const countFile = join(dir, 'received.txt');
  await writeFile(script, `
import { appendFileSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('2.1.0 (Claude Code)'); process.exit(0); }
const flag = args.findIndex(arg => arg === '--session-id' || arg === '--resume');
const session = flag >= 0 ? args[flag + 1] : crypto.randomUUID();
const dir = join(homedir(), '.claude/projects', realpathSync(process.cwd()).replace(/[^a-zA-Z0-9]/g, '-'));
mkdirSync(dir, { recursive: true });
const record = event => appendFileSync(join(dir, session + '.jsonl'), JSON.stringify({ ...event, sessionId: session, cwd: process.cwd(), timestamp: new Date().toISOString() }) + '\\n');
process.stdout.write('? for shortcuts\\r\\n> ');
readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return;
  appendFileSync(${JSON.stringify(countFile)}, 'received\\n');
  record({ type: 'user', message: { role: 'user', content: line.trim() } });
  setTimeout(() => {
    record({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'EXTERNAL_REPLY_OK' }], stop_reason: 'end_turn' } });
    process.stdout.write('EXTERNAL_REPLY_OK\\r\\n> ');
  }, 3000);
});
`);
  await mkdir(resolve('test-runtime/bin'), { recursive: true });
  await writeFile(shim, `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`); await chmod(shim, 0o755);
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'External receipt test', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const node = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'External recipient',
      x: 80, y: 80, width: 720, height: 420, payload: { provider: 'claude', maestro: false } } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}`);
    await expect(page.locator(`.svelte-flow__node[data-id="${node.id}"] .xterm-rows`)).toContainText('? for shortcuts', { timeout: 20_000 });
    const { token } = (await (await request.get(`${base}/bridge-token`)).json()).data;
    const headers = { authorization: `Bearer ${token}` };
    const external = { clientId: randomBytes(16).toString('hex'), requestId: randomBytes(16).toString('hex'), receipt: randomBytes(32).toString('hex') };
    const data = { to: node.id, message: 'An external caller needs a saved reply', external, timeoutMs: 1000 };
    const sent = await request.post('/api/agent-room/bridge/ask', { headers, data });
    expect(sent.status(), await sent.text()).toBe(200);
    const result = (await sent.json()).data;
    expect(result.externalReply).toBe(true); expect(result.replyConfirmed).toBe(false);
    const retry = await request.post('/api/agent-room/bridge/ask', { headers, data });
    expect((await retry.json()).data.messageId).toBe(result.messageId);
    const reply = await request.post('/api/agent-room/bridge/messages/result', { headers, data: { external, waitMs: 25_000 } });
    expect(reply.status(), await reply.text()).toBe(200);
    expect((await reply.json()).data).toMatchObject({ replyConfirmed: true, reply: 'EXTERNAL_REPLY_OK', deliveryState: 'replied' });
    expect((await readFile(countFile, 'utf8')).trim().split('\n')).toHaveLength(1);
    const wrongReceipt = await request.post('/api/agent-room/bridge/messages/result', { headers, data: { external: { ...external, receipt: '0'.repeat(64) } } });
    expect(wrongReceipt.status()).toBeGreaterThanOrEqual(400);
    const noIdentity = await request.post('/api/agent-room/bridge/messages/result', { headers, data: { messageId: result.messageId } });
    expect(noIdentity.status()).toBeGreaterThanOrEqual(400);
    expect(await reply.text()).not.toContain(external.receipt);
  } catch (error) {
    console.error('External fixture terminal:', await page.locator('.xterm-rows').innerText().catch(() => 'unavailable'));
    console.error('External fixture receives:', await readFile(countFile, 'utf8').catch(() => 'none'));
    throw error;
  } finally {
    await request.delete(base); await rm(shim, { force: true }); await rm(dir, { recursive: true, force: true });
  }
});
