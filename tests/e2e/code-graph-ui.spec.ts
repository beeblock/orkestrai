import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

const GRAPH_NODE_COLORS = [
  [14, 165, 233],
  [139, 92, 246],
  [34, 197, 94],
  [6, 182, 212],
  [168, 85, 247],
  [249, 115, 22],
  [236, 72, 153],
  [16, 185, 129],
  [148, 163, 184],
  [245, 158, 11],
] as const;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function rgb(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  return channels as [number, number, number];
}

function contrast(foreground: string, background: string): number {
  const luminance = ([red, green, blue]: [number, number, number]) => (
    0.2126 * channelLuminance(red)
    + 0.7152 * channelLuminance(green)
    + 0.0722 * channelLuminance(blue)
  );
  const first = luminance(rgb(foreground));
  const second = luminance(rgb(background));
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function graphNodePoints(image: Buffer): Array<{ x: number; y: number }> {
  const png = PNG.sync.read(image);
  const matchesNodeColor = (x: number, y: number) => {
    const offset = (png.width * y + x) * 4;
    const [red, green, blue, alpha] = png.data.subarray(offset, offset + 4);
    return alpha > 200 && GRAPH_NODE_COLORS.some(([targetRed, targetGreen, targetBlue]) => (
      Math.abs(red - targetRed) + Math.abs(green - targetGreen) + Math.abs(blue - targetBlue) < 70
    ));
  };
  const points: Array<{ x: number; y: number }> = [];
  for (let y = 4; y < png.height - 4; y += 2) {
    for (let x = 4; x < png.width - 4; x += 2) {
      // Filled neighborhoods distinguish nodes from the one-pixel graph edges.
      if (matchesNodeColor(x, y) && matchesNodeColor(x - 3, y) && matchesNodeColor(x + 3, y)) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

test.describe('code graph UI', () => {
  test('keeps graph controls actionable and readable in light and dark themes', async ({ page, request }) => {
    const directory = mkdtempSync(join(tmpdir(), 'orkestrai-code-graph-ui-'));
    writeFileSync(join(directory, 'package.json'), '{"name":"code-graph-ui"}\n');
    writeFileSync(join(directory, 'index.ts'), 'export function greet(name: string) { return `Hello ${name}`; }\n');

    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: {
        name: `Code graph UI ${Date.now()}`,
        workingDir: directory,
        codeIntelligenceMode: 'manual',
      },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string; name: string };
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'codeGraph',
        title: 'Code graph',
        x: 100,
        y: 80,
        width: 780,
        height: 580,
        payload: {},
      },
    });
    const node = (await nodeResponse.json()).data as { id: string };

    try {
      for (const appTheme of ['orkestrai-light', 'orkestrai-dark']) {
        await request.put('/api/agent-room/settings', {
          data: { ...originalSettings, appTheme, uiLanguage: 'en' },
        });
        await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}`);

        const graph = page.getByRole('region', { name: 'Code graph' });
        await expect(graph).toBeVisible();
        await expect(graph.getByRole('button', { name: 'All repositories' })).toBeVisible();
        await graph.getByRole('button', { name: 'All repositories' }).click();
        await expect(page.getByRole('option', { name: `Main repository · ${workspace.name}` })).toBeVisible();
        await page.keyboard.press('Escape');

        const indexButton = graph.getByRole('button', { name: 'Index code' });
        await expect(indexButton).toBeVisible();
        const colors = await indexButton.evaluate((element) => {
          const style = getComputedStyle(element);
          return { color: style.color, background: style.backgroundColor };
        });
        expect(contrast(colors.color, colors.background), `${appTheme}: ${JSON.stringify(colors)}`).toBeGreaterThanOrEqual(4.5);

        await indexButton.click();
        await expect(page.getByText('Code graph indexed.', { exact: true })).toBeVisible();

        if (appTheme === 'orkestrai-light') {
          const visualization = graph.getByTestId('code-graph-visualization');
          await expect(visualization.locator('canvas.sigma-nodes')).toBeVisible();
          const before = await visualization.boundingBox();
          expect(before).not.toBeNull();
          await visualization.evaluate((element) => {
            const flowNode = element.closest<HTMLElement>('.svelte-flow__node');
            if (!flowNode) throw new Error('Code graph flow node not found');
            flowNode.style.width = `${flowNode.offsetWidth + 120}px`;
            flowNode.style.height = `${flowNode.offsetHeight + 80}px`;
          });
          await expect.poll(async () => visualization.evaluate((element) => {
            const host = element as HTMLElement;
            const canvases = [...host.querySelectorAll('canvas')];
            const width = `${host.offsetWidth}px`;
            const height = `${host.offsetHeight}px`;
            return canvases.length > 0 && canvases.every((canvas) => (
              canvas.style.width === width && canvas.style.height === height
            ));
          })).toBe(true);
          const after = await visualization.boundingBox();
          expect(after!.width).toBeGreaterThan(before!.width + 80);
          expect(after!.height).toBeGreaterThan(before!.height + 50);

          // Sigma is nested inside XYFlow's CSS-scaled viewport. Exercise a
          // non-1 outer scale so pointer picking cannot accidentally pass by
          // comparing viewport pixels with unscaled canvas coordinates.
          await page.locator('.svelte-flow__controls-zoomout').click();
          await page.locator('.svelte-flow__controls-zoomout').click();
          await expect.poll(() => visualization.evaluate((element) => (
            element.getBoundingClientRect().width / (element as HTMLElement).offsetWidth
          ))).toBeLessThan(0.85);
          const scaledBounds = await visualization.boundingBox();
          expect(scaledBounds).not.toBeNull();

          const screenshot = await visualization.screenshot();
          const png = PNG.sync.read(screenshot);
          const candidates = graphNodePoints(screenshot);
          let hoveredSymbol = '';
          let hoveredPoint: { x: number; y: number } | null = null;
          for (const candidate of candidates.slice(0, 150)) {
            await page.mouse.move(
              scaledBounds!.x + candidate.x * scaledBounds!.width / png.width,
              scaledBounds!.y + candidate.y * scaledBounds!.height / png.height,
            );
            hoveredSymbol = await visualization.getAttribute('data-hovered-symbol') ?? '';
            if (hoveredSymbol) {
              hoveredPoint = candidate;
              break;
            }
          }
          expect(hoveredSymbol, 'node picking should stay aligned after XYFlow zoom and graph-node resize').not.toBe('');
          expect(hoveredPoint).not.toBeNull();
          await expect.poll(async () => visualization.locator('canvas.sigma-hovers').evaluate((canvas) => {
            const context = (canvas as HTMLCanvasElement).getContext('2d');
            if (!context) return false;
            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let index = 3; index < pixels.length; index += 4) {
              if (pixels[index] > 0) return true;
            }
            return false;
          })).toBe(true);

          const focusedSymbol = (await (await request.get(
            `/api/agent-room/workspaces/${workspace.id}/code-graph/symbols/${encodeURIComponent(hoveredSymbol)}`,
          )).json()).data as { name: string };
          await page.mouse.click(
            scaledBounds!.x + hoveredPoint!.x * scaledBounds!.width / png.width,
            scaledBounds!.y + hoveredPoint!.y * scaledBounds!.height / png.height,
          );
          await expect(visualization).toHaveAttribute('data-focused-symbol', hoveredSymbol);
          await expect(graph.getByText(focusedSymbol.name, { exact: true }).last()).toBeVisible();
          const cameraKey = `orkestrai:code-graph-camera:${workspace.id}:${node.id}`;
          await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), cameraKey)).not.toBeNull();
          await page.waitForTimeout(450);

          const focusedBounds = await visualization.boundingBox();
          expect(focusedBounds).not.toBeNull();
          await page.mouse.dblclick(
            focusedBounds!.x + focusedBounds!.width / 2,
            focusedBounds!.y + focusedBounds!.height / 2,
          );
          await expect.poll(async () => {
            const serialized = await page.evaluate((key) => sessionStorage.getItem(key), cameraKey);
            return serialized ? (JSON.parse(serialized) as { ratio: number }).ratio : Number.POSITIVE_INFINITY;
          }).toBeLessThanOrEqual(0.33);
          await expect(visualization).toHaveAttribute('data-focused-symbol', hoveredSymbol);
          await page.waitForTimeout(400);
          const cameraBeforeStageDoubleClick = await page.evaluate((key) => sessionStorage.getItem(key), cameraKey);

          const stageCandidates = [
            { x: 8, y: 8 },
            { x: scaledBounds!.width - 8, y: 8 },
            { x: 8, y: scaledBounds!.height - 8 },
            { x: scaledBounds!.width - 8, y: scaledBounds!.height - 8 },
          ];
          let emptyStagePoint = stageCandidates[0];
          for (const point of stageCandidates) {
            await page.mouse.move(scaledBounds!.x + point.x, scaledBounds!.y + point.y);
            if (!(await visualization.getAttribute('data-hovered-symbol'))) {
              emptyStagePoint = point;
              break;
            }
          }
          await page.mouse.dblclick(scaledBounds!.x + emptyStagePoint.x, scaledBounds!.y + emptyStagePoint.y);
          await page.waitForTimeout(400);
          const cameraAfterStageDoubleClick = await page.evaluate((key) => sessionStorage.getItem(key), cameraKey);
          expect(cameraAfterStageDoubleClick).toBe(cameraBeforeStageDoubleClick);
        }

        const impact = graph.getByRole('button', { name: /Change impact/ });
        await expect(impact).toBeEnabled();
        await impact.hover();
        await expect(page.locator('[data-slot="tooltip-content"]')).toContainText('Maps uncommitted Git changes');

        const semanticSearch = graph.getByRole('button', { name: 'Lexical symbol search enabled' });
        await semanticSearch.click();
        await expect(graph).toContainText('Local semantic index');
        await expect(page.getByText('Build or rebuild the local semantic index before searching by intent.', { exact: true })).toBeVisible();
        await expect(graph.getByRole('button', { name: 'Search symbols' })).toBeVisible();
      }

      await page.locator('.workspace-list li.active').getByRole('button', { name: 'Edit workspace' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Code Intelligence' })).toHaveText('Manual');
      await dialog.getByRole('button', { name: 'Code Intelligence' }).click();
      await expect(page.getByRole('option', { name: 'Assisted (recommended)' })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Disabled' })).toBeVisible();
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
