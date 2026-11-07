import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function fixture(page: Page, request: APIRequestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-space-pan-'));
  await writeFile(join(directory, 'image.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAANSURBVAiZY2BgYPgPAAEEAQB9ssjfAAAAAElFTkSuQmCC', 'base64'));
  const created = await request.post('/api/agent-room/workspaces', {
    data: { name: 'E2E large image group', workingDir: directory, codeIntelligenceMode: 'disabled' },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = (await created.json()).data;
  const base = `/api/agent-room/workspaces/${id}`;
  async function node(data: Record<string, unknown>) {
    const response = await request.post(`${base}/nodes`, { data });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data;
  }
  const first = await node({ type: 'image', title: 'First image', x: 300, y: 230, width: 300, height: 220, payload: { path: 'image.png' } });
  const last = await node({ type: 'image', title: 'Last image', x: 3000, y: 1400, width: 300, height: 220, payload: { path: 'image.png' } });
  const group = await node({ type: 'group', title: 'Many images', x: 270, y: 192, width: 3060, height: 1458,
    zIndex: -1, payload: { members: [first.id, last.id] } });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(({ id }) => {
    localStorage.setItem(`orkestrai.canvasViewport.${id}`, JSON.stringify({ x: -500, y: -350, zoom: 2.2 }));
  }, { id });
  await page.goto(`/canvas?workspace=${id}`);
  await expect(page.locator('.svelte-flow__node')).toHaveCount(3);
  await expect(page.locator('.zoom-level')).toHaveText('220%');
  await expect(page.getByRole('img', { name: 'First image', exact: true }).first()).toBeVisible();
  const positions = async () => ((await (await request.get(`${base}/nodes`)).json()).data as Array<{ id: string; x: number; y: number }>)
    .map(({ id, x, y }) => ({ id, x, y })).sort((a, b) => a.id.localeCompare(b.id));
  return { first, last, group, positions, cleanup: async () => {
    await request.delete(base);
    await rm(directory, { recursive: true, force: true });
  } };
}

async function transform(page: Page) {
  return page.locator('.svelte-flow__viewport').evaluate(element => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
}

for (const theme of ['light', 'dark']) {
  test(`Space pans across a zoomed group and image without changing any node (${theme})`, async ({ page, request }) => {
    const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
    await request.put('/api/agent-room/settings', { data: { ...settings, appTheme: theme === 'light' ? 'orkestrai-light' : 'graphite-dark' } });
    const f = await fixture(page, request);
    try {
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const original = await f.positions();
      const area = page.locator('.canvas-area');
      const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
      const groupPoint = { x: pane.x + 1000, y: pane.y + 440 };
      expect(await page.evaluate(point => Boolean(document.elementFromPoint(point.x, point.y)?.closest('.canvas-group')), groupPoint)).toBe(true);
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      let before = await transform(page);
      await page.keyboard.down('Space');
      await expect(area).toHaveClass(/hand-panning/);
      await expect(page.locator('.svelte-flow__pane')).toHaveCSS('cursor', 'grab');
      await page.mouse.move(groupPoint.x, groupPoint.y);
      await page.mouse.down();
      await page.mouse.move(groupPoint.x + 90, groupPoint.y + 40, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await transform(page)).x - before.x).toBeCloseTo(90, 0);
      expect((await transform(page)).zoom).toBeCloseTo(2.2);
      await page.keyboard.up('Space');
      await expect(area).not.toHaveClass(/hand-panning/);
      expect(await f.positions()).toEqual(original);

      // Image bodies normally block node dragging and the pane; the shortcut
      // must cross both the group's drag surface and its interactive children.
      const image = (await page.locator(`[data-id="${f.first.id}"] .image-body`).boundingBox())!;
      before = await transform(page);
      await page.keyboard.down('Space');
      await page.mouse.move(image.x + 100, image.y + 80);
      await page.mouse.down();
      await page.mouse.move(image.x + 170, image.y + 110, { steps: 8 });
      // Releasing Space before the mouse must not start moving a node mid-drag.
      await page.keyboard.up('Space');
      await page.mouse.move(image.x + 190, image.y + 120, { steps: 3 });
      await page.mouse.up();
      await expect.poll(async () => (await transform(page)).x - before.x).toBeCloseTo(90, 0);
      expect(await f.positions()).toEqual(original);

      // The inverse contract matters too: the group can still move its members
      // normally once Space has been released.
      before = await transform(page);
      await page.mouse.move(groupPoint.x, groupPoint.y);
      await page.mouse.down();
      await page.mouse.move(groupPoint.x + 66, groupPoint.y + 44, { steps: 8 });
      await page.mouse.up();
      await expect.poll(async () => (await f.positions()).find(n => n.id === f.group.id)!.x).not.toBe(original.find(n => n.id === f.group.id)!.x);
      expect(await transform(page)).toEqual(before);
      const moved = await f.positions();
      const movedGroup = moved.find(n => n.id === f.group.id)!;
      const oldGroup = original.find(n => n.id === f.group.id)!;
      // XYFlow starts after its drag threshold; compare the actual group
      // delta rather than counting the threshold pixels as node movement.
      const delta = { x: movedGroup.x - oldGroup.x, y: movedGroup.y - oldGroup.y };
      expect(delta.x).toBeGreaterThan(20);
      expect(delta.y).toBeGreaterThan(10);
      for (const position of moved) {
        const old = original.find(n => n.id === position.id)!;
        expect(position.x - old.x).toBeCloseTo(delta.x, 5);
        expect(position.y - old.y).toBeCloseTo(delta.y, 5);
      }
    } finally {
      await page.keyboard.up('Space'); await page.mouse.up(); await f.cleanup();
      await request.put('/api/agent-room/settings', { data: settings });
    }
  });
}

test('Space preserves editing and modified shortcuts, resets on blur, and temporarily overrides creation', async ({ page, request }) => {
  const f = await fixture(page, request);
  try {
    const area = page.locator('.canvas-area');
    const field = page.locator('.composer textarea');
    await field.fill('one');
    await field.press('End');
    await field.press('Space');
    await field.pressSequentially('two');
    await expect(field).toHaveValue('one two');
    await expect(area).not.toHaveClass(/hand-panning/);

    await page.locator(`[data-id="${f.first.id}"]`).hover();
    await page.locator(`[data-id="${f.first.id}"] .node-title`).dblclick();
    const rename = page.locator(`[data-id="${f.first.id}"] input`).filter({ visible: true });
    await expect(rename).toBeVisible();
    await rename.fill('new');
    await rename.press('End');
    await rename.press('Space');
    await rename.pressSequentially('name');
    await expect(rename).toHaveValue('new name');
    await expect(area).not.toHaveClass(/hand-panning/);
    await rename.press('Escape');

    await page.getByTestId('canvas-tool-select').focus();
    await page.keyboard.press('Space');
    await expect(area).not.toHaveClass(/hand-panning/);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Control+Space');
    await expect(area).not.toHaveClass(/hand-panning/);
    await page.keyboard.down('Space');
    await expect(area).toHaveClass(/hand-panning/);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(area).not.toHaveClass(/hand-panning/);
    await page.keyboard.up('Space');

    await page.getByRole('button', { name: 'Nota markdown compartilhada com os agentes (specs, briefings)' }).click();
    await expect(area).toHaveClass(/drawing/);
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const before = await transform(page);
    const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
    await page.keyboard.down('Space');
    await expect(area).toHaveClass(/hand-panning/);
    await page.mouse.move(pane.x + 1000, pane.y + 440);
    await page.mouse.down();
    await page.mouse.move(pane.x + 1080, pane.y + 470, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await expect(area).toHaveClass(/drawing/);
    await expect(area).not.toHaveClass(/hand-panning/);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(3);
    expect((await transform(page)).x - before.x).toBeCloseTo(80, 0);
  } finally { await page.keyboard.up('Space'); await page.mouse.up(); await f.cleanup(); }
});
