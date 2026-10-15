import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('two Kanbans share small summaries and receive external changes immediately', async ({ page, request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-board-feed-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Board feed fixture', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Large note', x: 1500, y: 0, payload: { content: 'Do not download this in a board picker. '.repeat(10_000) } } });
    for (let index = 0; index < 2; index++) await request.post(`${base}/nodes`, { data: { type: 'tasks', title: `Board ${index}`, x: index * 850, y: 0, width: 800, height: 500 } });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let taskRequests = 0;
    page.on('request', req => { if (req.method() === 'GET' && req.url().endsWith(`${base}/tasks`)) taskRequests++; });
    const summaryResponse = page.waitForResponse(response => response.url().endsWith(`${base}/nodes?view=board`));
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.canvas-tasks')).toHaveCount(2);
    const summary = await (await summaryResponse).text();
    expect(summary.length).toBeLessThan(500); expect(summary).not.toContain('Do not download');
    await page.waitForTimeout(500);
    const before = taskRequests;
    await page.waitForTimeout(5500);
    const idleTaskRequests = taskRequests - before;
    expect(idleTaskRequests).toBe(0);
    const started = Date.now();
    await request.post(`${base}/tasks`, { data: { title: 'External agent delivery' } });
    await expect(page.locator('.canvas-tasks .tb-title', { hasText: 'External agent delivery' })).toHaveCount(2, { timeout: 2500 });
    const latencyMs = Date.now() - started;
    console.info('Board reconciliation', { summaryBytes: Buffer.byteLength(summary), idleTaskRequests, latencyMs });
    expect(latencyMs).toBeLessThan(2500);
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank'); await request.delete(base);
    await rm(dir, { recursive: true, force: true });
  }
});
