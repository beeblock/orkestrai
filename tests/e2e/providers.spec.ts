import { expect, test } from '@playwright/test';

let settingsBeforeTest: Record<string, unknown> | undefined;
test.beforeEach(async ({ request }) => {
  settingsBeforeTest = (await (await request.get('/api/agent-room/settings')).json()).data;
});
test.afterEach(async ({ playwright, baseURL }) => {
  const cleanup = await playwright.request.newContext({ baseURL });
  try { if (settingsBeforeTest) await cleanup.put('/api/agent-room/settings', { data: settingsBeforeTest }); }
  finally { await cleanup.dispose(); settingsBeforeTest = undefined; }
});

test('Central de Providers lista o registry e mostra a configuração oficial', async ({ page, request }) => {
  await request.put('/api/agent-room/settings', { data: { uiLanguage: 'en' } });

  try {
    await page.goto('/providers');
    await expect(page.getByRole('heading', { name: 'Provider Center' })).toBeVisible();
    const status = await request.get('/api/agent-room/status');
    expect(status.ok()).toBe(true);
    const providers: Array<{ id: string }> = (await status.json()).data.providers;
    expect(providers.some(provider => provider.id === 'shared')).toBe(true);
    await expect(page.locator('.provider-row')).toHaveCount(providers.length);
    await expect(page.locator('.provider-row').filter({ has: page.getByRole('heading', { name: 'Orkestrai', exact: true }) })).toHaveCount(1);
    await expect(page.locator('.provider-row', { hasText: 'Oh My Pi' })).toHaveCount(1);
    await expect(page.locator('.provider-row').filter({ has: page.getByText('Pi', { exact: true }) })).toHaveCount(1);

    const claude = page.locator('.provider-row', { hasText: 'Claude' });
    await claude.getByRole('button', { name: 'View setup' }).click();
    await expect(claude.getByText('1. Install the CLI')).toBeVisible();
    await expect(claude.getByRole('link', { name: 'Open official guide' })).toHaveAttribute('href', /^https:\/\//);
    await expect(page.getByRole('region', { name: new RegExp(`\\d+ of ${providers.length} CLIs detected on this device`) })).toBeVisible();
  } finally {
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });
  }
});
