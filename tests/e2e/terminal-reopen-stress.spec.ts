import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';

async function stopFixtureSession(sessionId: string) {
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
    const timeout = setTimeout(() => finish(new Error('Fixture PTY shutdown timed out')), 5_000);
    const finish = (error?: Error) => { clearTimeout(timeout); socket.close(); error ? reject(error) : resolve(); };
    socket.on('error', finish);
    socket.on('open', () => socket.send(JSON.stringify({ type: 'kill', sessionId })));
    socket.on('message', raw => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === 'killed' && frame.sessionId === sessionId) finish();
    });
  });
}

test('preserves Canvas state and functional input across 50 reopens including stale PTY ids', async ({ page, request }) => {
  test.setTimeout(240_000);
  const root = await mkdtemp(join(tmpdir(), 'ork-reopen-stress-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: 'E2E reopen stress', workingDir: root, codeIntelligenceMode: 'manual' },
  })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const terminal = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Persistent shell', x: 100, y: 120, width: 640, height: 380,
      payload: { command: '/bin/cat', role: 'qa' },
    } })).json()).data;
    const note = (await (await request.post(`${base}/nodes`, { data: {
      type: 'note', title: 'Persistent briefing', x: 800, y: 120, payload: { content: 'Keep this exact briefing.' },
    } })).json()).data;
    await request.post(`${base}/edges`, { data: { sourceNodeId: note.id, targetNodeId: terminal.id } });
    let previousSession: string | null = null;
    for (let round = 0; round < 50; round++) {
      await page.goto('about:blank');
      const stale = round > 0 && round % 10 === 0;
      const stopped = stale && round % 20 === 0;
      if (stopped && previousSession) await stopFixtureSession(previousSession);
      if (stale) {
        const current = (await (await request.get(`${base}/nodes/${terminal.id}`)).json()).data;
        await request.patch(`${base}/nodes/${terminal.id}`, {
          data: { payload: { ...current.payload, sessionId: `expired-session-${round}` } },
        });
      }
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const node = page.locator(`.svelte-flow__node[data-id="${terminal.id}"]`);
      await expect(node.locator('.xterm-helper-textarea')).toBeAttached();
      let session: string | null = null;
      await expect.poll(async () => {
        const current = (await (await request.get(`${base}/nodes/${terminal.id}`)).json()).data;
        session = current.payload.sessionId;
        return Boolean(session && !session.startsWith('expired-session'));
      }).toBe(true);
      // A stale saved id must reclaim the live node-owned PTY, not duplicate it.
      if (previousSession && !stopped) expect(session).toBe(previousSession);
      if (stopped) expect(session).not.toBe(previousSession);
      previousSession = session;
      const marker = `reopen-${round}-ok`;
      await node.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type(marker);
      await page.keyboard.press('Enter');
      await expect(node.locator('.xterm-rows')).toContainText(marker);
      const persisted = (await (await request.get(`${base}/nodes`)).json()).data;
      expect(persisted).toHaveLength(2);
      expect(persisted.find((item: any) => item.id === terminal.id)).toMatchObject({ title: 'Persistent shell', x: 100, y: 120 });
      expect(persisted.find((item: any) => item.id === note.id).payload.content).toBe('Keep this exact briefing.');
      expect((await (await request.get(`${base}/edges`)).json()).data).toHaveLength(1);
      if ((round + 1) % 10 === 0) console.log(`Canvas reopen/input/state: ${round + 1}/50`);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});
