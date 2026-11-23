import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

for (const locale of ['pt-BR', 'en', 'es']) {
  const labels = JSON.parse(await readFile(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
  test(`${locale} bot profile fits long account names and groups, and exposes workflows and routines`, async ({ page, request }) => {
    test.setTimeout(60_000);
    await page.clock.install();
    const root = await mkdtemp(join(tmpdir(), 'bot-profile-layout-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Profile layout', workingDir: root } })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    const original = (await (await request.get('/api/agent-room/settings')).json()).data;
    const longAccount = 'ContaDeTrabalhoSemEspacos'.repeat(5);
    const group = '55119999999-123456789012345678901234567890@g.us';
    try {
      const bot = (await (await request.post(`${base}/bots`, { data: { command: 'create', settings: {
        title: 'AssistantWithoutSpacesForLayoutTesting', provider: 'codex', instructions: `Keep all controls readable. https://example.com/${'reference'.repeat(70)}`,
      } } })).json()).data;
      await page.route(`**${base}/bots?connections=1`, route => route.fulfill({ json: { data: [{ id: '01955555-1111-7111-8111-111111111111', name: longAccount, enabled: true, state: 'connected', error: null, chats: [] }] } }));
      await page.route(`**${base}/bots?connectionId=*`, route => route.fulfill({ json: { data: { state: 'connected', qr: null, error: null } } }));
      await page.route(`**${base}/channel-bindings?*`, route => route.fulfill({ json: { data: [{ id: '01955555-2222-7222-8222-222222222222', workspaceId: workspace.id,
        nodeId: bot.id, kind: 'whatsapp', externalChatId: group, enabled: true, allowedSenders: [], replyPrefixes: ['#jarvis'], lastError: null, lastInboundAt: null }] } }));
      const profile = page.locator('.bot-profile');
      const workingSince = new Date(Date.now() - 4_000).toISOString();
      await page.route(`**${base}/control-center*`, route => route.fulfill({ json: { data: { workspaceId: workspace.id, counts: { working: 1 }, agents: [{
        nodeId: bot.id, title: bot.title, provider: 'codex', state: 'working', stateSince: workingSince, sessionAlive: true, lastAction: null,
      }] } } }));
      const fits = async () => {
        const sizes = await profile.evaluate(element => {
          const panel = element.getBoundingClientRect();
          const controls = [...element.querySelectorAll('button, input, textarea, form, .mono')].filter(el => el.getClientRects().length);
          return { width: element.clientWidth, scrollWidth: element.scrollWidth, outside: controls.filter(el => {
            const r = el.getBoundingClientRect(); return r.left < panel.left - 1 || r.right > panel.right + 1;
          }).map(el => el.tagName + ':' + el.textContent?.slice(0, 35)) };
        });
        expect(sizes.scrollWidth, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.width + 1);
        expect(sizes.outside).toEqual([]);
      };
      for (const theme of ['light', 'dark']) {
        expect((await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: locale, appTheme: `orkestrai-${theme}` } })).ok()).toBe(true);
        await page.goto(`/bots?workspace=${workspace.id}&node=${bot.id}`);
        await expect(profile.getByRole('combobox', { name: labels['bots.whatsapp_account'], exact: true })).toContainText(longAccount);
        await expect(profile.locator('.mono')).toContainText(group);
        const status = profile.getByTestId('agent-profile-status');
        await expect(status).toContainText(labels['control_center.state_working']);
        const previousTime = await status.innerText();
        await page.clock.fastForward(2_000);
        await expect.poll(() => status.innerText(), { timeout: 4_000 }).not.toBe(previousTime);
        const workflow = profile.getByTestId('bot-profile-shortcuts').getByRole('button', { name: labels['bots.workflow_title'], exact: true });
        expect(await workflow.locator('span').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(25);
        for (const [width, height] of [[1440, 900], [1100, 800], [960, 600], [375, 600], [320, 600]]) {
          await page.setViewportSize({ width, height });
          await fits();
        }
        // The full name stays available to keyboard users in the opened select.
        await profile.getByRole('combobox', { name: labels['bots.whatsapp_account'], exact: true }).click();
        await expect(page.getByRole('option').filter({ hasText: longAccount })).toBeVisible();
        await page.keyboard.press('Escape');
        await profile.getByRole('button', { name: labels['bots.edit_route'], exact: true }).click();
        const shortcuts = profile.getByTestId('bot-profile-shortcuts');
        await shortcuts.getByRole('button', { name: labels['chat.profile_routines'], exact: true }).click();
        await expect(profile.getByRole('textbox', { name: labels['chat.routine_label'], exact: true })).toBeVisible();
        await profile.getByRole('textbox', { name: labels['chat.routine_label'], exact: true }).fill('Keep this routine draft');
        for (const trigger of await profile.locator('[data-slot=accordion-trigger]').all()) {
          if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
        }
        for (const [width, height] of [[1100, 800], [375, 600], [320, 600]]) {
          await page.setViewportSize({ width, height }); await fits();
        }
        await shortcuts.getByRole('button', { name: labels['bots.workflow_title'], exact: true }).click();
        await expect(page.getByTestId('bot-workflow-editor')).toBeVisible();
        await expect(page.getByTestId('bot-editor').getByRole('button', { name: labels['bots.advanced'], exact: true })).toHaveAttribute('aria-expanded', 'true');
        await page.getByTestId('bot-editor').getByRole('button', { name: labels['bots.cancel'], exact: true }).click();
        await expect(profile.getByRole('textbox', { name: labels['chat.routine_label'], exact: true })).toHaveValue('Keep this routine draft');
        if (theme === 'light') {
          const saved = await request.post(`${base}/automations`, { data: { name: `Hourly fixture ${locale}`, triggerType: 'schedule', intervalMinutes: 60,
            actionType: 'prompt_agent', targetNodeId: bot.id, prompt: 'Fixture only; disabled.', enabled: false } });
          expect(saved.ok(), await saved.text()).toBe(true);
          await expect(profile.getByText(`Hourly fixture ${locale}`, { exact: true })).toBeVisible();
          await profile.getByRole('button', { name: labels['bots.automations'], exact: true }).click();
          const overview = page.getByTestId('automation-workspace');
          await expect(overview.getByText(`Hourly fixture ${locale}`, { exact: true })).toBeVisible();
          const second = await request.post(`${base}/automations`, { data: { name: `Live fixture ${locale}`, triggerType: 'manual',
            actionType: 'prompt_agent', targetNodeId: bot.id, prompt: 'Fixture only; disabled.', enabled: false } });
          expect(second.ok(), await second.text()).toBe(true);
          await expect(overview.getByText(`Live fixture ${locale}`, { exact: true })).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(overview).not.toBeVisible();
          await expect(profile.getByText(`Live fixture ${locale}`, { exact: true })).toBeVisible();
          await expect(profile.getByRole('textbox', { name: labels['chat.routine_label'], exact: true })).toHaveValue('Keep this routine draft');
        }
        await page.setViewportSize({ width: 375, height: 720 });
        await profile.getByTestId('bot-profile-shortcuts').scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`profile-${locale}-${theme}.png`) });
      }
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: original });
      await request.delete(base); await rm(root, { recursive: true, force: true });
    }
  });
}
