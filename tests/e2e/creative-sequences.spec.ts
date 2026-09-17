import { test, expect } from '@playwright/test';
import { access, mkdtemp, readFile, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

test('discovers sequences and confirms the optional encoder without starting a download', async ({ page, request }) => {
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-sequence-empty-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Empty sequence', workingDir: folder } })).json()).data; workspaceId = workspace.id;
    await page.goto(`/terminal?workspace=${workspaceId}`);
    await page.getByRole('button', { name: 'Images', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Video sequence', exact: true }).click();
    const ui = page.getByTestId('video-sequence');
    await expect(ui.getByRole('button', { name: 'Export MP4', exact: true })).toBeDisabled();
    const runtime = (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/creative-media/sequences?command=runtime`)).json()).data;
    if (!runtime.installed) {
      await ui.getByRole('button', { name: 'Install video encoder', exact: true }).click();
      const dialog = page.getByRole('alertdialog');
      await expect(dialog.getByRole('link', { name: 'FFmpeg · GPL-3.0-or-later' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(ui.getByRole('button', { name: 'Install video encoder', exact: true })).toBeEnabled();
    }
    expect((await request.get(`/api/agent-room/workspaces/${workspaceId}/creative-media/sequences?command=install_runtime`)).status()).toBe(405);
  } finally {
    if (workspaceId) expect.soft((await request.delete(`/api/agent-room/workspaces/${workspaceId}`)).ok()).toBe(true);
    await request.put('/api/agent-room/settings', { data: settings }).catch(() => undefined);
    await rm(folder, { recursive: true, force: true });
  }
});

test('edit and export a native video sequence through Workbench and Canvas', async ({ page, request }) => {
  test.setTimeout(180000);
  const runtimeSource = process.env.ORKESTRAI_TEST_ENCODER_HOME;
  test.skip(!runtimeSource || !await access(join(runtimeSource, 'installed.json')).then(() => true, () => false), 'Real encoder acceptance requires the verified optional runtime fixture.');
  await cp(runtimeSource!, resolve('test-runtime/creative-encoder/9.0.1-r1'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(runtimeSource!, 'installed.json'), 'utf8'));
  const folder = await mkdtemp(join(tmpdir(), 'orkestrai-sequence-ui-'));
  const headers = { origin: 'http://127.0.0.1:5199' }, errors: string[] = [];
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  page.on('pageerror', error => errors.push(error.message));
  try {
    execFileSync(join(runtimeSource!, manifest.ffmpeg.path), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(folder, 'shot.mp4')], { timeout: 30000 });
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Sequence acceptance', workingDir: folder } })).json()).data; workspaceId = workspace.id;
    expect((await request.get(`/api/agent-room/workspaces/${workspaceId}/creative-media/sequences?command=install_runtime`)).status()).toBe(405);
    expect((await request.post(`/api/agent-room/workspaces/${workspaceId}/creative-media/sequences`, { headers: { origin: 'https://untrusted.example' }, data: { command: 'install_runtime' } })).status()).toBe(403);
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, { data: { type: 'video', title: 'Opening shot', payload: { path: 'shot.mp4' } } })).json()).data;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/terminal?workspace=${workspaceId}`);
    await page.getByRole('button', { name: 'Images', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Video sequence', exact: true }).click();
    const ui = page.getByTestId('video-sequence');
    await expect(ui).toBeVisible();
    await ui.getByRole('combobox', { name: 'Choose a workspace video' }).click();
    await page.getByRole('option', { name: 'Opening shot', exact: true }).click();
    await ui.getByRole('button', { name: 'Add clip', exact: true }).click();
    await expect(ui.getByRole('navigation').getByText('1. Opening shot')).toBeVisible();
    await ui.getByRole('textbox', { name: 'Caption', exact: true }).fill('A complete story');
    await ui.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(ui.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await ui.getByRole('combobox', { name: 'Aspect ratio', exact: true }).click();
    await page.getByRole('option', { name: '9:16 · 1080×1920', exact: true }).click();
    await expect(ui.getByRole('combobox', { name: 'Aspect ratio' })).toContainText('9:16');
    await ui.getByRole('button', { name: 'Play sequence' }).click();
    await expect.poll(() => ui.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
    await ui.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.screenshot({ path: '/tmp/orkestrai-sequence-light.png' });
    await ui.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.getBoundingClientRect().height ?? 0)).toBeGreaterThan(600);
    await page.screenshot({ path: '/tmp/orkestrai-sequence-fullscreen.png' });
    await ui.getByRole('button', { name: 'Full screen', exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await ui.getByRole('button', { name: 'Export MP4', exact: true }).click();
    await expect(ui.getByRole('button', { name: 'Open exported video' })).toBeVisible({ timeout: 90000 });
    const endpoint = `/api/agent-room/workspaces/${workspaceId}/creative-media/sequences`;
    const sequence = (await (await request.get(endpoint)).json()).data[0];
    expect(sequence.export).toMatchObject({ state: 'completed', revision: 4, progress: 100 });
    const output = join(folder, sequence.export.path); await access(output);
    const metadata = JSON.parse(execFileSync(join(runtimeSource!, manifest.ffprobe.path), ['-v', 'error', '-show_streams', '-of', 'json', output], { encoding: 'utf8' }));
    expect(metadata.streams.find((stream: { codec_type: string }) => stream.codec_type === 'video')).toMatchObject({ width: 1080, height: 1920 });
    expect(sequence.document.clips[0].nodeId).toBe(node.id);
    // Reusing the same file must still seek and play the next clip as a new segment.
    await ui.getByRole('button', { name: 'Add clip', exact: true }).click();
    await expect(ui.getByRole('navigation').getByText('2. Opening shot')).toBeVisible();
    await ui.getByRole('button', { name: 'Play sequence' }).click();
    await expect(ui.getByRole('navigation').getByRole('button').nth(1)).toHaveAttribute('aria-current', 'step');
    await expect.poll(() => ui.locator('video').evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0)).toBe(true);
    await ui.getByRole('button', { name: 'Pause', exact: true }).click();
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto(`/canvas?workspace=${workspaceId}`);
    await expect(ui).toBeVisible();
    await expect.poll(() => ui.locator('video').evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    expect(await ui.locator('video').evaluate((video: HTMLVideoElement) => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32;
      const context = canvas.getContext('2d')!; context.drawImage(video, 0, 0, 32, 32);
      const bytes = context.getImageData(0, 0, 32, 32).data;
      return bytes.some((value, index) => index % 4 !== 3 && value > 80);
    })).toBe(true);
    await page.screenshot({ path: '/tmp/orkestrai-sequence-canvas-dark.png' });
    await ui.getByRole('button', { name: 'Open exported video' }).click();
    await expect(page.getByTestId('video-sequence')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) expect.soft((await request.delete(`/api/agent-room/workspaces/${workspaceId}`)).ok()).toBe(true);
    await request.put('/api/agent-room/settings', { data: settings }).catch(() => undefined);
    await rm(folder, { recursive: true, force: true });
  }
});
