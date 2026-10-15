import { expect, test } from '@playwright/test';

test.describe('Settings section navigation', () => {
  test('selects short sections at the scroll limit and resumes tracking manual scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/settings');
    await expect(page.locator('#language')).toBeAttached();
    const nav = page.locator('.settings-page aside nav');

    // All these headings cannot align with the sticky header at this height.
    // Repeated clicks at the same scroll position must still change selection.
    for (const id of ['language', 'presets', 'updates', 'shortcuts', 'presets', 'presets']) {
      const link = nav.locator(`a[href="#${id}"]`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`#${id}$`));
      await expect(link).toHaveAttribute('aria-current', 'location');
      await expect(nav.locator('[aria-current="location"]')).toHaveCount(1);
      await expect(page.locator(`#${id}`)).toBeInViewport();
      await expect.poll(() => page.evaluate(() => {
        const root = document.scrollingElement!;
        return Math.abs(root.scrollHeight - root.clientHeight - root.scrollTop);
      })).toBeLessThanOrEqual(2);
    }

    // The clicked preference must not freeze scrollspy during manual scrolling.
    await page.mouse.move(1100, 400);
    await page.mouse.wheel(0, -10000);
    await expect(nav.locator('a[href="#autonomy"]')).toHaveAttribute('aria-current', 'location');
    await page.mouse.wheel(0, 10000);
    await expect(nav.locator('a[href="#language"]')).toHaveAttribute('aria-current', 'location');

    // Keyboard activation uses the same native anchor and selected state.
    const shortcuts = nav.locator('a[href="#shortcuts"]');
    await shortcuts.focus();
    await page.keyboard.press('Enter');
    await expect(shortcuts).toHaveAttribute('aria-current', 'location');
  });

  test('selects a bottom hash on direct navigation and browser history', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/settings#presets');
    const nav = page.locator('.settings-page aside nav');
    await expect(nav.locator('a[href="#presets"]')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#presets')).toBeInViewport();
    await nav.locator('a[href="#updates"]').click();
    await expect(nav.locator('a[href="#updates"]')).toHaveAttribute('aria-current', 'location');
    await page.goBack();
    await expect(page).toHaveURL(/#presets$/);
    await expect(nav.locator('a[href="#presets"]')).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#presets')).toBeInViewport();
    await page.goForward();
    await expect(page).toHaveURL(/#updates$/);
    await expect(nav.locator('a[href="#updates"]')).toHaveAttribute('aria-current', 'location');
  });

  test('tracks the Windows desktop scroll container rather than the document', async ({ page }) => {
    await page.addInitScript(() => Object.assign(window, { orkestraiDesktop: { platform: 'win32' } }));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto('/settings');
    await expect(page.locator('#language')).toBeAttached();
    const nav = page.locator('.settings-page aside nav');
    const scrollContainer = page.locator('.desktop-content');
    await expect(scrollContainer).toBeAttached();
    for (const id of ['language', 'presets', 'updates']) {
      await nav.locator(`a[href="#${id}"]`).click();
      await expect(nav.locator(`a[href="#${id}"]`)).toHaveAttribute('aria-current', 'location');
    }
    expect(await scrollContainer.evaluate((root) => root.scrollTop)).toBeGreaterThan(0);
    await page.mouse.move(1100, 400);
    await page.mouse.wheel(0, -10000);
    await expect(nav.locator('a[href="#autonomy"]')).toHaveAttribute('aria-current', 'location');
  });

  test('selects bottom sections in the compact horizontal menu with reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/settings');
    await expect(page.locator('#language')).toBeAttached();
    const nav = page.locator('.settings-page aside nav');
    for (const id of ['language', 'presets', 'shortcuts', 'updates']) {
      const link = nav.locator(`a[href="#${id}"]`);
      await link.click();
      await expect(link).toHaveAttribute('aria-current', 'location');
      await expect(nav.locator('[aria-current="location"]')).toHaveCount(1);
      await expect(page.locator(`#${id}`)).toBeInViewport();
    }
  });
});
