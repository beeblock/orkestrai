import { afterEach, expect, it, vi } from 'vitest';
import { readWorkspaceViewCache, writeWorkspaceViewCache, removeWorkspaceViewCache, clearWorkspaceViewCache, loadWorkspaceProviders, type WorkspaceViewSnapshot } from '$lib/components/agent-room/workspace-view-cache.js';
import type { AgentProviderInfo } from '$lib/modules/agent-room/domain/types.js';

const ids: string[] = [];
const snapshot = (id: string, content = '') => { ids.push(id); return { workspace: { id }, nodes: content ? [{ payload: { content } }] : [], edges: [], floors: [] } as unknown as WorkspaceViewSnapshot; };
const providers = (id: string) => [{ id }] as AgentProviderInfo[];
afterEach(() => { for (const id of ids.splice(0)) removeWorkspaceViewCache(id); vi.useRealTimers(); });

it('retains the six visible tabs and evicts the least recently revisited board', () => {
  const first = snapshot('cache-first'); writeWorkspaceViewCache(first);
  for (let i = 0; i < 5; i++) writeWorkspaceViewCache(snapshot(`cache-${i}`));
  expect(readWorkspaceViewCache('cache-first')).toBe(first);
  writeWorkspaceViewCache(snapshot('cache-next'));
  expect(readWorkspaceViewCache('cache-0')).toBeNull();
  expect(readWorkspaceViewCache('cache-first')).toBe(first);
});

it('keeps a previously opened board after an hour and explicitly evicts it on unload', () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const value = snapshot('cache-expiring'); writeWorkspaceViewCache(value);
  vi.advanceTimersByTime(3_600_000);
  expect(readWorkspaceViewCache(value.workspace.id)).toBe(value);
  clearWorkspaceViewCache(value.workspace.id);
  expect(readWorkspaceViewCache(value.workspace.id)).toBeNull();
});

it('bounds retained DTO memory and does not displace small boards for one oversized snapshot', () => {
  const a = snapshot('cache-large-a', 'a'.repeat(5 * 1024 * 1024));
  const b = snapshot('cache-large-b', 'b'.repeat(5 * 1024 * 1024));
  writeWorkspaceViewCache(a); writeWorkspaceViewCache(b);
  expect(readWorkspaceViewCache(a.workspace.id)).toBeNull();
  expect(readWorkspaceViewCache(b.workspace.id)).toBe(b);
  const oversized = snapshot('cache-oversized', 'c'.repeat(9 * 1024 * 1024));
  writeWorkspaceViewCache(oversized);
  expect(readWorkspaceViewCache(oversized.workspace.id)).toBeNull();
  expect(readWorkspaceViewCache(b.workspace.id)).toBe(b);
});

it('deduplicates simultaneous provider discovery per workspace, preserving runtime scope', async () => {
  const a = snapshot('providers-a').workspace.id, b = snapshot('providers-b').workspace.id;
  let finish!: (value: AgentProviderInfo[]) => void;
  const load = vi.fn(() => new Promise<AgentProviderInfo[]>(resolve => { finish = resolve; }));
  const first = loadWorkspaceProviders(a, load), second = loadWorkspaceProviders(a, load);
  expect(first).toBe(second);
  await Promise.resolve(); expect(load).toHaveBeenCalledOnce();
  const list = providers('native'); finish(list);
  expect(await first).toBe(list);
  expect(await loadWorkspaceProviders(a, load)).toBe(list);
  const other = vi.fn().mockResolvedValue(providers('wsl'));
  expect(await loadWorkspaceProviders(b, other)).toEqual(providers('wsl'));
  expect(other).toHaveBeenCalledOnce();
});

it('refreshes provider metadata after its TTL or an explicit runtime/settings refresh', async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const id = snapshot('providers-refresh').workspace.id;
  const load = vi.fn().mockResolvedValue(providers('old'));
  await loadWorkspaceProviders(id, load);
  vi.advanceTimersByTime(60_001); load.mockResolvedValue(providers('new'));
  expect(await loadWorkspaceProviders(id, load)).toEqual(providers('new'));
  expect(load).toHaveBeenCalledTimes(2);
  load.mockResolvedValue(providers('changed-runtime'));
  expect(await loadWorkspaceProviders(id, load, true)).toEqual(providers('changed-runtime'));
  expect(load).toHaveBeenCalledTimes(3);
});

it('does not poison provider discovery after failure or repopulate an unloaded workspace with a late response', async () => {
  const id = snapshot('providers-recovery').workspace.id;
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(providers('retry'));
  await expect(loadWorkspaceProviders(id, load)).rejects.toThrow('offline');
  expect(await loadWorkspaceProviders(id, load)).toEqual(providers('retry'));
  let finish!: (value: AgentProviderInfo[]) => void;
  const pending = loadWorkspaceProviders(id, () => new Promise(resolve => { finish = resolve; }), true);
  await Promise.resolve(); clearWorkspaceViewCache(id); finish(providers('late'));
  await pending;
  expect(await loadWorkspaceProviders(id, load)).toEqual(providers('retry'));
  expect(load).toHaveBeenCalledTimes(3);
});
