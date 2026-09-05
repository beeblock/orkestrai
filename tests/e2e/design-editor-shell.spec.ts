import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Design editor shell', () => {
  test('uses the full viewport, adapts its panels, and restores visual state', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-shell-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design shell ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Responsive design', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [{
          kind: 'create',
          element: {
            id: randomUUID(),
            pageId: initial.activePageId,
            parentId: null,
            type: 'frame',
            name: 'Remote frame',
            x: 2_400,
            y: 1_200,
            width: 1_440,
            height: 900,
          },
        }],
        summary: 'Seed responsive design',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);

      const focusMode = page.getByTestId('canvas-design-mode');
      await expect(focusMode).toBeVisible();
      await expect.poll(async () => focusMode.boundingBox()).toMatchObject({ x: 0, width: 1280 });
      await expect(page.getByTestId('design-left-panel')).toBeVisible();
      await expect(page.getByTestId('design-right-panel')).toBeVisible();

      await page.getByRole('button', { name: 'Hide properties' }).click();
      await expect(page.getByTestId('design-right-panel')).toHaveCount(0);
      await page.getByRole('button', { name: 'Zoom in' }).click();
      const savedZoom = await page.getByTestId('design-toolbar').locator('span.tabular-nums').last().textContent();

      await page.getByRole('button', { name: 'Back to Canvas' }).click();
      await expect(focusMode).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit design' }).first().click();
      await expect(page.getByTestId('canvas-design-mode')).toBeVisible();
      await expect(page.getByTestId('design-right-panel')).toHaveCount(0);
      await expect(page.getByTestId('design-toolbar').locator('span.tabular-nums').last()).toHaveText(savedZoom ?? '');

      await page.setViewportSize({ width: 700, height: 760 });
      await page.getByRole('button', { name: 'Hide layers and assets' }).click();
      await page.getByRole('button', { name: 'Show layers and assets' }).click();
      const viewportBox = await page.getByTestId('design-viewport').boundingBox();
      const panelBox = await page.getByTestId('design-left-panel').boundingBox();
      expect(viewportBox?.width).toBe(700);
      expect(panelBox?.width).toBeLessThanOrEqual(320);
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
