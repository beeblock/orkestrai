import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('workspace event channels', () => {
  let sockets: FakeSocket[];
  let fail = false;
  const stops: Array<() => void> = [];
  class FakeSocket {
    onopen: (() => void) | null = null; onclose: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null; onerror: (() => void) | null = null;
    send = vi.fn(); close = vi.fn();
    constructor() { if (fail) throw new Error('Unavailable'); sockets.push(this); }
  }
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); sockets = []; fail = false;
    vi.stubGlobal('WebSocket', FakeSocket); vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5199' });
  });
  afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('shares scoped metadata and closes only after the last consumer', async () => {
    const { subscribeWorkspaceEvents } = await import('$lib/components/agent-room/workspace-events.js');
    const first = vi.fn(); const second = vi.fn();
    stops.push(subscribeWorkspaceEvents('one', first), subscribeWorkspaceEvents('one', second));
    expect(sockets).toHaveLength(1); sockets[0].onopen!();
    expect(JSON.parse(sockets[0].send.mock.calls[0][0])).toMatchObject({ type: 'subscribe', workspaceId: 'one' });
    first.mockClear(); second.mockClear();
    for (const data of ['bad', 'null', JSON.stringify({ type: 'portalCommand', workspaceId: 'other' }), 'a'.repeat(4097)]) sockets[0].onmessage!({ data });
    expect(first).not.toHaveBeenCalled();
    sockets[0].onmessage!({ data: JSON.stringify({ type: 'portalCommand', workspaceId: 'one', nodeId: 'portal', args: { secret: 'must-not-forward' } }) });
    expect(first).toHaveBeenCalledWith({ type: 'portalCommand', workspaceId: 'one', nodeId: 'portal' });
    expect(second).toHaveBeenCalledTimes(1);
    stops.shift()!(); expect(sockets[0].close).not.toHaveBeenCalled();
    stops.shift()!(); expect(sockets[0].close).toHaveBeenCalledTimes(1);
  });
  it('retries constructor failures and disconnects without reviving disposed channels', async () => {
    const { subscribeWorkspaceEvents } = await import('$lib/components/agent-room/workspace-events.js');
    fail = true; stops.push(subscribeWorkspaceEvents('one', vi.fn()));
    await vi.advanceTimersByTimeAsync(6000); expect(sockets).toHaveLength(0);
    fail = false; await vi.advanceTimersByTimeAsync(3000); expect(sockets).toHaveLength(1);
    sockets[0].onclose!(); stops.shift()!();
    await vi.advanceTimersByTimeAsync(6000); expect(sockets).toHaveLength(1);
  });
});
