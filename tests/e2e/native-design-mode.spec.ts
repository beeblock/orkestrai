import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Native Design Mode', () => {
  test('audits quality, confirms templates, and keeps an automatic backup', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-quality-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design quality ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Quality review', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const imageId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [{
          kind: 'create',
          element: { id: imageId, pageId: initial.activePageId, parentId: null, type: 'image', name: 'Hero image', x: 80, y: 80, width: 320, height: 200 },
        }],
        summary: 'Seed unlabeled image',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });

    try {
      const quality = (await (await request.get(
        `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/quality`,
      )).json()).data as { report: { issues: Array<{ rule: string; elementId: string }> } };
      expect(quality.report.issues).toContainEqual(expect.objectContaining({ rule: 'accessibility', elementId: imageId }));

      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      await editor.getByRole('button', { name: 'Open quality and history', exact: true }).click();
      const qualityDrawer = page.getByTestId('design-quality-drawer');
      await expect(qualityDrawer.getByRole('heading', { name: 'Design quality' })).toBeVisible();
      await expect(qualityDrawer.getByText('Accessibility metadata', { exact: true })).toBeVisible();

      await qualityDrawer.getByRole('button', { name: 'Product dashboard', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByRole('heading', { name: 'Apply template' })).toBeVisible();
      const applied = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/designs/${node.id}/quality`));
      await dialog.getByRole('button', { name: 'Apply template', exact: true }).click();
      await applied;

      const current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        elements: Array<{ id: string }>;
      };
      expect(current.elements.some((element) => element.id === imageId)).toBe(true);
      expect(current.elements.length).toBeGreaterThan(10);
      const maintenance = (await (await request.get(
        `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/quality`,
      )).json()).data as { maintenance: { backupRevision: number | null } };
      expect(maintenance.maintenance.backupRevision).toBe(1);
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('draws freely and keeps layer deletion isolated from Canvas', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E native design ${Date.now()}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Interface draft', x: 120, y: 120, width: 720, height: 520, payload: {} },
    });
    const node = (await nodeResponse.json()).data as { id: string };
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      await expect(page.locator('[data-testid="canvas-design-mode"]')).toBeVisible();
      await page.getByRole('button', { name: 'Rectangle', exact: true }).click();

      const pageSvg = page.locator('svg[role="application"]');
      const bounds = await pageSvg.boundingBox();
      expect(bounds).not.toBeNull();
      const start = { x: bounds!.x + bounds!.width * 0.55, y: bounds!.y + bounds!.height * 0.55 };
      const end = { x: start.x + 135, y: start.y + 72 };
      const created = page.waitForResponse((response) => (
        response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`)
      ));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();
      await created;

      await expect(page.getByRole('textbox', { name: 'W', exact: true })).not.toHaveValue('180');
      await expect(page.getByRole('textbox', { name: 'H', exact: true })).not.toHaveValue('120');
      const afterCreate = (await (await request.get(
        `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`,
      )).json()).data as { elements: unknown[] };
      expect(afterCreate.elements).toHaveLength(1);

      const deleted = page.waitForResponse((response) => (
        response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`)
      ));
      await page.keyboard.press('Delete');
      await deleted;

      await expect(page.locator('[data-testid="canvas-design-mode"]')).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      const afterDelete = (await (await request.get(
        `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`,
      )).json()).data as { elements: unknown[] };
      expect(afterDelete.elements).toHaveLength(0);
      expect(pageErrors).toEqual([]);
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('combines vectors, draws paths, imports assets, exports, and caches its preview', async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-phase2-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design phase 2 ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Vector system', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const firstId = randomUUID();
    const secondId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: firstId, pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Rectangle A', x: 220, y: 220, width: 220, height: 160 } },
          { kind: 'create', element: { id: secondId, pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Rectangle B', x: 340, y: 280, width: 220, height: 160 } },
        ],
        summary: 'Seed boolean layers',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      await expect(editor).toBeVisible();

      const penButton = editor.getByRole('button', { name: 'Pen', exact: true });
      await penButton.hover();
      const penTooltip = page.locator('[data-slot="tooltip-content"]').filter({ hasText: 'Click for corners' });
      await expect(penTooltip).toBeVisible();
      expect(await penTooltip.evaluate((element) => Number(getComputedStyle(element).zIndex))).toBeGreaterThan(70);

      await editor.getByRole('button', { name: 'Rectangle A', exact: true }).click();
      await editor.getByRole('button', { name: 'Rectangle B', exact: true }).click({ modifiers: ['Shift'] });
      await editor.getByRole('button', { name: 'Boolean operation', exact: true }).click();
      const booleanMenu = page.getByRole('menu');
      await expect(booleanMenu).toBeVisible();
      expect(await booleanMenu.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 8);
        return Boolean(top && (top === element || element.contains(top)));
      })).toBe(true);
      const combined = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('menuitem', { name: 'Union', exact: true }).click();
      await combined;

      let current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        revision: number;
        elements: Array<{ id: string; type: string; width: number; height: number; text: string; pathSubpaths: unknown[][]; pathPoints: Array<{ inX: number | null; outX: number | null }> }>;
        guides: unknown[];
        assets: unknown[];
      };
      expect(current.elements).toHaveLength(1);
      expect(current.elements[0].type).toBe('path');
      expect(current.elements[0].pathSubpaths[0].length).toBeGreaterThan(3);

      await penButton.click();
      const pageSvg = editor.locator('svg[role="application"]');
      const svgBounds = await pageSvg.boundingBox();
      const viewportBounds = await editor.locator('main').boundingBox();
      expect(svgBounds).not.toBeNull();
      expect(viewportBounds).not.toBeNull();
      const bounds = {
        x: Math.max(svgBounds!.x, viewportBounds!.x),
        y: Math.max(svgBounds!.y, viewportBounds!.y),
        width: Math.min(svgBounds!.x + svgBounds!.width, viewportBounds!.x + viewportBounds!.width) - Math.max(svgBounds!.x, viewportBounds!.x),
        height: Math.min(svgBounds!.y + svgBounds!.height, viewportBounds!.y + viewportBounds!.height) - Math.max(svgBounds!.y, viewportBounds!.y),
      };
      expect(bounds.width).toBeGreaterThan(240);
      expect(bounds.height).toBeGreaterThan(180);
      const curveStart = { x: bounds.x + bounds.width * 0.28, y: bounds.y + bounds.height * 0.28 };
      await page.mouse.move(curveStart.x, curveStart.y);
      await page.mouse.down();
      await page.mouse.move(curveStart.x + 34, curveStart.y - 22, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(80);
      await page.mouse.click(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.42);
      await page.waitForTimeout(80);
      await page.mouse.click(bounds.x + bounds.width * 0.44, bounds.y + bounds.height * 0.64);
      const pathCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.keyboard.press('Enter');
      await pathCreated;

      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      const editablePath = current.elements.find((element) => element.type === 'path' && element.pathPoints.length > 0)!;
      expect(editablePath.pathPoints[0].outX).not.toBeNull();
      await editor.getByRole('button', { name: 'Anchor 1', exact: true }).click();
      const handle = editor.getByRole('button', { name: 'Outgoing handle 1', exact: true });
      await expect(handle).toBeVisible();
      const handleBounds = await handle.boundingBox();
      expect(handleBounds).not.toBeNull();
      const handleMoved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.mouse.move(handleBounds!.x + handleBounds!.width / 2, handleBounds!.y + handleBounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(handleBounds!.x + handleBounds!.width / 2 + 24, handleBounds!.y + handleBounds!.height / 2 + 12, { steps: 5 });
      await page.mouse.up();
      await handleMoved;

      const properties = editor.locator('aside').last();
      const madeCorner = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await properties.getByRole('button', { name: 'Corner', exact: true }).click();
      await madeCorner;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.find((element) => element.id === editablePath.id)!.pathPoints[0]).toMatchObject({ inX: null, outX: null });

      const madeSmooth = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await properties.getByRole('button', { name: 'Mirrored', exact: true }).click();
      await madeSmooth;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      const beforeInsert = current.elements.find((element) => element.id === editablePath.id)!.pathPoints.length;
      const pointAdded = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await properties.getByRole('button', { name: 'Add point', exact: true }).click();
      await pointAdded;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.find((element) => element.id === editablePath.id)!.pathPoints).toHaveLength(beforeInsert + 1);
      const pointDeleted = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await properties.getByRole('button', { name: 'Delete point', exact: true }).click();
      await pointDeleted;

      await page.keyboard.press('Escape');
      await expect(editor.getByRole('button', { name: 'Anchor 1', exact: true })).toHaveCount(0);
      await expect(properties.getByRole('button', { name: 'Edit vector', exact: true })).toBeVisible();
      const resizeHandle = editor.getByRole('button', { name: 'Resize handle se', exact: true });
      const resizeBounds = await resizeHandle.boundingBox();
      expect(resizeBounds).not.toBeNull();
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      const widthBeforeResize = current.elements.find((element) => element.id === editablePath.id)!.width;
      const resized = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.mouse.move(resizeBounds!.x + resizeBounds!.width / 2, resizeBounds!.y + resizeBounds!.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeBounds!.x + resizeBounds!.width / 2 + 36, resizeBounds!.y + resizeBounds!.height / 2 + 18, { steps: 6 });
      await page.mouse.up();
      await resized;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.find((element) => element.id === editablePath.id)!.width).toBeGreaterThan(widthBeforeResize);

      const textCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await editor.getByRole('button', { name: 'Text', exact: true }).click();
      await page.mouse.click(bounds.x + bounds.width * 0.32, bounds.y + bounds.height * 0.72);
      await textCreated;
      await page.keyboard.press('Enter');
      const textEditor = editor.locator('[data-design-text-editor]');
      await expect(textEditor).toBeVisible();
      await textEditor.fill('Design text edited on canvas');
      const textSaved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await textEditor.press('Control+Enter');
      await textSaved;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      const editedText = current.elements.find((element) => element.type === 'text' && element.text === 'Design text edited on canvas');
      expect(editedText?.height).toBeGreaterThan(48);

      await editor.getByRole('button', { name: 'Rulers and guides', exact: true }).click();
      const guideCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('menuitem', { name: 'Add vertical guide', exact: true }).click();
      await guideCreated;

      const assetImported = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/designs/${node.id}/assets`));
      const imageCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await editor.locator('input[type="file"]').setInputFiles({
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
      });
      await assetImported;
      await imageCreated;

      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.filter((element) => element.type === 'path')).toHaveLength(2);
      expect(current.elements.some((element) => element.type === 'image')).toBe(true);
      expect(current.guides).toHaveLength(1);
      expect(current.assets).toHaveLength(1);

      await editor.getByRole('button', { name: 'Export', exact: true }).click();
      const download = page.waitForEvent('download');
      await page.getByRole('menuitem', { name: 'Export SVG', exact: true }).click();
      const exported = await download;
      expect(exported.suggestedFilename()).toMatch(/\.svg$/);
      const exportedSvg = readFileSync((await exported.path())!, 'utf8');
      expect(exportedSvg).not.toContain('data-design-ui');
      expect(exportedSvg).not.toContain('data-design-hit');

      await expect.poll(async () => (await request.get(
        `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/thumbnail?revision=${current.revision}`,
      )).status(), { timeout: 10_000 }).toBe(200);
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('pastes SVG as editable vectors and supports color-wide edits and grouping', async ({ page, request, context }) => {
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-svg-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E SVG vectors ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'SVG vectors', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 140">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#6633ff" />
        </radialGradient>
      </defs>
      <style>.brand { fill: #ff0066; stroke: #202020; stroke-width: 2; }</style>
      <g transform="translate(12 10)">
        <rect id="logo-card" class="brand" x="0" y="0" width="100" height="80" rx="16" />
        <path id="logo-curve" class="brand" transform="translate(112 4) rotate(8 50 40)" d="M4 68 C20 4 76 4 96 68 A44 28 0 0 1 4 68 Z" />
        <circle id="logo-glow" cx="250" cy="40" r="36" fill="url(#glow)" />
      </g>
    </svg>`;
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      await expect(editor).toBeVisible();
      await editor.locator('main').click({ position: { x: 20, y: 20 } });
      const imported = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.evaluate((source) => {
        const data = new DataTransfer();
        data.setData('text/plain', source);
        window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      }, svg);
      await imported;

      let current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        revision: number;
        assets: unknown[];
        elements: Array<{ id: string; parentId: string | null; type: string; name: string; fills: Array<{ type: string; color?: string }>; pathPoints: unknown[] }>;
      };
      expect(current.assets).toHaveLength(0);
      expect(current.elements.map((element) => element.type).sort()).toEqual(['group', 'group', 'path', 'path', 'path']);
      expect(current.elements.filter((element) => element.type === 'path').every((element) => element.pathPoints.length > 2)).toBe(true);
      const importedGroups = current.elements.filter((element) => element.type === 'group');
      expect(importedGroups.find((element) => element.parentId !== null)?.parentId).toBe(importedGroups.find((element) => element.parentId === null)?.id);
      expect(current.elements.filter((element) => element.type === 'path').every((element) => element.parentId === importedGroups.find((group) => group.parentId !== null)?.id)).toBe(true);
      expect(current.elements.find((element) => element.name === 'logo-glow')?.fills[0]).toMatchObject({
        type: 'radial-gradient', centerX: 0.5, centerY: 0.5, radius: 0.5,
      });

      await editor.getByRole('button', { name: 'logo-card', exact: true }).click();
      await editor.getByRole('button', { name: 'Color tools', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Select all with the same fill', exact: true }).click();
      await expect(editor.getByText('2 layers', { exact: true })).toBeVisible();

      const grouped = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await editor.getByRole('button', { name: 'Group selection', exact: true }).first().click();
      await grouped;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      const nestedGroup = current.elements.find((element) => element.type === 'group' && element.name.startsWith('Group'))!;
      expect(current.elements.filter((element) => element.parentId === nestedGroup.id)).toHaveLength(2);

      const ungrouped = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await editor.getByRole('button', { name: 'Ungroup selection', exact: true }).first().click();
      await ungrouped;

      await editor.getByRole('button', { name: 'logo-card', exact: true }).click();
      await editor.getByRole('button', { name: /#FF0066 in 2 layers/ }).click();
      await page.getByRole('textbox', { name: 'Replacement color', exact: true }).fill('#00aa88');
      const recolored = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('button', { name: 'Replace all 2', exact: true }).click();
      await recolored;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.filter((element) => ['logo-card', 'logo-curve'].includes(element.name)).every((element) => element.fills.some((paint) => paint.type === 'solid' && paint.color === '#00aa88'))).toBe(true);
      expect(current.elements.find((element) => element.name === 'logo-glow')?.fills[0]?.type).toBe('radial-gradient');

      await editor.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy selection as SVG', exact: true }).click();
      await expect(page.getByText('Selection copied as SVG.', { exact: true })).toBeVisible();
      await editor.getByRole('button', { name: 'Export', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Copy selection as PNG', exact: true }).click();
      await expect(page.getByText('Selection copied as PNG.', { exact: true })).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('manages variable modes and binds tokens through the visible editor UI', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-variables-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design variables ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Design system', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as { revision: number; activePageId: string };
    const collectionId = randomUUID();
    const lightModeId = randomUUID();
    const darkModeId = randomUUID();
    const variableId = randomUUID();
    const rectangleId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'add-variable-collection', collection: { id: collectionId, name: 'Brand', modes: [{ id: lightModeId, name: 'Light' }, { id: darkModeId, name: 'Dark' }], defaultModeId: lightModeId, order: 0 } },
          { kind: 'add-variable', variable: { id: variableId, collectionId, name: 'Primary', type: 'color', description: 'Primary action', values: { [lightModeId]: { kind: 'color', value: '#2255ee' }, [darkModeId]: { kind: 'color', value: '#88aaff' } }, order: 0 } },
          { kind: 'create', element: { id: rectangleId, pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Token button', x: 240, y: 220, width: 240, height: 96, variableBindings: { fill: variableId } } },
        ],
        summary: 'Seed design system',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      await expect(editor).toBeVisible();
      const rendered = editor.locator(`[data-design-element="${rectangleId}"] > rect`).first();
      await expect(rendered).toHaveAttribute('fill', '#2255ee');

      await editor.getByRole('button', { name: 'Variables', exact: true }).click();
      await expect(editor.getByLabel('Collection name')).toHaveValue('Brand');
      await expect(editor.getByText('Primary', { exact: true })).toBeVisible();
      const modeChanged = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await editor.getByLabel('Active mode', { exact: true }).selectOption(darkModeId);
      await modeChanged;
      await expect(rendered).toHaveAttribute('fill', '#88aaff');

      await editor.getByRole('button', { name: 'Layers', exact: true }).click();
      await editor.getByRole('button', { name: 'Token button', exact: true }).click();
      const binding = editor.getByRole('combobox', { name: 'Bind Fill to a variable' });
      await expect(binding).toContainText('Brand / Primary');
      await binding.click();
      const unbound = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('option', { name: 'Not bound', exact: true }).click();
      await unbound;
      let current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as { elements: Array<{ id: string; variableBindings: Record<string, string> }> };
      expect(current.elements.find((element) => element.id === rectangleId)?.variableBindings.fill).toBeUndefined();

      await binding.click();
      await page.getByPlaceholder('Search variables...').fill('Primary');
      const rebound = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('option', { name: 'Brand / Primary', exact: true }).click();
      await rebound;
      current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
      expect(current.elements.find((element) => element.id === rectangleId)?.variableBindings.fill).toBe(variableId);
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('keeps multi-frame work sharp, framed, and free from nested label noise', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-legibility-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design legibility ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Todo responsive UI', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const desktopId = randomUUID();
    const nestedFrameId = randomUUID();
    const mobileId = randomUUID();
    const seeded = (await (await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: desktopId, pageId: initial.activePageId, parentId: null, type: 'frame', name: 'Todo / Desktop', x: 80, y: 80, width: 1440, height: 900, fill: '#ffffff' } },
          { kind: 'create', element: { id: nestedFrameId, pageId: initial.activePageId, parentId: desktopId, type: 'frame', name: 'Internal task list', x: 320, y: 220, width: 880, height: 560, fill: '#f8fafc' } },
          { kind: 'create', element: { id: randomUUID(), pageId: initial.activePageId, parentId: nestedFrameId, type: 'text', name: 'Todo title', x: 368, y: 268, width: 420, height: 56, text: 'Today', fontSize: 40, fontWeight: 700 } },
          { kind: 'create', element: { id: mobileId, pageId: initial.activePageId, parentId: null, type: 'frame', name: 'Todo / Mobile', x: 1600, y: 80, width: 390, height: 844, fill: '#ffffff' } },
        ],
        summary: 'Seed responsive Todo frames',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    })).json()).data as { revision: number };
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      await expect(editor).toBeVisible();
      const frameLabels = editor.locator('[data-design-frame-label]');
      await expect(frameLabels).toHaveCount(2);
      await expect(frameLabels).toHaveText(['Todo / Desktop', 'Todo / Mobile']);
      const desktopBounds = await editor.locator(`[data-design-element="${desktopId}"]`).boundingBox();
      expect(desktopBounds?.width).toBeGreaterThan(500);

      const thumbnailUrl = `/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/thumbnail?revision=${seeded.revision}`;
      await expect.poll(async () => (await request.get(thumbnailUrl)).status(), { timeout: 10_000 }).toBe(200);
      const thumbnailSize = await page.evaluate(async (url) => {
        const bitmap = await createImageBitmap(await (await fetch(url)).blob());
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return size;
      }, thumbnailUrl);
      expect(Math.max(thumbnailSize.width, thumbnailSize.height)).toBeGreaterThan(640);
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('builds reusable components, token presets, code links, and a local library through the visible UI', async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-system-e2e-'));
    writeFileSync(join(dir, 'app.css'), ':root { --color-brand: #3366ee; --space-control: 12px; }');
    writeFileSync(join(dir, 'Button.svelte'), '<script lang="ts">let { label, disabled = false } = $props<{ label: string; disabled?: boolean }>();</script><button {disabled}>{label}</button>');
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design system ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Product foundations', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as { revision: number; activePageId: string };
    const rootId = randomUUID();
    const textId = randomUUID();
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: rootId, pageId: initial.activePageId, parentId: null, type: 'frame', name: 'Button source', x: 180, y: 180, width: 220, height: 64, fill: '#3366ee' } },
          { kind: 'create', element: { id: textId, pageId: initial.activePageId, parentId: rootId, type: 'text', name: 'Label', x: 210, y: 200, width: 160, height: 24, text: 'Continue' } },
        ],
        summary: 'Seed component source',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      const sidebar = editor.locator('aside').first();
      await expect(editor).toBeVisible();

      await sidebar.getByRole('button', { name: 'Button source', exact: true }).click();
      await sidebar.getByRole('button', { name: 'Components', exact: true }).click();
      const componentCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await sidebar.getByRole('button', { name: 'Create component', exact: true }).click();
      await componentCreated;
      await expect(sidebar.getByText('Button source', { exact: true })).toBeVisible();

      const instanceCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await sidebar.getByRole('button', { name: 'Create instance', exact: true }).click();
      await instanceCreated;

      await sidebar.getByRole('button', { name: 'Layers', exact: true }).click();
      await sidebar.getByTestId(`design-layer-${textId}`).getByRole('button', { name: 'Label', exact: true }).click();
      await sidebar.getByRole('button', { name: 'Components', exact: true }).click();
      const exposeProperty = sidebar.getByRole('button', { name: 'Expose property', exact: true });
      await expect(exposeProperty).toBeEnabled();
      await exposeProperty.click();
      const propertyCreated = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('menuitem', { name: 'Text', exact: true }).click();
      await propertyCreated;

      await sidebar.getByRole('button', { name: 'Variables', exact: true }).click();
      await sidebar.getByRole('button', { name: 'Token presets', exact: true }).click();
      const presetAdded = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await page.getByRole('menuitem', { name: 'Product foundation', exact: true }).click();
      await presetAdded;
      await expect(sidebar.getByLabel('Collection name')).toHaveValue('Product foundation');

      const inspector = editor.getByTestId('design-right-panel');
      await inspector.getByRole('button', { name: 'Inspect', exact: true }).click();
      await inspector.getByRole('button', { name: 'Code', exact: true }).click();
      await expect(inspector.getByText('app.css', { exact: true })).toBeVisible();
      const componentLinked = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
      await inspector.getByRole('button', { name: /Button.*Button\.svelte/ }).click();
      await componentLinked;
      await expect(inspector.getByText('Connected', { exact: true })).toBeVisible();

      await sidebar.getByRole('button', { name: 'Components', exact: true }).click();
      await sidebar.getByRole('button', { name: 'Libraries', exact: true }).click();
      const published = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/designs/${node.id}/libraries`));
      await sidebar.getByRole('button', { name: 'Publish library', exact: true }).click();
      await published;
      await expect(sidebar.getByRole('button', { name: 'Update library', exact: true })).toBeVisible();

      const current = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        components: Array<{ id: string; codeConnect: { path: string } | null; properties: unknown[] }>;
        variableCollections: unknown[];
        variables: unknown[];
        elements: Array<{ instanceOf: string | null }>;
      };
      expect(current.components[0].properties).toHaveLength(1);
      expect(current.components[0].codeConnect?.path).toBe('Button.svelte');
      expect(current.variableCollections).toHaveLength(1);
      expect(current.variables.length).toBeGreaterThan(8);
      expect(current.elements.some((element) => element.instanceOf === current.components[0].id)).toBe(true);
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
