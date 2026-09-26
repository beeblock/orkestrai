const { app, BrowserWindow, WebContentsView, View, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-portal-navigation-'));
app.setPath('userData', profile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let parent, server, executor;
const watchdog = setTimeout(() => finish(new Error('Portal navigation regression timed out.')), 45000);

async function main() {
  await app.whenReady();
  app.dock?.hide();
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<body style="margin:0;background:#168766"><h1>Navigation recovered</h1><input aria-label="Message"><script>window.identity=Math.random()</script></body>');
  });
  await new Promise(resolve => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  parent = new BrowserWindow({ width: 900, height: 700, show: false, webPreferences: { sandbox: true } });
  await parent.loadURL('data:text/html,<body>Portal navigation regression</body>');
  parent.showInactive();
  executor = createManagedPortalExecutor({ WebContentsView, View, session });
  const request = { workspaceId: randomUUID(), nodeId: randomUUID(), initialUrl: 'about:blank',
    profile: { profileId: 'qa', profileScope: 'private', allowedHosts: ['127.0.0.1', 'localhost'], paused: false, allowBackground: true },
    action: 'snapshot', args: {}, timeoutMs: 5000 };
  const lease = randomUUID();
  const initial = await executor.surface(request, parent, lease);
  const clip = parent.contentView.children.find(view => !(view instanceof WebContentsView));
  const contents = clip.children[0].webContents;
  const geometry = { bounds: { x: 40, y: 40, width: 400, height: 300 }, clip: { x: 40, y: 40, width: 400, height: 300 },
    viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };
  const layout = zoom => executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, zoom }, lease);
  const command = (action, args = {}) => executor.execute({ ...request, requestId: randomUUID(), action, args });
  const confirm = async (action, args) => {
    const result = await command(action, args);
    assert.equal(result.ok, true, `${action}: ${result.error}`);
    return result;
  };

  // A new WebContents has no RenderWidgetHostView yet. Applying emulation here
  // used to segfault the main process, outside JavaScript exception handling.
  console.log('Portal navigation: resize a never-loaded blank page');
  layout(0.5);
  await pause(100);
  await confirm('navigate', { url });
  await confirm('snapshot');
  await executor.userCommand(request, 'capture', {});
  await confirm('screenshot');
  assert.equal((await executor.inspect(request)).webContentsId, initial.webContentsId);

  console.log('Portal navigation: failed load, inspect, and retry');
  const closedServer = http.createServer();
  await new Promise(resolve => closedServer.listen(0, '127.0.0.1', resolve));
  const unavailable = `http://127.0.0.1:${closedServer.address().port}/`;
  await new Promise(resolve => closedServer.close(resolve));
  assert.equal((await command('navigate', { url: unavailable })).ok, false, 'an unavailable site must not be reported as opened');
  layout(0.6);
  await command('snapshot');
  await confirm('navigate', { url });
  await confirm('screenshot');

  console.log('Portal navigation: origin changes with concurrent preview and zoom');
  for (let i = 0; i < 4; i++) {
    const preview = executor.userCommand(request, 'preview', {}).catch(() => null);
    const navigation = confirm('navigate', { url: i % 2 ? url : url.replace('127.0.0.1', 'localhost') });
    layout(0.5 + i * 0.1);
    await navigation;
    await preview;
    const snapshot = await confirm('snapshot');
    assert.ok(snapshot.result.elements.some(element => element.name === 'Message'));
    const capture = await confirm('screenshot');
    assert.ok(capture.result.width > 0 && capture.result.height > 0);
  }

  console.log('Portal navigation: renderer loss followed by recovery');
  const gone = new Promise(resolve => contents.once('render-process-gone', resolve));
  contents.forcefullyCrashRenderer();
  await gone;
  layout(0.9);
  await pause(50);
  await confirm('navigate', { url });
  await confirm('snapshot');
  await confirm('screenshot');
  for (let i = 0; i < 40 && !clip.getVisible(); i++) await pause(50);
  assert.equal(clip.getVisible(), true, 'the live page must return after renderer recovery');
  assert.equal((await executor.inspect(request)).webContentsId, initial.webContentsId);
  console.log('Portal navigation regression passed.');
}

function finish(error) {
  clearTimeout(watchdog);
  if (error) console.error(error);
  executor?.closeAll();
  if (parent && !parent.isDestroyed()) parent.destroy();
  server?.closeAllConnections();
  server?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}

main().then(() => finish(), finish);
