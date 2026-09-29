const { app, BrowserWindow, WebContentsView, View, session, ipcMain, nativeImage } = require('electron');
const { build } = require('esbuild');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');
const { validPortalGeometry } = require('../electron/portal-presentation.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-portal-layout-'));
app.setPath('userData', profile);
let parent, server, executor, captures = 0;
let hostHtml = '';
const layouts = [];
const watchdog = setTimeout(() => finish(new Error('Portal layout regression timed out')), 45000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  if (!process.argv.includes('--show-window')) app.dock?.hide();
  server = http.createServer((incoming, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    if (incoming.url === '/host') { response.end(hostHtml); return; }
    response.end('<body style="margin:0;background:#168766;color:white;font:24px system-ui;min-height:2000px"><h1>Portal page</h1><input id="message" value="Session preserved"><button style="position:absolute;left:200px;top:100px;width:100px;height:30px" onclick="this.textContent=\'Clicked\'">Click here</button><div style="position:absolute;top:800px;left:0;width:100%;height:500px;background:#ff8844"></div><script>window.identity=Math.random();window.sizes=[];addEventListener("resize",()=>sizes.push([innerWidth,innerHeight]))</script></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = { workspaceId: randomUUID(), nodeId: randomUUID(), initialUrl: `http://127.0.0.1:${server.address().port}/`, action: 'snapshot', args: {}, timeoutMs: 5000,
    profile: { profileId: 'qa', profileScope: 'workspace', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: true } };
  executor = createManagedPortalExecutor({ WebContentsView, View, session,
    onState: (workspaceId, nodeId, state) => {
      if (parent && !parent.isDestroyed()) parent.webContents.send('orkestrai:portal-state', { workspaceId, nodeId, state });
    },
  });
  ipcMain.handle('orkestrai:portal-surface', async (_event, input) => {
    if (input.method === 'attach') return executor.surface(request, parent, input.lease);
    if (input.method === 'detach') return executor.detach(request.workspaceId, request.nodeId, input.lease);
    if (input.method === 'preview') captures++;
    return executor.userCommand(request, input.method, input.args);
  });
  ipcMain.on('orkestrai:portal-layout', (_event, input) => {
    assert.ok(validPortalGeometry(input.geometry), 'renderer must send a valid bounded presentation');
    layouts.push(input.geometry); executor.setGeometry(request.workspaceId, request.nodeId, input.geometry, input.lease);
  });
  parent = new BrowserWindow({ width: 1100, height: 850, show: process.argv.includes('--show-window'), webPreferences: { preload: path.resolve('electron/preload.cjs'), sandbox: true, backgroundThrottling: false } });
  parent.webContents.on('console-message', event => console.log('renderer:', event.message));
  hostHtml = `<!doctype html><body style="margin:0;background:#202328;color:white">
    <div class="svelte-flow" style="position:relative;height:100vh;overflow:hidden">
      <div id="node" class="svelte-flow__node" style="position:absolute;left:150px;top:90px;width:600px;height:650px;transform-origin:0 0">
        <header style="height:40px;background:#333">Portal drag handle</header>
        <div id="host" style="height:610px;width:600px;overflow:hidden"></div>
      </div>
      <div class="svelte-flow__panel" id="toolbar" style="position:absolute;z-index:20;left:280px;top:680px;width:500px;height:50px;background:#fe5a44">Canvas toolbar</div>
      <aside data-portal-occluder id="sidebar" style="position:absolute;z-index:20;left:0;top:0;width:120px;height:100vh;background:#2674c9">Workspaces</aside>
      <aside data-portal-occluder id="rightbar" style="position:absolute;z-index:20;right:0;top:0;width:90px;height:100vh;background:#2674c9">Tools</aside>
      <div id="overlay-root"></div>
    </div></body>`;
  await parent.loadURL(`http://127.0.0.1:${server.address().port}/host`);
  // Native compositor pixels require a presented window. Do not steal focus.
  parent.showInactive();
  const bundle = await build({ entryPoints: ['src/lib/components/agent-room/managed-portal-surface.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'PortalSurface' });
  await parent.webContents.executeJavaScript(bundle.outputFiles[0].text);
  const dom = code => parent.webContents.executeJavaScript(code);
  const raw = code => executor.userCommand(request, 'inspectScript', { code });
  await dom(`void (window.surface=PortalSurface.managedPortalSurface(document.getElementById('host'),{workspaceId:${JSON.stringify(request.workspaceId)},nodeId:${JSON.stringify(request.nodeId)},ready:()=>{}}))`);
  for (let i = 0; i < 100; i++) {
    if (await dom(`!!document.querySelector('[data-portal-preview]')?.naturalWidth`)) break;
    await pause(50);
  }
  assert.ok(await dom(`document.querySelector('[data-portal-preview]').naturalWidth>0`), 'page preview must render real pixels');
  await pause(180);
  assert.ok(layouts.at(-1).clip.y + layouts.at(-1).clip.height <= 680, 'live website must stop above the toolbar');
  const clip = parent.contentView.children.find(view => view instanceof View && !(view instanceof WebContentsView));
  assert.ok(clip);
  const nativeView = clip.children[0];
  const density = await nativeView.webContents.executeJavaScript('devicePixelRatio');
  let presentedFrames = 0;
  const oversizedFrames = [];
  nativeView.webContents.beginFrameSubscription(false, image => {
    if (!clip.getVisible() || !clip.children.includes(nativeView)) return;
    presentedFrames++;
    const frame = image.getSize(), bounds = nativeView.getBounds();
    if (frame.width > Math.ceil(bounds.width * density) + 2 || frame.height > Math.ceil(bounds.height * density) + 2) oversizedFrames.push({ frame, bounds });
  });
  const sendCommand = nativeView.webContents.debugger.sendCommand.bind(nativeView.webContents.debugger);
  let exposedCaptures = 0, fullCaptures = 0;
  nativeView.webContents.debugger.sendCommand = async (method, parameters) => {
    if (method === 'Page.captureScreenshot') {
      fullCaptures++;
      if (clip.getVisible() && clip.children.includes(nativeView)) exposedCaptures++;
    }
    return sendCommand(method, parameters);
  };
  await executor.userCommand(request, 'preview', {});
  assert.equal(exposedCaptures, 0, 'CDP screenshot temporarily resizes its widget and must never run on an attached visible surface');
  await pause(350);
  const idleCaptures = captures;
  for (let step = 0; step < 4; step++) {
    await raw(`document.title='Background update ${step}'`);
    assert.equal((await executor.execute(request)).ok, true);
    await pause(300);
  }
  assert.equal(captures, idleCaptures, 'title changes and agent reads must not recapture an idle Portal');
  // Exercise the renderer action and native guest together: URL changes alone
  // must not turn history navigation into detached captures or new documents.
  const spaIdentity = await raw('window.identity');
  const spaCaptures = captures;
  const spaRevision = (await executor.userCommand(request, 'state', {})).documentRevision;
  await dom(`window.spaEvents={inPage:0,finished:0};const host=document.getElementById('host');host.addEventListener('did-navigate-in-page',()=>window.spaEvents.inPage++);host.addEventListener('did-finish-load',()=>window.spaEvents.finished++);`);
  await raw(`document.getElementById('message').value='Unsaved SPA draft'`);
  for (const [code, suffix] of [
    [`history.pushState({},'', '/settings')`, '/settings'],
    [`history.replaceState({},'', '/settings?tab=team')`, '/settings?tab=team'],
    [`location.hash='members'`, '/settings?tab=team#members'],
    [`history.back()`, '/settings?tab=team'],
    [`history.forward()`, '/settings?tab=team#members'],
  ]) {
    await raw(code);
    for (let attempt = 0; attempt < 40; attempt++) {
      if ((await dom(`document.getElementById('host').src`)).endsWith(suffix)) break;
      await pause(25);
    }
    await pause(350);
    assert.ok((await dom(`document.getElementById('host').src`)).endsWith(suffix), 'SPA address must follow history');
    assert.equal(await raw('window.identity'), spaIdentity, 'SPA navigation must preserve the document');
    assert.equal(await raw(`document.getElementById('message').value`), 'Unsaved SPA draft');
    assert.equal((await executor.userCommand(request, 'state', {})).documentRevision, spaRevision);
    assert.equal(captures, spaCaptures, 'SPA navigation must not detach the native page for a preview');
    assert.equal(clip.getVisible(), true);
    assert.ok(clip.children.includes(nativeView));
  }
  assert.deepEqual(await dom('window.spaEvents'), { inPage: 5, finished: 0 });
  await executor.userCommand(request, 'navigate', { url: request.initialUrl });
  await pause(400);
  assert.notEqual(await raw('window.identity'), spaIdentity, 'explicit navigation must still load a new document');
  assert.ok((await dom('window.spaEvents.finished')) > 0);
  if (process.argv.includes('--spa-only')) {
    nativeView.webContents.endFrameSubscription();
    console.log(JSON.stringify({ ok: true, spaNavigationStable: true, draftPreserved: true, explicitNavigationWorks: true }));
    return;
  }
  function assertNativeContained() {
    const parentBounds = clip.getBounds(), child = nativeView.getBounds();
    assert.deepEqual(child, { x: 0, y: 0, width: parentBounds.width, height: parentBounds.height },
      'the actual WebContentsView, not merely its parent, must be clipped');
  }
  assertNativeContained();
  const baseline = await raw('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,wide:matchMedia("(min-width:590px)").matches})');
  const identity = await raw('window.identity');
  const captureCount = captures;
  await dom(`document.querySelector('header').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1}));`);
  for (let step = 0; step < 12; step++) {
    await dom(`document.getElementById('node').style.transform='translate(${step * 7}px,${step * 3}px) scale(0.85)'`);
    await pause(18);
    assert.equal(layouts.at(-1).moving, true);
    assert.equal(clip.getVisible(), false, 'native page must not trail the DOM during movement');
  }
  assert.ok(captures <= captureCount + 1, 'never capture once per frame');
  assert.equal((await executor.execute(request)).ok, true, 'agent must retain the same page during motion');
  const screenshot = path.join(os.tmpdir(), 'orkestrai-portal-motion.png');
  fs.writeFileSync(screenshot, (await parent.webContents.capturePage()).toPNG());
  await dom(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1}))`);
  await pause(300);
  assert.equal(layouts.at(-1).moving, false);
  for (let i = 0; i < 60 && !clip.getVisible(); i++) await pause(50);
  assert.equal(clip.getVisible(), true);
  assertNativeContained();
  assert.deepEqual(await raw('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,wide:matchMedia("(min-width:590px)").matches})'), baseline);
  assert.equal(await raw('window.identity'), identity);
  assert.equal(await raw('document.getElementById("message").value'), 'Session preserved');
  // Same-origin pages used to share setZoomFactor, changing each other's viewport.
  const other = { ...request, nodeId: randomUUID(), profile: { ...request.profile } };
  const otherLease = randomUUID();
  await executor.surface(other, parent, otherLease);
  executor.setGeometry(other.workspaceId, other.nodeId, {
    bounds: { x: 810, y: 50, width: 120, height: 160 }, clip: { x: 810, y: 50, width: 120, height: 160 },
    viewport: { width: 300, height: 400 }, zoom: 0.4, visible: true,
  }, otherLease);
  await pause(250);
  assert.deepEqual(await raw('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,wide:matchMedia("(min-width:590px)").matches})'), baseline);
  for (const zoom of [0.05, 0.075, 0.1, 0.5, 1, 1.4, 4]) {
    await dom(`document.getElementById('node').style.transform='scale(${zoom})'`);
    await pause(350);
    assert.deepEqual(await raw('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,wide:matchMedia("(min-width:590px)").matches})'), baseline, `Canvas zoom ${zoom} must not affect CSS or density`);
    assertNativeContained();
  }
  // Stop over each fixed control. Cropping must survive pointer-up and keep input aligned.
  for (const [x, y] of [[-100, 0], [480, 0], [0, 350]]) {
    await dom(`document.getElementById('node').style.transform='translate(${x}px,${y}px)'`);
    await pause(350); assertNativeContained();
    const frame = clip.getBounds();
    assert.equal(clip.getVisible(), x !== -100, 'left-origin clipping must use the DOM preview, other clipped sides stay live');
    for (const obstacle of await dom(`['sidebar','rightbar','toolbar'].map(id=>document.getElementById(id).getBoundingClientRect().toJSON())`)) {
      assert.ok(frame.x + frame.width <= obstacle.x || frame.x >= obstacle.right || frame.y + frame.height <= obstacle.y || frame.y >= obstacle.bottom, 'native surface must never cover a fixed control');
    }
    assert.deepEqual(await raw('[innerWidth,innerHeight]'), [600,610]);
  }
  await dom(`document.getElementById('node').style.transform='translate(0.2px,0.2px) scale(0.5)'`);
  await pause(350);
  assert.equal(clip.getVisible(), true, 'fractional positions must not trigger origin-clipped fallback');
  const pagePoint = { x: 125, y: 58 };
  parent.focus(); nativeView.webContents.focus();
  await pause(80);
  nativeView.webContents.sendInputEvent({ type: 'mouseDown', ...pagePoint, button: 'left', clickCount: 1 });
  nativeView.webContents.sendInputEvent({ type: 'mouseUp', ...pagePoint, button: 'left', clickCount: 1 });
  await pause(100);
  assert.equal(await raw('document.querySelector("button").textContent'), 'Clicked', 'native click coordinates must match the scaled page');

  // Select mounts inside a portal wrapper, not directly under document.body.
  for (const role of ['listbox', 'menu', 'dialog']) {
    await dom(`document.getElementById('overlay-root').innerHTML='<div role="${role}" data-state="open" style="position:absolute;z-index:99;left:200px;top:220px;width:320px;height:200px;background:white;color:black">Responsive presets</div>'`);
    await pause(60);
    assert.equal(clip.getVisible(), false, `${role} must sit above the site`);
    await dom(`document.getElementById('overlay-root').firstElementChild.setAttribute('data-state','closed')`);
    await pause(80);
    assert.equal(clip.getVisible(), true, 'closing an overlay must restore the same page');
    await dom(`document.getElementById('overlay-root').replaceChildren()`);
  }
  await dom(`document.getElementById('node').style.transform='none';document.getElementById('host').style.width='390px';document.getElementById('host').style.height='844px'`);
  await pause(350);
  assert.deepEqual(await raw('[innerWidth,innerHeight,matchMedia("(min-width:590px)").matches]'), [390,844,false], 'only explicit responsive sizing changes the layout');
  await executor.userCommand(request, 'navigate', { url: request.initialUrl + '?navigation' });
  await pause(250);
  assert.deepEqual(await raw('[innerWidth,innerHeight]'), [390,844], 'navigation keeps logical viewport');
  await raw('window.scrollTo(0,800)');
  await pause(120);
  const scrolled = nativeImage.createFromDataURL(await executor.userCommand(request, 'preview', {}));
  const size = scrolled.getSize();
  assert.ok(Math.max(size.width, size.height) <= 1600, 'preview must remain bounded on high-density displays');
  assert.ok(Math.abs(size.width / size.height - 390 / 844) < 0.002, 'preview contains the entire logical viewport, not its clipped native slice');
  const pixels = scrolled.toBitmap();
  const color = [...pixels.subarray((20 * size.width + 20) * 4, (20 * size.width + 20) * 4 + 3)];
  assert.ok(color.every((value, index) => Math.abs(value - [68,136,255][index]) <= 16), 'preview preserves page scroll (allow display color-profile conversion)');
  // Browser wheel zoom and node resizing use the same stable presentation.
  await dom(`document.querySelector('.svelte-flow').dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:50})); document.getElementById('node').style.transform='scale(1.1)'`);
  await pause(30); assert.equal(layouts.at(-1).moving, true);
  await pause(220); assert.equal(layouts.at(-1).moving, false);
  await dom(`document.getElementById('host').style.width='720px'`);
  await pause(40); assert.equal(layouts.at(-1).moving, true);
  await pause(220); assert.equal(clip.getVisible(), true);
  assert.ok(layouts.at(-1).clip.y + layouts.at(-1).clip.height <= 680);
  const beforeDestroy = captures;
  await dom(`window.surface.destroy()`);
  await pause(250);
  assert.equal(captures, beforeDestroy, 'destroy must stop preview requests');
  assert.equal(await dom(`document.querySelector('[data-portal-preview]')`), null);
  assert.ok(fullCaptures > 0);
  assert.equal(exposedCaptures, 0, 'all transient screenshot resizes must remain detached');
  nativeView.webContents.endFrameSubscription();
  assert.ok(presentedFrames > 0, 'inspect real compositor frames, not only final bounds');
  assert.deepEqual(oversizedFrames, [], 'no oversized compositor frame may be presented');
  console.log(JSON.stringify({ ok: true, actualNativeClipping: true, dropdownsUncovered: true, stableViewportAtAllZooms: true, sameOriginIsolated: true, nativeInputAligned: true, scrollPreserved: true, sessionPreserved: true, idleStable: true, presentedFrames, fullCaptures, exposedCaptures, captures, screenshot }));
}
main().then(() => finish(), finish);
async function finish(error) {
  clearTimeout(watchdog);
  if (error) console.error(error);
  await executor?.closeAll(); parent?.destroy(); server?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
