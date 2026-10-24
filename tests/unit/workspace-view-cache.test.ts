import { afterEach, expect, it, vi } from 'vitest';
import { readWorkspaceViewCache, writeWorkspaceViewCache, removeWorkspaceViewCache, type WorkspaceViewSnapshot } from '$lib/components/agent-room/workspace-view-cache.js';

const ids: string[] = [];
const snapshot = (id: string) => { ids.push(id); return { workspace: { id }, nodes: [], edges: [], floors: [] } as unknown as WorkspaceViewSnapshot; };
afterEach(() => { for (const id of ids.splice(0)) removeWorkspaceViewCache(id); vi.useRealTimers(); });

it('keeps only recent workspace snapshots while preserving the most recently revisited workspace', () => {
  const first = snapshot('cache-first'); writeWorkspaceViewCache(first);
  for (let i = 0; i < 3; i++) writeWorkspaceViewCache(snapshot(`cache-${i}`));
  expect(readWorkspaceViewCache('cache-first')).toBe(first);
  writeWorkspaceViewCache(snapshot('cache-next'));
  expect(readWorkspaceViewCache('cache-0')).toBeNull();
  expect(readWorkspaceViewCache('cache-first')).toBe(first);
});

it('expires snapshots without extending their lifetime on a cache hit', () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const value = snapshot('cache-expiring'); writeWorkspaceViewCache(value);
  vi.advanceTimersByTime(30_000); expect(readWorkspaceViewCache(value.workspace.id)).toBe(value);
  vi.advanceTimersByTime(30_001); expect(readWorkspaceViewCache(value.workspace.id)).toBeNull();
});
