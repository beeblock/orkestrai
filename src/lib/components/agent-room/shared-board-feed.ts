import { subscribeWorkspaceEvents } from './workspace-events.js';

type Snapshot = { tasks: unknown[]; nodes: Array<{ id: string; type: string; title: string | null }>; columns: unknown[] };
type Feed = { subscribe: (listener: (snapshot: Snapshot) => void) => () => void; refresh: () => Promise<void> };
const feeds = new Map<string, Feed>();

/** Event-driven board data; slow reconciliation survives dropped WS events. */
export function boardFeed(workspaceId: string): Feed {
  const existing = feeds.get(workspaceId);
  if (existing) return existing;
  const listeners = new Set<(snapshot: Snapshot) => void>();
  let flight: Promise<void> | null = null;
  let dirty = false;
  let last = '';
  let value: Snapshot | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let controller: AbortController | null = null;
  const onVisible = () => { if (!document.hidden) void feed.refresh(); };
  const base = `/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}`;
  const feed: Feed = {
    refresh() {
      if (flight) { dirty = true; return flight; }
      if (!listeners.size) return Promise.resolve();
      controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      flight = (async () => {
        try {
          const [tasks, nodes, columns] = await Promise.all(['/tasks', '/nodes?view=board', '/task-columns'].map(async path => {
            const response = await fetch(base + path, { signal });
            if (!response.ok) throw new Error('Board refresh unavailable.');
            const payload = await response.json();
            if (!Array.isArray(payload.data)) throw new Error('Invalid board response.');
            return payload.data;
          }));
          if (!listeners.size || signal.aborted) return;
          const next: Snapshot = { tasks, nodes, columns };
          const serialized = JSON.stringify(next);
          if (serialized !== last) {
            last = serialized; value = next;
            for (const listener of listeners) listener(next);
          }
        } catch { /* Retain the last snapshot; later events/reconciliation retry. */ }
        finally {
          flight = null; controller = null;
          if (dirty && listeners.size) { dirty = false; await feed.refresh(); }
        }
      })();
      return flight;
    },
    subscribe(listener) {
      listeners.add(listener);
      if (value) listener(value);
      if (listeners.size === 1) {
        unsubscribe = subscribeWorkspaceEvents(workspaceId, event => {
          if (!['workspaceChanged', 'connected'].includes(event.type)) return;
          if (event.type === 'connected' && !value && flight) return;
          if (document.hidden) return;
          if (debounce) return;
          debounce = setTimeout(() => { debounce = null; void feed.refresh(); }, 100);
        });
        timer = setInterval(() => { if (!document.hidden) void feed.refresh(); }, 30_000);
        document.addEventListener('visibilitychange', onVisible);
        void feed.refresh();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.(); if (timer) clearInterval(timer); if (debounce) clearTimeout(debounce);
          document.removeEventListener('visibilitychange', onVisible);
          controller?.abort(); feeds.delete(workspaceId); value = null; last = ''; dirty = false;
        }
      };
    },
  };
  feeds.set(workspaceId, feed);
  return feed;
}
