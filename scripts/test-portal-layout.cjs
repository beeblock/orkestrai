const { app, BrowserWindow, WebContentsView, View, session, ipcMain } = require('electron');
const { build } = require('esbuild');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');
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
    response.end('<body style="margin:0;background:#168766;color:white;font:24px system-ui"><h1>Portal page</h1><input id="message" value="Session preserved"><script>window.identity=Math.random()</script></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = { workspaceId: randomUUID(), nodeId: randomUUID(), initialUrl: `http://127.0.0.1:${server.address().port}/`, action: 'snapshot', args: {}, timeoutMs: 5000,
    profile: { profileId: 'qa', profileScope: 'private', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: true } };
  executor = createManagedPortalExecutor({ WebContentsView, View, session });
  ipcMain.handle('orkestrai:portal-surface', async (_event, input) => {
    if (input.method === 'attach') return executor.surface(request, parent, input.lease);
    if (input.method === 'detach') return executor.detach(request.workspaceId, request.nodeId, input.lease);
    if (input.method === 'preview') captures++;
    return executor.userCommand(request, input.method, input.args);
  });
  ipcMain.on('orkestrai:portal-layout', (_event, input) => { layouts.push(input.geometry); executor.setGeometry(request.workspaceId, request.nodeId, input.geometry, input.lease); });
  parent = new BrowserWindow({ width: 1100, height: 850, show: process.argv.includes('--show-window'), webPreferences: { preload: path.resolve('electron/preload.cjs'), sandbox: true, backgroundThrottling: false } });
  parent.webContents.on('console-message', event => console.log('renderer:', event.message));
  hostHtml = `<!doctype html><body style="margin:0;background:#202328;color:white">
    <div class="svelte-flow" style="position:relative;height:100vh;overflow:hidden">
      <div id="node" class="svelte-flow__node" style="position:absolute;left:150px;top:90px;width:600px;height:650px;transform-origin:0 0">
        <header style="height:40px;background:#333">Portal drag handle</header>
        <div id="host" style="height:610px;width:600px;overflow:hidden"></div>
      </div>
      <div class="svelte-flow__panel" id="toolbar" style="position:absolute;z-index:20;left:280px;top:680px;width:500px;height:50px;background:#fe5a44">Canvas toolbar</div>
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
  assert.equal(clip.getVisible(), true);
  assert.equal(await raw('window.identity'), identity);
  assert.equal(await raw('document.getElementById("message").value'), 'Session preserved');
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
  console.log(JSON.stringify({ ok: true, toolbarClipped: true, movementAligned: true, sessionPreserved: true, captures, screenshot }));
}
main().then(() => finish(), finish);
function finish(error) {
  clearTimeout(watchdog);
  if (error) console.error(error);
  executor?.closeAll(); parent?.destroy(); server?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
