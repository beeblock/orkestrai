import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('image actions prepare traceable drafts through the visible editor', async ({ page, request }) => {
  test.setTimeout(120000);
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-actions-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Creative actions verification', workingDir: folder } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const original = await readFile('electron/resources/icons/512x512.png'); await writeFile(join(folder, 'source.png'), original);
    const node = (await (await request.post(`${base}/nodes`, { data: { type: 'image', title: 'Original', payload: { path: 'source.png' } } })).json()).data;
    await page.setViewportSize({ width: 1280, height: 800 });
    for (const operation of ['Variation', 'Remove background', 'Change region', 'Animate']) {
      await page.goto(`/terminal?workspace=${workspaceId}&node=${node.id}`);
      await page.getByRole('button', { name: 'Creative actions', exact: true }).click();
      const dialog = page.getByTestId('creative-asset-actions');
      await dialog.getByRole('radio', { name: operation, exact: true }).click();
      await expect(dialog.getByRole('radio', { name: operation, exact: true })).toHaveAttribute('aria-checked', 'true');
      if (operation !== 'Remove background') await dialog.getByRole('textbox').fill('A calm green variation.');
      if (operation === 'Change region') {
        const region = dialog.getByRole('button', { name: 'Edit region', exact: true });
        const box = (await region.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3); await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.8); await page.mouse.up();
        await page.screenshot({ path: '/tmp/orkestrai-creative-actions-region.png' });
      }
      const responsePromise = page.waitForResponse(response => response.url().endsWith('/creative-media/assets') && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Prepare draft', exact: true }).click();
      const response = await responsePromise; expect(response.ok()).toBe(true);
      const result = (await response.json()).data;
      await expect(dialog).not.toBeVisible();
      const nodes = (await (await request.get(`${base}/nodes`)).json()).data;
      const created = nodes.find((item: { id: string }) => item.id === result.nodeId);
      expect(created.type).toBe(operation === 'Animate' ? 'videoWorkflow' : 'imageWorkflow');
      expect(created.payload.creativeOrigin.sourceNodeId).toBe(node.id);
      if (operation === 'Change region') expect(created.payload.prompt).toContain('width=256');
      if (operation === 'Remove background') expect(created.payload.transparentBackground).toBe(true);
      expect(await readFile(join(folder, 'source.png'))).toEqual(original);
    }
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) expect.soft((await request.delete(`/api/agent-room/workspaces/${workspaceId}`)).ok()).toBe(true);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(folder, { recursive: true, force: true });
  }
});
