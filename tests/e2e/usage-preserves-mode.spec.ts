import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const copy = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8'));

test('header usage opens over Conversation, Bots and Focus without visiting Canvas', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-usage-modes-'));
  const response = await request.post('/api/agent-room/workspaces', { data: { name: 'Usage modes QA', workingDir: root } });
  expect(response.ok()).toBe(true);
  const workspace = (await response.json()).data;
  try {
    await page.route(/\/api\/agent-room\/usage(?:\?.*)?$/, route => route.fulfill({ json: { data: [{
      provider: 'claude', plan: null, windows: [{ kind: '5h', label: '5 hours', usedPercent: 37, resetsAt: null }],
      error: null, fetchedAt: new Date().toISOString(),
    }] } }));
    for (const mode of ['chat', 'bots', 'terminal']) {
      await page.goto(`/${mode}?workspace=${workspace.id}`);
      await expect(page).toHaveURL(new RegExp(`/${mode}\\?`));
      // Focus selects its initial entry asynchronously and records it in the URL.
      // Capture that settled selection so the assertion isolates the Usage click.
      if (mode === 'terminal') await expect(page).toHaveURL(/[?&]node=/);
      const original = page.url();
      await page.getByTestId('topbar-usage').click();
      const drawer = page.getByTestId('global-usage-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer).toContainText(copy['usage.title']);
      expect(page.url()).toBe(original);
      expect(await page.evaluate(() => sessionStorage.getItem('orkestrai.menu-action'))).not.toBe('usage');
      await drawer.getByRole('button', { name: copy['usage.close'], exact: true }).click();
      await expect(drawer).not.toBeVisible();
      expect(page.url()).toBe(original);
    }
  } finally { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); await rm(root, { recursive: true, force: true }); }
});
