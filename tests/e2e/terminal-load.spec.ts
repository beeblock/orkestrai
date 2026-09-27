import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('keeps PTY input and quick prompts usable during dense Canvas refresh and reconnect', async ({ page, request }) => {
  test.setTimeout(120_000);
  const root = await mkdtemp(join(tmpdir(), 'ork-terminal-load-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: 'E2E terminal load', workingDir: root, codeIntelligenceMode: 'manual' },
  })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const terminals = [];
    for (let i = 0; i < 4; i++) {
      terminals.push((await (await request.post(`${base}/nodes`, { data: {
        type: 'terminal', title: `PTY probe ${i}`, x: 40 + i * 800, y: 40,
        width: 740, height: 480, payload: { command: '/bin/cat' },
      } })).json()).data);
    }
    const note = (await (await request.post(`${base}/nodes`, { data: {
      type: 'note', title: 'Live briefing', x: 3500, y: 40, payload: { content: 'Revision 0' },
    } })).json()).data;
    await request.post(`${base}/edges`, { data: { sourceNodeId: note.id, targetNodeId: terminals[0].id } });
    const extra = Array.from({ length: 200 }, (_, i) => ({
      id: randomUUID(), workspaceId: workspace.id, type: 'note', title: `Reference ${i}`,
      x: 40 + (i % 20) * 380, y: 600 + Math.floor(i / 20) * 300,
      width: 340, height: 260, zIndex: 0, floorId: null, payload: { content: `Brief ${i}` },
    }));
    const edges = Array.from({ length: 600 }, (_, i) => ({
      id: randomUUID(), workspaceId: workspace.id,
      sourceNodeId: extra[i % 200].id, targetNodeId: extra[(i + 1 + Math.floor(i / 200)) % 200].id,
    }));
    await page.route(`**${base}/nodes`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { data: [...body.data, ...extra] } });
    });
    await page.route(`**${base}/edges`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { data: [...body.data, ...edges] } });
    });
    await page.addInitScript(() => {
      const Original = window.WebSocket;
      (window as any).__ptySockets = [];
      window.WebSocket = class extends Original {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          (window as any).__ptySockets.push(this);
          this.addEventListener('message', event => {
            const frame = JSON.parse(String(event.data));
            if (frame.type === 'created') (this as any).__ptyId = frame.session.id;
            if (frame.type === 'attached') (this as any).__ptyId = frame.session.id;
          });
        }
      };
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(205);
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(601);
    const terminal = page.locator(`.svelte-flow__node[data-id="${terminals[0].id}"]`);
    await expect(terminal.locator('.xterm-helper-textarea')).toHaveCount(1);
    await expect.poll(async () => {
      const nodes = (await (await request.get(`${base}/nodes`)).json()).data;
      return nodes.find((node: any) => node.id === terminals[0].id).payload.sessionId;
    }).toBeTruthy();
    await page.locator('.svelte-flow__viewport').evaluate(element => {
      (element as HTMLElement).style.setProperty('transform', 'translate(15px, 60px) scale(1)', 'important');
    });
    const latencies: number[] = [];
    for (let i = 0; i < 5; i++) {
      await request.patch(`${base}/nodes/${note.id}`, { data: { title: `Live briefing ${i}`, payload: { content: `Revision ${i}` } } });
      await terminal.locator('.xterm-helper-textarea').focus();
      const start = performance.now();
      await page.keyboard.type(`input-${i}-okay`);
      await expect(terminal.locator('.xterm-rows')).toContainText(`input-${i}-okay`, { timeout: 2_000 });
      latencies.push(performance.now() - start);
      await page.keyboard.press('Enter');
    }
    const prompt = terminal.getByTestId('terminal-quick-prompt');
    const writePath = `**${base}/terminals/${terminals[0].id}/write`;
    await page.route(writePath, route => route.fulfill({ status: 503, json: { error: 'Synthetic delivery failure' } }));
    await prompt.fill('retained-quick-prompt');
    await prompt.press('Enter');
    await expect(terminal.getByRole('alert')).toBeVisible();
    await expect(prompt).toHaveValue('retained-quick-prompt');
    await page.unroute(writePath);
    await prompt.press('Enter');
    await expect(prompt).toHaveValue('');
    await expect(terminal.locator('.xterm-rows')).toContainText('retained-quick-prompt');
    const before = (await (await request.get(`${base}/nodes`)).json()).data.find((node: any) => node.id === terminals[0].id).payload.sessionId;
    const occurrencesBefore = ((await terminal.locator('.xterm-rows').innerText()).match(/input-0-okay/g) ?? []).length;
    await page.evaluate(id => {
      for (const socket of (window as any).__ptySockets) if (socket.__ptyId === id) socket.close();
    }, before);
    await terminal.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('buffered-after-reconnect');
    await expect(terminal.locator('.xterm-rows')).toContainText('buffered-after-reconnect');
    expect(((await terminal.locator('.xterm-rows').innerText()).match(/input-0-okay/g) ?? []).length).toBe(occurrencesBefore);
    const after = (await (await request.get(`${base}/nodes`)).json()).data.find((node: any) => node.id === terminals[0].id).payload.sessionId;
    expect(after).toBe(before);
    expect(Math.max(...latencies)).toBeLessThan(2_000);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/orkestrai-terminal-load.png' });
    console.log(JSON.stringify({ nodes: 205, edges: 601, typingLatencyMs: latencies.map(Math.round) }));
  } finally {
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});
