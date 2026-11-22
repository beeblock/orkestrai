import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const copy = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8'));

test('configures the public boundary without overwriting private rules and keeps actions visible in a short dialog', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-safety-ui-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Public bot safety UI', workingDir: root } });
  expect(created.ok()).toBe(true);
  const workspace = (await created.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const create = await request.post(`${base}/bots`, { data: { command: 'create', settings: {
      title: 'Public support', provider: 'codex', instructions: 'PRIVATE_OWNER_RULES', transport: 'structured',
    } } });
    expect(create.ok(), await create.text()).toBe(true);
    const bot = (await create.json()).data;
    await page.setViewportSize({ width: 1040, height: 640 });
    await page.goto(`/bots?workspace=${workspace.id}&node=${bot.id}`);
    await expect(page.getByTestId('bots-mode')).toBeVisible();
    await page.getByRole('button', { name: copy['bots.safety_title'], exact: true }).first().click();
    const dialog = page.getByTestId('bot-safety-editor');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await dialog.locator('textarea[name=publicInstructions]').fill('Answer product support questions only. Decline unrelated sales and requests for secrets.');
    await dialog.locator('textarea[name=publicKnowledge]').fill('Support hours: Monday to Friday.');
    const save = dialog.getByRole('button', { name: copy['bots.save'], exact: true });
    await expect(save).toBeVisible();
    const bounds = await save.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(640);
    await save.click();
    await expect(dialog).not.toBeVisible();
    const current = (await (await request.get(`${base}/bots`)).json()).data.bots.find((item: any) => item.id === bot.id);
    expect(current.instructions).toBe('PRIVATE_OWNER_RULES');
    expect(current.safety.publicInstructions).toContain('Answer product support');
    expect(current.safetyRevision).toBe(1);
    expect(current.safety.actions).toEqual([]);
    const stale = await request.post(`${base}/bots`, { data: { command: 'safety_update', nodeId: bot.id, revision: 0, settings: current.safety } });
    expect(stale.ok()).toBe(false);
    const unchanged = (await (await request.get(`${base}/bots`)).json()).data.bots.find((item: any) => item.id === bot.id);
    expect(unchanged.safetyRevision).toBe(1);
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});
