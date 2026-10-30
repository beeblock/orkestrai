import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Camp transfers the complete bag and stash despite filters, with controls that fit both themes', async ({ page, request }, testInfo) => {
  test.setTimeout(60_000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-adventure-storage-'));
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId: string | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    expect((await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en' } })).ok()).toBe(true);
    const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Adventure storage', workingDir: dir } });
    expect(created.ok()).toBe(true);
    workspaceId = (await created.json()).data.id;
    const node = await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
      data: { type: 'terminal', title: 'Storage Maestro', x: 0, y: 0, width: 400, height: 300,
        payload: { command: 'true', args: [], maestro: true, provider: 'claude' } },
    });
    expect(node.ok()).toBe(true);
    const base = `/api/agent-room/workspaces/${workspaceId}/adventure`;
    const initial = (await (await request.get(base)).json()).data.snapshot;
    expect((await request.post(`${base}/actions`, { data: { type: 'settings', settings: { autoOpen: false, autoSalvage: 'off' } } })).ok()).toBe(true);
    for (const hero of initial.heroes) expect((await request.post(`${base}/actions`, { data: { type: 'auto-gear', heroId: hero.id, enabled: false } })).ok()).toBe(true);
    expect((await request.post(`${base}/report`, { data: {
      reportId: 'storage-e2e', elapsedMs: 5_000, position: { difficulty: 'normal', act: 1, stage: 1 }, wave: 0,
      xp: {}, gold: 0, kills: { 'bug-beetle': 1 }, bosses: [], stages: [],
      chests: [{ tier: 'blue', level: 1, difficulty: 'normal', act: 1 }],
    } })).ok()).toBe(true);
    const opened = await request.post(`${base}/actions`, { data: { type: 'open-chests', tier: 'blue' } });
    expect(opened.ok()).toBe(true);
    const items = (await opened.json()).data.snapshot.items.filter((item: { location: string }) => item.location === 'inventory');
    expect(items).toHaveLength(2);

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/adventure/camp?workspace=${workspaceId}&tab=inventory`);
    const move = page.getByTestId('camp-move-all');
    await expect(move).toHaveText('Store all');
    // Filters must never silently turn "all" into only the currently visible items.
    await page.getByLabel('Filter by rarity').selectOption('cosmic');
    await expect(move).toBeEnabled();
    await move.click();
    await expect(page.getByTestId('camp-transfer-summary')).toContainText('Stored 2 items. Not moved: 0.');
    const stored = (await (await request.get(base)).json()).data.snapshot;
    expect(stored.items.filter((item: { location: string }) => item.location === 'stash').map((item: { id: string }) => item.id).sort()).toEqual(items.map((item: { id: string }) => item.id).sort());
    await expect(move).toBeDisabled();
    await page.getByRole('radio', { name: /^Stash / }).click();
    await expect(move).toHaveText('Withdraw all');
    await move.click();
    await expect(page.getByTestId('camp-transfer-summary')).toContainText('Withdrew 2 items. Not moved: 0.');
    const withdrawn = (await (await request.get(base)).json()).data.snapshot;
    expect(withdrawn.items.filter((item: { location: string }) => item.location === 'inventory').map((item: { id: string }) => item.id).sort()).toEqual(items.map((item: { id: string }) => item.id).sort());
    await page.getByRole('radio', { name: /^Bag / }).click();
    await page.getByLabel('Filter by rarity').selectOption('');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
      await expect(move).toBeInViewport();
      const box = await move.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(1024);
      await page.screenshot({ path: testInfo.outputPath(`adventure-storage-${theme}.png`), fullPage: true, animations: 'disabled' });
    }
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: original });
    rmSync(dir, { recursive: true, force: true });
  }
});
