import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('switches provider contracts explicitly and preserves references without paid execution', async ({ page, request }) => {
  test.setTimeout(90000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-multi-provider-'));
  let workspaceId = '', paidAttempts = 0;
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Multi-provider UI QA', workingDir: folder } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}/creative-media`;
    const created = await request.post(base, { headers: { origin: 'http://127.0.0.1:5199' }, data: { title: 'Provider selection test', config: { prompt: 'Approved direction', parameters: { duration: 5 } } } });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = (await created.json()).data;
    const byteplus = (await (await request.get(`${base}/models?provider=byteplus`)).json()).data;
    expect(byteplus.models).toHaveLength(4);
    const h3 = (await (await request.get(`${base}/models?provider=higgsfield&endpoint=minimax/h3/image-to-video`)).json()).data;
    expect(h3.schema.properties.resolution.default).toBe('2K');
    await page.route(`**${base}/models?*`, route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.get('provider') === 'fal' && !query.has('endpoint')) return route.fulfill({ json: { data: { models: [], total: 0 } } });
      if (query.has('pricingIds')) return route.fulfill({ json: { data: { prices: [] } } });
      return route.continue();
    });
    await page.route('**/creative-media/**/runs', route => { paidAttempts++; return route.abort(); });
    await page.route(`**${base}`, async route => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch(), body = await response.json();
      body.data.profiles = [
        { id: '11111111-1111-4111-8111-111111111111', name: 'Fal test account', provider: 'fal', enabled: true, revision: 1, hasCredential: true },
        { id: '22222222-2222-4222-8222-222222222222', name: 'Higgsfield test account', provider: 'higgsfield', enabled: true, revision: 1, hasCredential: true },
      ];
      await route.fulfill({ response, json: body });
    });
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto(`/terminal?workspace=${workspaceId}&node=${workflow.nodeId}`);
    const node = page.getByTestId('video-workflow');
    await node.getByRole('combobox', { name: 'Video provider', exact: true }).selectOption('higgsfield');
    await expect(node.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await node.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: /minimax\/h3\/image-to-video/ }).click();
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: /Change provider/ }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(node.locator('[data-model-parameter="/resolution"]')).toContainText('2K');
    const accounts = node.getByRole('combobox', { name: 'Account', exact: true });
    expect(await accounts.locator('option').allTextContents()).toContain('Higgsfield test account');
    expect(await accounts.locator('option').allTextContents()).not.toContain('Fal test account');
    await node.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow.config.provider).toBe('higgsfield');
    await page.reload();
    await expect(node.getByRole('combobox', { name: 'Video provider', exact: true })).toHaveValue('higgsfield');
    await expect(node.locator('[data-model-parameter="/resolution"]')).toContainText('2K');
    await page.getByRole('button', { name: 'Configure access', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /New account/ }).click();
    await dialog.getByRole('combobox', { name: 'Video provider', exact: true }).selectOption('higgsfield');
    await expect(dialog.getByText(/KEY_ID:KEY_SECRET/)).toBeVisible();
    await page.screenshot({ path: '/tmp/orkestrai-video-providers-account.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    for (const theme of ['orkestrai-light', 'orkestrai-dark']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: theme } });
      await page.reload();
      await expect(node.getByRole('combobox', { name: 'Video provider', exact: true })).toHaveValue('higgsfield');
      expect(await node.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `/tmp/orkestrai-video-providers-${theme}.png` });
    }
    await node.getByRole('combobox', { name: 'Video provider', exact: true }).selectOption('byteplus');
    await node.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: /dreamina-seedance-2-5-260628/ }).click();
    await confirmation.getByRole('button', { name: /Change provider/ }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(node.locator('[data-model-parameter="/ratio"] select')).toHaveValue('"adaptive"');
    await node.getByText('Advanced', { exact: true }).click();
    await expect(node.getByLabel('Estimated billing units (optional)', { exact: true })).toHaveCount(0);
    await node.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow.config.provider).toBe('byteplus');
    await page.goto(`/canvas?workspace=${workspaceId}`);
    await expect(node.getByRole('combobox', { name: 'Video provider', exact: true })).toHaveValue('byteplus');
    expect(await node.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '/tmp/orkestrai-video-providers-canvas.png' });
    expect(paidAttempts).toBe(0);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(folder, { recursive: true, force: true });
  }
});
