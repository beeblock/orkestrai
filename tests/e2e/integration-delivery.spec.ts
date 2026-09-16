import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

test('Integration Activity distinguishes accepted, pending and uncertain sends in every language and theme', async ({ page, request }) => {
  test.setTimeout(120_000);
  const directory = mkdtempSync(join(tmpdir(), 'orkestrai-delivery-ui-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId: string | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const response = await request.post('/api/agent-room/workspaces', { data: { name: 'Delivery UI regression', workingDir: directory } });
    expect(response.ok()).toBe(true);
    workspaceId = (await response.json()).data.id;
    const root = `/api/agent-room/workspaces/${workspaceId}`;
    const integrationId = randomUUID(), now = new Date().toISOString();
    // Native/provider transport is not exercised by this UI fixture. No message
    // is published and no credentials, live accounts or production data are used.
    await page.route(`**${root}/integrations`, route => route.fulfill({ json: { data: { integrations: [{ id: integrationId,
      workspaceId, name: 'Test channel', type: 'slack', enabled: true, status: 'connected', permissions: ['slack.send_message'],
      config: {}, secretRefs: [], error: null, createdAt: now, updatedAt: now }], catalog: [] } } }));
    await page.route(`**${root}/integrations/events?*`, route => route.fulfill({ json: { data: [
      { id: 'uncertain', integrationId, kind: 'slack.send_message', status: 'uncertain', deliveryState: 'uncertain', error: 'internal unconfirmed', createdAt: now },
      { id: 'accepted', integrationId, kind: 'slack.send_message', status: 'succeeded', deliveryState: 'accepted', receipt: { evidence: 'provider_message_id', messageIds: ['provider-id.' + 'a'.repeat(240)] }, error: null, createdAt: now },
      { id: 'pending', integrationId, kind: 'slack.send_message', status: 'running', deliveryState: 'pending', error: null, createdAt: now },
      { id: 'failed', integrationId, kind: 'slack.send_message', status: 'failed', deliveryState: 'not_submitted', error: 'internal preflight', createdAt: now },
      { id: 'legacy', integrationId, kind: 'slack.send_message', status: 'succeeded', deliveryState: 'unknown', error: null, createdAt: now },
    ] } }));
    const locales = [
      { id: 'en', tab: 'Integrations', uncertain: 'Send unconfirmed', accepted: 'Accepted by provider', pending: 'In progress', failed: 'Not submitted', receipt: 'Provider receipt', unknown: 'No delivery evidence' },
      { id: 'pt-BR', tab: 'Integrações', uncertain: 'Envio não confirmado', accepted: 'Aceito pelo provedor', pending: 'Em andamento', failed: 'Não enviado', receipt: 'Comprovante do provedor', unknown: 'Sem evidência de envio' },
      { id: 'es', tab: 'Integraciones', uncertain: 'Envío sin confirmar', accepted: 'Aceptado por el proveedor', pending: 'En curso', failed: 'No enviado', receipt: 'Comprobante del proveedor', unknown: 'Sin evidencia de envío' },
    ];
    for (const locale of locales) for (const theme of ['orkestrai-light', 'orkestrai-dark']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: locale.id, appTheme: theme } });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`/terminal?workspace=${workspaceId}&node=workbench-automations:${workspaceId}`);
      await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);
      const automation = page.getByTestId('automation-workspace').filter({ visible: true });
      const tab = automation.getByRole('tab', { name: locale.tab, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute('data-state', 'active');
      const panel = automation.getByTestId('integration-center');
      for (const label of [locale.uncertain, locale.accepted, locale.pending, locale.failed, locale.unknown]) await expect(panel.getByText(label, { exact: true })).toBeVisible();
      const unknownEvent = panel.locator('article').filter({ hasText: locale.unknown });
      await expect(unknownEvent.locator('svg').first()).toHaveClass(/text-\[var\(--app-text-muted\)\]/);
      const expectedTime = await page.evaluate(({ now, locale }) => new Date(now).toLocaleString(locale), { now, locale: locale.id });
      await expect(panel.getByText(expectedTime, { exact: true })).toHaveCount(5);
      await expect(panel.getByText('internal unconfirmed')).toHaveCount(0);
      await expect(panel.getByText('internal preflight')).toHaveCount(0);
      await panel.locator('summary').filter({ hasText: locale.receipt }).click();
      await expect(panel.getByText('provider-id.', { exact: false })).toBeVisible();
      expect(await panel.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      const uncertain = panel.locator('article').filter({ hasText: locale.uncertain });
      const colors = await uncertain.locator('p').last().evaluate(element => ({ text: getComputedStyle(element).color, background: getComputedStyle(element.closest('article')!).backgroundColor }));
      expect(colors.text).not.toBe(colors.background);
      await panel.screenshot({ path: `test-results/integration-delivery-${locale.id}-${theme}.png` });
    }
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    rmSync(directory, { recursive: true, force: true });
  }
});
