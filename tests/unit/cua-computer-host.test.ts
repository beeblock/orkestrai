import { afterEach, describe, expect, it, vi } from 'vitest';
import { CuaComputerHost } from '$lib/modules/agent-room/application/adapters/computers/CuaComputerHost.js';
import { computerHostRequestSchema } from '$lib/modules/agent-room/contracts/schemas/computer-host.schema.js';
import { NativeInteractionError } from '$lib/modules/agent-room/application/adapters/computers/native-interaction-error.js';

afterEach(() => vi.useRealTimers());

function fixture(granted = true) {
  const driver = {
    listApps: vi.fn(async () => ({ apps: [{ pid: 12, name: 'Test app', bundleId: 'com.test.app', active: true, running: true }] })),
    listWindows: vi.fn(async () => ({ windows: [{ pid: 12, windowId: 34n, title: 'Test window', appName: 'Test app', bounds: { x: 0, y: 0, width: 800, height: 600 }, isOnScreen: true, zIndex: 10n, layer: 0 }] })),
    getWindowState: vi.fn(async () => ({ pid: 12, windowId: 34n, elements: [], elementsComplete: true, truncated: false, degraded: false })),
    callTool: vi.fn(), shutdown: vi.fn(async () => undefined), uniffiDestroy: vi.fn(),
  };
  const loadDriver = vi.fn(async () => driver as never);
  const permissions = vi.fn(() => ({ accessibility: granted ? 'granted' as const : 'denied' as const, screenRecording: 'denied' as const }));
  const host = new CuaComputerHost({ loadDriver, permissions, displays: () => [{ id: '1', name: 'Display', primary: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 1440, height: 900 } }] });
  return { host, driver, loadDriver, permissions };
}

describe('Electron-owned Cua host', () => {
  it('exports only allowlisted diagnostics from trusted adapter failures', async () => {
    const f = fixture(false);
    expect(f.host.failureCode(new Error('private text'))).toBeUndefined();
    expect(f.host.failureCode({ code: 'draft_unconfirmed', message: 'private' })).toBeUndefined();
    expect(f.host.failureCode(new NativeInteractionError('private', true))).toBeUndefined();
    expect(f.host.failureCode(new NativeInteractionError('private', true, 'draft_unconfirmed'))).toBe('draft_unconfirmed');
    const denied = await f.host.execute({ operation: 'read', targetId: '12:cg:34', appId: 'com.test.app' }).catch(error => error);
    expect(f.host.failureCode(denied)).toBe('permission_accessibility');
    await f.host.stop();
  });
  it('recovers after a timeout only when native shutdown confirms all admitted work settled', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.driver.listApps.mockImplementationOnce((...args: unknown[]) => new Promise((_, reject) => {
      (args[1] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    let shutdown!: () => void;
    f.driver.shutdown.mockImplementationOnce(() => new Promise<void>(resolve => { shutdown = resolve; }));
    const observation = f.host.execute({ operation: 'snapshot' });
    const rejected = expect(observation).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.host.ready).toBe(false);
    expect(f.driver.shutdown).toHaveBeenCalledOnce();
    expect(f.driver.uniffiDestroy).not.toHaveBeenCalled();
    await expect(f.host.execute({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    shutdown();
    await rejected;
    expect(f.host.ready).toBe(true);
    expect(f.driver.uniffiDestroy).toHaveBeenCalledOnce();
    await f.host.execute({ operation: 'snapshot' });
    expect(f.loadDriver).toHaveBeenCalledTimes(2);
    expect(f.driver.callTool).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('does not recreate or destroy a runtime whose timeout shutdown failed', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.driver.listApps.mockImplementationOnce((...args: unknown[]) => new Promise((_, reject) => {
      (args[1] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    f.driver.shutdown.mockRejectedValueOnce(new Error('shutdown unconfirmed'));
    const rejected = expect(f.host.execute({ operation: 'snapshot' })).rejects.toThrow('shutdown unconfirmed');
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(f.host.ready).toBe(false);
    expect(f.driver.uniffiDestroy).not.toHaveBeenCalled();
    await expect(f.host.execute({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    expect(f.loadDriver).toHaveBeenCalledOnce();
    await f.host.stop();
  });
  it('coalesces quitting with timeout shutdown and never reopens a stopped host', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.driver.listApps.mockImplementationOnce((...args: unknown[]) => new Promise((_, reject) => {
      (args[1] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    let shutdown!: () => void;
    f.driver.shutdown.mockImplementationOnce(() => new Promise<void>(resolve => { shutdown = resolve; }));
    const rejected = expect(f.host.execute({ operation: 'snapshot' })).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(20_000);
    const stopping = f.host.stop();
    shutdown();
    await Promise.all([rejected, stopping]);
    expect(f.driver.shutdown).toHaveBeenCalledOnce();
    expect(f.driver.uniffiDestroy).toHaveBeenCalledOnce();
    expect(f.host.ready).toBe(false);
  });
  it('keeps a native mutation uncertain after timeout and never replays it while recovering', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.driver.callTool.mockImplementationOnce((...args: unknown[]) => new Promise((_, reject) => {
      (args[2] as { signal: AbortSignal }).signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const rejected = expect(f.host.execute({ operation: 'shortcut', keys: ['enter'], binding: { targetId: '12:cg:34', appId: 'com.test.app' } })).rejects.toMatchObject({ inputAttempted: true });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    expect(f.host.ready).toBe(true);
    expect(f.driver.callTool).toHaveBeenCalledOnce();
    await f.host.execute({ operation: 'snapshot' });
    expect(f.driver.callTool).toHaveBeenCalledOnce();
    expect(f.loadDriver).toHaveBeenCalledTimes(2);
    await f.host.stop();
  });
  it('reports the importing host permission and never requests grants or loads a denied driver', async () => {
    const f = fixture(false);
    expect(await f.host.execute({ operation: 'snapshot' })).toMatchObject({ permissions: { accessibility: 'denied' }, windows: [], focusedWindowId: null });
    await expect(f.host.execute({ operation: 'read', targetId: '12:cg:34', appId: 'com.test.app' })).rejects.toMatchObject({ inputAttempted: false });
    expect(f.loadDriver).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('reuses one in-process runtime and returns only the existing bounded snapshot contract', async () => {
    const f = fixture();
    const snapshot = await f.host.execute({ operation: 'snapshot', targetId: '12:cg:34' });
    expect(snapshot).toMatchObject({ platform: 'macos', focusedWindowId: '12:cg:34', windows: [{ id: '12:cg:34', appId: 'com.test.app' }] });
    expect(JSON.stringify(snapshot)).not.toContain('zIndex');
    expect(f.driver.listWindows).toHaveBeenCalledWith({ pid: 12 }, { signal: expect.any(AbortSignal) });
    await f.host.execute({ operation: 'read', targetId: '12:cg:34', appId: 'com.test.app' });
    expect(f.loadDriver).toHaveBeenCalledTimes(1);
    expect(f.driver.callTool).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('does not guess focus from window array order when native z-order is missing or ambiguous', async () => {
    const f = fixture();
    const windows = (await f.driver.listWindows()).windows;
    f.driver.listWindows.mockResolvedValue({ windows: [{ ...windows[0], zIndex: undefined as never }] });
    expect(await f.host.execute({ operation: 'snapshot' })).toMatchObject({ focusedWindowId: null });
    f.driver.listWindows.mockResolvedValue({ windows: [windows[0], { ...windows[0], windowId: 35n }] });
    expect(await f.host.execute({ operation: 'snapshot' })).toMatchObject({ focusedWindowId: null });
    await f.host.stop();
  });
  it('does not list native menu-bar overlays and one-pixel helper surfaces as controllable app windows', async () => {
    const f = fixture();
    const original = (await f.driver.listWindows()).windows[0];
    f.driver.listWindows.mockResolvedValue({ windows: [original, { ...original, windowId: 35n, layer: 24 }, { ...original, windowId: 36n, bounds: { x: 0, y: 0, width: 1, height: 1 } }] });
    expect(await f.host.execute({ operation: 'snapshot' })).toMatchObject({ windows: [{ id: '12:cg:34' }] });
    expect((await f.host.execute({ operation: 'snapshot' }) as { windows: unknown[] }).windows).toHaveLength(1);
    await f.host.stop();
  });
  it('rejects transport-level arbitrary tools, unknown fields and unbounded identifiers', () => {
    for (const request of [{ operation: 'callTool', tool: 'kill_app' }, { operation: 'snapshot', socketPath: '/tmp/another.sock' }, { operation: 'read', appId: 'com.test.app', targetId: 'x'.repeat(10000) }]) expect(() => computerHostRequestSchema.parse(request)).toThrow();
  });
  it('rechecks host permission after an earlier successful call', async () => {
    const f = fixture();
    await f.host.execute({ operation: 'snapshot' });
    f.permissions.mockReturnValue({ accessibility: 'denied', screenRecording: 'denied' });
    await expect(f.host.execute({ operation: 'read', targetId: '12:cg:34', appId: 'com.test.app' })).rejects.toMatchObject({ inputAttempted: false });
    expect(f.driver.getWindowState).not.toHaveBeenCalled();
    await f.host.stop();
  });
  it('does not overlap observations with another operation or dispose a native runtime while in use', async () => {
    const f = fixture();
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    f.driver.listApps.mockImplementationOnce(async () => { await wait; return { apps: [] }; });
    const observation = f.host.execute({ operation: 'snapshot' });
    await expect(f.host.execute({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
    const closing = f.host.stop();
    expect(f.driver.shutdown).not.toHaveBeenCalled();
    const interrupted = expect(observation).rejects.toMatchObject({ inputAttempted: false });
    release();
    await interrupted;
    await closing;
    await f.host.stop();
    expect(f.driver.shutdown).toHaveBeenCalledTimes(1);
    expect(f.driver.uniffiDestroy).toHaveBeenCalledTimes(1);
    await expect(f.host.execute({ operation: 'snapshot' })).rejects.toMatchObject({ inputAttempted: false });
  });
  it('sanitizes native loading failures without activating an external daemon', async () => {
    const f = fixture();
    f.loadDriver.mockRejectedValue(new Error('private native path or credential'));
    await expect(f.host.execute({ operation: 'snapshot' })).rejects.toThrow('could not load');
    expect(f.driver.callTool).not.toHaveBeenCalled();
    await f.host.stop();
  });
});
