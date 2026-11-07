import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ read: vi.fn(), info: vi.fn() }));
vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>(), readdir: state.read, stat: state.info }));
import { recentTranscriptFiles } from '$lib/modules/agent-room/infrastructure/transcript/TranscriptFiles.ts';
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
it('shares a slow Windows/UNC scan past the cache TTL, including fresh readers', async () => {
  vi.useFakeTimers();
  let complete!: (entries: unknown[]) => void;
  state.read.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const a = recentTranscriptFiles('/private-unique-slow-root', 5);
  await vi.advanceTimersByTimeAsync(2500);
  const b = recentTranscriptFiles('/private-unique-slow-root', 5);
  const fresh = recentTranscriptFiles('/private-unique-slow-root', 5, true);
  expect(a).toBe(b); expect(fresh).toBe(a); expect(state.read).toHaveBeenCalledTimes(1);
  complete([]); await a;
  expect(await recentTranscriptFiles('/private-unique-slow-root', 5)).toEqual([]);
  expect(state.read).toHaveBeenCalledTimes(1);
});
