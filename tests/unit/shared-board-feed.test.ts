import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const events = vi.hoisted(() => new Map<string, (event: { type: string; workspaceId: string }) => void>());
vi.mock('$lib/components/agent-room/workspace-events.js', () => ({
  subscribeWorkspaceEvents: vi.fn((id, listener) => { events.set(id, listener); return () => events.delete(id); }),
}));

describe('shared board feed', () => {
  const stops: Array<() => void> = [];
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers();
    const document = Object.assign(new EventTarget(), { hidden: false });
    vi.stubGlobal('document', document);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.endsWith('/tasks') ? [{ id: 'task', title: 'First' }] : [] }) })));
  });
  afterEach(() => { stops.splice(0).forEach(stop => stop()); events.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('shares requests across boards, uses summaries and updates on events without five-second polling', async () => {
    const { boardFeed } = await import('$lib/components/agent-room/shared-board-feed.js');
    const feed = boardFeed('workspace'); const first = vi.fn(); const second = vi.fn();
    stops.push(feed.subscribe(first), boardFeed('workspace').subscribe(second));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/nodes?view=board'), expect.anything());
    expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(3);
    events.get('workspace')!({ type: 'workspaceChanged', workspaceId: 'workspace' });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(first).toHaveBeenCalledTimes(1); // identical data must not rebuild Markdown/DOM
    stops.shift()!(); stops.shift()!();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(6); expect(events.size).toBe(0);
  });

  it('skips hidden-window requests and reconciles immediately on visibility', async () => {
    const { boardFeed } = await import('$lib/components/agent-room/shared-board-feed.js');
    stops.push(boardFeed('workspace').subscribe(vi.fn()));
    await vi.advanceTimersByTimeAsync(0);
    Object.assign(document, { hidden: true });
    events.get('workspace')!({ type: 'workspaceChanged', workspaceId: 'workspace' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    Object.assign(document, { hidden: false }); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it('coalesces in-flight invalidations and recovers from startup failures', async () => {
    const { boardFeed } = await import('$lib/components/agent-room/shared-board-feed.js');
    const fetchMock = vi.mocked(fetch); fetchMock.mockRejectedValueOnce(new Error('Failed to fetch'));
    const listener = vi.fn(); const feed = boardFeed('workspace'); stops.push(feed.subscribe(listener));
    await vi.advanceTimersByTimeAsync(0); expect(listener).not.toHaveBeenCalled();
    events.get('workspace')!({ type: 'connected', workspaceId: 'workspace' });
    await vi.advanceTimersByTimeAsync(100); expect(listener).toHaveBeenCalledTimes(1);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    fetchMock.mockImplementationOnce(async () => { await gate; return { ok: true, json: async () => ({ data: [] }) } as Response; });
    const flight = feed.refresh(); void feed.refresh(); void feed.refresh();
    expect(fetch).toHaveBeenCalledTimes(9);
    release(); await flight;
    expect(fetch).toHaveBeenCalledTimes(12); // one follow-up, never concurrent duplicate drains
  });
});
