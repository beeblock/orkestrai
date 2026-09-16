const { app } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Native-library compatibility only. No BrowserWindow, permission prompt,
// screenshot, application control, user profile or installed-app acceptance.
const directory = mkdtempSync(join(tmpdir(), 'orkestrai-cua-electron-smoke-'));
app.setPath('userData', directory);
app.dock?.hide();
let driver;
process.env.CUA_DRIVER_RS_TELEMETRY_ENABLED = '0';
const deadline = setTimeout(() => {
  rmSync(directory, { recursive: true, force: true });
  app.exit(2);
}, 20_000);
app.whenReady().then(async () => {
  const { CuaDriver } = await import('@trycua/cua-driver');
  driver = CuaDriver.create(undefined);
  const metadata = await driver.metadata();
  const result = await driver.callTool('check_permissions', JSON.stringify({ prompt: false }));
  const payload = JSON.parse(result.structuredJson || '{}');
  if (result.isError || payload.source?.attribution !== 'host' || payload.source?.direct_runtime !== true) throw new Error('SDK permission ownership did not match the Electron host.');
  console.log(JSON.stringify({ host: process.type, electron: process.versions.electron, metadata,
    permissionAttribution: payload.source?.attribution, directRuntime: payload.source?.direct_runtime }));
  if (process.env.ORKESTRAI_CUA_SMOKE_SCREEN === '1') {
    const screen = await driver.callTool('get_screen_size', '{}');
    console.log(JSON.stringify({ screen: JSON.parse(screen.structuredJson || '{}'), isError: screen.isError }));
  }
}).then(() => finish(0), () => finish(1));

async function finish(code) {
  try { await driver?.shutdown(); }
  finally {
    driver?.uniffiDestroy();
    clearTimeout(deadline);
    rmSync(directory, { recursive: true, force: true });
    app.exit(code);
  }
}
