const { setTimeout: sleep } = require('node:timers/promises');

const MAX_PROFILE_BYTES = 8 * 1024 * 1024;
const MAX_PROFILE_NODES = 20_000;
const MAX_PROFILE_SAMPLES = 100_000;
const PROFILE_MS = 5_000;

function number(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }
function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null; }
function route(contents) {
  try {
    const url = new URL(contents.getURL());
    return { route: ['/canvas', '/terminal', '/bots', '/adventure', '/settings'].includes(url.pathname) ? url.pathname : 'other',
      workspaceId: identifier(url.searchParams.get('workspace')) };
  } catch { return { route: 'other', workspaceId: null }; }
}
function frame(value) {
  let file = '';
  try { file = new URL(value.url).pathname.split('/').at(-1) ?? ''; } catch { /* Empty and native frames have no URL. */ }
  if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(file)) file = '';
  return { functionName: String(value.functionName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160),
    scriptId: String(value.scriptId ?? '').slice(0, 32), url: file,
    lineNumber: Number.isInteger(value.lineNumber) ? value.lineNumber : -1,
    columnNumber: Number.isInteger(value.columnNumber) ? value.columnNumber : -1 };
}
function safeProfile(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.samples) || !Array.isArray(raw.timeDeltas)
    || raw.nodes.length > MAX_PROFILE_NODES || raw.samples.length > MAX_PROFILE_SAMPLES
    || raw.timeDeltas.length !== raw.samples.length) return null;
  const nodes = raw.nodes.map(node => ({ id: number(node.id), callFrame: frame(node.callFrame ?? {}),
    hitCount: number(node.hitCount), ...(Array.isArray(node.children) ? { children: node.children.map(number) } : {}) }));
  const profile = { nodes, startTime: number(raw.startTime), endTime: number(raw.endTime),
    samples: raw.samples.map(number), timeDeltas: raw.timeDeltas.map(number) };
  return Buffer.byteLength(JSON.stringify(profile)) <= MAX_PROFILE_BYTES ? profile : null;
}
async function bounded(operation, ms = 1_500) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('diagnostics_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function heapUsage(dbg) {
  try {
    const value = await bounded(dbg.sendCommand('Runtime.getHeapUsage'), 250);
    if (!Number.isFinite(value?.usedSize) || value.usedSize < 0 || !Number.isFinite(value?.totalSize) || value.totalSize < 0) return { status: 'unavailable' };
    const result = { status: 'ok' };
    // CDP Runtime.getHeapUsage reports isolate-wide byte counts. It does not
    // execute page code or take a heap snapshot. Older hosts may omit extras.
    for (const key of ['usedSize', 'totalSize', 'embedderHeapUsedSize', 'backingStorageSize']) {
      if (Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
    }
    return result;
  } catch { return { status: 'unavailable' }; }
}

/** Private, read-only observations. Never accepts a URL, script, PID or debugger command. */
function createRuntimeDiagnostics({ app, getMainWindow, getPortalRenderers = () => [], getWindows = () => [], now = Date.now, wait = sleep }) {
  let profiling = false, lastProfile = -Infinity, lastMetrics = -Infinity;
  function windowRenderer(window, kind) {
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return null;
    const contents = window.webContents;
    return { kind, webContentsId: contents.id, osProcessId: contents.getOSProcessId(), visible: Boolean(window.isVisible()), ...route(contents) };
  }
  function metrics() {
    if (now() - lastMetrics < 1_000) return { status: 'rate_limited' };
    lastMetrics = now();
    const main = getMainWindow(), mainRenderer = windowRenderer(main, 'main');
    const renderers = mainRenderer ? [mainRenderer] : [];
    for (const window of getWindows().slice(0, 32)) {
      if (window === main) continue;
      const renderer = windowRenderer(window, 'app-window');
      if (renderer) renderers.push(renderer);
    }
    const portals = getPortalRenderers();
    for (const value of portals.slice(0, 256)) renderers.push({ kind: 'portal', webContentsId: number(value.webContentsId),
      osProcessId: number(value.osProcessId), workspaceId: identifier(value.workspaceId), nodeId: identifier(value.nodeId),
      tabId: identifier(value.tabId), visible: value.visible === true, paused: value.paused === true });
    const processes = app.getAppMetrics().slice(0, 256).map(value => ({ pid: number(value.pid),
      type: ['Browser', 'Tab', 'GPU', 'Utility', 'Zygote', 'Sandbox helper', 'Pepper Plugin', 'Pepper Plugin Broker'].includes(value.type) ? value.type : 'other',
      cpu: { percentCPUUsage: number(value.cpu?.percentCPUUsage), cumulativeCPUUsage: number(value.cpu?.cumulativeCPUUsage) },
      memory: { workingSetSize: number(value.memory?.workingSetSize), peakWorkingSetSize: number(value.memory?.peakWorkingSetSize),
        privateBytes: number(value.memory?.privateBytes) } }));
    return { status: 'ok', capturedAt: new Date(now()).toISOString(), mainRendererPid: mainRenderer?.osProcessId ?? null,
      renderers, processes, truncated: portals.length >= 256 || processes.length >= 256 };
  }
  async function profile() {
    if (profiling) return { status: 'busy' };
    if (now() - lastProfile < 60_000) return { status: 'rate_limited' };
    const window = getMainWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return { status: 'unavailable' };
    const contents = window.webContents, dbg = contents.debugger;
    if (dbg.isAttached()) return { status: 'busy' };
    profiling = true; lastProfile = now();
    let owned = false;
    const detached = () => { owned = false; };
    const command = (method, parameters) => {
      if (!owned || !dbg.isAttached()) throw new Error('diagnostics_detached');
      return dbg.sendCommand(method, parameters);
    };
    try {
      dbg.attach('1.3'); owned = true; dbg.on('detach', detached);
      await bounded(command('Profiler.enable'));
      await bounded(command('Profiler.setSamplingInterval', { interval: 1_000 }));
      const before = await heapUsage({ sendCommand: command });
      await bounded(command('Profiler.start'));
      await wait(PROFILE_MS);
      if (!owned || !dbg.isAttached()) return { status: 'unavailable' };
      const result = await bounded(command('Profiler.stop'));
      const after = await heapUsage({ sendCommand: command });
      const profile = safeProfile(result?.profile);
      if (!profile) return { status: 'too_large' };
      return { status: 'ok', capturedAt: new Date(now()).toISOString(), durationMs: PROFILE_MS,
        mainRendererPid: contents.getOSProcessId(), ...route(contents), heap: { before, after }, profile };
    } catch (error) { return { status: error?.message === 'diagnostics_timeout' ? 'timeout' : 'unavailable' }; }
    finally {
      try {
        if (owned && dbg.isAttached()) {
          try { await bounded(command('Profiler.disable'), 250); } catch { /* Detach still releases our profiler. */ }
          if (owned && dbg.isAttached()) dbg.detach();
        }
      } catch { /* A closing window cannot retain the admission lock. */ }
      finally { dbg.removeListener('detach', detached); profiling = false; }
    }
  }
  return { async execute(mode) {
    if (!['metrics', 'profile'].includes(mode)) return { status: 'invalid' };
    try { return mode === 'metrics' ? metrics() : await profile(); }
    catch { return { status: 'unavailable' }; }
  } };
}

module.exports = { createRuntimeDiagnostics, safeProfile };
