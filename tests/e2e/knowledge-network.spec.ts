import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
test.use({ actionTimeout: 10_000 });

async function point(graph: Locator, id: string) {
  await graph.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return graph.locator(`[data-graph-label="node:${id}"]`).evaluate(el => {
    const stage = el.closest('[data-testid="knowledge-graph-stage"]') as HTMLElement;
    const rect = stage.getBoundingClientRect(), label = el as HTMLElement;
    return { x: rect.x + parseFloat(label.style.left) * rect.width / stage.clientWidth, y: rect.y + (parseFloat(label.style.top) - 10) * rect.height / stage.clientHeight };
  });
}
async function nonblank(stage: Locator) {
  const png = PNG.sync.read(await stage.screenshot());
  let colored = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const [r, g, b] = png.data.subarray(i, i + 3);
    if (Math.max(r, g, b) - Math.min(r, g, b) > 45) colored++;
  }
  expect(colored).toBeGreaterThan(300);
}

test('live knowledge network stays interactive, scaled correctly and stable across source changes', async ({ page, request }, info) => {
  test.setTimeout(100_000);
  const dir = mkdtempSync(join(tmpdir(), 'ork-network-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let id = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).__knowledgeDraws = 0;
    const original = WebGL2RenderingContext.prototype.drawElementsInstanced;
    WebGL2RenderingContext.prototype.drawElementsInstanced = function (...args) {
      if ((this.canvas as HTMLCanvasElement).dataset?.testid === 'knowledge-network') (window as any).__knowledgeDraws++;
      return original.apply(this, args);
    };
  });
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    id = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Knowledge network', workingDir: dir } })).json()).data.id;
    const root = `/api/agent-room/workspaces/${id}`;
    const hubs = ['Research', 'Product', 'Engineering', 'Customers', 'Operations', 'Decisions'];
    const nodes: any[] = [];
    for (let i = 0; i < 54; i++) {
      const group = i % hubs.length, title = i < 6 ? hubs[i] : `${hubs[group]} ${Math.floor(i / 6)}`;
      const content = i < 6 ? `[[${hubs[(i + 1) % 6]}]]` : `[[${hubs[group]}]] Research finding ${i}. #knowledge`;
      const res = await request.post(`${root}/nodes`, { data: { type: 'note', title, payload: { content }, x: i * 20, y: i * 20 } });
      expect(res.ok()).toBe(true); nodes.push((await res.json()).data);
    }
    writeFileSync(join(dir, 'research.md'), 'Initial observation [[Research]]');
    const file = (await (await request.post(`${root}/knowledge`, { data: { command: 'attach', path: 'research.md' } })).json()).data;
    await request.post(`${root}/knowledge`, { data: { command: 'create', title: 'Knowledge' } });
    await page.setViewportSize({ width: 1440, height: 980 });
    await page.goto(`/canvas?workspace=${id}`);
    await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    const dialog = page.getByRole('dialog'), view = dialog.getByTestId('knowledge-view');
    await view.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    const graph = view.getByTestId('knowledge-graph');
    await expect(graph).toHaveAttribute('data-arranging', 'false');
    await expect(graph).toHaveAttribute('data-count', '55');
    await expect(graph.locator('canvas')).toHaveCount(1);
    await expect(graph.locator('.svelte-flow')).toHaveCount(0);
    await nonblank(graph.getByTestId('knowledge-graph-stage'));
    await graph.screenshot({ path: info.outputPath('knowledge-network-3d-dark.png') });
    await page.waitForTimeout(150);
    const idleDraws = await page.evaluate(() => (window as any).__knowledgeDraws);
    expect(idleDraws).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as any).__knowledgeDraws)).toBe(idleDraws);
    const hub = nodes[0];
    const unrotated = await graph.locator('[data-graph-label]').evaluateAll(labels => Object.fromEntries(labels.map(el => {
      const label = el as HTMLElement;
      return [label.dataset.graphLabel!, { x: parseFloat(label.style.left), y: parseFloat(label.style.top) }];
    })));
    const bounds = (await graph.getByTestId('knowledge-graph-stage').boundingBox())!;
    await page.mouse.move(bounds.x + 60, bounds.y + 35); await page.mouse.down();
    await page.mouse.move(bounds.x + 160, bounds.y + 80, { steps: 8 }); await page.mouse.up();
    await expect.poll(() => graph.locator('[data-graph-label]').evaluateAll((labels, previous) => Math.max(0, ...labels.map(el => {
      const label = el as HTMLElement, before = previous[label.dataset.graphLabel!];
      return before ? Math.hypot(parseFloat(label.style.left) - before.x, parseFloat(label.style.top) - before.y) : 0;
    })), unrotated)).toBeGreaterThan(5);
    await graph.getByRole('button', { name: 'Fit graph', exact: true }).click();
    await graph.locator(`[data-graph-label="node:${hub.id}"]`).hover();
    await expect(graph.getByRole('tooltip')).toContainText('Research');
    await graph.locator(`[data-graph-label="node:${hub.id}"]`).click();
    await expect(view.locator('aside')).toContainText('Research');
    await view.locator('aside').getByRole('button', { name: 'Close', exact: true }).click();
    const before = await point(graph, hub.id);
    await page.mouse.move(before.x, before.y);
    await expect(graph.getByRole('tooltip')).toContainText('Research');
    await page.mouse.click(before.x, before.y);
    await expect(view.locator('aside')).toContainText('Research');
    await view.locator('aside').getByRole('button', { name: 'Close', exact: true }).click();
    await graph.getByRole('radio', { name: '2D', exact: true }).click();
    await expect(graph).toHaveAttribute('data-mode', '2d');
    const start = await point(graph, hub.id);
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 44, start.y + 20, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => Math.round((await point(graph, hub.id)).x - start.x)).toBeGreaterThan(35);
    const moved = await point(graph, hub.id);
    await request.patch(`${root}/nodes/${hub.id}`, { data: { payload: { content: 'Updated finding without refresh [[Product]]' } } });
    await page.mouse.move(moved.x, moved.y);
    await expect(graph.getByRole('tooltip')).toContainText('Updated finding without refresh', { timeout: 7000 });
    expect(Math.abs((await point(graph, hub.id)).x - moved.x)).toBeLessThan(2);
    const fresh = (await (await request.post(`${root}/nodes`, { data: { type: 'note', title: 'Live source', payload: { content: '[[Research]]' } } })).json()).data;
    await expect(graph).toHaveAttribute('data-count', '56', { timeout: 7000 });
    expect(Math.abs((await point(graph, hub.id)).x - moved.x)).toBeLessThan(2);
    await request.delete(`${root}/nodes/${fresh.id}`);
    await expect(graph).toHaveAttribute('data-count', '55', { timeout: 7000 });
    // File watch, not the 15-second recovery interval. No manual refresh/search.
    await view.getByRole('tab', { name: 'Sources', exact: true }).click();
    await view.getByRole('button', { name: /^research.md Document/ }).click();
    writeFileSync(join(dir, 'research.md'), 'Filesystem update delivered live [[Research]]');
    await expect(view.locator('aside')).toContainText('Filesystem update delivered live', { timeout: 7000 });
    await view.locator('aside').getByRole('button', { name: 'Close', exact: true }).click();
    await view.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    await expect(graph).toHaveAttribute('data-arranging', 'false');
    // Native fullscreen resizes the same renderer, and restores it afterwards.
    await graph.getByRole('button', { name: 'Expand graph', exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await nonblank(graph.getByTestId('knowledge-graph-stage'));
    await graph.getByRole('button', { name: 'Expand graph', exact: true }).click();
    await page.keyboard.press('Escape');
    // Inner hover and wheel must use the outer canvas's scaled bounding box.
    const embedded = page.getByTestId('knowledge-view');
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await embedded.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    const eg = embedded.getByTestId('knowledge-graph');
    await expect(eg).toHaveAttribute('data-arranging', 'false');
    const vp = page.getByRole('region', { name: 'Canvas', exact: true }).locator('.svelte-flow__viewport').first();
    // Fit View animates the outer canvas; measure the embedded point only once it settles.
    await vp.evaluate(element => new Promise<void>(resolve => {
      let previous = '', stable = 0;
      const sample = () => {
        const current = element.getAttribute('style') ?? '';
        stable = current === previous ? stable + 1 : 0; previous = current;
        if (stable >= 5) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const transform = await vp.getAttribute('style');
    const ep = await point(eg, hub.id); await page.mouse.move(ep.x, ep.y);
    await expect(eg.getByRole('tooltip')).toContainText('Research');
    await page.mouse.wheel(0, -100); await page.waitForTimeout(250);
    expect(await vp.getAttribute('style')).toBe(transform);
    // Light theme and mobile graph with no horizontal overflow.
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    await page.reload(); await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    await view.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    await expect(graph).toHaveAttribute('data-arranging', 'false');
    await nonblank(graph.getByTestId('knowledge-graph-stage'));
    await graph.screenshot({ path: info.outputPath('knowledge-network-light.png') });
    await graph.getByRole('radio', { name: '2D', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await graph.boundingBox())!.width).toBeLessThan(390);
    await nonblank(graph.getByTestId('knowledge-graph-stage'));
    await dialog.screenshot({ path: info.outputPath('knowledge-network-mobile.png') });
    const mobileStage = graph.getByTestId('knowledge-graph-stage');
    const touchBounds = (await mobileStage.boundingBox())!;
    // A finger can start over a source label, not just the WebGL canvas behind it.
    const touchOrigin = await mobileStage.locator('[data-graph-label]').evaluateAll((labels, bounds) => {
      return labels.map(label => {
        const rect = label.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }).find(point => point.x > bounds.x + 70 && point.x < bounds.x + bounds.width - 70
        && point.y > bounds.y + 20 && point.y < bounds.y + bounds.height - 20);
    }, touchBounds);
    expect(touchOrigin).toBeDefined();
    const beforeTouch = await mobileStage.locator('[data-graph-label]').evaluateAll(labels => Object.fromEntries(labels.map(el => {
      const label = el as HTMLElement;
      return [label.dataset.graphLabel!, { x: parseFloat(label.style.left), y: parseFloat(label.style.top) }];
    })));
    const beforePinch = await mobileStage.screenshot();
    const cdp = await page.context().newCDPSession(page);
    const x = touchOrigin!.x + (touchOrigin!.x < touchBounds.x + touchBounds.width / 2 ? 30 : -30), y = touchOrigin!.y;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(async () => (await mobileStage.screenshot()).equals(beforePinch)).toBe(false);
    // A one-finger pan also changes pixels; only a real pinch changes pairwise distances in 2D.
    await expect.poll(() => mobileStage.locator('[data-graph-label]').evaluateAll((labels, previous) => {
      const points = labels.map(el => {
        const label = el as HTMLElement;
        return { x: parseFloat(label.style.left), y: parseFloat(label.style.top), before: previous[label.dataset.graphLabel!] };
      }).filter(point => point.before);
      return Math.max(0, ...points.flatMap((a, i) => points.slice(i + 1).map(b =>
        Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(a.before.x - b.before.x, a.before.y - b.before.y)))));
    }, beforeTouch)).toBeGreaterThan(10);
    expect(errors).toEqual([]);
  } finally {
    if (id) await request.delete(`/api/agent-room/workspaces/${id}`);
    await request.put('/api/agent-room/settings', { data: settings });
    rmSync(dir, { recursive: true, force: true });
  }
});
