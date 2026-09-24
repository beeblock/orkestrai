import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Workbench layout and search', () => {
  test('creates eight recursive panes and keeps Canvas navigation client-side', async ({ page, request }) => {
    const runId = Date.now();
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E eight panes ${runId}`, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const noteResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'note',
        title: `Eight panes note ${runId}`,
        x: 100,
        y: 100,
        width: 360,
        height: 260,
        payload: { content: 'Nested layout' },
      },
    });
    const note = (await noteResponse.json()).data as { id: string };

    try {
      await page.goto(`/terminal?workspace=${workspace.id}&node=${note.id}`);
      await expect(page.getByTestId('workbench-pane-primary')).toBeVisible();

      for (let index = 0; index < 7; index += 1) {
        await page.getByTestId(index % 2 === 0 ? 'workbench-split-right' : 'workbench-split-down').click();
      }
      await expect(page.locator('section[data-pane-id]')).toHaveCount(8);
      await expect(page.getByTestId('workbench-pane-count')).toHaveText('8/8');
      await expect(page.getByTestId('workbench-pane-count')).toHaveAttribute('title', /8/);
      await expect(page.getByTestId('workbench-split-right')).toBeDisabled();
      await expect(page.getByTestId('workbench-split-down')).toBeDisabled();
      await expect(page.getByTestId('workbench-usage-footer')).toBeVisible();

      await page.reload();
      await expect(page.locator('section[data-pane-id]')).toHaveCount(8);
      await expect(page).toHaveURL(new RegExp(`workspace=${workspace.id}.*pane=`));

      await page.evaluate(() => ((window as Window & { workbenchMarker?: string }).workbenchMarker = 'alive'));
      await page.getByRole('link', { name: 'Canvas' }).click();
      await expect(page).toHaveURL(new RegExp(`/canvas\\?workspace=${workspace.id}`));
      await expect.poll(() => page.evaluate(() => (window as Window & { workbenchMarker?: string }).workbenchMarker)).toBe('alive');
      await page.getByRole('link', { name: 'Workbench' }).click();
      await expect(page.locator('section[data-pane-id]')).toHaveCount(8);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('opens a tree item in the pane it is dropped on', async ({ page, request }) => {
    const runId = Date.now();
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E tree drop ${runId}`, workingDir: '/tmp' },
    })).json()).data as { id: string };
    const root = `/api/agent-room/workspaces/${workspace.id}/nodes`;
    const opened = (await (await request.post(root, {
      data: { type: 'note', title: `Open note ${runId}`, x: 100, y: 100, width: 360, height: 260, payload: { content: 'Already open' } },
    })).json()).data as { id: string };
    const droppedTitle = `Dropped note ${runId}`;
    await request.post(root, {
      data: { type: 'note', title: droppedTitle, x: 520, y: 100, width: 360, height: 260, payload: { content: 'Opened by drag' } },
    });

    try {
      await page.goto(`/terminal?workspace=${workspace.id}&node=${opened.id}`);
      await page.getByTestId('workbench-split-right').click();
      const panes = page.locator('section[data-pane-id]');
      await expect(panes).toHaveCount(2);
      const target = panes.nth(1);
      await expect(target).not.toContainText(droppedTitle);

      // Arrastar a linha da árvore até um painel abre o item ali.
      await page.locator('.wb-row').filter({ hasText: droppedTitle }).dragTo(target);
      await expect(target).toContainText(droppedTitle);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('finds a newly created artifact through the global palette', async ({ page, request }) => {
    const runId = Date.now();
    const title = `Universal note ${runId}`;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E universal search ${runId}`, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const noteResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'note',
        title,
        x: 100,
        y: 100,
        width: 360,
        height: 260,
        payload: { content: 'Searchable preview content' },
      },
    });
    const note = (await noteResponse.json()).data as { id: string };

    try {
      await page.goto(`/terminal?workspace=${workspace.id}&node=${note.id}`);
      await expect(page.getByTestId('workbench-pane-primary')).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('orkestrai:global-search')));
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').fill(title);
      const result = dialog.getByRole('option').filter({ hasText: title });
      await expect(result).toBeVisible();
      await expect(dialog).toContainText('Searchable preview content');
      await result.click();
      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}.*node=${note.id}`));
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('opens a workspace file from the global palette without creating a canvas node', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-workbench-palette-'));
    const fileName = `palette-${Date.now()}.ts`;
    writeFileSync(join(dir, fileName), 'export const openedFromPalette = true;\n');
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E palette file ${Date.now()}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      await expect(page.getByRole('application')).toBeVisible();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('combobox').fill(fileName);
      const result = dialog.getByRole('option').filter({ hasText: fileName });
      await expect(result).toBeVisible();
      await result.click();

      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}`));
      const fileView = page.getByTestId('workbench-file-view');
      await expect(fileView.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
      await expect(fileView).toContainText('text/typescript');
      const nodesResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`);
      const nodes = (await nodesResponse.json()).data as Array<{ type: string }>;
      expect(nodes.some((node) => node.type === 'editor')).toBe(false);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('hands a file from the Canvas tree directly to the Workbench', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-canvas-file-handoff-'));
    const fileName = `canvas-handoff-${Date.now()}.ts`;
    writeFileSync(join(dir, fileName), 'export const openedFromCanvas = true;\n');
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E Canvas file handoff ${Date.now()}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'fileTree',
        title: 'Workspace files',
        x: 100,
        y: 100,
        width: 420,
        height: 360,
        payload: { path: dir },
      },
    });
    const fileTree = (await nodeResponse.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}&node=${fileTree.id}`);
      const fileButton = page.getByRole('button', { name: fileName, exact: true });
      await expect(fileButton).toBeVisible();
      await fileButton.dblclick();

      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}`));
      const fileView = page.getByTestId('workbench-file-view');
      await expect(fileView.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
      await expect(fileView.locator('.view-lines')).toContainText('openedFromCanvas');
      const nodesResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`);
      const nodes = (await nodesResponse.json()).data as Array<{ type: string }>;
      expect(nodes.filter((node) => node.type === 'editor')).toEqual([]);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
