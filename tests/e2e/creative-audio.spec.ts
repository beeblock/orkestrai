import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('creates audio from the menu, edits literal speech and plays project audio in both views', async ({ page, request }) => {
  test.setTimeout(120000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-audio-ui-'));
  let workspaceId = '', submissions = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Audio workflow UI QA', workingDir: dir } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}/creative-media`;
    const models = [
      { id: 'fal-ai/elevenlabs/music', name: 'ElevenLabs Music', category: 'text-to-audio', status: 'active' },
      { id: 'fal-ai/elevenlabs/tts/eleven-v3', name: 'ElevenLabs speech', category: 'text-to-speech', status: 'active' },
      { id: 'fal-ai/elevenlabs/voice-changer', name: 'ElevenLabs voice changer', category: 'audio-to-audio', status: 'active' },
    ];
    await page.route(`**${base}/models?*`, route => {
      const query = new URL(route.request().url()).searchParams;
      if (query.has('pricingIds')) return route.fulfill({ json: { data: { prices: [] } } });
      if (!query.has('endpoint')) return route.fulfill({ json: { data: { models, total: models.length, nextOffset: null } } });
      const model = models.find(item => item.id === query.get('endpoint'))!;
      return route.fulfill({ json: { data: { ...model, documentationUrl: `https://fal.ai/models/${model.id}/api`, digest: 'a'.repeat(64), outputSchema: {}, schema: { type: 'object', additionalProperties: false, required: model === models[1] ? ['text'] : [], properties: model === models[0] ? {
        prompt: { type: 'string', maxLength: 4100 }, music_length_ms: { type: 'integer', minimum: 3000, maximum: 600000, title: 'Duration (ms)' }, force_instrumental: { type: 'boolean', title: 'Instrumental', default: false }, output_format: { type: 'string', default: 'mp3_44100_128' },
      } : model === models[2] ? { audio_url: { type: 'string' }, voice: { type: 'string', default: 'Rachel' } } : {
        text: { type: 'string', title: 'Text', minLength: 1, maxLength: 5000 }, voice: { type: 'string', title: 'Voice', default: 'Rachel', examples: ['Aria', 'Rachel'] }, language_code: { type: 'string', title: 'Language' },
      } } } } });
    });
    await page.route('**/creative-media/**/runs', route => { submissions++; return route.abort(); });
    await page.setViewportSize({ width: 1100, height: 760 });
    await page.goto(`/terminal?workspace=${workspaceId}`);
    await page.getByRole('button', { name: 'Images', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Audio workflow', exact: true }).click();
    const node = page.getByTestId('video-workflow');
    await expect(node.getByRole('combobox', { name: 'Audio provider', exact: true })).toHaveValue('fal');
    await expect(node.locator('[data-model-parameter="/music_length_ms"] input')).toHaveValue('30000');
    await expect(node.getByRole('combobox', { name: 'Audio provider', exact: true }).locator('option')).toHaveCount(1);
    expect(await node.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '/tmp/orkestrai-audio-music-light.png' });
    await node.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: /ElevenLabs speech/ }).click();
    const text = node.locator('[data-model-parameter="/text"] textarea');
    await expect(text).toBeVisible();
    await expect(node.locator('[data-model-parameter="/music_length_ms"]')).toHaveCount(0);
    await text.fill('Only these words. Olá, mundo!');
    await node.locator('[data-model-parameter="/voice"]').getByRole('combobox').selectOption('Aria');
    await node.getByRole('button', { name: 'Save', exact: true }).click();
    const workflowId = new URL(page.url()).searchParams.get('node')!;
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflowId}`)).json()).data.workflow.config).toMatchObject({ modality: 'audio', parameters: { text: 'Only these words. Olá, mundo!', voice: 'Aria' } });
    await page.reload();
    await expect(text).toHaveValue('Only these words. Olá, mundo!');
    await expect(node.getByRole('button', { name: 'Estimate cost', exact: true })).toBeDisabled();
    for (const theme of ['orkestrai-dark', 'orkestrai-light']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: theme } });
      await page.goto(`/canvas?workspace=${workspaceId}`);
      await expect(text).toHaveValue('Only these words. Olá, mundo!');
      expect(await node.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `/tmp/orkestrai-audio-canvas-${theme}.png` });
    }
    // A deterministic WAV exercises real storage/playback, with no provider call.
    const wav = Buffer.alloc(44 + 16000 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    await mkdir(join(dir, 'generated/audio'), { recursive: true });
    await writeFile(join(dir, 'generated/audio/sample.wav'), wav);
    const asset = (await (await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, { data: { type: 'video', title: 'Audio playback fixture', x: 800, y: 0, width: 350, height: 240, payload: { path: 'generated/audio/sample.wav', mimeType: 'audio/wav' } } })).json()).data;
    const index = (await (await request.get(base)).json()).data;
    expect(index.inputs.find(item => item.id === asset.id).mimeType).toBe('audio/wav');
    const response = await request.get(`${base}/videos/${asset.id}`, { headers: { range: 'bytes=0-43' } });
    expect(response.status()).toBe(206);
    expect(response.headers()['content-type']).toBe('audio/wav');
    expect(await response.body()).toEqual(wav.subarray(0, 44));
    for (const view of ['terminal', 'canvas']) {
      await page.goto(`/${view}?workspace=${workspaceId}&node=${asset.id}`);
      const audio = page.locator('audio');
      await expect(audio).toBeVisible();
      await expect.poll(() => audio.evaluate(element => element.readyState)).toBeGreaterThan(0);
      expect(await audio.evaluate(element => element.duration)).toBe(1);
      await audio.click({ position: { x: 25, y: 25 } });
      await audio.evaluate(element => element.play());
      await expect.poll(() => audio.evaluate(element => element.currentTime)).toBeGreaterThan(0);
      await audio.evaluate(element => element.pause());
      await page.screenshot({ path: `/tmp/orkestrai-audio-playback-${view}.png` });
    }
    await page.goto(`/terminal?workspace=${workspaceId}&node=${workflowId}`);
    await node.getByRole('combobox', { name: 'Model', exact: true }).click();
    await page.getByRole('option', { name: /ElevenLabs voice changer/ }).click();
    const refs = node.getByTestId('creative-media-inputs');
    await refs.getByRole('button', { name: 'Attach workspace media', exact: true }).click();
    await refs.getByRole('combobox').nth(1).click();
    await page.getByRole('option', { name: /Audio playback fixture/ }).click();
    await node.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${base}/workflows/${workflowId}`)).json()).data.workflow.config.mediaBindings).toEqual([{ pointer: '/audio_url', nodeId: asset.id }]);
    await page.screenshot({ path: '/tmp/orkestrai-audio-reference.png' });
    // Privacy changes are explicit owner settings, never a download fallback.
    const profileId = '00000000-0000-4000-8000-000000000001';
    let savedPolicy: Record<string, unknown> = { enabled: true, allowAgents: false, allowExternalMedia: true, falOutputAccess: 'private', modelIds: [], maxRunCents: 100, maxDayCents: 500, maxConcurrentRuns: 1 };
    await page.route(`**${base}`, route => route.fulfill({ json: { data: { profiles: [{ id: profileId, name: 'Privacy fixture', provider: 'fal', enabled: true, hasCredential: true, revision: 1 }], policies: [{ ...savedPolicy, profileId, workspaceId, revision: 1 }], inputs: [], workflows: [] } } }));
    await page.route(`**${base}/policies/${profileId}`, async route => {
      savedPolicy = route.request().postDataJSON();
      await route.fulfill({ json: { data: { ...savedPolicy, profileId, workspaceId } } });
    });
    await node.getByRole('button', { name: 'Configure access', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Workspace permissions', exact: true }).click();
    const access = dialog.getByRole('combobox', { name: 'fal.ai output access', exact: true });
    await expect(access).toHaveValue('private');
    await access.selectOption('temporary_link');
    await expect(dialog.getByText(/Link mode allows anyone with the URL/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => savedPolicy.falOutputAccess).toBe('temporary_link');
    await expect(access).toHaveValue('temporary_link');
    expect(await dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: '/tmp/orkestrai-audio-output-access.png' });
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    expect(submissions).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(dir, { recursive: true, force: true });
  }
});
