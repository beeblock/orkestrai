import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('drops real videos as playable, persistent native workflow references without contacting providers', async ({ page, request }) => {
  test.setTimeout(90000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-video-drop-'));
  const root = '/api/agent-room/workspaces';
  const workspace = (await (await request.post(root, { data: { name: 'E2E video drop', workingDir: dir } })).json()).data;
  let paidRequests = 0;
  page.on('request', req => { if (/fal\.ai|higgsfield|byteplus/.test(req.url())) paidRequests++; });
  try {
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.blank-canvas, .svelte-flow__pane').first()).toBeVisible();
    const encoded = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(10);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      recorder.ondataavailable = event => chunks.push(event.data);
      const finished = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      for (const color of ['#168766', '#e36550', '#168766']) {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 160, 120);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      recorder.stop(); await finished; stream.getTracks().forEach(track => track.stop());
      return btoa(String.fromCharCode(...new Uint8Array(await new Blob(chunks).arrayBuffer())));
    });
    const transfer = await page.evaluateHandle(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'Beach reference.webm', { type: 'video/webm' }));
      data.items.add(new File([bytes], 'Second angle.WEBM')); // Explorer may omit MIME.
      data.items.add(new File(['# Direction\nPreserve the original character.'], 'Direction.md', { type: 'text/markdown' }));
      return data;
    }, encoded);
    await page.locator('.blank-canvas, .svelte-flow__pane').first().dispatchEvent('drop', { dataTransfer: transfer, clientX: 600, clientY: 260 });
    await transfer.dispose();
    let nodes: any[] = [];
    await expect.poll(async () => {
      nodes = (await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data;
      return nodes.filter(node => node.type === 'video').length;
    }).toBe(2);
    await expect.poll(async () => (await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data.filter((node: any) => node.type === 'document').length).toBe(1);
    const videos = nodes.filter(node => node.type === 'video');
    expect(new Set(videos.map(node => `${node.x}:${node.y}`)).size).toBe(2);
    for (const node of videos) expect(readFileSync(join(dir, node.payload.path))).toEqual(Buffer.from(encoded, 'base64'));
    await page.goto(`/terminal?workspace=${workspace.id}&node=${videos[0].id}`);
    const player = page.locator('video').first();
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, height: element.videoHeight, error: element.error?.code ?? null }))).toEqual({ width: 160, height: 120, error: null });
    await player.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await page.reload();
    await expect(player).toBeVisible();
    const inputs = (await (await request.get(`${root}/${workspace.id}/creative-media`)).json()).data.inputs;
    expect(inputs.filter((node: any) => node.type === 'video').map((node: any) => node.title).sort()).toEqual(['Beach reference.webm', 'Second angle.WEBM']);
    const modelId = 'fal-ai/test/video-to-video';
    const model = { id: modelId, name: 'Video reference fixture', category: 'video-to-video', status: 'active', documentationUrl: 'https://fal.ai/models/test' };
    await page.route(`**/workspaces/${workspace.id}/creative-media/models?*`, route => route.fulfill({ json: { data: new URL(route.request().url()).searchParams.has('endpoint') ? {
      ...model, digest: 'a'.repeat(64), outputSchema: {}, schema: { type: 'object', properties: { prompt: { type: 'string' }, video_url: { type: 'string' } } },
    } : { models: [model], total: 1, nextOffset: null } } }));
    const draftResponse = await request.post(`${root}/${workspace.id}/creative-media`, {
      headers: { origin: 'http://127.0.0.1:5199' },
      data: { title: 'Continue the imported clip', config: { modelId, mediaBindings: [{ pointer: '/video_url', nodeId: videos[0].id }] } },
    });
    expect(draftResponse.ok()).toBe(true);
    const draft = (await draftResponse.json()).data;
    await page.goto(`/terminal?workspace=${workspace.id}&node=${draft.nodeId}`);
    const references = page.getByTestId('creative-media-inputs');
    await expect(references.getByRole('combobox').nth(1)).toContainText('Beach reference.webm');
    await references.getByTestId('creative-media-preview').getByRole('button').click();
    const referencePlayer = page.getByRole('dialog').locator('video');
    await expect.poll(() => referencePlayer.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(160);
    await page.screenshot({ path: '/tmp/orkestrai-imported-video-reference.png' });
    await page.keyboard.press('Escape');
    // A disguised HTML file must not become a document or an executable video.
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const invalid = await page.evaluateHandle(() => {
      const data = new DataTransfer(); data.items.add(new File(['<html>' + 'not a movie'.repeat(10)], 'bad.mp4', { type: 'video/mp4' })); return data;
    });
    const failed = page.waitForResponse(response => response.url().endsWith('/creative-media/videos') && response.status() === 422);
    await page.locator('.svelte-flow__pane').dispatchEvent('drop', { dataTransfer: invalid, clientX: 700, clientY: 300 });
    await failed; await invalid.dispose();
    await expect(page.getByText(/bad\.mp4/)).toBeVisible();
    expect((await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data).toHaveLength(4);
    expect(paidRequests).toBe(0);
  } finally {
    await page.goto('about:blank').catch(() => undefined);
    await request.delete(`${root}/${workspace.id}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
