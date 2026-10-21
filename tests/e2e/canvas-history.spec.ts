import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Going back through history (back button, swipe, Cmd+[) from Settings must reopen the Canvas.
test('history back from Settings reopens the Canvas', async ({ page, request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-history-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E history ${Date.now()}`, workingDir: dir } })).json()).data;
  try {
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'note', title: 'Âncora', x: 0, y: 0, width: 300, height: 220, payload: { content: 'anchor' } } });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.svelte-flow__node-note')).toHaveCount(1);
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await expect(page).toHaveURL(/\/settings/);
    await page.evaluate(() => history.back());
    await expect(page).toHaveURL(/\/canvas/);
    await expect(page.locator('.svelte-flow__node-note')).toHaveCount(1, { timeout: 8_000 });
    await expect(page).toHaveTitle(/Canvas/);
  } finally {
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});
