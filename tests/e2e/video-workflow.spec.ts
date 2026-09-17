import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const headers = { origin: 'http://127.0.0.1:5199' };
test.describe('native video workflows', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/creative-media/models?*', route => route.fulfill({ json: { data: { models: [], total: 0, nextOffset: null } } }));
  });
  test('searches a large catalog and saves Seedance 2.5 with its own string duration and audio controls', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-catalog-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E model catalog', workingDir: dir } })).json()).data;
    const endpoint = 'bytedance/seedance-2.5/text-to-video';
    const models = [...Array.from({ length: 150 }, (_, index) => ({ id: `fal-ai/model-${index}/text-to-video`, name: `Model ${index}`, category: 'text-to-video', status: 'active' })), { id: endpoint, name: 'Seedance 2.5 Text to Video', category: 'text-to-video', status: 'active' }];
    await page.route('**/creative-media/models?*', route => route.fulfill({ json: { data: new URL(route.request().url()).searchParams.has('endpoint') ? { ...models.at(-1), documentationUrl: `https://fal.ai/models/${endpoint}/api`, digest: 'a'.repeat(64), schema: { type: 'object', required: ['prompt'], properties: { prompt: { type: 'string' }, duration: { type: 'string', enum: ['4', '5', '30', 'auto'], default: 'auto' }, resolution: { type: 'string', enum: ['480p', '720p'], default: '720p' }, generate_audio: { type: 'boolean', default: true } } }, outputSchema: {} } : { models, total: models.length, nextOffset: null } } }));
    try {
      const created = await request.post(`/api/agent-room/workspaces/${workspace.id}/creative-media`, { headers, data: { title: 'Seedance draft', config: { prompt: 'A coffee product rotates slowly' } } });
      expect(created.ok()).toBeTruthy();
      const workflow = (await created.json()).data;
      await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
      const node = page.getByTestId('video-workflow');
      await node.getByRole('combobox', { name: /Modelo|Model/, exact: true }).click();
      await page.locator('[data-slot=command-input]').fill('Seedance 2.5');
      await page.getByRole('option', { name: /Seedance 2.5 Text/ }).click();
      await expect(node.getByText(endpoint, { exact: true })).toBeVisible();
      await node.locator('select[id$="duration"]').selectOption('"30"');
      await expect(node.getByRole('switch')).toBeChecked();
      await node.getByRole('button', { name: /Salvar|Save|Guardar/, exact: true }).click();
      await expect.poll(async () => {
        const saved = await request.get(`/api/agent-room/workspaces/${workspace.id}/creative-media/workflows/${workflow.nodeId}`);
        return (await saved.json()).data.workflow.config;
      }).toMatchObject({ modelId: endpoint, parameters: { duration: '30', resolution: '720p', generate_audio: true } });
      await page.reload();
      await expect(node.locator('select[id$="duration"]')).toHaveValue('"30"');
      await page.screenshot({ path: '/tmp/orkestrai-seedance-catalog.png' });
    } finally { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); await rm(dir, { recursive: true, force: true }); }
  });
  test('persists a draft, exposes access settings and reopens in Workbench without charging', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-ui-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E video draft', workingDir: dir } })).json()).data;
    try {
      const response = await request.post(`/api/agent-room/workspaces/${workspace.id}/creative-media`, { headers, data: { title: 'Video draft', config: { prompt: 'A product rotates slowly', aspectRatio: '9:16' } } });
      expect(response.ok(), await response.text()).toBeTruthy();
      const workflow = (await response.json()).data;
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const node = page.getByTestId('video-workflow');
      await expect(node).toBeVisible();
      await expect(node.getByRole('textbox').first()).toHaveValue('A product rotates slowly');
      const prompt = node.getByRole('textbox').first();
      await prompt.fill('A product rotates slowly against a blue studio background');
      await node.getByRole('button', { name: /Salvar|Save|Guardar/, exact: true }).click();
      await expect(node.getByRole('button', { name: /Estimar|Estimate/ })).toBeDisabled();
      await page.reload();
      await expect(page.getByTestId('video-workflow').getByRole('textbox').first()).toHaveValue('A product rotates slowly against a blue studio background');
      // UI-only account fixture: no secret store or paid provider is contacted.
      await page.route(`**/api/agent-room/workspaces/${workspace.id}/creative-media`, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        body.data.profiles = [{ id: '11111111-1111-4111-8111-111111111111', name: 'UI test account', enabled: false, provider: 'fal', hasCredential: true, revision: 1 }];
        await route.fulfill({ response, json: body });
      });
      await page.getByRole('button', { name: /Configurar acesso|Configure access|Configurar acceso/ }).first().click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const tabs = dialog.getByRole('tab');
      await tabs.nth(1).click();
      await expect(tabs.nth(1)).toHaveAttribute('data-state', 'active');
      await expect(dialog.getByRole('switch').first()).not.toBeChecked();
      const box = await dialog.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
      await expect(page.getByTestId('video-workflow')).toBeVisible();
      await expect(page.getByTestId('video-workflow').getByRole('textbox').first()).toHaveValue('A product rotates slowly against a blue studio background');
      const denied = await request.post(`/api/agent-room/workspaces/${workspace.id}/creative-media/workflows/${workflow.nodeId}/preview`, { headers, data: {} });
      expect(denied.status()).toBe(422);
      expect((await denied.json()).error).toBe('creative_profile_required');
      await page.screenshot({ path: '/tmp/orkestrai-video-workbench.png' });
    } finally {
      try { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  });

  for (const [format, mimeType] of [['mp4', 'video/mp4'], ['webm', 'video/webm']]) test(`serves a real local ${format.toUpperCase()} with byte ranges and native playback`, async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-playback-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E video playback', workingDir: dir } })).json()).data;
    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      // Browser-generated test media exercises decoding without a paid API call.
      const bytes = await page.evaluate(async (mimeType) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const context = canvas.getContext('2d')!;
        const stream = canvas.captureStream(12);
        const recorder = new MediaRecorder(stream, { mimeType });
        const chunks: Blob[] = [];
        const finished = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType })); });
        recorder.start();
        for (let frame = 0; frame < 12; frame++) { context.fillStyle = frame % 2 ? '#087f8c' : '#e63946'; context.fillRect(0,0,320,180); await new Promise(resolve => setTimeout(resolve, 90)); }
        recorder.stop();
        const blob = await finished; stream.getTracks().forEach(track => track.stop());
        return Array.from(new Uint8Array(await blob.arrayBuffer()));
      }, mimeType);
      const video = Buffer.from(bytes); await writeFile(join(dir, `test.${format}`), video);
      const response = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'video', title: 'Playback test', x: 0, y: 0, width: 520, height: 390, payload: { path: `test.${format}`, mimeType, size: video.length, sha256: createHash('sha256').update(video).digest('hex'), width: 320, height: 180, duration: 1, fps: 12 } } });
      expect(response.ok()).toBeTruthy();
      const node = (await response.json()).data;
      const url = `/api/agent-room/workspaces/${workspace.id}/creative-media/videos/${node.id}`;
      const range = await request.get(url, { headers: { range: 'bytes=0-31' } });
      expect(range.status()).toBe(206); expect(await range.body()).toEqual(video.subarray(0,32));
      await page.goto(`/terminal?workspace=${workspace.id}&node=${node.id}`);
      await expect(page.locator('video')).toBeVisible();
      await page.locator('video').evaluate(async (element: HTMLVideoElement) => { element.muted = true; await element.play(); });
      await expect.poll(() => page.locator('video').evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
      expect(await page.locator('video').evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(320);
    } finally {
      try { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  });

  test('shows an unavailable official model contract after reopening its saved draft', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-unavailable-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E unavailable model', workingDir: dir } })).json()).data;
    const endpoint = 'fal-ai/unavailable-video';
    await page.route('**/creative-media/models?*', route => new URL(route.request().url()).searchParams.has('endpoint')
      ? route.fulfill({ status: 503, json: { error: 'creative_model_contract_unavailable' } })
      : route.fulfill({ json: { data: { models: [{ id: endpoint, name: 'Unavailable model', category: 'text-to-video', status: 'active' }], total: 1, nextOffset: null } } }));
    try {
      const response = await request.post(`/api/agent-room/workspaces/${workspace.id}/creative-media`, { headers, data: { title: 'Unavailable draft', config: { modelId: endpoint } } });
      expect(response.ok()).toBeTruthy();
      const workflow = (await response.json()).data;
      await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
      const node = page.getByTestId('video-workflow');
      await expect(node.getByRole('alert')).toContainText('creative_model_contract_unavailable');
      await expect(node.getByRole('button', { name: /Estimar|Estimate/ })).toBeDisabled();
    } finally { await request.delete(`/api/agent-room/workspaces/${workspace.id}`); await rm(dir, { recursive: true, force: true }); }
  });

  test('keeps video controls accessible in both themes and compact viewports', async ({ page, request }) => {
    test.setTimeout(60000);
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-video-themes-'));
    const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E video themes', workingDir: dir } })).json()).data;
    try {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/creative-media`, { headers, data: { title: 'Vertical campaign', config: { prompt: 'A paper sculpture with soft light', aspectRatio: '9:16' } } });
      for (const [theme, language] of [['orkestrai-light', 'en'], ['orkestrai-dark', 'es']]) {
        await request.put('/api/agent-room/settings', { data: { ...settings, appTheme: theme, uiLanguage: language } });
        await page.setViewportSize({ width: 1024, height: 640 });
        await page.goto(`/canvas?workspace=${workspace.id}`);
        await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);
        await expect(page.getByTestId('video-workflow')).toBeVisible();
        await page.screenshot({ path: `/tmp/orkestrai-video-${theme}.png` });
        await page.getByRole('button', { name: /Configure access|Configurar acceso/ }).first().click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.getByLabel(/API key|Clave API/)).toBeVisible();
        const overflow = await dialog.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
        const save = dialog.getByRole('button', { name: /Save|Guardar/, exact: true });
        const box = await save.boundingBox();
        expect(box!.y + box!.height).toBeLessThanOrEqual(640);
        const accountName = dialog.getByRole('textbox', { name: /Account name|Nombre de la cuenta/ });
        await accountName.fill('');
        await save.click();
        await expect(accountName).toHaveAttribute('aria-invalid', 'true');
        await expect(dialog.getByRole('alert')).toBeVisible();
        await page.screenshot({ path: `/tmp/orkestrai-video-account-${theme}.png` });
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
      }
    } finally {
      try { await request.put('/api/agent-room/settings', { data: settings }); await request.delete(`/api/agent-room/workspaces/${workspace.id}`); }
      finally { await rm(dir, { recursive: true, force: true }); }
    }
  });
});
