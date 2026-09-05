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

  test('manages pages and hierarchical layers from the file panel', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-file-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design file ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Organized design', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const frameId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: frameId, pageId: initial.activePageId, parentId: null, type: 'frame', name: 'Checkout', x: 100, y: 100, width: 420, height: 320 } },
          { kind: 'create', element: { id: randomUUID(), pageId: initial.activePageId, parentId: frameId, type: 'text', name: 'Headline', x: 132, y: 132, width: 260, height: 48, text: 'Complete payment' } },
        ],
        summary: 'Seed organized design',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const filePanel = page.getByTestId('design-file-panel');
      await expect(filePanel).toBeVisible();

      await filePanel.getByRole('button', { name: 'Add page' }).click();
      await expect(filePanel.getByRole('button', { name: 'Page 2', exact: true })).toBeVisible();
      await filePanel.getByRole('button', { name: 'Page 2', exact: true }).dblclick();
      const rename = filePanel.getByRole('textbox').first();
      await expect(rename).toBeFocused();
      await rename.fill('Archive');
      await rename.press('Enter');
      await expect(filePanel.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();

      const archiveRow = filePanel.locator('[data-testid^="design-page-"]').filter({ hasText: 'Archive' });
      await archiveRow.getByRole('button', { name: 'Page actions' }).click();
      await page.getByRole('menuitem', { name: 'Duplicate' }).click();
      await expect(filePanel.getByRole('button', { name: 'Archive copy', exact: true })).toBeVisible();
      const copyRow = filePanel.locator('[data-testid^="design-page-"]').filter({ hasText: 'Archive copy' });
      await copyRow.getByRole('button', { name: 'Page actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete page' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Archive copy');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete page' }).click();
      await expect(filePanel.getByRole('button', { name: 'Archive copy', exact: true })).toHaveCount(0);

      await filePanel.getByRole('button', { name: 'Page 1', exact: true }).click();
      await expect(filePanel.getByRole('button', { name: 'Headline', exact: true })).toBeVisible();
      await filePanel.getByRole('button', { name: 'Collapse layer' }).click();
      await expect(filePanel.getByRole('button', { name: 'Headline', exact: true })).toHaveCount(0);
      await filePanel.getByRole('textbox', { name: 'Search layers...' }).fill('headline');
      await expect(filePanel.getByRole('button', { name: 'Headline', exact: true })).toBeVisible();
      await filePanel.getByRole('textbox', { name: 'Search layers...' }).fill('');

      const checkoutLayer = filePanel.getByRole('treeitem', { name: /Checkout/ });
      await filePanel.getByRole('button', { name: 'Checkout', exact: true }).click();
      await expect(checkoutLayer).toHaveAttribute('aria-selected', 'true');
      await page.keyboard.press('Meta+d');
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`);
        const body = await response.json();
        return body.data.elements.length;
      }).toBe(4);
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reveals precision controls and tidies a multi-layer selection', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-precision-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design precision ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Precision design', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const elementIds = [randomUUID(), randomUUID(), randomUUID()];
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: elementIds[0], pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Alpha card', x: 80, y: 80, width: 120, height: 72, order: 0 } },
          { kind: 'create', element: { id: elementIds[1], pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Beta card', x: 260, y: 92, width: 120, height: 72, order: 1 } },
          { kind: 'create', element: { id: elementIds[2], pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Gamma card', x: 90, y: 240, width: 120, height: 72, order: 2 } },
        ],
        summary: 'Seed precision controls',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);

      const designViewport = page.getByTestId('design-viewport');
      const firstLayer = designViewport.locator(`[data-design-element="${elementIds[0]}"]`);
      await firstLayer.hover();
      await expect(firstLayer.locator('[data-design-hover]')).toBeVisible();
      await firstLayer.click();
      await expect(page.getByRole('button', { name: /Rotate selection/ })).toBeVisible();

      await designViewport.locator(`[data-design-element="${elementIds[1]}"]`).click({ modifiers: ['Shift'] });
      await designViewport.locator(`[data-design-element="${elementIds[2]}"]`).click({ modifiers: ['Shift'] });
      await page.getByRole('button', { name: 'Tidy up' }).first().click();

      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`);
        const body = await response.json();
        return body.data.elements
          .filter((element: { id: string }) => elementIds.includes(element.id))
          .map((element: { id: string; x: number; y: number }) => ({ id: element.id, x: element.x, y: element.y }));
      }).toEqual([
        { id: elementIds[0], x: 80, y: 80 },
        { id: elementIds[1], x: 216, y: 80 },
        { id: elementIds[2], x: 80, y: 168 },
      ]);
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('edits responsive layout, color, and typography from the contextual inspector', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-inspector-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design inspector ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Inspector design', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const frameId = randomUUID();
    const textId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          {
            kind: 'create',
            element: {
              id: frameId,
              pageId: initial.activePageId,
              parentId: null,
              type: 'frame',
              name: 'Responsive card',
              x: 100,
              y: 100,
              width: 320,
              height: 160,
              order: 0,
              layoutMode: 'horizontal',
              layoutGap: 12,
              layoutPaddingTop: 20,
              layoutPaddingLeft: 24,
            },
          },
          {
            kind: 'create',
            element: {
              id: textId,
              pageId: initial.activePageId,
              parentId: frameId,
              type: 'text',
              name: 'Card label',
              x: 0,
              y: 0,
              width: 120,
              height: 32,
              order: 0,
              text: 'Responsive text',
            },
          },
        ],
        summary: 'Seed inspector design',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);

      const filePanel = page.getByTestId('design-file-panel');
      await filePanel.getByRole('button', { name: 'Responsive card', exact: true }).click();
      const widthInput = page.getByRole('textbox', { name: 'W', exact: true });
      await widthInput.fill('160 * 2 + 40');
      await widthInput.press('Enter');
      await page.getByRole('button', { name: 'Apply layout' }).click();

      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`);
        const body = await response.json();
        const frame = body.data.elements.find((element: { id: string }) => element.id === frameId);
        const text = body.data.elements.find((element: { id: string }) => element.id === textId);
        return { frameWidth: frame.width, textX: text.x, textY: text.y };
      }).toEqual({ frameWidth: 360, textX: 124, textY: 120 });

      await page.getByRole('button', { name: 'Color picker' }).first().click();
      await expect(page.getByRole('button', { name: 'hex', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'rgb', exact: true }).click();
      await expect(page.getByRole('button', { name: 'rgb', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');

      await filePanel.getByRole('button', { name: 'Card label', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Font family' })).toHaveValue('Inter Variable');
      await page.getByRole('textbox', { name: 'Font family' }).fill('JetBrains Mono');
      await page.getByRole('textbox', { name: 'Font family' }).press('Enter');
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`);
        const body = await response.json();
        return body.data.elements.find((element: { id: string }) => element.id === textId).fontFamily;
      }).toBe('JetBrains Mono');
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
