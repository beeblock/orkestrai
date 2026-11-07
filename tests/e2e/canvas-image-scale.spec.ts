import { test, expect } from '@playwright/test';
import { createCanvas } from '@napi-rs/canvas';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emulateSlowCpu } from './helpers';

test('bounded previews preserve SVG pixels, transparency and aspect ratio', async ({ page, request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-image-format-'));
  await writeFile(join(directory, 'reference.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect x="60" width="120" height="120" fill="#ffcc55"/></svg>');
  const response = await request.post('/api/agent-room/workspaces', { data: { name: 'Image formats', workingDir: directory } });
  const workspace = (await response.json()).data;
  try {
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: {
      type: 'image', title: 'Vector reference', x: 100, y: 100, width: 320, height: 240, payload: { path: 'reference.svg' },
    } });
    await page.addInitScript(id => localStorage.setItem(`orkestrai.canvasViewport.${id}`,
      JSON.stringify({ x: 100, y: 100, zoom: 0.8 })), workspace.id);
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const canvas = page.locator('.canvas-image canvas.ready');
    await expect(canvas).toHaveCount(1);
    expect(await canvas.evaluate((surface: HTMLCanvasElement) => ({
      ratio: surface.width / surface.height,
      center: [...surface.getContext('2d')!.getImageData(surface.width / 2, surface.height / 2, 1, 1).data],
      corner: [...surface.getContext('2d')!.getImageData(0, 0, 1, 1).data],
    }))).toEqual({ ratio: 2, center: [255, 204, 85, 255], corner: [0, 0, 0, 0] });
    await page.locator('.svelte-flow__controls-zoomin').click();
    await expect.poll(() => canvas.evaluate((surface: HTMLCanvasElement) => surface.width)).toBe(512);
    await canvas.evaluate(surface => {
      (window as any).__previewResizes = 0;
      const observer = new MutationObserver(records => { (window as any).__previewResizes += records.length; });
      observer.observe(surface, { attributes: true, attributeFilter: ['width', 'height'] });
    });
    const before = await page.locator('.zoom-level').innerText();
    await page.locator('.svelte-flow__controls-zoomin').click();
    await expect(page.locator('.zoom-level')).not.toHaveText(before);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => (window as any).__previewResizes)).toBe(0);
  } finally {
    await page.goto('about:blank');
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(directory, { recursive: true, force: true });
  }
});

test('cancelled asset responses leave Core responsive for the next Canvas request', async ({ page, request }) => {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-asset-cancellation-'));
  await writeFile(join(directory, 'asset.bin'), Buffer.alloc(8 * 1024 * 1024, 0x5a));
  const response = await request.post('/api/agent-room/workspaces', { data: {
    name: 'Asset cancellation QA', workingDir: directory, codeIntelligenceMode: 'disabled',
  } });
  const workspace = (await response.json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    await page.goto(`/canvas?workspace=${workspace.id}`);
    for (let round = 0; round < 4; round++) {
      await page.evaluate(async ({ url, round }) => {
        await Promise.all(Array.from({ length: 8 }, async (_, index) => {
          const abort = new AbortController();
          const timer = setTimeout(() => abort.abort(), (index + round) % 8);
          try {
            const response = await fetch(url, { signal: abort.signal, cache: 'no-store' });
            if (!response.ok) throw new Error(`Asset response ${response.status}`);
            const reader = response.body?.getReader();
            if (reader) { await reader.read(); await reader.cancel(); }
          } catch (error) {
            if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
          } finally { clearTimeout(timer); }
        }));
      }, { url: `${base}/fs/raw?path=asset.bin`, round });
      // This server has no restart supervisor: a fatal stream error cannot be
      // hidden by reconnecting to a fresh Core between cancellation rounds.
      expect((await request.get('/api/agent-room/settings')).ok()).toBe(true);
    }
    expect((await request.get(`${base}/nodes`)).ok()).toBe(true);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await request.delete(base);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const count of [300, 3000]) test(`${count} large image references keep bounded decodes and responsive Canvas input`, async ({ page, request }) => {
  test.setTimeout(150000);
  await emulateSlowCpu(page);
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-image-scale-'));
  const response = await request.post('/api/agent-room/workspaces', { data: { name: `Image scale ${count}`, workingDir: directory } });
  const workspace = (await response.json()).data;
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(), workspaceId: workspace.id, type: 'image', title: `Image ${index}`,
    x: (index % 60) * 240, y: Math.floor(index / 60) * 180, width: 220, height: 160,
    zIndex: 0, floorId: null, payload: { path: `asset-${index}.png` },
  }));
  // Small encoded fixture, real 16 MiB decoded pixels per source. Never write
  // thousands of heavy files or force the pre-fix 48 GiB decode on the host.
  const image = createCanvas(2048, 2048); const context = image.getContext('2d');
  context.fillStyle = '#7649bb'; context.fillRect(0, 0, 2048, 2048);
  context.fillStyle = '#ffcc55'; context.fillRect(512, 512, 1024, 1024);
  const png = image.toBuffer('image/png');
  let active = 0, maximum = 0, reads = 0;
  const errors: string[] = [];
  let profiler: import('@playwright/test').CDPSession | undefined;
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => console.error(`Image scale ${count}: renderer crashed`));
  if (process.env.ORKESTRAI_IMAGE_PROFILE) page.on('request', req => { if (new URL(req.url()).pathname.endsWith('/nodes')) console.info('Nodes read', req.method(), req.url()); });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    const stats = { active: 0, peak: 0 }; (window as any).__imageScaleFetch = stats;
    window.fetch = async (...args) => {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      if (!url.includes('/fs/raw?')) return nativeFetch(...args);
      stats.active++; stats.peak = Math.max(stats.peak, stats.active);
      try { return await nativeFetch(...args); } finally { stats.active--; }
    };
  });
  await page.route(`**/workspaces/${workspace.id}/nodes`, route => route.fulfill({ json: { data: nodes } }));
  await page.route(`**/workspaces/${workspace.id}/edges`, route => route.fulfill({ json: { data: [] } }));
  await page.route(`**/workspaces/${workspace.id}/fs/raw?*`, async route => {
    active++; maximum = Math.max(maximum, active); reads++;
    try { await new Promise(resolve => setTimeout(resolve, 60)); await route.fulfill({ contentType: 'image/png', body: png }); }
    catch { /* Offscreen and replaced jobs deliberately abort their fetch. */ }
    finally { active--; }
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    const start = Date.now();
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.canvas-image')).toHaveCount(count, { timeout: 90000 });
    await expect.poll(() => page.locator('.canvas-image canvas.ready').count(), { timeout: 30000 }).toBeGreaterThan(2);
    const mountedMs = Date.now() - start;
    await page.evaluate(firstId => {
      (window as any).__imageScaleHandle = document.querySelector(`[data-id="${firstId}"] .node-handle`);
    }, nodes[0].id);
    console.info(JSON.stringify({ count, mountedMs, phase: 'mounted', errors }));
    if (!process.env.ORKESTRAI_IMAGE_PROFILE) expect(mountedMs).toBeLessThan(10000);
    if (process.env.ORKESTRAI_IMAGE_PROFILE) {
      profiler = await page.context().newCDPSession(page);
      await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
    }
    await expect(page.locator('.canvas-image .image-body img')).toHaveCount(0);
    await page.evaluate(() => {
      const gaps: number[] = []; let last = performance.now();
      (window as any).__imageScaleFrames = gaps;
      function frame(now: number) { gaps.push(now - last); last = now; (window as any).__imageScaleFrameId = requestAnimationFrame(frame); }
      (window as any).__imageScaleFrameId = requestAnimationFrame(frame);
    });
    // Real input while the gallery is still filling, rather than waiting for
    // every original to finish first. This does not touch the owner's workspace.
    const zoomIn = page.locator('.svelte-flow__controls-zoomin');
    // Include readable zoom: offscreen headers must stay deferred even after
    // the selected area grows large enough to show its editing controls.
    for (let index = 0; index < 15; index++) {
      await zoomIn.click({ timeout: 5000 }); await page.waitForTimeout(150);
      if (count === 3000) console.info(`Image scale zoom ${index + 1}`);
    }
    const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
    await page.keyboard.down('Space');
    await page.mouse.move(pane.x + 100, pane.y + 100); await page.mouse.down();
    await page.mouse.move(pane.x + 400, pane.y + 200, { steps: 15 });
    await page.mouse.up(); await page.keyboard.up('Space');
    await page.waitForTimeout(700);
    const sample = await page.evaluate(({ count, firstId }) => {
      cancelAnimationFrame((window as any).__imageScaleFrameId);
      const surfaces = [...document.querySelectorAll<HTMLCanvasElement>('.canvas-image canvas[data-image-preview]')];
      const gaps = (window as any).__imageScaleFrames as number[];
      return { maxFrameGapMs: Math.max(...gaps), frames: gaps.length,
        surfacePixels: surfaces.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0),
        releasedSurfaces: count - surfaces.length + surfaces.filter(canvas => canvas.width === 1).length,
        mountedHeaders: document.querySelectorAll('.canvas-image .node-header').length,
        retainedHandle: Boolean((window as any).__imageScaleHandle)
          && (window as any).__imageScaleHandle === document.querySelector(`[data-id="${firstId}"] .node-handle`),
        ready: surfaces.filter(canvas => canvas.classList.contains('ready')).length,
        fetchPeak: (window as any).__imageScaleFetch.peak };
    }, { count, firstId: nodes[0].id });
    console.info(JSON.stringify({ count, mountedMs, reads, maximumConcurrentFetches: maximum, ...sample }));
    expect(sample.fetchPeak).toBeLessThanOrEqual(2);
    expect(sample.surfacePixels).toBeLessThanOrEqual(16 * 1024 * 1024 + count);
    expect(sample.frames).toBeGreaterThan(10);
    expect(sample.maxFrameGapMs).toBeLessThan(500);
    expect(sample.releasedSurfaces).toBeGreaterThan(count / 2);
    expect(sample.mountedHeaders).toBeLessThan(200);
    expect(sample.retainedHandle).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`image-scale-${count}.png`) });
  } catch (error) {
    console.info('Canvas diagnostic', await page.evaluate(() => ({
      controls: document.querySelectorAll('.svelte-flow__controls-zoomin').length,
      zoom: document.querySelector('.zoom-level')?.textContent,
      buttons: [...document.querySelectorAll('.svelte-flow__controls button')].map(button => ({ text: button.textContent, cls: button.className, disabled: (button as HTMLButtonElement).disabled })),
      flow: document.querySelector('.svelte-flow')?.getAttribute('data-canvas-moving'),
    })).catch(() => 'unresponsive'));
    await page.screenshot({ path: test.info().outputPath(`image-scale-failure-${count}.png`), timeout: 5000 }).catch(() => {});
    console.info(JSON.stringify({ phase: 'failed', count, url: page.url(), errors,
      body: await page.locator('body').innerText({ timeout: 5000 }).then(text => text.slice(0, 1500)).catch(() => 'unresponsive') }));
    throw error;
  } finally {
    if (profiler) {
      const result = await profiler.send('Profiler.stop').catch(() => null);
      if (result) await writeFile(test.info().outputPath(`image-scale-${count}.cpuprofile`), JSON.stringify(result.profile));
    }
    await page.evaluate(() => cancelAnimationFrame((window as any).__imageScaleFrameId)).catch(() => {});
    await page.goto('about:blank');
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(directory, { recursive: true, force: true });
  }
});
