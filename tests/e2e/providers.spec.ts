import { expect, test } from '@playwright/test';

test('Central de Providers lista o registry e mostra a configuração oficial', async ({ page, request }) => {
  await request.put('/api/agent-room/settings', { data: { uiLanguage: 'en' } });

  try {
    await page.goto('/providers');
    await expect(page.getByRole('heading', { name: 'Provider Center' })).toBeVisible();
    await expect(page.locator('.provider-row')).toHaveCount(14);

    const claude = page.locator('.provider-row', { hasText: 'Claude' });
    await claude.getByRole('button', { name: 'View setup' }).click();
    await expect(claude.getByText('1. Install the CLI')).toBeVisible();
    await expect(claude.getByRole('link', { name: 'Open official guide' })).toHaveAttribute('href', /^https:\/\//);
    await expect(page.getByRole('region', { name: /\d+ of 14 CLIs detected on this device/ })).toBeVisible();
  } finally {
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });
  }
});
