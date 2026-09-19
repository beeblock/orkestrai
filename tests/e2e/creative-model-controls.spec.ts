import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('edits model examples, nested inputs, defaults and account prices without generating', async ({ page, request }) => {
  test.setTimeout(90000);
  const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-model-controls-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E model controls', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}/creative-media`;
  const profileId = '11111111-1111-4111-8111-111111111111';
  const endpoint = 'minimax/h3/image-to-video';
  const second = 'fal-ai/other-video';
  const models = [{ id: endpoint, name: 'MiniMax H3', status: 'active', category: 'image-to-video' }, { id: second, name: 'Other model', status: 'active', category: 'text-to-video' }];
  let submissions = 0;
  await page.route('**/creative-media/**/runs', route => { submissions++; return route.abort(); });
  await page.route(`**${base}/models?*`, route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.has('pricingIds')) return route.fulfill({ json: { data: { prices: query.get('pricingIds')!.split(',').map(id => ({ endpointId: id, unitPrice: 0.06, unit: 'second', currency: 'USD' })) } } });
    if (query.has('endpoint')) return route.fulfill({ json: { data: { ...models.find(model => model.id === query.get('endpoint')), digest: 'a'.repeat(64), documentationUrl: `https://fal.ai/models/${endpoint}/api`, outputSchema: {}, schema: { type: 'object', additionalProperties: false, required: ['prompt'], properties: query.get('endpoint') === second ? { prompt: { type: 'string' }, duration: { type: 'integer', default: 5 } } : {
      prompt: { type: 'string' }, duration: { type: 'integer', minimum: 1, maximum: 15, default: 5 },
      prompt_expansion_mode: { type: 'string', default: 'balanced', description: 'Rewrite direction, not render speed. <img src=x onerror=alert(1)>', examples: ['disabled', 'fast', 'balanced', 'quality'] },
      generate_audio: { type: 'boolean', default: true },
      settings: { type: 'object', properties: { strength: { type: 'number', minimum: 0, maximum: 1, default: 0.5 } } },
      scenes: { type: 'array', maxItems: 2, items: { type: 'object', properties: { text: { type: 'string' } } } },
    } } } } });
    return route.fulfill({ json: { data: { models, total: models.length, nextOffset: null } } });
  });
  await page.route(`**${base}`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.data.profiles = [{ id: profileId, name: 'No-charge UI fixture', enabled: true, hasCredential: true, provider: 'fal', revision: 1 }];
    await route.fulfill({ response, json: body });
  });
  try {
    const response = await request.post(base, { headers: { origin: 'http://127.0.0.1:5199' }, data: { title: 'Model fields test', config: { modelId: endpoint, profileId, prompt: 'Approved direction' } } });
    expect(response.ok()).toBe(true);
    const workflow = (await response.json()).data;
    await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.nodeId}`);
    const node = page.getByTestId('video-workflow');
    await expect(node.getByTestId('model-unit-price')).toContainText(/0[.,]06/);
    await expect(node.locator('[data-model-parameter="/generate_audio"]').getByRole('switch')).toBeChecked();
    const expansion = node.locator('[data-model-parameter="/prompt_expansion_mode"]');
    await expect(expansion.getByText(/Rewrite direction/)).toBeVisible();
    await expect(expansion.locator('img')).toHaveCount(0);
    await expansion.getByRole('combobox').selectOption('disabled');
    await expect(expansion.getByRole('textbox')).toHaveValue('disabled');
    await node.getByText(/Additional model parameters|Parâmetros adicionais|Parámetros adicionales/, { exact: true }).click();
    await node.locator('[data-model-parameter="/settings/strength"]').getByRole('spinbutton').fill('0.8');
    const scenes = node.locator('[data-model-parameter="/scenes"]');
    await scenes.getByRole('button', { name: /Add item|Adicionar item|Añadir elemento/, exact: true }).click();
    await node.locator('[data-model-parameter="/scenes/0/text"]').getByRole('textbox').fill('A continuous scene');
    await node.getByRole('button', { name: /Save|Salvar|Guardar/, exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflow.nodeId}`)).json()).data.workflow.config.parameters).toMatchObject({ prompt_expansion_mode: 'disabled', settings: { strength: 0.8 }, scenes: [{ text: 'A continuous scene' }] });
    await page.reload();
    await expect(node.locator('[data-model-parameter="/prompt_expansion_mode"]').getByRole('textbox')).toHaveValue('disabled');
    for (const [theme, language] of [['orkestrai-light', 'en'], ['orkestrai-dark', 'es']]) {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, appTheme: theme, uiLanguage: language } });
      await page.setViewportSize({ width: 1100, height: 740 });
      await page.reload();
      await expect(node.locator('[data-model-parameter="/prompt_expansion_mode"]').getByRole('textbox')).toHaveValue('disabled');
      const overflow = await node.evaluate(element => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `/tmp/orkestrai-model-controls-${theme}.png` });
      await node.locator('[data-model-parameter="/prompt_expansion_mode"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `/tmp/orkestrai-model-controls-fields-${theme}.png` });
    }
    await node.getByRole('combobox', { name: /Model|Modelo/, exact: true }).click();
    await expect(page.getByRole('option', { name: /Other model/ })).toContainText(/0[.,]06/);
    await page.getByRole('option', { name: /Other model/ }).click();
    await expect(node.getByRole('alert').first()).toContainText(/prompt_expansion_mode/);
    await expect(node.getByRole('button', { name: /Estimate|Estimar/ })).toBeDisabled();
    expect(submissions).toBe(0);
    await page.screenshot({ path: '/tmp/orkestrai-model-parameter-mismatch.png' });
  } finally {
    await request.put('/api/agent-room/settings', { data: originalSettings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});
