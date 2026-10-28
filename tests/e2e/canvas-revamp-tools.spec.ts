import { expect, test } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectCanvasTool } from './helpers';
import { PNG } from 'pngjs';

test.describe('canvas revamp tools', () => {
  test('keeps note Markdown and connection counts readable on every paper in both themes', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    const original = (await (await request.get('/api/agent-room/settings')).json()).data;
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-note-contrast-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Note contrast matrix', workingDir: dir, codeIntelligenceMode: 'manual' } })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    const samples: Array<{ theme: string; paper: string; state: string; target: string; ratio: number }> = [];
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    try {
      const note = (await (await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Readable note', x: 80, y: 80, width: 620, height: 520, payload: { color: 'neutral', formatted: true, font: 'sans', content: '**Readable emphasis**\n\n~~Readable deletion~~\n\n[Readable link](https://example.com)\n\n[`Inline code link`](https://example.com)\n\n> **Readable quote**\n\n| Header | Value |\n| --- | --- |\n| Cell | Text |' } } })).json()).data;
      const other = (await (await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Linked note', x: 800, y: 80, width: 300, height: 200, payload: { content: 'Reference' } } })).json()).data;
      expect((await request.post(`${base}/edges`, { data: { sourceNodeId: note.id, targetNodeId: other.id } })).ok()).toBe(true);
      const root = page.locator(`.svelte-flow__node[data-id="${note.id}"] .canvas-note`);
      const badge = root.locator('.connections-badge');
      async function measure(theme: string, paper: string, state: string, headerOnly = false) {
        const targets = await root.evaluate((element, headerOnly) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          const selector = headerOnly ? '.connections-badge, .connections-badge svg' : '.md strong, .md del, .md a, .md th, .connections-badge, .connections-badge svg';
          return [...element.querySelectorAll<HTMLElement>(selector)].map((target, index) => {
            context.clearRect(0, 0, 1, 1);
            const style = getComputedStyle(target);
            context.fillStyle = target.tagName.toLowerCase() === 'svg' ? style.stroke : style.color;
            context.fillRect(0, 0, 1, 1);
            const foreground = Array.from(context.getImageData(0, 0, 1, 1).data);
            const badge = target.closest('.connections-badge');
            const background = badge ?? target.querySelector('code') ?? target.closest('th') ?? target.closest('p') ?? target;
            const box = background.getBoundingClientRect();
            let opacity = 1;
            for (let parent: Element | null = target; parent; parent = parent.parentElement) opacity *= Number(getComputedStyle(parent).opacity);
            return { target: `${target.tagName.toLowerCase()}-${index}`, foreground, opacity, x: box.right - 3, y: box.top + box.height / 2 };
          });
        }, headerOnly);
        const image = PNG.sync.read(await page.screenshot());
        for (const target of targets) {
          const x = Math.round(target.x), y = Math.round(target.y);
          expect(x >= 0 && x < image.width && y >= 0 && y < image.height).toBe(true);
          const offset = (y * image.width + x) * 4;
          const background = [...image.data.subarray(offset, offset + 3)];
          const alpha = target.foreground[3] / 255 * target.opacity;
          const foreground = target.foreground.slice(0, 3).map((value, index) => alpha * value + (1 - alpha) * background[index]);
          const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
          samples.push({ theme, paper, state, target: target.target, ratio: (values[1] + .05) / (values[0] + .05) });
        }
      }
      for (const theme of ['orkestrai-dark', 'orkestrai-light']) {
        expect((await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en', appTheme: theme } })).ok()).toBe(true);
        await page.goto(`/canvas?workspace=${workspace.id}`);
        await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);
        await expect(root.locator('.md strong').first()).toBeVisible();
        await page.addStyleTag({ content: '.canvas-note, .canvas-note * { transition-duration: 0s !important; }' });
        for (const [index, paper] of ['yellow', 'peach', 'red', 'purple', 'blue', 'green', 'lime', 'neutral', 'glass'].entries()) {
          await root.locator('.color-trigger').click();
          const swatch = page.locator('[data-state="open"] .swatch-grid button').nth(index);
          await swatch.click();
          await expect(swatch).toHaveAttribute('aria-checked', 'true');
          await page.keyboard.press('Escape');
          await page.mouse.move(10, 10);
          await expect(badge).toBeVisible();
          await measure(theme, paper, 'normal');
          await badge.hover();
          await measure(theme, paper, 'hover', true);
          await badge.click();
          await expect(badge).toHaveAttribute('data-state', 'open');
          await measure(theme, paper, 'open', true);
          await page.keyboard.press('Escape');
          if (index === 0 || paper === 'glass') await page.screenshot({ path: info.outputPath(`note-${theme}-${paper}.png`) });
        }
      }
      await writeFile(info.outputPath('note-contrast.json'), JSON.stringify(samples, null, 2));
      await info.attach('Rendered note contrast', { path: info.outputPath('note-contrast.json'), contentType: 'application/json' });
      expect(samples.length).toBeGreaterThan(100);
      expect(samples.filter(sample => sample.ratio < 4.5), 'All note text and linked-count icons need readable contrast.').toEqual([]);
    } finally {
      await request.put('/api/agent-room/settings', { data: original });
      await request.delete(base); await rm(dir, { recursive: true, force: true });
    }
  });

  test('draws with the pen, shows an agent as a conversation and reuses a score', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-tools-'));
    const source = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E tools ${Date.now()}`, workingDir: dir } })).json()).data;
    const target = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E score target ${Date.now()}`, workingDir: dir } })).json()).data;
    const base = `/api/agent-room/workspaces/${source.id}`;
    let scoreId: string | null = null;
    try {
      const agent = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Reviewer', x: 400, y: 120, width: 520, height: 340, payload: { provider: 'claude', args: [], command: '/bin/cat', role: null } } })).json()).data;
      const note = (await (await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Checklist', x: 1000, y: 120, width: 300, height: 200, payload: { content: '- one' } } })).json()).data;
      await request.post(`${base}/edges`, { data: { sourceNodeId: agent.id, targetNodeId: note.id } });

      await page.goto(`/canvas?workspace=${source.id}`);
      await expect(page.locator('.canvas-terminal')).toHaveCount(1);

      // Conversation face: same node, the agent's direct conversation instead of the terminal.
      await page.locator('.canvas-terminal .face-toggle').click();
      await expect(page.getByTestId('agent-chat-face')).toBeVisible();
      await page.locator('.canvas-terminal .face-toggle').click();
      await expect(page.getByTestId('agent-chat-face')).toHaveCount(0);

      // Pen: a stroke on the empty canvas becomes a freehand shape.
      await selectCanvasTool(page, 'Caneta');
      await expect(page.getByRole('menu')).toHaveCount(0);
      const pane = page.locator('.svelte-flow__pane');
      const box = (await pane.boundingBox())!;
      await page.mouse.move(box.x + 420, box.y + 620);
      await page.mouse.down();
      for (let step = 1; step <= 12; step += 1) await page.mouse.move(box.x + 420 + step * 18, box.y + 620 + Math.sin(step) * 30);
      await page.mouse.up();
      await expect(page.locator('.svelte-flow__node-shape')).toHaveCount(1);

      // A score keeps the chosen nodes and their connection, and lands in another workspace.
      const saved = await request.post('/api/agent-room/presets', { data: { workspaceId: source.id, name: 'Review squad', nodeIds: [agent.id, note.id] } });
      expect(saved.status()).toBe(201);
      scoreId = (await saved.json()).data.id;
      await page.reload();
      // Scores live in the Canvas panel rail (right).
      await page.locator('[data-rail-item="scores"]').click();
      await expect(page.getByRole('region', { name: 'Partituras' })).toContainText('Review squad');
      const applied = await request.post(`/api/agent-room/presets/${scoreId}/apply`, { data: { workspaceId: target.id } });
      expect(applied.ok()).toBe(true);
      const placed = (await (await request.get(`/api/agent-room/workspaces/${target.id}/nodes`)).json()).data as Array<{ type: string; title: string }>;
      expect(placed.map((node) => node.title).sort()).toEqual(['Checklist', 'Reviewer']);
      const edges = (await (await request.get(`/api/agent-room/workspaces/${target.id}/edges`)).json()).data as unknown[];
      expect(edges).toHaveLength(1);
    } finally {
      if (scoreId) await request.delete(`/api/agent-room/presets/${scoreId}`);
      await request.delete(`/api/agent-room/workspaces/${source.id}`);
      await request.delete(`/api/agent-room/workspaces/${target.id}`);
    }
  });

  test('reopens a workspace at the zoom it was left at', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-viewport-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E viewport ${Date.now()}`, workingDir: dir } })).json()).data;
    try {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'note', title: 'Anchor', x: 0, y: 0, width: 300, height: 200, payload: { content: 'anchor' } } });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const zoom = page.locator('.zoom-level');
      await expect(zoom).toHaveText('100%');
      await page.locator('.svelte-flow__controls-zoomout').click();
      await page.locator('.svelte-flow__controls-zoomout').click();
      await expect(zoom).not.toHaveText('100%');
      // Let the zoom animation settle before reading where the board was left.
      await page.waitForTimeout(800);
      const left = await zoom.textContent();
      await page.reload();
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1);
      await expect(zoom).toHaveText(left!);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
