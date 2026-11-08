import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

test('recovers a newly created Canvas terminal after input finds its PTY missing', async ({ page, request }) => {
  test.skip(process.platform === 'win32', 'Browser app lifecycle fixture uses the Unix test runtime. Native ConPTY has its real Codex fixture.');
  test.setTimeout(45000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-missing-session-'));
  const script = join(root, 'shell.mjs');
  await writeFile(script, `process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('READY:'+process.pid+'\\r\\n');let draft='';process.stdin.on('data',data=>{for(const char of data.toString()){if(char==='\\r'){process.stdout.write('ACCEPTED:'+draft+'\\r\\n');draft='';}else if(char.charCodeAt(0)>=32)draft+=char;}});`);
  const readyHeaders = new Map<string, string>();
  page.on('websocket', connection => connection.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string') return;
    const frame = JSON.parse(payload);
    const text = frame.type === 'output' ? frame.data : frame.scrollback;
    const id = frame.sessionId ?? frame.session?.id;
    const header = typeof text === 'string' ? /READY:\d+/.exec(text)?.[0] : undefined;
    if (id && header) readyHeaders.set(id, header);
  }));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Missing PTY recovery', workingDir: root, codeIntelligenceMode: 'manual' } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const node = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Recover fresh terminal', x: 80, y: 80, width: 700, height: 420, payload: { command: process.execPath, args: [script] } } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const terminal = page.locator('.canvas-terminal');
    await expect(terminal.locator('.xterm-rows')).toContainText('READY');
    const currentId = async () => (await (await request.get(`${base}/nodes`)).json()).data.find((item: any) => item.id === node.id)?.payload.sessionId;
    await expect.poll(currentId).toBeTruthy();
    const oldId = await currentId();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture kill timed out')), 5000);
      socket.on('message', raw => { const frame = JSON.parse(raw.toString()); if (frame.type === 'killed' && frame.sessionId === oldId) { clearTimeout(timeout); resolve(); } });
      socket.send(JSON.stringify({ type: 'kill', sessionId: oldId }));
    });
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Control+c');
    // A cleared payload id and the dead terminal's last READY are not the
    // replacement. Wait for the exact new PTY and its own parsed header.
    await expect.poll(async () => {
      const id = await currentId();
      return Boolean(id && id !== oldId && readyHeaders.has(id));
    }).toBe(true);
    const replacementId = await currentId();
    await expect(terminal.locator('.xterm-rows')).toContainText(readyHeaders.get(replacementId)!);
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('replacement-works'); await page.keyboard.press('Enter');
    await expect(terminal.locator('.xterm-rows')).toContainText('ACCEPTED:replacement-works');
    await expect(terminal).not.toContainText('PTY não encontrada');
  } finally {
    await page.goto('about:blank'); socket.close(); await request.delete(base); await rm(root, { recursive: true, force: true });
  }
});
