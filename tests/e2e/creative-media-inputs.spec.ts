import { test, expect } from '@playwright/test';
import { mkdtemp, rm, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';

test('shows named media with thumbnails, preserves mappings and aligns model/account fields', async ({ page, request }) => {
  test.setTimeout(90000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-reference-ui-'));
  await copyFile('electron/resources/icon.png', join(dir, 'identity.png'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E video references', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}/creative-media`;
  const modelId = 'fal-ai/test/image-to-video';
  const model = { id: modelId, name: 'Reference UI fixture', category: 'image-to-video', status: 'active', documentationUrl: 'https://fal.ai/models/test' };
  let paid = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/runs$/.test(req.url())) paid++; });
  await page.route(`**${base}/models?*`, route => route.fulfill({ json: { data: new URL(route.request().url()).searchParams.has('endpoint') ? {
    ...model, digest: 'a'.repeat(64), outputSchema: {}, schema: { type: 'object', properties: {
      prompt: { type: 'string' }, image_url: { type: 'string' }, reference_image_urls: { type: 'array', maxItems: 6, items: { type: 'array', maxItems: 2, items: { type: 'string' } } },
    } },
  } : { models: [model], total: 1, nextOffset: null } } }));
  try {
    const image = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'image', title: 'Lia - approved identity', x: 0, y: 0, width: 320, height: 300, payload: { path: 'identity.png' } } })).json()).data;
    const created = await request.post(base, { headers: { origin: 'http://127.0.0.1:5199' }, data: { title: 'References UI', config: { modelId, mediaBindings: [{ pointer: '/reference_image_urls/4/1', nodeId: image.id }] } } });
    expect(created.ok()).toBe(true);
    const workflow = (await created.json()).data;
    for (const [theme, lang] of [['orkestrai-light', 'en'], ['graphite-dark', 'pt-BR'], ['orkestrai-dark', 'es']]) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: lang, appTheme: theme } });
      await page.setViewportSize({ width: 1100, height: 740 });
      await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
      const node = page.getByTestId('video-workflow');
      const refs = page.getByTestId('creative-media-inputs');
      await expect(refs).toBeVisible();
      const destination = refs.getByRole('combobox').first();
      await expect(destination).toContainText('5 / 2');
      await expect(destination).not.toContainText('urls');
      await expect(refs.getByRole('combobox').nth(1)).toContainText('Lia - approved identity');
      await expect(refs.locator('code:visible')).toHaveCount(0);
      await refs.getByRole('combobox').nth(1).click();
      const option = page.getByRole('option', { name: /Lia - approved identity/ });
      await expect(option.locator('img')).toBeVisible();
      await expect.poll(() => option.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      await page.screenshot({ path: `/tmp/orkestrai-media-options-${lang}.png` });
      await page.keyboard.press('Escape');
      await node.getByTestId('creative-model-field').scrollIntoViewIfNeeded();
      const a = (await node.getByTestId('creative-model-field').getByRole('combobox').boundingBox())!;
      const b = (await node.getByTestId('creative-account-field').getByRole('combobox').boundingBox())!;
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      expect(await node.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `/tmp/orkestrai-media-form-${lang}.png` });
    }
    const saved = (await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow;
    expect(saved.config.mediaBindings).toEqual([{ pointer: '/reference_image_urls/4/1', nodeId: image.id }]);
    expect(paid).toBe(0);
  } finally {
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('shows a standalone file reference and browses project media without exposing raw inputs', async ({ page, request }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-file-reference-'));
  await mkdir(join(dir, 'generated', 'images'), { recursive: true });
  const path = 'generated/images/v14-b2-frame-276.png';
  await copyFile('electron/resources/icon.png', join(dir, path));
  await copyFile('electron/resources/icons/128x128.png', join(dir, 'replacement.png'));
  await writeFile(join(dir, 'not-media.txt'), 'Not a media reference');
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E file references', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}/creative-media`;
  const modelId = 'minimax/h3/image-to-video';
  const model = { id: modelId, name: 'MiniMax H3 Image to Video', category: 'image-to-video', status: 'active', documentationUrl: 'https://fal.ai/models/minimax/h3/image-to-video' };
  let paid = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/(runs|preview)$/.test(req.url())) paid++; });
  await page.route(`**${base}/models?*`, route => route.fulfill({ json: { data: new URL(route.request().url()).searchParams.has('endpoint') ? {
    ...model, digest: 'a'.repeat(64), outputSchema: {}, schema: { type: 'object', properties: { prompt: { type: 'string' }, image_url: { type: 'string' } } },
  } : { models: [model], total: 1, nextOffset: null } } }));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'graphite-dark' } });
    const result = await request.post(base, { headers: { origin: 'http://127.0.0.1:5199' }, data: { title: 'V14 product reference', config: { modelId, mediaBindings: [{ pointer: '/image_url', path }] } } });
    expect(result.ok(), await result.text()).toBe(true);
    const workflow = (await result.json()).data;
    await page.setViewportSize({ width: 850, height: 900 });
    await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
    const refs = page.getByTestId('creative-media-inputs');
    const preview = refs.getByTestId('creative-media-preview');
    await expect(refs.getByRole('combobox').first()).toContainText('First frame');
    await expect(refs.getByRole('combobox').nth(1)).toContainText('v14-b2-frame-276.png');
    await expect(preview.getByText('v14-b2-frame-276.png', { exact: true })).toBeVisible();
    await expect.poll(() => preview.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);
    await expect(refs.getByRole('textbox', { name: 'Workspace-relative file path' })).not.toBeVisible();
    await refs.scrollIntoViewIfNeeded();
    await preview.locator('img').evaluate(img => (img as HTMLImageElement).decode());
    const thumbnail = PNG.sync.read(await preview.locator('img').screenshot());
    let visibleLogoPixels = 0;
    for (let i = 0; i < thumbnail.data.length; i += 4) {
      if (thumbnail.data[i] > 180 && thumbnail.data[i + 1] > 100 && thumbnail.data[i + 2] < 90) visibleLogoPixels++;
    }
    expect(visibleLogoPixels).toBeGreaterThan(100);
    await page.screenshot({ path: '/tmp/orkestrai-file-reference-dark.png' });
    await preview.getByRole('button', { name: 'View reference' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'v14-b2-frame-276.png' })).toBeVisible();
    await expect(dialog.locator('img')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    // Merely viewing a path reference must not turn it into a node binding.
    expect((await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow.config.mediaBindings).toEqual([{ pointer: '/image_url', path }]);
    await refs.getByRole('button', { name: 'Choose from project' }).click();
    const replacement = page.getByRole('option', { name: 'replacement.png', exact: true });
    await expect(replacement).toBeVisible();
    await replacement.scrollIntoViewIfNeeded();
    await expect.poll(() => replacement.evaluate(element => {
      const r = element.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit !== null && element.contains(hit);
    })).toBe(true);
    await page.screenshot({ path: '/tmp/orkestrai-file-picker-open.png' });
    await expect(page.getByRole('option', { name: 'not-media.txt', exact: true })).toHaveCount(0);
    await page.getByRole('option', { name: 'generated', exact: true }).click();
    await expect(page.getByRole('option', { name: 'images', exact: true })).toBeVisible();
    await page.waitForResponse(response => response.url().endsWith(`${base}/workflows/${workflow.nodeId}`) && response.request().method() === 'GET');
    await expect(page.getByRole('option', { name: 'images', exact: true })).toBeVisible();
    await page.getByRole('option', { name: 'images', exact: true }).click();
    await expect(page.getByRole('option', { name: 'v14-b2-frame-276.png', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Parent folder' }).click();
    await page.getByRole('button', { name: 'Parent folder' }).click();
    await page.getByRole('option', { name: 'replacement.png', exact: true }).click();
    await expect(refs.getByRole('combobox').nth(1)).toContainText('replacement.png');
    await page.getByTestId('video-workflow').getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow.config.mediaBindings).toEqual([{ pointer: '/image_url', path: 'replacement.png' }]);
    await page.reload();
    await expect(preview.getByText('replacement.png', { exact: true })).toBeVisible();
    expect(paid).toBe(0);
  } finally {
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});
