import { expect, test } from '@playwright/test';

for (const reason of ['network', 'unsigned'] as const) {
  test(`shows the correct manual-update reason (${reason}) and opens only the official release page`, async ({ page }) => {
    await page.addInitScript(({ reason }) => {
      const releasePages: string[] = [];
      Object.defineProperty(window, '__releasePages', { value: releasePages });
      Object.defineProperty(window, 'orkestraiDesktop', { configurable: true, value: {
        onUpdate: () => () => {},
        updateState: async () => ({ status: 'manual', version: '0.52.7', reason }),
        openExternal: async (url: string) => { releasePages.push(url); },
      } });
    }, { reason });
    await page.goto('/settings');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('0.52.7');
    if (reason === 'network') {
      await expect(dialog).toContainText('serviço de atualização automática está temporariamente indisponível');
      await expect(dialog).not.toContainText('Mac');
    } else {
      await expect(dialog).toContainText('Mac');
      await expect(dialog).toContainText('sem assinatura');
    }
    await dialog.getByRole('button', { name: 'Baixar do site' }).click();
    expect(await page.evaluate(() => (window as unknown as { __releasePages: string[] }).__releasePages))
      .toEqual(['https://github.com/beeblock/orkestrai/releases/latest']);
  });
}
