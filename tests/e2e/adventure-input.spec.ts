import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Point = { x: number; y: number } | null;
type Probe = { sample: (point: Point) => void; interactive: boolean; moves: number; blockMoves: boolean; opened: string[]; subscribed: boolean };

for (const hud of ['always', 'hover'] as const) {
  test(`Adventure receives hero and ${hud} HUD input without forwarded DOM movement`, async ({ page, request }) => {
    test.setTimeout(45_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-adventure-input-'));
    const original = (await (await request.get('/api/agent-room/settings')).json()).data;
    let workspaceId: string | undefined;
    try {
      expect((await request.put('/api/agent-room/settings', { data: { ...original, adventureHud: hud } })).ok()).toBe(true);
      const workspaceResponse = await request.post('/api/agent-room/workspaces', { data: { name: `Adventure input ${hud}`, workingDir: dir } });
      expect(workspaceResponse.ok()).toBe(true);
      workspaceId = (await workspaceResponse.json()).data.id;
      const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
        data: { type: 'terminal', title: 'Input Maestro', x: 0, y: 0, width: 400, height: 300,
          payload: { command: 'true', args: [], maestro: true, provider: 'claude' } },
      });
      expect(nodeResponse.ok()).toBe(true);
      await page.addInitScript(() => {
        const probe: Probe = { sample: () => {}, interactive: false, moves: 0, blockMoves: true, opened: [], subscribed: false };
        // Chromium on Linux can emit an initial pointermove during layout.
        // Model an ignored native window by preventing movement from reaching
        // the app, rather than assuming the browser creates no such events.
        for (const name of ['pointermove', 'mousemove']) {
          window.addEventListener(name, (event) => {
            if (probe.blockMoves) event.stopImmediatePropagation();
          }, { capture: true });
        }
        window.addEventListener('pointermove', () => probe.moves++);
        Object.assign(window, {
          __adventureInput: probe,
          orkestraiDesktop: {
            platform: 'win32',
            setAdventureInteractive: (value: boolean) => { probe.interactive = value; },
            onAdventurePointer: (callback: (point: Point) => void) => {
              probe.sample = callback; probe.subscribed = true;
              return () => { probe.sample = () => {}; probe.subscribed = false; };
            },
            setAdventureLayout: () => {},
            openInMainWindow: (route: string) => probe.opened.push(route),
          },
        });
      });
      await page.goto(`/adventure?workspace=${workspaceId}`);
      const stage = page.getByTestId('adventure-stage');
      await expect(stage).toHaveAttribute('data-hud', hud);
      await expect.poll(() => page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.subscribed)).toBe(true);
      // Exercise the gate even on platforms that emit no initial movement.
      await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: 0 })));

      // Cursor IPC is the only movement source here. It must reveal a
      // hover-only HUD without any pointermove reaching this ignored page.
      const canvas = await stage.locator('canvas').boundingBox();
      expect(canvas).not.toBeNull();
      await page.evaluate(({ x, y }) => {
        (window as unknown as { __adventureInput: Probe }).__adventureInput.sample({ x, y });
      }, { x: canvas!.x + canvas!.width / 2, y: canvas!.y + 10 });
      const camp = page.getByTestId('adventure-open-camp');
      await expect(camp).toBeVisible();
      await expect(stage.locator('.hud')).toHaveCSS('pointer-events', 'auto');
      const hudBox = await camp.boundingBox();
      expect(hudBox).not.toBeNull();
      await page.evaluate(({ x, y }) => {
        (window as unknown as { __adventureInput: Probe }).__adventureInput.sample({ x, y });
      }, { x: hudBox!.x + hudBox!.width / 2, y: hudBox!.y + hudBox!.height / 2 });
      expect(await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.interactive)).toBe(true);
      await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.sample(null));
      expect(await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.interactive)).toBe(false);

      // Locate a real rendered sprite's hit box, without keeping a second
      // approximation of the formation geometry in this test.
      const row = { y: canvas!.y + canvas!.height - 50, left: canvas!.x, width: canvas!.width };
      const findHero = () => page.evaluate(({ y, left, width }) => {
        const probe = (window as unknown as { __adventureInput: Probe }).__adventureInput;
        let start: number | null = null;
        for (let x = left; x < left + width; x += 6) {
          probe.sample({ x, y });
          if (probe.interactive && start === null) start = x;
          if (!probe.interactive && start !== null) {
            const center = { x: (start + x - 6) / 2, y };
            probe.sample(center);
            return center;
          }
        }
        return null;
      }, row);
      await expect.poll(findHero).not.toBeNull();
      const point = (await findHero())!;
      expect(await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.moves)).toBe(0);
      await page.evaluate(() => { (window as unknown as { __adventureInput: Probe }).__adventureInput.blockMoves = false; });
      await page.mouse.click(point.x, point.y);
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.sample(null));
      expect(await page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.interactive)).toBe(false);
      await camp.click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __adventureInput: Probe }).__adventureInput.opened)).toEqual([`/adventure/camp?workspace=${workspaceId}`]);
    } finally {
      await page.goto('about:blank');
      if (workspaceId) expect((await request.delete(`/api/agent-room/workspaces/${workspaceId}`)).ok()).toBe(true);
      expect((await request.put('/api/agent-room/settings', { data: original })).ok()).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
