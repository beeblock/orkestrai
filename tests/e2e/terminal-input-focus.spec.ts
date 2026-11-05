import { test, expect, type WebSocketRoute } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const echoTerminal = {
  command: process.execPath,
  args: ['-e', 'if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on("data",chunk=>process.stdout.write(chunk));console.log("INPUT_READY");'],
};

test('a terminal finishing startup does not steal the cursor from another selected terminal', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-startup-focus-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: 'Late terminal startup', workingDir: root, codeIntelligenceMode: 'disabled' },
  })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const create = async (title: string, x: number) => (await (await request.post(`${base}/nodes`, { data: {
    type: 'terminal', title, x, y: 80, width: 560, height: 380, payload: echoTerminal,
  } })).json()).data;
  const fast = await create('Typing here', 40);
  const slow = await create('Background startup', 660);
  let release: (() => void) | undefined;
  await page.routeWebSocket('**/ws/agent-room/pty', socket => {
    const server = socket.connectToServer();
    socket.onMessage(message => server.send(message));
    server.onMessage(message => {
      const frame = JSON.parse(String(message));
      if (frame.type === 'created' && frame.session.nodeId === slow.id) release = () => socket.send(message);
      else socket.send(message);
    });
  });
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const fastCard = page.locator(`[data-id="${fast.id}"]`);
    const slowCard = page.locator(`[data-id="${slow.id}"]`);
    await expect.poll(() => Boolean(release)).toBe(true);
    await slowCard.locator('.node-icon').click();
    await fastCard.locator('.node-icon').click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
    await expect(slowCard).toHaveClass(/selected/);
    await expect(fastCard).toHaveClass(/selected/);
    const input = fastCard.locator('.xterm-helper-textarea');
    await input.focus();
    await page.keyboard.type('KEEP_MY_CURSOR');
    release!();
    await expect(slowCard.locator('.terminal-status')).toHaveCount(0);
    await page.evaluate(async () => {
      // Observe the async session persistence followed by its queued focus frames.
      for (let frame = 0; frame < 20; frame++) await new Promise(requestAnimationFrame);
    });
    await expect(input).toBeFocused();
    await page.keyboard.type('_STILL_TYPING');
    await page.keyboard.press('Enter');
    await expect(fastCard.locator('.xterm-rows')).toContainText('KEEP_MY_CURSOR_STILL_TYPING');
    await expect(slowCard.locator('.xterm-rows')).not.toContainText('STILL_TYPING');
  } finally {
    await page.goto('about:blank');
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps terminal input focused through live Canvas updates and a transport reconnect', async ({ page, request }) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-input-focus-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: 'Continuous terminal input', workingDir: root, codeIntelligenceMode: 'disabled' },
  })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  let terminalSocket: WebSocketRoute | undefined;
  let canvasSocket: WebSocketRoute | undefined;
  let connections = 0;
  await page.routeWebSocket('**/ws/agent-room/pty', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const frame = JSON.parse(String(message));
      if (frame.type === 'create' || frame.type === 'attach') { terminalSocket = socket; connections++; }
      if (frame.type === 'subscribe' && frame.events?.includes('workspaceChanged') && frame.events?.includes('talking')) canvasSocket = socket;
      server.send(message);
    });
  });
  try {
    const terminal = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Continuous input', x: 80, y: 100, width: 660, height: 380,
      payload: echoTerminal,
    } })).json()).data;
    const note = (await (await request.post(`${base}/nodes`, { data: {
      type: 'note', title: 'Live peer', x: 850, y: 100, payload: { content: 'Peer updates' },
    } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const input = page.locator(`[data-id="${terminal.id}"] .xterm-helper-textarea`);
    await expect(input).toBeAttached();
    await expect.poll(() => Boolean(terminalSocket)).toBe(true);
    await expect.poll(() => Boolean(canvasSocket)).toBe(true);
    await input.focus();
    await page.evaluate(() => { (window as any).__focusInput = document.activeElement; });
    for (const character of 'CONTINUOUS') {
      const peer = await request.patch(`${base}/nodes/${note.id}`, { data: { title: `Peer ${character}`, payload: { content: character } } });
      expect(peer.ok()).toBe(true);
      canvasSocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
      await expect(page.locator(`[data-id="${note.id}"] .node-title`)).toHaveText(`Peer ${character}`);
      await expect(input).toBeFocused();
      await page.keyboard.type(character);
      const current = (await (await request.get(`${base}/nodes/${terminal.id}`)).json()).data;
      expect((await request.patch(`${base}/nodes/${terminal.id}`, { data: { payload: { ...current.payload, role: `role-${character}` } } })).ok()).toBe(true);
      canvasSocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
      await expect(input).toBeFocused();
    }
    const beforeReconnect = connections;
    terminalSocket!.close({ code: 1001, reason: 'Isolated transport recovery probe' });
    await expect.poll(() => connections).toBeGreaterThan(beforeReconnect);
    await expect(input).toBeFocused();
    expect(await input.evaluate(element => element === (window as any).__focusInput)).toBe(true);
    await page.keyboard.type('_AFTER_RECONNECT');
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-id="${terminal.id}"] .xterm-rows`)).toContainText('CONTINUOUS_AFTER_RECONNECT');

    // Retaining terminal input must never steal a deliberate focus change.
    const composer = page.locator('.composer textarea');
    await composer.focus();
    await request.patch(`${base}/nodes/${note.id}`, { data: { title: 'Owner chose another field' } });
    canvasSocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
    await expect(page.locator(`[data-id="${note.id}"] .node-title`)).toHaveText('Owner chose another field');
    await expect(composer).toBeFocused();
  } finally {
    await page.goto('about:blank');
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});
