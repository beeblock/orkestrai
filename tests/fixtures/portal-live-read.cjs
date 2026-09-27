const { app, BrowserWindow, WebContentsView, View, session } = require('electron');
const { createManagedPortalExecutor } = require('../../electron/managed-portal.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-portal-live-read-'));
app.setPath('userData', profile);
let host, executor;
const timer = setTimeout(() => finish(1), 20000);
async function finish(code) {
  clearTimeout(timer); await executor?.closeAll(); host?.destroy(); fs.rmSync(profile, { recursive: true, force: true }); app.exit(code);
}
app.whenReady().then(async () => {
  app.dock?.hide();
  host = new BrowserWindow({ show: false, width: 1000, height: 800 });
  executor = createManagedPortalExecutor({ WebContentsView, View, session });
  const request = { requestId: randomUUID(), workspaceId: randomUUID(), nodeId: randomUUID(),
    initialUrl: process.env.ORKESTRAI_PORTAL_TEST_URL, action: 'snapshot', args: {}, timeoutMs: 3000,
    profile: { profileId: 'readonly-test', profileScope: 'workspace', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: true } };
  const lease = randomUUID();
  console.time('attach'); console.log(await executor.surface(request, host, lease)); console.timeEnd('attach');
  executor.setGeometry(request.workspaceId, request.nodeId, { bounds: { x: 0, y: 0, width: 640, height: 480 }, clip: { x: 0, y: 0, width: 640, height: 480 }, viewport: { width: 1920, height: 1080 }, zoom: 0.333, visible: true }, lease);
  console.time('snapshot'); const result = await executor.execute(request); console.log({ ok: result.ok, elements: result.result?.elements?.length, error: result.error }); console.timeEnd('snapshot');
  finish(result.ok ? 0 : 1);
}).catch(e => { console.error(e); finish(1); });
