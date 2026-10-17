import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import WebSocket from 'ws';

test('elastic edges settle without restarting from their own render updates', async ({ page, request }) => {
  test.setTimeout(60000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-edge-idle-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E idle canvas', workingDir: dir } })).json()).data;
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, canvasEdgeRendering: 'elastic' } });
    const nodes = [];
    for (let i = 0; i < 6; i++) {
      nodes.push((await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: {
        type: 'note', title: `Idle note ${i}`, x: (i % 3) * 400, y: Math.floor(i / 3) * 330, width: 320, height: 240, payload: { content: 'Performance fixture' },
      } })).json()).data);
    }
    for (let i = 0; i < nodes.length - 1; i++) await request.post(`/api/agent-room/workspaces/${workspace.id}/edges`, { data: { sourceNodeId: nodes[i].id, targetNodeId: nodes[i + 1].id } });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.orkestrai-edge .edge-line')).toHaveCount(5);
    await page.evaluate(() => {
      const state = { count: 0 };
      (window as any).__edgeMutations = state;
      new MutationObserver(records => { state.count += records.filter(record => (record.target as Element).matches('.edge-line') && record.attributeName === 'd').length; }).observe(document.querySelector('.svelte-flow')!, { attributes: true, subtree: true, attributeFilter: ['d'] });
    });
    const countUpdates = async () => page.evaluate(async () => {
      const before = (window as any).__edgeMutations.count;
      await new Promise(resolve => setTimeout(resolve, 500));
      return (window as any).__edgeMutations.count - before;
    });
    await expect.poll(countUpdates, { timeout: 10000 }).toBe(0);
    const first = page.locator('.svelte-flow__node').first().locator('.node-header');
    const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + 70, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 125, box.y + 65, { steps: 8 });
    await page.mouse.up();
    await expect.poll(countUpdates, { timeout: 10000 }).toBe(0);
    expect(await page.locator('.orkestrai-edge .edge-line').first().getAttribute('d')).toContain(' L ');

    // A small canvas also simplifies native dash rasterization while panning;
    // this is independent of the >=150-node body-paint policy.
    const pane = (await page.locator('.svelte-flow__pane').boundingBox())!;
    await page.mouse.move(pane.x + 20, pane.y + pane.height - 70);
    await page.mouse.down();
    await page.mouse.move(pane.x + 120, pane.y + pane.height - 40, { steps: 8 });
    await expect(page.locator('.svelte-flow')).toHaveAttribute('data-canvas-navigating', 'true');
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-moving');
    await expect(page.locator('.orkestrai-edge .edge-line').first()).toHaveCSS('stroke-dasharray', 'none');
    await page.mouse.up();
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-navigating');
    await expect(page.locator('.orkestrai-edge .edge-line').first()).toHaveCSS('stroke-dasharray', '7px, 5px');
    await page.locator('.svelte-flow__edge').first().press('Enter');
    await expect(page.locator('.svelte-flow__edge.selected')).toHaveCount(1);
    await page.mouse.move(pane.x + 20, pane.y + pane.height - 70);
    await page.mouse.down();
    await page.mouse.move(pane.x + 5_000, pane.y + pane.height - 40, { steps: 20 });
    await page.mouse.up();
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-navigating');
    // Offscreen wrappers/data remain; only paint is culled, with an exception
    // for selected controls so keyboard interaction is never discarded.
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(5);
    await expect.poll(() => page.locator('.edge-line').evaluateAll(lines =>
      lines.filter(line => getComputedStyle(line).visibility === 'visible').length)).toBe(1);
    await expect(page.locator('.orkestrai-edge')).toHaveCount(5);
    // EdgeLabel portals its controls outside the SVG wrapper.
    await expect(page.locator('.edge-delete')).toHaveCount(1);
    await page.locator('.svelte-flow__controls-fitview').click();
    await expect(page.locator('.orkestrai-edge')).toHaveCount(5);
  } finally {
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});

test('overview defers terminal paint without stopping its PTY or losing its renderer', async ({ page, request }) => {
  test.skip(process.platform === 'win32', 'POSIX fixture; provider/WSL startup is covered by domain tests.');
  test.setTimeout(90000);
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-terminal-overview-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E terminal overview', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const counter = join(dir, 'progress.txt');
  let socket: WebSocket | undefined;
  try {
    const node = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Overview Shell', x: 100, y: 100, width: 560, height: 360,
      payload: { command: '/bin/sh', args: [], currentWorkingDir: dir },
    } })).json()).data;
    socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
    const sessionId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Overview Shell creation timed out')), 10000);
      socket!.once('error', error => { clearTimeout(timer); reject(error); });
      socket!.on('open', () => socket!.send(JSON.stringify({ type: 'create', command: '/bin/sh', args: [], cwd: dir,
        workspaceId: workspace.id, workspaceRoot: dir, nodeId: node.id })));
      socket!.on('message', raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === 'created') { clearTimeout(timer); resolve(frame.session.id); }
        if (frame.type === 'error') { clearTimeout(timer); reject(new Error(frame.message)); }
      });
    });
    // A positive/stale intersection is not permission to redraw CSS-hidden
    // bodies. Native engines can report zero-area intersecting descendants.
    // Force that signal for both our observer and xterm's own observer so the
    // regression exercises our output policy, not xterm's separate fallback.
    await page.addInitScript(() => {
      const Original = window.IntersectionObserver;
      window.IntersectionObserver = class extends Original {
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super((entries, observer) => callback(entries.map(entry => entry.target.closest('.canvas-terminal') ? {
            time: entry.time, target: entry.target, rootBounds: entry.rootBounds,
            boundingClientRect: entry.boundingClientRect, intersectionRect: entry.intersectionRect,
            intersectionRatio: 1, isIntersecting: true,
          } : entry), observer), options);
        }
      };
    });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const terminal = page.locator('.canvas-terminal .xterm-helper-textarea');
    const body = page.locator('.canvas-terminal .node-body');
    await expect(terminal).toBeAttached();
    await page.evaluate(() => { (window as any).__overviewTerminal = document.querySelector('.canvas-terminal .xterm-helper-textarea'); });
    for (let i = 0; i < 10; i++) await page.locator('.svelte-flow__controls-zoomout').click();
    await expect(page.locator('.svelte-flow')).toHaveAttribute('data-canvas-overview', 'true');
    await expect(body).toHaveCSS('content-visibility', 'hidden');
    await page.evaluate(() => {
      const state = { mutations: 0 };
      (window as any).__overviewWrites = state;
      new MutationObserver(records => { state.mutations += records.length; }).observe(
        document.querySelector('.canvas-terminal .xterm-rows')!, { subtree: true, childList: true, characterData: true });
    });
    // The same live PTY makes progress while its unreadable body is not painted.
    socket.send(JSON.stringify({ type: 'input', sessionId, data: `printf 'still working\\n' >> ${JSON.stringify(counter)}\r` }));
    await expect.poll(() => readFile(counter, 'utf8').catch(() => '')).toBe('still working\n');
    // Native output keeps flowing, but CSS-hidden TUIs must not rebuild their
    // DOM on every chunk merely because IntersectionObserver sees their box.
    socket.send(JSON.stringify({ type: 'input', sessionId, data: `printf 'invisible redraw\\n'\r` }));
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__overviewWrites.mutations)).toBe(0);
    for (let i = 0; i < 10; i++) await page.locator('.svelte-flow__controls-zoomin').click();
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-overview');
    await expect(body).toHaveCSS('content-visibility', 'visible');
    expect(await page.evaluate(() => (window as any).__overviewTerminal === document.querySelector('.canvas-terminal .xterm-helper-textarea'))).toBe(true);
    await expect(terminal).toBeAttached();
    await expect(page.locator('.canvas-terminal .xterm-rows')).toContainText('invisible redraw');
  } finally {
    socket?.close();
    await page.goto('about:blank');
    await request.delete(base);
    await rm(dir, { recursive: true, force: true });
  }
});

test('pans and zooms 399 loaded image, long-note and Portal nodes without losing their state', async ({ page, request }) => {
  test.setTimeout(150000);
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-dense-canvas-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E dense creative canvas', workingDir: dir } })).json()).data;
  const nodes = Array.from({ length: 399 }, (_, i) => ({
    id: randomUUID(), workspaceId: workspace.id, type: i < 208 ? 'image' : i < 396 ? 'note' : 'portal', title: `Creative asset ${i + 1}`,
    x: (i % 20) * 440, y: Math.floor(i / 20) * 500, width: 390, height: 420, zIndex: 0, floorId: null,
    payload: i < 208 ? { path: `fixture-${i}.png` } : i < 396 ? { content: 'A detailed, unsaved creative direction. '.repeat(150) } : { url: 'https://example.com/' },
  }));
  const edges = Array.from({ length: 727 }, (_, i) => ({ id: randomUUID(), workspaceId: workspace.id,
    sourceNodeId: i < 236 ? nodes[0].id : nodes[i % nodes.length].id,
    targetNodeId: i < 236 ? nodes[i + 1].id : nodes[(i % nodes.length + 1 + Math.floor(i / nodes.length)) % nodes.length].id }));
  const fixture = createCanvas(1024, 1024);
  const context = fixture.getContext('2d');
  await page.route(`**/workspaces/${workspace.id}/fs/raw?*`, route => {
    const index = Number(new URL(route.request().url()).searchParams.get('path')?.match(/\d+/)?.[0]);
    context.fillStyle = `hsl(${index * 17 % 360}, 50%, 55%)`;
    context.fillRect(0, 0, 1024, 1024);
    return route.fulfill({ contentType: 'image/png', body: fixture.toBuffer('image/png') });
  });
  await page.addInitScript(() => Object.assign(window, { orkestraiDesktop: {
    onPortalState: () => () => {}, onPortalOpenRequest: () => () => {}, portalLayout: () => {},
    portalSurface: async ({ method }: { method: string }) => method === 'preview' ? '' : method === 'inspectScript'
      ? { __orkestraiPortalScriptResult: true, ok: true, value: 'https://example.com/' }
      : { url: 'https://example.com/', webContentsId: 1, activeTabId: 'fixture', tabs: [{ id: 'fixture', url: 'https://example.com/', title: 'Fixture' }] },
  } }));
  const errors: string[] = [];
  let activitySocket: import('@playwright/test').WebSocketRoute | undefined;
  await page.routeWebSocket('**/ws/agent-room/pty', socket => {
    const server = socket.connectToServer();
    server.onMessage(message => socket.send(message));
    socket.onMessage(message => {
      const request = JSON.parse(String(message));
      // Boards/Portals share their own metadata-only connection. Inject the
      // ordered activity+graph frames into the canvas subscriber, not the last
      // socket that happens to subscribe to workspaceChanged.
      if (request.type === 'subscribe' && request.events?.includes('workspaceChanged') && request.events?.includes('talking')) activitySocket = socket;
      server.send(message);
    });
  });
  page.on('pageerror', error => errors.push(error.message));
  let nodeReads = 0;
  await page.route(`**/workspaces/${workspace.id}/nodes`, route => {
    nodeReads++;
    return route.fulfill({ json: { data: nodes } });
  });
  await page.route(`**/workspaces/${workspace.id}/edges`, route => route.fulfill({ json: { data: edges } }));
  // Mocked Portals persist their address through the real Canvas callback.
  // Supply that fixture write instead of sending fake IDs to the actual DB.
  await page.route(`**/workspaces/${workspace.id}/nodes/*`, route => {
    const node = nodes.find(node => route.request().url().endsWith(`/${node.id}`));
    if (!node || route.request().method() !== 'PATCH') return route.continue();
    const patch = route.request().postDataJSON();
    return route.fulfill({ json: { data: { ...node, ...patch, payload: { ...node.payload, ...patch.payload } } } });
  });
  await page.route(`**/workspaces/${workspace.id}/image-workflows/*`, route => route.fulfill({ json: { data: { running: false, runId: null, lastError: null, executorReady: false, executorNodeId: null, executorTitle: null } } }));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, canvasEdgeRendering: 'auto' } });
    await page.setViewportSize({ width: 1440, height: 900 });
    await test.step('mount the complete creative fixture', async () => {
      await page.goto(`/canvas?workspace=${workspace.id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.svelte-flow__node')).toHaveCount(nodes.length);
    });
    await expect(page.locator('.svelte-flow__node')).toHaveCount(nodes.length);
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(727);
    // A leader-like hub is not the same workload as a low-degree chain.
    // Drag it in the fixture, never move nodes in the owner's workspace.
    const hub = page.locator('.svelte-flow__node').first();
    const hubHeader = (await hub.locator('.node-header').boundingBox())!;
    const hubBefore = await hub.getAttribute('style');
    await page.mouse.move(hubHeader.x + hubHeader.width / 2, hubHeader.y + hubHeader.height / 2);
    await page.mouse.down();
    await page.mouse.move(hubHeader.x + hubHeader.width / 2 + 30, hubHeader.y + hubHeader.height / 2 + 20, { steps: 16 });
    await expect(hub).not.toHaveAttribute('style', hubBefore!);
    await page.mouse.up();
    await expect(page.locator('.svelte-flow__node')).toHaveCount(nodes.length);
    await expect.poll(() => Boolean(activitySocket)).toBe(true);
    const readsBeforeActivity = nodeReads;
    activitySocket!.send(JSON.stringify({ type: 'talking', workspaceId: workspace.id, from: null, to: nodes[0].id, talking: true }));
    activitySocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
    // A prompt to a recipient must not animate all of its unrelated assets.
    // Both frames share an ordered socket. Observing the refresh proves the
    // preceding activity frame was consumed before checking rendered classes.
    await expect.poll(() => nodeReads).toBeGreaterThan(readsBeforeActivity);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.orkestrai-edge.talking')).toHaveCount(0);
    await expect(page.locator('.edge-line.animated')).toHaveCount(0);
    const deferred = await page.locator('.canvas-image .node-body').first().evaluate(element => getComputedStyle(element).contentVisibility);
    expect(deferred).toBe('auto');
    expect(await page.evaluate(() => {
      const badge = document.querySelector<HTMLElement>('.connections-badge')!;
      const flow = document.querySelector<HTMLElement>('.svelte-flow')!;
      badge.focus();
      flow.dataset.canvasMoving = 'true';
      const visible = getComputedStyle(badge).visibility;
      flow.removeAttribute('data-canvas-moving');
      badge.blur();
      return visible;
    })).toBe('visible');
    await test.step('decode all 208 full-size PNGs', async () => {
      await expect.poll(() => page.locator('.canvas-image img.img-outline').evaluateAll(images => images.filter(image => (image as HTMLImageElement).naturalWidth === 1024).length), { timeout: 30000 }).toBe(208);
      // naturalWidth proves headers loaded, not that async pixel decoding has
      // completed. Keep the full 832 MiB fixture, but finish preparation before
      // measuring navigation, rather than attributing cold decode to a gesture.
      await page.locator('.canvas-image img.img-outline').evaluateAll(async images => {
        await Promise.all(images.map(image => (image as HTMLImageElement).decode()));
      });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
    });
    // All original pixels are still loaded; the visible overview additionally
    // uses actual bounded rasters, not empty-image or header-only fixtures.
    await expect.poll(() => page.locator('.canvas-image .overview-preview.active').count()).toBeGreaterThan(200);
    await expect(page.locator('.canvas-image .overview-preview canvas')).toHaveCount(208);
    expect(await page.locator('.canvas-image .overview-preview canvas').evaluateAll(canvases =>
      canvases.every(canvas => (canvas as HTMLCanvasElement).width <= 256 && (canvas as HTMLCanvasElement).height <= 256))).toBe(true);
    await page.evaluate(() => {
      (window as any).__retainedImage = document.querySelector('.canvas-image img.img-outline');
      (window as any).__retainedNote = document.querySelector('.canvas-note textarea');
      const note = (window as any).__retainedNote as HTMLTextAreaElement;
      note.value = 'Unsaved review draft';
      note.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(start => {
      const gaps: number[] = [];
      let last = start;
      const until = start + 15000;
      let expired = false;
      let frameId = 0;
      const frame = (now: number) => {
        gaps.push(now - last); last = now;
        if (now < until) frameId = requestAnimationFrame(frame);
        else expired = true;
      };
      frameId = requestAnimationFrame(frame);
      (window as any).__denseFrameGaps = gaps;
      (window as any).__denseStopFrames = () => {
        cancelAnimationFrame(frameId);
        return { expired, elapsedMs: performance.now() - start };
      };
      resolve();
    })));
    const zoomIn = page.locator('.svelte-flow__controls-zoomin');
    const zoomOut = page.locator('.svelte-flow__controls-zoomout');
    for (let i = 0; i < 4; i++) { await zoomIn.click(); await zoomOut.click(); }
    const viewport = page.locator('.svelte-flow__viewport').first();
    // Observe the transient state during real movement, not after mouse.move
    // has returned and a loaded runner may already have exceeded the 150 ms
    // settle window. Keep the exact CSS and unchanged frame-time assertions.
    await page.evaluate(() => {
      const flow = document.querySelector<HTMLElement>('.svelte-flow')!;
      const samples: Array<{ navigating: boolean; dash: string; body: string }> = [];
      const capture = () => {
        if (flow.dataset.canvasMoving !== 'true' || samples.length >= 10) return;
        samples.push({ navigating: flow.dataset.canvasNavigating === 'true',
          dash: getComputedStyle(document.querySelector('.orkestrai-edge .edge-line')!).strokeDasharray,
          body: getComputedStyle(document.querySelector('.canvas-image .node-body')!).contentVisibility });
      };
      const observer = new MutationObserver(capture);
      observer.observe(flow, { attributes: true, attributeFilter: ['data-canvas-moving', 'data-canvas-navigating'] });
      capture();
      (window as any).__denseMotionSamples = samples;
      (window as any).__denseMotionObserver = observer;
    });
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-moving');
    const transform = await viewport.getAttribute('style');
    // Find an actually empty hit target. At fit-view scale a fixed "margin"
    // coordinate can land on a loaded image or an interactive node control.
    const panStart = await page.locator('.svelte-flow__pane').evaluate(pane => {
      const box = pane.getBoundingClientRect();
      for (let y = box.top + 60; y < box.bottom - 100; y += 20) {
        for (let x = box.left + 10; x < box.right - 10; x += 20) {
          const hit = document.elementFromPoint(x, y);
          if (hit && pane.contains(hit) && !hit.closest('.svelte-flow__node, .svelte-flow__panel, .svelte-flow__edge, button, input, textarea')) return { x, y };
        }
      }
      throw new Error('Dense fixture has no empty canvas pan target');
    });
    await page.mouse.move(panStart.x, panStart.y);
    await page.mouse.down();
    await page.mouse.move(panStart.x + 70, panStart.y + 120, { steps: 20 });
    await expect.poll(() => page.evaluate(() => (window as any).__denseMotionSamples)).toContainEqual({ navigating: true, dash: 'none', body: 'hidden' });
    await expect(page.locator('.svelte-flow__node')).toHaveCount(nodes.length);
    await page.mouse.up();
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-moving');
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-navigating');
    await page.evaluate(() => { (window as any).__denseMotionObserver.disconnect(); delete (window as any).__denseMotionObserver; });
    await expect(page.locator('.canvas-image .node-body').first()).toHaveCSS('content-visibility', 'auto');
    expect(await page.evaluate(() => ({ image: (window as any).__retainedImage === document.querySelector('.canvas-image img.img-outline'),
      note: (window as any).__retainedNote === document.querySelector('.canvas-note textarea'),
      draft: (window as any).__retainedNote.value }))).toEqual({ image: true, note: true, draft: 'Unsaved review draft' });
    if (await page.locator('.svelte-flow').getAttribute('data-canvas-overview')) {
      await expect(page.locator('.orkestrai-edge .edge-line').first()).toHaveCSS('stroke-dasharray', 'none');
    }
    await expect(viewport).not.toHaveAttribute('style', transform!);
    const sample = await page.evaluate(() => (window as any).__denseStopFrames());
    // A slow runner must not silently finish sampling before the pan. Measure
    // every zoom, the real pan and paint restoration, with a bounded failsafe.
    expect(sample.expired).toBe(false);
    const gaps = await page.evaluate(() => (window as any).__denseFrameGaps as number[]);
    console.log(JSON.stringify({ nodes: nodes.length, loadedImages: 208, decodedImageMiB: 832, longNotes: 188, portals: 3, edges: 727, sampledMs: Math.round(sample.elapsedMs), maxFrameGapMs: Math.round(Math.max(...gaps)), initialFrameGapsMs: gaps.slice(0, 10).map(Math.round) }));
    expect(gaps.length).toBeGreaterThan(5);
    expect(Math.max(...gaps)).toBeLessThan(500);
    await expect(page.locator('.svelte-flow__node')).toHaveCount(nodes.length);
    expect(errors).toEqual([]);
    await test.step('rebuild the display cache after removing and restoring the same source', async () => {
      const image = page.locator(`.svelte-flow__node[data-id="${nodes[1].id}"]`);
      const beforeCanvas = await image.locator('canvas').evaluate(canvas => { (window as any).__previousOverviewCanvas = canvas; return (canvas as HTMLCanvasElement).width; });
      expect(beforeCanvas).toBe(256);
      nodes[1].payload = { path: '' };
      activitySocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
      await expect(image.locator('img.img-outline')).toHaveCount(0);
      nodes[1].payload = { path: 'fixture-1.png' };
      activitySocket!.send(JSON.stringify({ type: 'workspaceChanged', workspaceId: workspace.id }));
      await expect(image.locator('img.img-outline')).toHaveCount(1);
      await expect(image.locator('.overview-preview.active')).toHaveCount(1);
      expect(await image.locator('canvas').evaluate(canvas => ({
        fresh: canvas !== (window as any).__previousOverviewCanvas, width: (canvas as HTMLCanvasElement).width,
      }))).toEqual({ fresh: true, width: 256 });
    });
    // Readable zoom restores the very same original elements and URLs, not a
    // thumbnail pretending to be the reference/master.
    // The app top bar leaves a shorter canvas, so the fitted start is a little
    // farther out; zoom until readable instead of counting a fixed number of steps.
    for (let i = 0; i < 12; i++) {
      await zoomIn.click();
      if (i >= 4 && !(await page.locator('.svelte-flow').getAttribute('data-canvas-overview'))) break;
      await page.waitForTimeout(200);
    }
    await expect(page.locator('.svelte-flow')).not.toHaveAttribute('data-canvas-overview');
    await expect(page.locator('.canvas-image .overview-preview.active')).toHaveCount(0);
    await expect(page.locator('.canvas-image img.img-outline').first()).toHaveCSS('visibility', 'visible');
    expect(await page.evaluate(() => (window as any).__retainedImage === document.querySelector('.canvas-image img.img-outline'))).toBe(true);
    await page.screenshot({ path: '/tmp/orkestrai-dense-canvas.png' });
  } finally {
    await page.evaluate(() => { (window as any).__denseMotionObserver?.disconnect(); (window as any).__denseStopFrames?.(); }).catch(() => {});
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(dir, { recursive: true, force: true });
  }
});
