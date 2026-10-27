import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { constrainMove, normalizeLayout, placementOf, stripBounds, COMPACT_WIDTH } = require('../../electron/adventure-window.cjs') as {
  constrainMove: (bounds: Bounds, workArea: Bounds, layout: Layout) => Bounds;
  normalizeLayout: (input: unknown) => Layout;
  placementOf: (bounds: Bounds, display: { id: number; workArea: Bounds }) => { displayId: number; left: number; bottom: number };
  stripBounds: (workArea: Bounds, layout: Layout, saved: { left: number; bottom: number } | null) => Bounds;
  COMPACT_WIDTH: number;
};
type Bounds = { x: number; y: number; width: number; height: number };
type Layout = { width: 'full' | 'compact'; height: number };

const area: Bounds = { x: 0, y: 25, width: 1440, height: 800 };

const { createAdventureWindowController, canTrackCursor } = require('../../electron/adventure-window.cjs');

function desktop(platform: string, options: { ozonePlatform?: string; env?: Record<string, string> } = {}) {
  vi.useFakeTimers();
  let point = { x: 40, y: 530 };
  let strip: WindowStub;
  class WindowStub extends EventEmitter {
    visible = false;
    destroyed = false;
    loading = false;
    zoom = 1;
    rect: Bounds;
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      isDestroyed: () => this.destroyed,
      isLoadingMainFrame: () => this.loading,
      getZoomFactor: () => this.zoom,
      setWindowOpenHandler: vi.fn(),
    });
    constructor(bounds: Bounds) { super(); this.rect = bounds; strip = this; }
    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    focus = vi.fn();
    loadURL = vi.fn(async () => {});
    isDestroyed = () => this.destroyed;
    isVisible = () => this.visible;
    getBounds = () => this.rect;
    getContentBounds = () => this.rect;
    setBounds = (bounds: Bounds) => { this.rect = bounds; };
    showInactive = () => { this.visible = true; this.emit('show'); };
    hide = () => { this.visible = false; this.emit('hide'); };
    destroy = () => { this.destroyed = true; this.emit('closed'); };
  }
  const display = { id: 1, workArea: area };
  const screen = Object.assign(new EventEmitter(), {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    getCursorScreenPoint: vi.fn(() => point),
  });
  const diagnostics = { write: vi.fn() };
  const controller = createAdventureWindowController({
    BrowserWindow: WindowStub, screen, platform, diagnostics,
    urlFor: () => 'http://127.0.0.1:5199/adventure',
    env: {}, ...options,
  });
  controller.open();
  const window = strip!;
  const envelopes = () => window.webContents.send.mock.calls.filter(([channel]) => channel === 'orkestrai:adventure-pointer').map(([, value]) => value);
  const samples = () => envelopes().map((value) => value.point);
  const acknowledge = () => controller.acknowledgePointer(envelopes().at(-1)?.id, window.webContents);
  return { controller, window, screen, diagnostics, samples, envelopes, acknowledge, point: (value: typeof point) => { point = value; } };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('adventure strip desktop cursor recovery', () => {
  it('bridges cursor samples through the real preload and removes the listener on disposal', () => {
    const ipc = Object.assign(new EventEmitter(), { send: vi.fn(), invoke: vi.fn() });
    let api: { onAdventurePointer: (callback: (point: { x: number; y: number } | null) => void) => () => void };
    runInNewContext(readFileSync(new URL('../../electron/preload.cjs', import.meta.url), 'utf8'), {
      process: { platform: 'win32' },
      require: (name: string) => {
        if (name !== 'electron') throw new Error(`Unexpected preload import: ${name}`);
        return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld: (_name: string, value: typeof api) => { api = value; } } };
      },
    });
    const receive = vi.fn();
    const dispose = api!.onAdventurePointer(receive);
    expect(ipc.send).toHaveBeenCalledWith('orkestrai:adventure-pointer-ready');
    ipc.emit('orkestrai:adventure-pointer', {}, { id: 1, point: { x: 120, y: 40 } });
    ipc.emit('orkestrai:adventure-pointer', {}, { id: 2, point: null });
    for (const invalid of [undefined, {}, { x: '120', y: 40 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }]) {
      ipc.emit('orkestrai:adventure-pointer', {}, { id: 3, point: invalid });
    }
    expect(receive.mock.calls).toEqual([[{ x: 120, y: 40 }], [null]]);
    expect(ipc.send).toHaveBeenCalledWith('orkestrai:adventure-pointer-ack', 1);
    expect(ipc.send).toHaveBeenCalledWith('orkestrai:adventure-pointer-ack', 2);
    receive.mockImplementationOnce(() => { throw new Error('hover failed'); });
    expect(() => ipc.emit('orkestrai:adventure-pointer', {}, { id: 4, point: null })).toThrow('hover failed');
    expect(ipc.send).toHaveBeenCalledWith('orkestrai:adventure-pointer-ack', 4);
    dispose();
    expect(ipc.listenerCount('orkestrai:adventure-pointer')).toBe(0);
    ipc.emit('orkestrai:adventure-pointer', {}, { id: 5, point: { x: 1, y: 2 } });
    expect(receive).toHaveBeenCalledTimes(3);
  });

  it.each(['win32', 'linux'])('recovers interactivity on %s without any DOM mouse movement', (platform) => {
    const { controller, window, samples } = desktop(platform);
    expect(samples()).toEqual([]);
    window.emit('ready-to-show');
    expect(samples()).toEqual([{ x: 40, y: 25 }]);
    // The ignored window delivered no native move. The renderer can still
    // hit-test this point and restore input using its authenticated sender.
    controller.setInteractive(true, window.webContents);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true });
    controller.setInteractive(false, window.webContents);
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(window.focus).not.toHaveBeenCalled();
  });

  it('uses DIP coordinates on negative-origin displays and applies the page zoom once', () => {
    const { window, point, samples } = desktop('win32');
    window.rect = { x: -1920, y: -300, width: 1440, height: 320 };
    window.zoom = 2;
    point({ x: -1720, y: -180 });
    window.emit('ready-to-show');
    expect(samples()).toEqual([{ x: 100, y: 60 }]);
  });

  it('reports leaving the window once, then sends no IPC while outside', () => {
    const { window, point, samples, screen, acknowledge } = desktop('linux');
    window.emit('ready-to-show');
    acknowledge();
    point({ x: 40, y: 20 });
    vi.advanceTimersByTime(33);
    expect(samples().at(-1)).toBeNull();
    acknowledge();
    const sent = samples().length;
    vi.advanceTimersByTime(30_000);
    expect(samples()).toHaveLength(sent);
    expect(screen.getCursorScreenPoint).toHaveBeenCalled();
  });

  it('bounds stationary-cursor updates while allowing moving heroes and late subscribers to catch up', () => {
    const { window, samples, acknowledge } = desktop('win32');
    window.emit('ready-to-show');
    for (let step = 0; step < 30; step++) { acknowledge(); vi.advanceTimersByTime(33); }
    expect(samples().length).toBeGreaterThan(1);
    expect(samples().length).toBeLessThanOrEqual(6);
  });

  it('stops on hide and close, and clears a stale hover when shown with the cursor outside', () => {
    const { controller, window, point, screen, samples } = desktop('win32');
    window.emit('ready-to-show');
    controller.setInteractive(true, window.webContents);
    window.hide();
    expect(vi.getTimerCount()).toBe(0);
    const calls = screen.getCursorScreenPoint.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(screen.getCursorScreenPoint).toHaveBeenCalledTimes(calls);
    point({ x: -40, y: 0 });
    controller.open();
    expect(samples().at(-1)).toBeNull();
    controller.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(controller.isOpen()).toBe(false);
  });

  it('resets the previous document input state and resumes sampling after reload', () => {
    const { controller, window, samples } = desktop('linux');
    window.emit('ready-to-show');
    controller.setInteractive(true, window.webContents);
    window.loading = true;
    window.webContents.emit('did-start-loading');
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    const sent = samples().length;
    vi.advanceTimersByTime(500);
    expect(samples()).toHaveLength(sent);
    window.loading = false;
    vi.advanceTimersByTime(33);
    expect(samples().length).toBe(sent + 1);
  });

  it('rejects input-state changes from another webContents', () => {
    const { controller, window } = desktop('win32');
    const calls = window.setIgnoreMouseEvents.mock.calls.length;
    controller.setInteractive(true, {});
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledTimes(calls);
  });

  it('keeps only one sample in flight while the renderer is blocked, then uses the current position', () => {
    const { window, samples, point, acknowledge, screen } = desktop('win32');
    window.emit('ready-to-show');
    point({ x: 140, y: 550 });
    const reads = screen.getCursorScreenPoint.mock.calls.length;
    vi.advanceTimersByTime(30_000);
    expect(samples()).toEqual([{ x: 40, y: 25 }]);
    expect(screen.getCursorScreenPoint).toHaveBeenCalledTimes(reads);
    acknowledge();
    vi.advanceTimersByTime(33);
    expect(samples()).toEqual([{ x: 40, y: 25 }, { x: 140, y: 45 }]);
  });

  it('recovers a sample sent before subscription and rejects foreign or stale acknowledgements', () => {
    const { controller, window, envelopes, samples } = desktop('linux');
    window.emit('ready-to-show');
    const old = envelopes().at(-1).id;
    controller.pointerReady(window.webContents);
    expect(samples()).toHaveLength(2);
    vi.advanceTimersByTime(1_000);
    controller.acknowledgePointer(old, window.webContents);
    controller.acknowledgePointer(envelopes().at(-1).id, {});
    controller.pointerReady({});
    vi.advanceTimersByTime(1_000);
    expect(samples()).toHaveLength(2);
    controller.acknowledgePointer(envelopes().at(-1).id, window.webContents);
    vi.advanceTimersByTime(33);
    expect(samples()).toHaveLength(3);
  });

  it('leaves macOS on the existing native forwarding path without a polling timer', () => {
    const { controller, window, samples, screen } = desktop('darwin');
    window.emit('ready-to-show');
    controller.pointerReady(window.webContents);
    vi.advanceTimersByTime(60_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled();
    expect(samples()).toEqual([]);
    expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it('distinguishes native Wayland from an explicit XWayland backend', () => {
    const env = { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' };
    expect(canTrackCursor('linux', '', env)).toBe(false);
    expect(canTrackCursor('linux', 'wayland', {})).toBe(false);
    expect(canTrackCursor('linux', 'x11', env)).toBe(true);
    expect(canTrackCursor('linux', '', { XDG_SESSION_TYPE: 'x11' })).toBe(true);
    const { window, screen, diagnostics } = desktop('linux', { env });
    window.emit('ready-to-show');
    expect(vi.getTimerCount()).toBe(0);
    expect(screen.getCursorScreenPoint).not.toHaveBeenCalled();
    expect(diagnostics.write).toHaveBeenCalledOnce();
  });

  it('contains a failed cursor API instead of crashing the main process or flooding logs', () => {
    const { window, screen, diagnostics, samples } = desktop('win32');
    screen.getCursorScreenPoint.mockImplementation(() => { throw new Error('display unavailable'); });
    expect(() => window.emit('ready-to-show')).not.toThrow();
    expect(() => vi.advanceTimersByTime(1_000)).not.toThrow();
    expect(diagnostics.write).toHaveBeenCalledOnce();
    screen.getCursorScreenPoint.mockReturnValue({ x: 40, y: 530 });
    vi.advanceTimersByTime(33);
    expect(samples().at(-1)).toEqual({ x: 40, y: 25 });
  });
});

describe('adventure strip window placement', () => {
  it('sits on the Dock at full width by default and keeps a sane height', () => {
    expect(stripBounds(area, normalizeLayout(null), null)).toEqual({ x: 0, y: 25 + 800 - 320, width: 1440, height: 320 });
    expect(normalizeLayout({ width: 'compact', height: 9_999 })).toEqual({ width: 'compact', height: 480 });
    expect(normalizeLayout({ width: 'weird', height: Number.NaN })).toEqual({ width: 'full', height: 320 });
  });

  it('remembers where it was left, relative to the work area, and stays on screen', () => {
    const layout = normalizeLayout({ width: 'compact', height: 320 });
    expect(stripBounds(area, layout, null)).toEqual({ x: (1440 - COMPACT_WIDTH) / 2, y: 505, width: COMPACT_WIDTH, height: 320 });
    const saved = placementOf({ x: 100, y: 300, width: COMPACT_WIDTH, height: 320 }, { id: 7, workArea: area });
    expect(saved).toEqual({ displayId: 7, left: 100, bottom: 205 });
    expect(stripBounds(area, layout, saved)).toEqual({ x: 100, y: 300, width: COMPACT_WIDTH, height: 320 });
    // A smaller display later: still fully visible.
    expect(stripBounds({ x: 0, y: 0, width: 800, height: 400 }, layout, { left: 700, bottom: 300 })).toEqual({ x: 40, y: 0, width: COMPACT_WIDTH, height: 320 });
  });

  it('drags full width only up and down, and compact anywhere on the display', () => {
    const full = normalizeLayout({ width: 'full', height: 320 });
    expect(constrainMove({ x: 300, y: 200, width: 1440, height: 320 }, area, full)).toEqual({ x: 0, y: 200, width: 1440, height: 320 });
    expect(constrainMove({ x: 0, y: -50, width: 1440, height: 320 }, area, full).y).toBe(25);
    const compact = normalizeLayout({ width: 'compact', height: 320 });
    expect(constrainMove({ x: 2_000, y: 900, width: COMPACT_WIDTH, height: 320 }, area, compact)).toEqual({ x: 1440 - COMPACT_WIDTH, y: 505, width: COMPACT_WIDTH, height: 320 });
  });
});
