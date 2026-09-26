import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('partial deletion keeps failed nodes and their edges visible and consistent after reload', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-delete-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'E2E deletion parity', workingDir: folder } });
  expect(created.ok()).toBeTruthy();
  const workspace = (await created.json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const ids: string[] = [];
    for (const [index, title] of ['Delete succeeds', 'Delete fails', 'Keep connected'].entries()) {
      const response = await request.post(`${base}/nodes`, { data: { type: 'note', title, x: 80 + index * 370, y: 120, width: 320, height: 220, payload: { content: '' } } });
      expect(response.ok()).toBeTruthy();
      ids.push((await response.json()).data.id);
    }
    const edge = await request.post(`${base}/edges`, { data: { sourceNodeId: ids[1], targetNodeId: ids[2] } });
    expect(edge.ok()).toBeTruthy();
    await page.route(`**${base}/nodes/${ids[1]}`, async route => {
      if (route.request().method() === 'DELETE') await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Simulated deletion conflict' }) });
      else await route.continue();
    });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const node = (id: string) => page.locator(`.svelte-flow__node[data-id="${id}"]`);
    await expect(node(ids[0])).toBeVisible();
    await node(ids[0]).locator('.node-header').click();
    await node(ids[1]).locator('.node-header').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.svelte-flow__node.selected')).toHaveCount(2);
    await page.keyboard.press('Delete');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Apagar 2 nó');
    await dialog.getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(node(ids[0])).toHaveCount(0);
    await expect(node(ids[1])).toBeVisible();
    await expect(page.getByText('Não foi possível apagar 1 nó(s).', { exact: false })).toBeVisible();
    expect((await (await request.get(`${base}/nodes`)).json()).data.map((item: { id: string }) => item.id).sort()).toEqual(ids.slice(1).sort());
    expect((await (await request.get(`${base}/edges`)).json()).data).toHaveLength(1);
    await page.reload();
    await expect(node(ids[0])).toHaveCount(0);
    await expect(node(ids[1])).toBeVisible();
    await page.unroute(`**${base}/nodes/${ids[1]}`);
    await node(ids[1]).locator('.node-header').click();
    await page.keyboard.press('Delete');
    await dialog.getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(node(ids[1])).toHaveCount(0);
    expect((await (await request.get(`${base}/edges`)).json()).data).toHaveLength(0);
    await expect(node(ids[2])).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await request.delete(base);
    await rm(folder, { recursive: true, force: true });
  }
});
