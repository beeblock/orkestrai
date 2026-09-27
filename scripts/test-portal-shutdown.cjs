const { app, BrowserWindow, WebContentsView, View, session } = require('electron');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-portal-shutdown-'));
app.setPath('userData', profile);
app.on('window-all-closed', () => {});
let server, parent, executor;
let finishing = false;
const watchdog = setTimeout(() => finish(new Error('Portal shutdown regression timed out.')), 120000);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  await app.whenReady();
  app.dock?.hide();
  server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><body style="background:#148870"><h1>Shutdown fixture</h1><script>localStorage.setItem("restored", "yes")</script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = { workspaceId: randomUUID(), nodeId: randomUUID(),
    initialUrl: `http://127.0.0.1:${server.address().port}/`, action: 'snapshot', args: {}, timeoutMs: 3000,
    profile: { profileId: 'shutdown', profileScope: 'private', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: true } };
  for (let round = 0; round < 50; round++) {
    parent = new BrowserWindow({ show: false, width: 900, height: 700 });
    executor = createManagedPortalExecutor({ WebContentsView, View, session });
    const lease = randomUUID();
    await executor.surface(request, parent, lease);
    executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 0, y: 0, width: 640, height: 480 }, clip: { x: 0, y: 0, width: 640, height: 480 },
      viewport: { width: 1280, height: 960 }, zoom: 0.5, visible: true,
    }, lease);
    assert.equal(await executor.userCommand(request, 'inspectScript', { code: 'localStorage.getItem("restored")' }), 'yes');
    const pending = executor.userCommand(request, 'preview', {}).then(() => 'captured', () => 'closed');
    await pause(round % 5);
    await executor.closeAll();
    await pending;
    assert.equal((await executor.execute(request)).ok, false, 'shutdown must not reopen a tab');
    parent.destroy();
    parent = null;
    if ((round + 1) % 10 === 0) console.log(`Portal capture/close/reopen: ${round + 1}/50`);
  }
  console.log(JSON.stringify({ ok: true, cycles: 50, pendingCapturesDrained: true, lateRequestsRejected: true }));
}

async function finish(error) {
  if (finishing) return;
  finishing = true;
  clearTimeout(watchdog);
  if (error) console.error(error);
  await executor?.closeAll();
  parent?.destroy();
  server?.closeAllConnections();
  server?.close();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}
main().then(() => finish(), finish);
