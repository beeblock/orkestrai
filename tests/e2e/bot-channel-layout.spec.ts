import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const labels = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;

for (const provider of ['Telegram', 'Slack']) {
  test(`${provider} keeps both footer actions visible and clickable in short windows`, async ({ page, request }) => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-channel-layout-'));
    const response = await request.post('/api/agent-room/workspaces', { data: { name: 'Channel layout', workingDir: root } });
    expect(response.ok()).toBe(true);
    const workspace = (await response.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data;
    try {
      expect((await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'Layout bot', provider: 'codex', instructions: 'Test layout only' } } })).ok()).toBe(true);
      for (const theme of ['light', 'dark']) {
        const themeId = `orkestrai-${theme}`;
        expect((await request.put('/api/agent-room/settings', { data: { ...originalSettings, appTheme: themeId, uiLanguage: 'pt-BR' } })).ok()).toBe(true);
        await page.goto(`/bots?workspace=${workspace.id}`);
        await expect(page.locator('html')).toHaveAttribute('data-app-theme', themeId);
        const profile = page.locator('.bot-profile');
        for (const [width, height] of [[1280, 800], [960, 600], [560, 480], [375, 480]]) {
          await page.setViewportSize({ width, height });
          await profile.getByRole('button', { name: labels['bots.setup_title'].replace('{provider}', provider), exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog.getByTestId('bot-channel-setup')).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('data-app-theme', themeId);
          await dialog.locator('input[type=password]').fill('TEST_ONLY_NOT_A_REAL_CREDENTIAL');
          const footer = dialog.getByTestId('integration-dialog-footer');
          const body = dialog.getByTestId('integration-dialog-body');
          const firstFooter = await footer.boundingBox();
          for (const scrollEnd of [false, true]) {
            await body.evaluate((node, end) => { node.scrollTop = end ? node.scrollHeight : 0; }, scrollEnd);
            const bounds = await dialog.boundingBox();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.y).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
            expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
            expect((await footer.boundingBox())!.y).toBeCloseTo(firstFooter!.y, 0);
            for (const name of [labels['automation.cancel'], labels['integrations.connect']]) {
              const button = footer.getByRole('button', { name, exact: true });
              await expect(button).toBeEnabled();
              const box = await button.boundingBox();
              expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
              expect(box!.y).toBeGreaterThanOrEqual(bounds!.y);
              expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
              expect(box!.y + box!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
              expect(await button.evaluate(element => {
                const r = element.getBoundingClientRect();
                return [[r.x + 3, r.y + 3], [r.right - 3, r.bottom - 3], [r.x + r.width / 2, r.y + r.height / 2]]
                  .every(([x, y]) => element.contains(document.elementFromPoint(x, y)));
              })).toBe(true);
            }
          }
          if (width === 560 && process.env.BOT_LAYOUT_EVIDENCE_DIR) {
            await mkdir(process.env.BOT_LAYOUT_EVIDENCE_DIR, { recursive: true });
            await page.screenshot({ path: join(process.env.BOT_LAYOUT_EVIDENCE_DIR, `${provider.toLowerCase()}-${theme}-${width}x${height}.png`) });
          }
          await footer.getByRole('button', { name: labels['automation.cancel'], exact: true }).click();
          await expect(dialog).not.toBeVisible();
        }
      }
    } finally { await page.goto('about:blank'); await request.put('/api/agent-room/settings', { data: originalSettings }); await request.delete(base); await rm(root, { recursive: true, force: true }); }
  });
}
