import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const { createRuntimeDiagnostics, safeProfile } = require('../../electron/runtime-diagnostics.cjs');
const rawProfile = () => ({ nodes: [{ id: 1, callFrame: { functionName: 'renderCanvas', scriptId: '3',
  url: 'http://127.0.0.1:4173/_app/immutable/chunks/canvas.js?token=private#secret', lineNumber: 12, columnNumber: 8 }, hitCount: 1 }],
samples: [1], timeDeltas: [1000], startTime: 1, endTime: 5000001 });

function harness() {
  let time = 0, attached = false;
  const dbg = Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => { attached = true; }),
    detach: vi.fn(() => { attached = false; dbg.emit('detach', {}, 'target_closed'); }),
    sendCommand: vi.fn(async (method: string): Promise<{ profile?: ReturnType<typeof rawProfile> | null }> => method === 'Profiler.stop' ? { profile: rawProfile() } : {}),
  });
  const contents = { id: 7, isDestroyed: () => false, getOSProcessId: () => 4321,
    getURL: () => 'http://localhost:4173/canvas?workspace=abc-123&token=private#secret', debugger: dbg };
  const window = { isDestroyed: () => false, isVisible: () => true, webContents: contents,
    isEnabled: () => false, isModal: () => false, isFocused: () => true,
    getBounds: () => ({ x: 10, y: 20, width: 1905, height: 900, privatePayload: 'secret' }) };
  const app = { getAppMetrics: () => [{ pid: 4321, type: 'Tab', serviceName: 'secret', cpu: { percentCPUUsage: 100 },
    memory: { workingSetSize: 2048 }, arbitrary: 'private' }] };
  const wait = vi.fn(async () => { time += 5000; });
  const diagnostics = createRuntimeDiagnostics({ app, getMainWindow: () => window,
    getPortalRenderers: () => [{ webContentsId: 20, osProcessId: 9876, workspaceId: 'workspace', nodeId: 'node',
      tabId: 'tab', visible: false, paused: false, url: 'https://private?credential=secret', parentWebContentsId: 7,
      clipBounds: { x: 0, y: 0, width: 1905, height: 900, privatePayload: 'secret' }, tabBounds: { x: Infinity },
      clipVisible: true, geometryVisible: false, geometryMoving: false }], now: () => time, wait });
  return { diagnostics, dbg, wait, setTime: (value: number) => { time = value; } };
}

describe('private runtime diagnostics', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('maps the main renderer and portals without returning URLs or arbitrary process fields', async () => {
    const { diagnostics, setTime } = harness();
    const result = await diagnostics.execute('metrics');
    expect(result).toMatchObject({ status: 'ok', mainRendererPid: 4321,
      renderers: [{ kind: 'main', route: '/canvas', workspaceId: 'abc-123', osProcessId: 4321,
        enabled: false, modal: false, focused: true, bounds: { x: 10, y: 20, width: 1905, height: 900 } },
      { kind: 'portal', osProcessId: 9876, parentWebContentsId: 7, clipVisible: true, geometryVisible: false,
        clipBounds: { x: 0, y: 0, width: 1905, height: 900 }, tabBounds: null }] });
    expect(JSON.stringify(result)).not.toMatch(/"private"|secret|token|credential|serviceName/);
    expect(await diagnostics.execute('metrics')).toEqual({ status: 'rate_limited' });
    setTime(1001);
    expect((await diagnostics.execute('metrics')).status).toBe('ok');
    expect(await diagnostics.execute('Runtime.evaluate')).toEqual({ status: 'invalid' });
  });

  it('profiles only the main renderer for five seconds and always releases its own debugger', async () => {
    const { diagnostics, dbg, wait } = harness();
    const result = await diagnostics.execute('profile');
    expect(result).toMatchObject({ status: 'ok', durationMs: 5000, mainRendererPid: 4321,
      profile: { nodes: [{ callFrame: { functionName: 'renderCanvas', url: 'canvas.js' } }] } });
    expect(wait).toHaveBeenCalledExactlyOnceWith(5000);
    expect(dbg.sendCommand.mock.calls.map(([method]) => method)).toEqual([
      'Profiler.enable', 'Profiler.setSamplingInterval', 'Runtime.getHeapUsage', 'Profiler.start', 'Profiler.stop', 'Runtime.getHeapUsage', 'Profiler.disable',
    ]);
    expect(dbg.detach).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toMatch(/private|secret|token|127\.0\.0\.1/);
    expect(await diagnostics.execute('profile')).toEqual({ status: 'rate_limited' });
  });

  it('leaves a debugger owned by DevTools or another client untouched', async () => {
    const { diagnostics, dbg, wait } = harness();
    dbg.isAttached.mockReturnValue(true);
    expect(await diagnostics.execute('profile')).toEqual({ status: 'busy' });
    expect(dbg.attach).not.toHaveBeenCalled(); expect(dbg.detach).not.toHaveBeenCalled(); expect(wait).not.toHaveBeenCalled();
  });

  it('allowlists heap byte counters and profiles normally when heap observation is unsupported', async () => {
    const { diagnostics, dbg, setTime } = harness();
    dbg.sendCommand.mockImplementation(async method => method === 'Profiler.stop' ? { profile: rawProfile() }
      : method === 'Runtime.getHeapUsage' ? { usedSize: 2048, totalSize: 4096, embedderHeapUsedSize: 512,
        backingStorageSize: 1024, privatePayload: 'secret' } as any : {});
    const result = await diagnostics.execute('profile');
    expect(result.heap).toEqual({ before: { status: 'ok', usedSize: 2048, totalSize: 4096, embedderHeapUsedSize: 512, backingStorageSize: 1024 },
      after: { status: 'ok', usedSize: 2048, totalSize: 4096, embedderHeapUsedSize: 512, backingStorageSize: 1024 } });
    expect(JSON.stringify(result)).not.toContain('privatePayload');
    setTime(60001);
    dbg.sendCommand.mockImplementation(async method => {
      if (method === 'Runtime.getHeapUsage') throw new Error('unsupported');
      return method === 'Profiler.stop' ? { profile: rawProfile() } : {};
    });
    const unsupported = await diagnostics.execute('profile');
    expect(unsupported).toMatchObject({ status: 'ok', heap: { before: { status: 'unavailable' }, after: { status: 'unavailable' } } });
  });

  it('does not detach a new debugger when its own session was detached during capture', async () => {
    const { diagnostics, dbg, wait } = harness();
    wait.mockImplementationOnce(async () => { dbg.emit('detach', {}, 'replaced'); });
    expect(await diagnostics.execute('profile')).toEqual({ status: 'unavailable' });
    expect(dbg.detach).not.toHaveBeenCalled();
    expect(dbg.sendCommand.mock.calls.map(([method]) => method)).not.toContain('Profiler.disable');
  });

  it('cleans up rejected commands and permits a later capture after cooldown', async () => {
    const { diagnostics, dbg, setTime } = harness();
    dbg.sendCommand.mockRejectedValueOnce(new Error('sensitive internal error'));
    expect(await diagnostics.execute('profile')).toEqual({ status: 'unavailable' });
    expect(dbg.detach).toHaveBeenCalledOnce();
    setTime(60001);
    expect((await diagnostics.execute('profile')).status).toBe('ok');
  });

  it('times out a stuck command and releases the debugger and admission lock', async () => {
    vi.useFakeTimers();
    const { diagnostics, dbg, setTime } = harness();
    dbg.sendCommand.mockImplementationOnce(() => new Promise(() => {}));
    const capture = diagnostics.execute('profile');
    await vi.advanceTimersByTimeAsync(1501);
    expect(await capture).toEqual({ status: 'timeout' });
    expect(dbg.detach).toHaveBeenCalledOnce();
    setTime(60001);
    expect((await diagnostics.execute('profile')).status).toBe('ok');
  });

  it('rejects oversized profiles rather than returning an invalid partial trace', async () => {
    expect(safeProfile({ ...rawProfile(), samples: new Array(100001).fill(1) })).toBeNull();
    const { diagnostics, dbg } = harness();
    dbg.sendCommand.mockImplementation(async method => method === 'Profiler.stop' ? { profile: null } : {});
    expect(await diagnostics.execute('profile')).toEqual({ status: 'too_large' });
    expect(dbg.detach).toHaveBeenCalledOnce();
  });
});
