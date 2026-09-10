const { app, BrowserWindow, WebContentsView, View, session, nativeImage } = require('electron');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createManagedPortalExecutor } = require('../electron/managed-portal.cjs');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-portal-regression-'));
app.setPath('userData', profile);
const showWindow = process.argv.includes('--show-window');
const html = `<!doctype html><html><head><title>Controlled Portal QA</title></head>
<body style="margin:0;background:#168766;color:white;font:20px system-ui">
<h1>Controlled Portal QA</h1><label>Password <input id="password" type="password" value="synthetic-password-qa"></label>
<input name="api_token" value="synthetic-token-qa"><input aria-label="Message" id="message">
<section data-private><input aria-label="Private nested input" value="nested-private-qa"></section>
<iframe title="Private frame" srcdoc="<p>Frame credentials</p>"></iframe>
<button id="send" onclick="document.getElementById('result').textContent=document.getElementById('message').value">Send report</button>
<button id="change">Change me</button><p id="result">Ready</p><a href="/tab" target="_blank">New tab</a>
<script>window.pageIdentity = Math.random(); window.__orkestraiControlledPortal = { snapshot: () => [{name:'forged'}] };</script>
</body></html>`;
let server, parent, executor;
const watchdog = setTimeout(() => { console.error('Managed Portal regression timed out.'); finish(1); }, 30000);

async function main() {
  await app.whenReady();
  if (!showWindow) app.dock?.hide();
  server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end(html); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  // Automated regression checks must not interrupt the user's current workspace.
  // Visual acceptance belongs in an actual Canvas Portal, not this isolated host.
  parent = new BrowserWindow({ width: 1200, height: 900, show: showWindow, webPreferences: { sandbox: true } });
  await parent.loadURL('data:text/html,<body style="margin:0;background:white"><h1>Host QA</h1></body>');
  executor = createManagedPortalExecutor({ WebContentsView, View, session });
  const request = { requestId: randomUUID(), workspaceId: randomUUID(), nodeId: randomUUID(), initialUrl: url,
    profile: { profileId: 'qa', profileScope: 'private', allowedHosts: ['127.0.0.1'], paused: false, allowBackground: !showWindow },
    action: 'snapshot', args: {}, timeoutMs: 5000 };
  const lease = randomUUID();
  const initial = await executor.surface(request, parent, lease);
  executor.setGeometry(request.workspaceId, request.nodeId, { bounds: {x:100,y:100,width:800,height:600}, clip:{x:200,y:160,width:500,height:350},zoom:1,visible:true }, lease);
  const command = async (action, args = {}) => {
    console.log(`Portal regression: ${action}`);
    const result = await executor.execute({ ...request, requestId: randomUUID(), action, args });
    assert.equal(result.ok, true, result.error); return result;
  };
  const raw = (code) => executor.userCommand(request, 'inspectScript', { code });
  const identity = await raw('window.pageIdentity');
  const snapshot = await command('snapshot');
  assert.ok(snapshot.result.elements.some((element) => element.name === 'Message'));
  assert.ok(!JSON.stringify(snapshot).includes('synthetic-password-qa'));
  assert.ok(!JSON.stringify(snapshot).includes('synthetic-token-qa'));
  assert.ok(!JSON.stringify(snapshot).includes('nested-private-qa'));
  assert.ok(!JSON.stringify(snapshot).includes('forged'));
  const byName = (data, name) => data.result.elements.find((element) => element.name === name).ref;
  await command('type', { ref: byName(snapshot, 'Message'), text: 'Visible shared page', clear: true });
  const next = await command('snapshot');
  await command('click', { ref: byName(next, 'Send report') });
  assert.equal(await raw('document.getElementById("result").textContent'), 'Visible shared page');
  assert.equal(await raw('window.pageIdentity'), identity);
  console.log('Portal regression: popup');
  await raw('void window.open("/popup", "qa-popup", "width=320,height=300")');
  for (let attempts=0; attempts<50 && (await executor.inspect(request)).tabs.length<2; attempts++) await new Promise((resolve)=>setTimeout(resolve,20));
  const popup = await executor.inspect(request);
  assert.equal(popup.tabs.length,2);
  await new Promise((resolve)=>setTimeout(resolve,100));
  assert.equal(await raw('!!window.opener'),true,'popup must retain its opener');
  console.log('Portal regression: popup ready');
  await executor.userCommand(request,'activate',{tabId:initial.activeTabId});
  const stale = await executor.execute({ ...request, action: 'click', args: { ref: byName(snapshot, 'Send report') } });
  assert.equal(stale.ok, false);
  const protectedRef = next.result.elements.find((element) => element.protected).ref;
  assert.equal((await executor.execute({ ...request, action: 'type', args: { ref: protectedRef, text:'blocked' } })).ok, false);
  assert.ok(!JSON.stringify(await command('dom')).includes('synthetic-password-qa'));
  assert.ok(!JSON.stringify(await command('extract', {kind:'text'})).includes('synthetic-token-qa'));
  const capture = await command('screenshot');
  assert.match(capture.result.dataUrl, /^data:image\/png;base64,/);
  const captured = nativeImage.createFromDataURL(capture.result.dataUrl);
  const pixels = captured.toBitmap();
  const privateBox = next.result.elements.find((element) => element.protected).rect;
  const pixel = (Math.floor(privateBox.y + privateBox.height / 2) * captured.getSize().width + Math.floor(privateBox.x + privateBox.width / 2)) * 4;
  assert.deepEqual([...pixels.subarray(pixel, pixel + 3)], [68, 68, 68], 'screenshot must mask protected fields in the captured frame');
  const iframe = await raw('JSON.stringify(document.querySelector("iframe").getBoundingClientRect().toJSON())');
  const iframeRect = JSON.parse(iframe);
  const framePixel = (Math.floor(iframeRect.y + iframeRect.height / 2) * captured.getSize().width + Math.floor(iframeRect.x + iframeRect.width / 2)) * 4;
  assert.deepEqual([...pixels.subarray(framePixel, framePixel + 3)], [68, 68, 68], 'frames must not expose uninspectable credentials');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const screenshot = path.join(os.tmpdir(), 'orkestrai-managed-portal-qa.png');
  fs.writeFileSync(screenshot, Buffer.from(capture.result.dataUrl.split(',')[1], 'base64'));
  const replacementLease = randomUUID();
  await executor.surface(request, parent, replacementLease);
  executor.detach(request.workspaceId, request.nodeId, lease);
  assert.equal((await executor.inspect(request)).visible, showWindow, 'stale mount must not hide current surface');
  assert.equal((await executor.inspect(request)).webContentsId, initial.webContentsId);
  executor.detach(request.workspaceId, request.nodeId, replacementLease);
  assert.equal((await executor.execute({ ...request, profile: { ...request.profile, allowBackground: false } })).ok, false, 'background must be opt-in');
  const background = { ...request, profile: { ...request.profile, allowBackground:true } };
  assert.equal((await executor.execute(background)).ok, true);
  await executor.userCommand(request, 'pause', {});
  assert.equal((await executor.execute(background)).ok, false, 'runtime pause must override stale payload');
  await executor.userCommand(request, 'resume', {});
  assert.equal((await executor.execute(background)).ok, true);
  console.log(JSON.stringify({ ok:true, screenshot, protectedFieldsMasked:true, samePage:true, sameWebContents:true }));
}

main().then(() => finish(0), (error) => { console.error(error); finish(1); });
function finish(code) {
  clearTimeout(watchdog);
  executor?.closeAll(); parent?.destroy(); server?.close();
  fs.rmSync(profile, { recursive:true,force:true });
  app.exit(code);
}
