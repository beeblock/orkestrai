import { expect, test } from '@playwright/test';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps a reference-led video draft readable in the Canvas in both themes', async ({ page, request }) => {
  test.setTimeout(90000);
  const directory = await mkdtemp(join(tmpdir(), 'ork-creative-showcase-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const headers = { origin: 'http://127.0.0.1:5199' };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // The draft is real; catalog networking and paid generation are not needed.
  await page.route('**/creative-media/models?*', route => route.fulfill({ json: { data: { models: [], total: 0, nextOffset: null } } }));
  let workspaceId = '';
  try {
    await copyFile(process.env.ORKESTRAI_SHOWCASE_REFERENCE ?? 'electron/resources/icons/512x512.png', join(directory, 'reference.png'));
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Nodo - launch film', workingDir: directory } })).json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const imageResponse = await request.post(`${base}/nodes`, { data: { type: 'image', title: 'Nodo - opening reference', x: 0, y: 0, width: 420, height: 420, payload: { path: 'reference.png' } } });
    expect(imageResponse.ok()).toBe(true);
    const image = (await imageResponse.json()).data;
    const noteResponse = await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Creative direction', x: 0, y: 450, width: 420, height: 280, payload: { content: '# Meet Nodo\n\nA short launch film for Orkestrai.\n\n- Keep the approved character and brand colors.\n- One continuous, gentle camera movement.\n- Review each take before assembling the final film.' } } });
    expect(noteResponse.ok()).toBe(true);
    const note = (await noteResponse.json()).data;
    const created = await request.post(`${base}/creative-media`, { headers, data: { title: '01 - Bring Nodo to life', config: { modelId: 'kling-v3-pro-image', prompt: 'Animate the approved Nodo reference. A slow camera push-in, a small friendly wave, soft studio lighting. Preserve the character silhouette and brand colors throughout the shot. No dialogue.', startImageNodeId: image.id, contextNodeIds: [note.id], duration: 5, generateAudio: true } } });
    expect(created.ok(), await created.text()).toBe(true);
    const workflow = (await created.json()).data;
    expect((await request.patch(`${base}/nodes/${workflow.nodeId}`, { data: { x: 470, y: 0, width: 660, height: 760 } })).ok()).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const theme of ['light', 'dark']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, appTheme: `orkestrai-${theme}`, uiLanguage: 'en', pinnedAgentProviders: '[]' } });
      await page.goto(`/canvas?workspace=${workspaceId}`);
      await expect(page.locator('html')).toHaveAttribute('data-app-theme', `orkestrai-${theme}`);
      await expect(page.getByTestId('video-workflow').getByRole('textbox', { name: 'Direction', exact: true })).toHaveValue(/Animate the approved Nodo/);
      await expect(page.getByTestId('video-workflow').getByRole('button', { name: /Estimate/ })).toBeDisabled();
      await expect(page.locator('.canvas-note').getByRole('textbox')).toHaveValue(/Meet Nodo/);
      await page.locator('.canvas-note').getByRole('button', { name: 'View formatted', exact: true }).click();
      await expect(page.locator('.canvas-note')).toContainText('Meet Nodo');
      const reference = page.locator('.svelte-flow__node').filter({ hasText: 'Nodo - opening reference' }).locator('img').first();
      await expect(reference).toBeVisible();
      await expect.poll(() => reference.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
      await page.evaluate(() => document.fonts.ready);
      if (process.env.ORKESTRAI_SHOWCASE_DIR) {
        await mkdir(process.env.ORKESTRAI_SHOWCASE_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.ORKESTRAI_SHOWCASE_DIR, `video-workflows-${theme}.png`), animations: 'disabled' });
      }
    }
    expect(errors).toEqual([]);
    const saved = (await (await request.get(`${base}/creative-media/workflows/${workflow.nodeId}`)).json()).data;
    expect(saved.runs).toEqual([]);
    expect(saved.workflow.config.startImageNodeId).toBe(image.id);
  } finally {
    if (workspaceId) expect.soft((await request.delete(`/api/agent-room/workspaces/${workspaceId}`)).ok()).toBe(true);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(directory, { recursive: true, force: true });
  }
});
