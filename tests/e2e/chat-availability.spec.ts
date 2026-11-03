import { expect, test, type APIRequestContext } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setup(request: APIRequestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-chat-availability-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Chat availability', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const node = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Available Leader', payload: { provider: 'codex', maestro: true } } })).json()).data;
  const { token } = JSON.parse(await readFile(join(dir, '.orkestrai', 'workspace.json'), 'utf8'));
  const post = async (message: string) => {
    const response = await request.post('/api/agent-room/bridge/channel', { data: { token, from: 'Available Leader', message, channel: 'owner' } });
    expect(response.ok(), `Agent post returned ${response.status()}`).toBe(true);
  };
  return { dir, base, url: `/chat?workspace=${workspace.id}&channel=${encodeURIComponent(`dm:${node.id}`)}`, post };
}

test('opens agents and messages without waiting for Canvas preparation or optional metadata', async ({ page, request }) => {
  const fixture = await setup(request);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let canvasRequests = 0;
  try {
    await fixture.post('The conversation can open independently.');
    for (const path of ['nodes', 'routines', 'channel-bindings']) {
      await page.route(`**${fixture.base}/${path}`, async route => {
        if (path === 'nodes') canvasRequests++;
        await blocked;
        await route.fulfill({ json: { data: [] } }).catch(() => undefined);
      });
    }
    await page.goto(fixture.url);
    await expect(page.getByTestId('chat-timeline')).toContainText('The conversation can open independently.');
    await expect(page.getByRole('navigation', { name: 'Canais e mensagens diretas' })).toContainText('Available Leader');
    expect(canvasRequests).toBe(0);
  } finally {
    release(); await page.goto('about:blank'); await request.delete(fixture.base); await rm(fixture.dir, { recursive: true, force: true });
  }
});

test('recovers stored replies and reconnects a silent chat socket while the status feed stays healthy', async ({ page, request }) => {
  test.setTimeout(60_000);
  const fixture = await setup(request);
  let chatConnections = 0;
  let blackhole = false;
  await page.clock.install();
  await page.routeWebSocket('**/ws/agent-room/pty', socket => {
    const server = socket.connectToServer();
    let isChat = false, ordinal = 0;
    socket.onMessage(raw => {
      try {
        const frame = JSON.parse(String(raw));
        if (frame.type === 'subscribe' && frame.events?.includes('channelMessage')) { isChat = true; ordinal = ++chatConnections; }
      } catch { /* Other frames are forwarded unchanged. */ }
      server.send(raw);
    });
    server.onMessage(raw => { if (!(blackhole && isChat && ordinal === 1)) socket.send(raw); });
  });
  try {
    await fixture.post('Initial visible answer.');
    await page.goto(fixture.url);
    await expect(page.getByTestId('chat-timeline')).toContainText('Initial visible answer.');
    await expect.poll(() => chatConnections).toBe(1);
    blackhole = true;
    await fixture.post('A stored reply must not disappear with its notification.');
    await expect(page.getByTestId('chat-timeline')).not.toContainText('A stored reply must not disappear with its notification.');
    await page.clock.runFor(45_000);
    await expect.poll(() => chatConnections).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('chat-timeline')).toContainText('A stored reply must not disappear with its notification.');
  } finally { await page.goto('about:blank'); await request.delete(fixture.base); await rm(fixture.dir, { recursive: true, force: true }); }
});
