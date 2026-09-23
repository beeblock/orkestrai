import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

test('elastic edges settle without restarting from their own render updates', async ({ page, request }) => {
  test.setTimeout(60000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-edge-idle-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E idle canvas', workingDir: dir } })).json()).data;
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, canvasEdgeRendering: 'elastic' } });
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      nodes.push((await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: {
        type: 'note', title: `Idle note ${i}`, x: (i % 3) * 400, y: Math.floor(i / 3) * 330, width: 320, height: 240, payload: { content: 'Performance fixture' },
      } })).json()).data);
    }
    for (let i = 0; i < nodes.length - 1; i++) await request.post(`/api/agent-room/workspaces/${workspace.id}/edges`, { data: { sourceNodeId: nodes[i].id, targetNodeId: nodes[i + 1].id } });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.orkestrai-edge .edge-line')).toHaveCount(5);
    await page.evaluate(() => {
      const state = { count: 0 };
      (window as any).__edgeMutations = state;
      new MutationObserver(records => { state.count += records.filter(record => (record.target as Element).matches('.edge-line') && record.attributeName === 'd').length; }).observe(document.querySelector('.svelte-flow')!, { attributes: true, subtree: true, attributeFilter: ['d'] });
    });
    const countUpdates = async () => page.evaluate(async () => {
      const before = (window as any).__edgeMutations.count;
      await new Promise(resolve => setTimeout(resolve, 500));
      return (window as any).__edgeMutations.count - before;
    });
    await expect.poll(countUpdates, { timeout: 10000 }).toBe(0);
    const first = page.locator('.svelte-flow__node').first().locator('.node-header');
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + 70, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 125, box.y + 65, { steps: 8 });
    await page.mouse.up();
    await expect.poll(countUpdates, { timeout: 10000 }).toBe(0);
    expect(await page.locator('.orkestrai-edge .edge-line').first().getAttribute('d')).toContain(' L ');
  } finally {
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('pans and zooms a 290-node, 727-edge creative canvas without unmounting its nodes', async ({ page, request }) => {
  test.setTimeout(90000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-dense-canvas-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E dense creative canvas', workingDir: dir } })).json()).data;
  const nodes = Array.from({ length: 290 }, (_, i) => ({
    id: randomUUID(), workspaceId: workspace.id, type: i < 139 ? 'image' : i < 268 ? 'imageWorkflow' : 'note', title: `Creative asset ${i + 1}`,
    x: (i % 20) * 440, y: Math.floor(i / 20) * 500, width: 390, height: 420, zIndex: 0, floorId: null, payload: i < 139 ? {} : i < 268 ? { status: 'idle', prompt: 'Approved visual direction' } : { content: 'Direction note' },
  }));
  const edges = Array.from({ length: 727 }, (_, i) => ({ id: randomUUID(), workspaceId: workspace.id, sourceNodeId: nodes[i % 290].id, targetNodeId: nodes[(i % 290 + 1 + Math.floor(i / 290)) % 290].id }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(`**/workspaces/${workspace.id}/nodes`, route => route.fulfill({ json: { data: nodes } }));
  await page.route(`**/workspaces/${workspace.id}/edges`, route => route.fulfill({ json: { data: edges } }));
  await page.route(`**/workspaces/${workspace.id}/image-workflows/*`, route => route.fulfill({ json: { data: { running: false, runId: null, lastError: null, executorReady: false, executorNodeId: null, executorTitle: null } } }));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, canvasEdgeRendering: 'auto' } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(290);
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(727);
    const deferred = await page.locator('.canvas-image .node-body').first().evaluate(element => getComputedStyle(element).contentVisibility);
    expect(deferred).toBe('auto');
    await page.evaluate(() => {
      const gaps: number[] = [];
      let last = performance.now();
      const until = last + 5000;
      const frame = (now: number) => { gaps.push(now - last); last = now; if (now < until) requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
      (window as any).__denseFrameGaps = gaps;
    });
    const zoomIn = page.locator('.svelte-flow__controls-zoomin');
    const zoomOut = page.locator('.svelte-flow__controls-zoomout');
    for (let i = 0; i < 4; i++) { await zoomIn.click(); await zoomOut.click(); }
    const viewport = page.locator('.svelte-flow__viewport').first();
    const transform = await viewport.getAttribute('style');
    const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
    // Start on the empty canvas margin, not a nowheel/nodrag workflow form.
    await page.mouse.move(pane.x + 20, pane.y + 300);
    await page.mouse.down();
    await page.mouse.move(pane.x + 90, pane.y + 420, { steps: 20 });
    await page.mouse.up();
    await expect(viewport).not.toHaveAttribute('style', transform!);
    const gaps = await page.evaluate(() => (window as any).__denseFrameGaps as number[]);
    expect(gaps.length).toBeGreaterThan(5);
    expect(Math.max(...gaps)).toBeLessThan(500);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(290);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/tmp/orkestrai-dense-canvas.png' });
    console.log(JSON.stringify({ nodes: 290, edges: 727, maxFrameGapMs: Math.round(Math.max(...gaps)) }));
  } finally {
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});
