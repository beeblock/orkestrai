import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const cases = [
  { locale: 'en', theme: 'orkestrai-dark', width: 1280, height: 800 },
  { locale: 'pt-BR', theme: 'orkestrai-light', width: 900, height: 560 },
  { locale: 'es', theme: 'orkestrai-dark', width: 560, height: 440 },
];

for (const viewport of cases) test(`scrolls video provider fields without hiding actions: ${viewport.locale}`, async ({ page, request }) => {
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-provider-layout-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: viewport.locale, appTheme: viewport.theme } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Provider scroll QA', workingDir: folder } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}/creative-media`;
    const created = await request.post(base, { headers: { origin: 'http://127.0.0.1:5199' }, data: { title: 'Scroll QA', config: { prompt: 'Local UI test only' } } });
    expect(created.ok()).toBe(true);
    const workflow = (await created.json()).data;
    // Read-only fixtures: no real key, account write, upload or paid provider call.
    await page.route(`**${base}`, async route => {
      const response = await route.fetch();
      const body = await response.json();
      body.data.profiles = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Layout fixture', provider: 'fal', enabled: false, hasCredential: true, revision: 1 }];
      await route.fulfill({ response, json: body });
    });
    await page.route('**/creative-media/models?*', route => route.fulfill({ json: { data: { models: Array.from({ length: 40 }, (_, i) => ({ id: `qa/model-${i}`, name: `Model ${i}`, category: 'image-to-video', status: 'active' })), total: 40 } } }));
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(`/terminal?workspace=${workspaceId}&node=${workflow.nodeId}`);
    await page.getByRole('button', { name: /Configure access|Configurar acesso|Configurar acceso/ }).first().click();
    const dialog = page.getByRole('dialog');
    const account = dialog.locator('input[name="name"]');
    await expect(account).toHaveValue('Layout fixture');
    await expect(account).toBeEnabled();
    const save = dialog.getByRole('button', { name: /Save|Salvar|Guardar/, exact: true });
    const before = await save.boundingBox();
    await dialog.getByRole('tab').nth(1).click();
    await expect(dialog.getByRole('tab').nth(1)).toHaveAttribute('aria-selected', 'true');
    const body = dialog.getByRole('tabpanel').locator('..');
    await expect.poll(() => body.evaluate(element => element.scrollHeight > element.clientHeight + 30)).toBe(true);
    const bounds = await body.boundingBox();
    // Start above the separately scrollable model list.
    await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 8);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const budget = dialog.locator('input[name="maxRunCents"]');
    await budget.scrollIntoViewIfNeeded();
    await budget.fill('1');
    await expect(budget).toHaveValue('1');
    // A DOM-visible input can still be clipped by an overflow:hidden ancestor.
    expect(await budget.evaluate(element => {
      const r = element.getBoundingClientRect();
      const scroller = element.closest('[role="tabpanel"]')!.parentElement!.getBoundingClientRect();
      return r.top >= scroller.top && r.bottom <= scroller.bottom;
    })).toBe(true);
    const concurrency = dialog.getByRole('tabpanel').getByRole('combobox');
    await concurrency.scrollIntoViewIfNeeded();
    await concurrency.selectOption('2');
    await expect(concurrency).toHaveValue('2');
    const after = await save.boundingBox();
    expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
    expect(after!.y + after!.height).toBeLessThan(viewport.height);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `/tmp/orkestrai-provider-scroll-${viewport.locale}.png` });
    await dialog.getByRole('tab').first().click();
    const enable = dialog.getByRole('tabpanel').getByRole('switch');
    await enable.scrollIntoViewIfNeeded();
    await enable.focus();
    await page.keyboard.press('Space');
    await expect(enable).toBeChecked();
    await expect(dialog.getByRole('tab').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(folder, { recursive: true, force: true });
  }
});
