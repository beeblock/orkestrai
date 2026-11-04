import { performance } from 'node:perf_hooks';

let windowStarted = 0;
let emitted = 0;
const active = new Map();

function routeKind(url) {
  const path = String(url ?? '').slice(0, 1024).split(/[?#]/, 1)[0];
  if (path.startsWith('/_app/immutable/')) return 'ui-module';
  if (/^\/api\/agent-room\/workspaces\/[^/]+\/fs\/raw$/.test(path)) return 'asset-stream';
  if (/^\/api\/agent-room\/workspaces\/[^/]+\/fs\//.test(path)) return 'workspace-files';
  if (/^\/api\/agent-room\/workspaces\/[^/]+\/git\//.test(path)) return 'workspace-git';
  if (path === '/api/agent-room/core/health') return 'core-health';
  if (path === '/api/agent-room/settings') return 'settings';
  if (path.startsWith('/api/')) return 'api';
  return 'page';
}

/** Record slow/failed HTTP classes even when immutable assets fail before
 * SvelteKit hooks. Never include URLs, paths, bodies, tokens or error text. */
export function observeCoreRequest(request, response, options = {}) {
  const now = options.now ?? (() => performance.now());
  const warn = options.warn ?? (value => console.warn(value));
  const started = now();
  const kind = routeKind(request.url);
  active.set(kind, (active.get(kind) ?? 0) + 1);
  let waitingLogged = false;
  let finished = false;
  const report = phase => {
    const time = now();
    if (time - windowStarted >= 60_000 || time < windowStarted) { windowStarted = time; emitted = 0; }
    if (emitted++ >= 12) return;
    warn(`[orkestrai:core-http] ${JSON.stringify({ phase, kind, status: phase === 'waiting' ? null : response.statusCode,
      elapsedMs: Math.round(time - started), pid: process.pid, active: Object.fromEntries(active) })}`);
  };
  const timer = setTimeout(() => {
    if (kind === 'asset-stream' && response.headersSent) return;
    waitingLogged = true; report('waiting');
  }, options.slowMs ?? 5_000);
  timer.unref();
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    const count = active.get(kind) - 1;
    if (count) active.set(kind, count); else active.delete(kind);
    const slow = now() - started >= (options.slowMs ?? 5_000);
    if (response.statusCode >= 500 || waitingLogged || (slow && kind !== 'asset-stream')) report('finished');
  };
  response.once('finish', finish);
  response.once('close', finish);
}
