const { app, BrowserWindow, WebContentsView, View, session, nativeImage } = require('electron');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');
const { createServer } = require('node:http');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
if (process.argv.includes('--software')) app.disableHardwareAcceleration();

const profile = process.env.ORKESTRAI_TEST_USER_DATA ?? mkdtempSync(join(tmpdir(), 'orkestrai-capture-lifecycle-'));
app.setPath('userData', profile);
let executor, host, server;
function TracedContentsView(options) {
  const view = new WebContentsView(options);
  for (const [owner, method] of [[view.webContents, 'capturePage'], [view.webContents, 'executeJavaScriptInIsolatedWorld'], [view.webContents.debugger, 'sendCommand']]) {
    const original = owner[method].bind(owner);
    owner[method] = (...args) => {
      const operation = method === 'sendCommand' ? args[0] : method;
      const timer = setTimeout(() => console.error(JSON.stringify({ pendingNativeOperation: operation })), 500);
      return Promise.resolve(original(...args)).finally(() => clearTimeout(timer));
    };
  }
  return view;
}
let ending = false;
const watchdog = setTimeout(() => finish(1, new Error('Capture lifecycle timed out')), 60000);
async function finish(code, error) {
  if (ending) return;
  ending = true;
  clearTimeout(watchdog);
  if (error) console.error(error);
  try {
    await executor?.closeAll();
    host?.destroy();
    server?.close();
    if (!process.env.ORKESTRAI_TEST_USER_DATA) rmSync(profile, { recursive: true, force: true });
  } catch (cleanupError) { console.error(cleanupError); code = 1; }
  finally { app.exit(code); }
}

app.whenReady().then(async () => {
  app.dock?.hide();
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<body style="margin:0;background:#168766"><h1 id="value">0</h1><input type="password" value="synthetic-secret"><script>window.identity=Math.random()</script></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  host = new BrowserWindow({ show: false, width: 1000, height: 800 });
  executor = createManagedPortalExecutor({ WebContentsView: TracedContentsView, View, BrowserWindow, session });
  const request = { requestId: randomUUID(), workspaceId: randomUUID(), nodeId: randomUUID(),
    initialUrl: `http://127.0.0.1:${server.address().port}/`,
    profile: { profileId: 'qa', profileScope: 'private', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: true },
    action: 'screenshot', args: {}, timeoutMs: 5000 };
  const raw = code => executor.userCommand(request, 'inspectScript', { code });
  await executor.inspect(request);
  const identity = await raw('window.identity');
  let count = 0;
  const captureSeries = async (label, target = request, rounds = 4, expectedIdentity = identity) => {
    const inspect = code => executor.userCommand(target, 'inspectScript', { code });
    let last;
    for (let i = 0; i < rounds; i++) {
      await inspect(`document.querySelector('#value').textContent=${++count};document.body.style.background='rgb(${20 + count * 4},135,102)'`);
      const start = Date.now();
      const result = await executor.execute({ ...target, requestId: randomUUID() });
      console.log(JSON.stringify({ label, index: i, ok: result.ok, ms: Date.now() - start, error: result.error }));
      assert.equal(result.ok, true, `${label}: ${result.error}`);
      const box = await inspect(`(() => { const r=document.querySelector('input').getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:innerWidth}; })()`);
      const image = nativeImage.createFromDataURL(result.result.dataUrl);
      assert.equal(image.isEmpty(), false);
      const scale = image.getSize().width / box.viewport;
      const pixel = (Math.floor((box.y + box.height / 2) * scale) * image.getSize().width + Math.floor((box.x + box.width / 2) * scale)) * 4;
      assert.deepEqual([...image.toBitmap().subarray(pixel, pixel + 3)], [68, 68, 68], `${label}: protected fields must be masked`);
      const hash = createHash('sha256').update(image.toPNG()).digest('hex');
      assert.notEqual(hash, last, 'Each capture must show the new DOM, not a cached frame');
      last = hash;
      assert.equal(await inspect('window.identity'), expectedIdentity, 'Capture must not reload the page');
    }
  };
  await captureSeries('never-mounted');
  const lease = randomUUID();
  const parentCloseListeners = host.listenerCount('closed');
  await executor.surface(request, host, lease);
  for (let round = 0; round < 50; round++) {
    assert.equal(host.listenerCount('closed'), parentCloseListeners + 1, 'Attached Portals share one parent lifecycle listener');
    executor.detach(request.workspaceId, request.nodeId, lease);
    assert.equal(host.listenerCount('closed'), parentCloseListeners, 'Leaving Canvas must release the parent lifecycle listener');
    await executor.surface(request, host, lease);
  }
  const geometry = { bounds: { x: 0, y: 0, width: 640, height: 480 }, clip: { x: 0, y: 0, width: 640, height: 480 },
    viewport: { width: 1280, height: 960 }, zoom: 0.5, visible: true };
  executor.setGeometry(request.workspaceId, request.nodeId, geometry, lease);
  await captureSeries('mounted-hidden-window');
  executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, visible: false }, lease);
  await captureSeries('offscreen');
  executor.detach(request.workspaceId, request.nodeId, lease);
  await captureSeries('detached-with-saved-geometry');
  await executor.surface(request, host, lease);
  executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, moving: true }, lease);
  await captureSeries('canvas-moving');
  await Promise.all(Array.from({ length: 3 }, async (_, index) => {
    const target = { ...request, nodeId: randomUUID() };
    await executor.inspect(target);
    const expected = await executor.userCommand(target, 'inspectScript', { code: 'window.identity' });
    await captureSeries(`parallel-portal-${index}`, target, 4, expected);
  }));
  await raw("document.body.style.minHeight='3000px';Object.assign(document.querySelector('input').style,{position:'fixed',left:'60px',top:'120px'});scrollTo(0,600)");
  await captureSeries('scrolled-fixed-private-field');
  const crop = nativeImage.createFromDataURL(await executor.userCommand(request, 'capture', { rect: { x: 20, y: 30, width: 240, height: 180 } }));
  const density = await raw('devicePixelRatio');
  assert.deepEqual(crop.getSize(), { width: 240 * density, height: 180 * density });
  assert.equal(await raw('scrollY'), 600, 'Cropped capture must preserve page scroll');
  assert.equal(await raw('window.identity'), identity);
  await raw("const style=document.createElement('style');style.textContent='@media(min-width:1500px){input{left:600px!important;top:1100px!important}}';document.head.append(style)");
  executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, visible: false, viewport: { width: 1920, height: 1280 } }, lease);
  await captureSeries('resized-offscreen-responsive-private-field');
  console.log(JSON.stringify({ portalCaptureLifecycle: 'passed', freshCaptures: count }));
}).then(() => finish(0), error => finish(1, error));
