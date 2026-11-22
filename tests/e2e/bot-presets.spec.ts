import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const copy = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8'));

test('presets fill editable purpose, personality and rules while preserving the owner’s name and provider', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-presets-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Preset creation QA', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    await page.route(`**${base}/bots?providerId=*`, route => route.fulfill({ json: { data: { installed: true, models: [], efforts: [] } } }));
    await page.goto(`/bots?workspace=${workspace.id}`);
    await page.getByRole('button', { name: copy['bots.create'], exact: true }).first().click();
    const editor = page.getByTestId('bot-editor'), picker = page.getByTestId('bot-preset-picker');
    await expect(picker.getByRole('button', { pressed: true })).toHaveAttribute('aria-label', copy['bots.preset.assistant.name']);
    await editor.locator('input[name=title]').fill('Jarvis');
    const provider = await editor.getByRole('combobox', { name: copy['bots.provider'], exact: true }).innerText();
    const account = await editor.getByRole('combobox', { name: copy['bots.profile'], exact: true }).innerText();
    await picker.getByRole('searchbox', { name: copy['bots.preset_search'] }).fill('suporte');
    await picker.getByRole('button', { name: copy['bots.preset.support.name'], exact: true }).click();
    await expect(editor.locator('input[name=title]')).toHaveValue('Jarvis');
    await expect(editor.locator('textarea[name=instructions]')).toHaveValue(copy['bots.preset.support.purpose']);
    await expect(editor.locator('textarea[name=personality]')).toHaveValue(copy['bots.preset.support.personality']);
    expect(await editor.locator('textarea[name=rules]').inputValue()).toContain(copy['bots.preset.support.rules']);
    await expect(editor.getByRole('combobox', { name: copy['bots.provider'], exact: true })).toHaveText(provider);
    await expect(editor.getByRole('combobox', { name: copy['bots.profile'], exact: true })).toHaveText(account);
    await editor.locator('textarea[name=personality]').fill('Calmo, com respostas curtas.');
    await editor.locator('textarea[name=rules]').fill('Use a documentação aprovada.');
    const saved = page.waitForResponse(response => response.url().endsWith(`${base}/bots`) && response.request().method() === 'POST');
    await editor.getByRole('button', { name: copy['bots.save'], exact: true }).click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBe(true);
    const bot = (await response.json()).data;
    expect(bot.title).toBe('Jarvis');
    expect(bot.instructions).toContain(copy['bots.preset.support.purpose']);
    expect(bot.instructions).toContain('Calmo, com respostas curtas.');
    expect(bot.instructions).toContain('Use a documentação aprovada.');
    expect(bot.safety.publicInstructions).toBe(bot.instructions);
    expect(bot.safety.actions).toEqual([]);
    await expect(editor).not.toBeVisible();
  } finally { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); await rm(root, { recursive: true, force: true }); }
});

test('preset browsing and custom setup keep creation actions inside short desktop and narrow windows', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-presets-layout-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Preset layout QA', workingDir: root } })).json()).data;
  try {
    await page.goto(`/bots?workspace=${workspace.id}`);
    for (const viewport of [{ width: 1100, height: 640 }, { width: 430, height: 640 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: copy['bots.create'], exact: true }).first().click();
      const editor = page.getByTestId('bot-editor'), picker = page.getByTestId('bot-preset-picker');
      const save = editor.getByRole('button', { name: copy['bots.save'], exact: true });
      await expect(save).toBeInViewport();
      const bounds = await page.getByRole('dialog').boundingBox();
      expect(bounds!.width).toBeLessThanOrEqual(viewport.width - 24);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      await picker.getByRole('searchbox', { name: copy['bots.preset_search'] }).fill('nonsense-no-template');
      await expect(picker).toContainText(copy['bots.preset_empty']);
      await picker.getByRole('button', { name: copy['bots.preset_custom'], exact: true }).click();
      await expect(editor.locator('textarea[name=instructions]')).toHaveValue('');
      await expect(editor.locator('textarea[name=personality]')).toHaveValue('');
      await expect(editor.locator('textarea[name=rules]')).toHaveValue('');
      await expect(save).toBeInViewport();
      await editor.getByRole('button', { name: copy['bots.cancel'], exact: true }).click();
      await expect(editor).not.toBeVisible();
    }
  } finally { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); await rm(root, { recursive: true, force: true }); }
});
