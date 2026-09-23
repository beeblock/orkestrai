import { watch, type FSWatcher } from 'chokidar';

type Lease = { watcher: FSWatcher; paths: Set<string>; expiry: ReturnType<typeof setTimeout>; debounce?: ReturnType<typeof setTimeout> };
const key = Symbol.for('orkestrai.knowledgeFileWatch');
const leases: Map<string, Lease> = ((globalThis as any)[key] ??= new Map());
const emit = (workspaceId: string) => (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'knowledgeChanged', workspaceId });

export async function stopKnowledgeWatch(workspaceId: string) {
  const lease = leases.get(workspaceId);
  if (!lease) return;
  leases.delete(workspaceId); clearTimeout(lease.expiry); clearTimeout(lease.debounce);
  await lease.watcher.close();
}

/** Exact, already-authorized source paths only. Never crawl a project or follow symlinks. */
export async function leaseKnowledgeWatch(workspaceId: string, paths: string[], polling = false) {
  const next = new Set(paths);
  if (!next.size) { await stopKnowledgeWatch(workspaceId); return; }
  let lease = leases.get(workspaceId);
  if (lease) {
    clearTimeout(lease.expiry);
    await lease.watcher.unwatch([...lease.paths].filter(path => !next.has(path)));
    lease.watcher.add([...next].filter(path => !lease!.paths.has(path)));
    lease.paths = next;
  } else {
    const watcher = watch([...next], { persistent: false, ignoreInitial: true, followSymlinks: false, depth: 0,
      usePolling: polling, interval: 1000, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 } });
    lease = { watcher, paths: next, expiry: setTimeout(() => {}, 0) };
    leases.set(workspaceId, lease);
    watcher.on('all', (_event, path) => {
      if (!lease!.paths.has(path)) return;
      clearTimeout(lease!.debounce);
      lease!.debounce = setTimeout(() => emit(workspaceId), 150); lease!.debounce.unref();
    });
    watcher.on('error', () => { emit(workspaceId); void stopKnowledgeWatch(workspaceId); });
    watcher.once('ready', () => emit(workspaceId));
  }
  lease.expiry = setTimeout(() => void stopKnowledgeWatch(workspaceId), 45_000); lease.expiry.unref();
}
