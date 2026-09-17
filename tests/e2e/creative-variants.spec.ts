import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('reviews actual variants, invalidates changed evidence and shares video transport', async ({ page, request }) => {
  test.setTimeout(120000);
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-variants-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Variant verification', workingDir: folder } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const bytes = await readFile('electron/resources/icons/512x512.png');
    await writeFile(join(folder, 'image.png'), bytes);
    const add = async (type: string, title: string, path: string) => (await (await request.post(`${base}/nodes`, { data: { type, title, payload: { path } } })).json()).data;
    const image = await add('image', 'Image A', 'image.png');
    await add('image', 'Image B', 'image.png');
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/terminal?workspace=${workspaceId}&node=${image.id}`);
    await page.getByRole('button', { name: 'Compare and review', exact: true }).click();
    const dialog = page.getByTestId('creative-asset-review');
    const left = dialog.getByRole('region', { name: 'A', exact: true });
    await expect(left.getByRole('button', { name: 'Approve', exact: true })).toBeEnabled();
    await left.getByRole('textbox').fill('The actual output has been reviewed.');
    await left.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(left.getByText('Approved', { exact: true }).first()).toBeVisible();
    await writeFile(join(folder, 'image.png'), Buffer.concat([bytes, Buffer.from('changed')]));
    await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(left.getByText('File or provenance changed', { exact: true })).toBeVisible();
    await page.screenshot({ path: '/tmp/orkestrai-variants-light.png' });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    const data = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext('2d')!, stream = canvas.captureStream(10);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/mp4' });
      const chunks: Blob[] = [];
      const done = new Promise<Blob>(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' })); });
      recorder.start();
      for (let i = 0; i < 15; i++) { context.fillStyle = i % 2 ? '#108e75' : '#f15368'; context.fillRect(0, 0, 320, 180); await new Promise(resolve => setTimeout(resolve, 100)); }
      recorder.stop(); const blob = await done; stream.getTracks().forEach(track => track.stop());
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    });
    await writeFile(join(folder, 'clip.mp4'), Buffer.from(data));
    const video = await add('video', 'Video A', 'clip.mp4');
    await add('video', 'Video B', 'clip.mp4');
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    await page.goto(`/terminal?workspace=${workspaceId}&node=${video.id}`);
    await page.getByRole('button', { name: 'Compare and review', exact: true }).click();
    await expect(dialog.locator('video')).toHaveCount(2);
    await dialog.getByRole('button', { name: 'Play both clips', exact: true }).click();
    await expect.poll(() => dialog.locator('video').first().evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1);
    await dialog.getByRole('button', { name: 'Pause both clips', exact: true }).click();
    expect(await dialog.locator('video').evaluateAll(elements => elements.every(element => (element as HTMLVideoElement).paused))).toBe(true);
    const seek = dialog.getByRole('slider'); await seek.focus(); await page.keyboard.press('ArrowRight');
    const times = await dialog.locator('video').evaluateAll(elements => elements.map(element => (element as HTMLVideoElement).currentTime));
    expect(Math.abs(times[0] - times[1])).toBeLessThan(0.13);
    await page.screenshot({ path: '/tmp/orkestrai-variants-dark.png' });
    await page.setViewportSize({ width: 620, height: 640 });
    await expect.poll(async () => (await dialog.boundingBox())!.x).toBeGreaterThanOrEqual(0);
    const bounds = await dialog.boundingBox(); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(640);
    const panes = dialog.locator('section');
    const first = (await panes.nth(0).boundingBox())!, second = (await panes.nth(1).boundingBox())!;
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    const history = (await panes.nth(0).locator('summary').boundingBox())!;
    expect(history.y + history.height).toBeLessThanOrEqual(first.y + first.height + 1);
    await page.screenshot({ path: '/tmp/orkestrai-variants-small.png' });
    await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(folder, { recursive: true, force: true });
  }
});
