import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scannedPdf } from '../helpers/scanned-pdf.js';

test('imported scans become searchable cited sources with visible OCR provenance', async ({ page, request }, info) => {
  test.setTimeout(75_000);
  const dir = await mkdtemp(join(tmpdir(), 'ork-e2e-ocr-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let workspace = '';
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E scanned PDF', workingDir: dir } })).json()).data.id;
    await page.goto(`/canvas?workspace=${workspace}`);
    await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    const view = page.getByRole('dialog').getByTestId('knowledge-view');
    await view.locator('input[type=file]').setInputFiles({ name: 'scanned-contract.pdf', mimeType: 'application/pdf', buffer: await scannedPdf([{ text: 'Campaign contract. Approved budget: 8721 dollars.' }]) });
    await view.getByRole('button', { name: /^scanned-contract.pdf Document/ }).click();
    const details = view.locator('aside');
    await expect(details.getByTestId('document-ocr-summary')).toContainText('Local OCR: 1');
    await expect(details).toContainText('8721');
    await expect(details).toContainText('p.1');
    await expect(details).toContainText('Estimated recognition confidence');
    await view.screenshot({ path: info.outputPath('ocr-dark.png') });
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await view.getByRole('textbox', { name: 'Search knowledge', exact: true }).fill('8721');
    await view.getByRole('button', { name: 'Search knowledge', exact: true }).click();
    await expect(view.getByRole('button', { name: /^scanned-contract.pdf Document/ })).toBeVisible();
    const result = (await (await request.get(`/api/agent-room/workspaces/${workspace}/knowledge?q=8721`)).json()).data;
    expect(result.items[0].locator).toBe('p.1');
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    await page.reload();
    await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    await page.setViewportSize({ width: 600, height: 800 });
    await view.getByRole('button', { name: /^scanned-contract.pdf Document/ }).click();
    await expect(details.getByTestId('document-ocr-summary')).toBeVisible();
    await view.screenshot({ path: info.outputPath('ocr-light-compact.png') });
    expect(errors).toEqual([]);
  } finally {
    if (workspace) await request.delete(`/api/agent-room/workspaces/${workspace}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(dir, { recursive: true, force: true });
  }
});
