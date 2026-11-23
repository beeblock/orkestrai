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
    await page.route(`**${base}/bots`, route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().command === 'owner_senders') return route.fulfill({ json: { data: [{ kind: 'whatsapp', senderId: '5511999999999@s.whatsapp.net', name: 'Trusted test phone' }] } });
      return route.continue();
    });
    await page.setViewportSize({ width: 1040, height: 640 });
    await page.goto(`/bots?workspace=${workspace.id}&node=${bot.id}`);
    await expect(page.getByTestId('bots-mode')).toBeVisible();
    await page.locator('.bot-profile').getByRole('button', { name: copy['bots.profile_security'], exact: true }).click();
    await page.getByRole('button', { name: copy['bots.safety_title'], exact: true }).first().click();
    const dialog = page.getByTestId('bot-safety-editor');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(copy['bots.safety_scope_hint'], { exact: true })).toBeVisible();
    await expect(dialog.getByText(copy['bots.safety_knowledge_hint'], { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await expect(dialog.getByRole('checkbox', { name: copy['bots.owner_phone_access'], exact: false })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: copy['bots.public_web_search'], exact: false })).toBeChecked();
    await dialog.getByRole('checkbox', { name: /Trusted test phone/ }).check();
    await dialog.locator('textarea[name=publicInstructions]').fill('Answer product support questions only. Decline unrelated sales and requests for secrets.');
    await dialog.locator('textarea[name=publicKnowledge]').fill('Support hours: Monday to Friday.');
    const save = dialog.getByRole('button', { name: copy['bots.save'], exact: true });
    await expect(save).toBeVisible();
    const bounds = await save.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThan(640);
    await page.screenshot({ path: test.info().outputPath('bot-protection-short-window.png') });
    await save.click();
    await expect(dialog).not.toBeVisible();
    const current = (await (await request.get(`${base}/bots`)).json()).data.bots.find((item: any) => item.id === bot.id);
    expect(current.instructions).toBe('PRIVATE_OWNER_RULES');
    expect(current.safety.publicInstructions).toContain('Answer product support');
    expect(current.safety.publicKnowledge).toBe('Support hours: Monday to Friday.');
    expect(current.safety.ownerSenders).toEqual([{ kind: 'whatsapp', senderId: '5511999999999@s.whatsapp.net' }]);
    expect(current.safety.webSearch).toBe(true);
    expect(current.safetyRevision).toBe(1);
    expect(current.safety.actions).toEqual([]);
    const stale = await request.post(`${base}/bots`, { data: { command: 'safety_update', nodeId: bot.id, revision: 0, settings: current.safety } });
    expect(stale.ok()).toBe(false);
    const unchanged = (await (await request.get(`${base}/bots`)).json()).data.bots.find((item: any) => item.id === bot.id);
    expect(unchanged.safetyRevision).toBe(1);
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});


test('shows the selected account quota pause and keeps its controls available without leaving Bots', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-quota-ui-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Quota warning UI', workingDir: root } });
  const workspace = (await created.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const response = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'Quota paused', provider: 'claude', instructions: 'UI only' } } });
    expect(response.ok()).toBe(true);
    const bot = (await response.json()).data;
    await page.route(`**${base}/bots`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const actual = await route.fetch(), result = await actual.json();
      result.data.bots = result.data.bots.map((item: any) => item.id === bot.id ? { ...item, usageBlock: { provider: 'claude', profileId: null, usedPercent: 97, limit: 95, window: 'weekly', resetsAt: null } } : item);
      return route.fulfill({ response: actual, json: result });
    });
    await page.goto(`/bots?workspace=${workspace.id}&node=${bot.id}`);
    await expect(page.getByTestId('bots-mode')).toBeVisible();
    await expect(page.locator('.bot-row').filter({ hasText: bot.title })).toContainText(copy['bots.quota_paused']);
    await expect(page.getByText(/97%.*95%/)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('bot-quota-warning.png') });
    await page.getByRole('button', { name: copy['bots.quota_change_account'], exact: true }).click();
    await expect(page.getByTestId('bot-editor')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/bots');
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});
