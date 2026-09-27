import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createManagedPortalExecutor } = require('../../electron/managed-portal.cjs');

class Contents extends EventEmitter {
  id = Math.random();
  url = 'about:blank';
  destroyed = false;
  handler: (details: Record<string, unknown>) => any = () => ({ action: 'deny' });
  getURL() { return this.url; }
  getTitle() { return 'Portal fixture'; }
  isDestroyed() { return this.destroyed; }
  setZoomFactor = vi.fn();
  getZoomFactor = () => 1;
  capturePage = vi.fn(async () => ({ toDataURL: () => 'data:image/png;base64,', getSize: () => ({ width: 800, height: 600 }) }));
  debugger = { isAttached: () => true, sendCommand: vi.fn(async (_method: string, _parameters?: Record<string, unknown>): Promise<any> => ({})) };
  setWindowOpenHandler(handler: typeof this.handler) { this.handler = handler; }
  async loadURL(url: string) {
    this.emit('did-start-navigation', {}, url, false, true);
    this.url = url;
    this.emit('did-navigate', {}, url);
    this.emit('dom-ready');
    this.emit('did-finish-load');
  }
  executeJavaScriptInIsolatedWorld = vi.fn(async (): Promise<any> => ({ x: 0, y: 0, density: 1 }));
  close() { this.destroyed = true; this.emit('destroyed'); }
}

class View {
  children = new Set<View>();
  visible = false;
  setBounds = vi.fn();
  setVisible(visible: boolean) { this.visible = visible; }
  addChildView(view: View) { this.children.add(view); }
  removeChildView(view: View) { this.children.delete(view); }
}

class ContentsView extends View {
  static instances: ContentsView[] = [];
  webContents: Contents;
  constructor(public options: { webContents?: Contents; webPreferences: Record<string, unknown> }) {
    super();
    this.webContents = options.webContents ?? new Contents();
    ContentsView.instances.push(this);
  }
}

const active: Array<ReturnType<typeof createManagedPortalExecutor>> = [];
afterEach(async () => {
  await Promise.all(active.splice(0).map((executor) => executor.closeAll()));
  ContentsView.instances = [];
});

async function setup() {
  const cookies = Object.assign(new EventEmitter(), { flushStore: vi.fn(async () => {}) });
  const onOpenRequest = vi.fn();
  const executor = createManagedPortalExecutor({
    WebContentsView: ContentsView, View,
    session: { fromPartition: () => ({ cookies, flushStorageData: vi.fn(), setPermissionRequestHandler: vi.fn() }) },
    onOpenRequest,
  });
  active.push(executor);
  const parent = Object.assign(new EventEmitter(), {
    contentView: new View(), isVisible: () => true, isDestroyed: () => false,
  });
  const request = {
    workspaceId: randomUUID(), nodeId: randomUUID(), initialUrl: 'https://example.com/',
    profile: { profileId: 'default', profileScope: 'private', allowedHosts: ['example.com'], paused: false, allowBackground: false },
    action: 'snapshot', args: {}, timeoutMs: 1000,
  };
  const lease = randomUUID();
  const state = await executor.surface(request, parent, lease);
  executor.setGeometry(request.workspaceId, request.nodeId, {
    bounds: { x: 100, y: 100, width: 800, height: 600 },
    clip: { x: 100, y: 100, width: 500, height: 350 }, zoom: 1, visible: true,
  }, lease);
  await new Promise(resolve => setImmediate(resolve));
  return { executor, parent, request, lease, state, onOpenRequest, contents: ContentsView.instances[0].webContents };
}

describe('embedded Portal surface lifecycle', () => {
  it('drains a pending native read before closing and rejects late work without recreating tabs', async () => {
    const { executor, request, contents, parent, lease } = await setup();
    let finish!: (result: []) => void;
    contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = executor.execute(request);
    await new Promise(resolve => setImmediate(resolve));
    const count = ContentsView.instances.length;
    const closing = executor.closeAll();
    expect(executor.closeAll()).toBe(closing);
    expect(contents.isDestroyed()).toBe(false);
    expect(await executor.execute(request)).toMatchObject({ ok: false, error: expect.stringContaining('closing') });
    await expect(executor.surface(request, parent, lease)).rejects.toThrow('closing');
    expect(ContentsView.instances).toHaveLength(count);
    finish([]);
    expect(await pending).toMatchObject({ ok: false });
    await closing;
    expect(contents.isDestroyed()).toBe(true);
    expect(parent.contentView.children.size).toBe(0);
  });

  it('does not run a second action while a timed-out renderer operation is unresolved', async () => {
    const { executor, request, contents } = await setup();
    vi.useFakeTimers();
    try {
      let finish!: (result: {}) => void;
      contents.executeJavaScriptInIsolatedWorld.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const first = executor.execute({ ...request, action: 'click', args: { ref: 'button' }, timeoutMs: 10000 });
      await vi.advanceTimersByTimeAsync(5100);
      expect(await first).toMatchObject({ ok: false, error: expect.stringContaining('did not respond') });
      const count = contents.executeJavaScriptInIsolatedWorld.mock.calls.length;
      expect(await executor.execute({ ...request, action: 'click', args: { ref: 'button' } })).toMatchObject({ ok: false, error: expect.stringContaining('unresolved') });
      expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(count);
      finish({});
      await Promise.resolve();
      expect(await executor.execute(request)).toMatchObject({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it('fails reads promptly after a dev server load failure, then permits navigation and retry', async () => {
    const { executor, request, contents } = await setup();
    contents.emit('did-start-navigation', {}, request.initialUrl, false, true);
    contents.emit('did-fail-load', {}, -102, 'ERR_CONNECTION_REFUSED', request.initialUrl, true);
    contents.emit('dom-ready'); contents.emit('did-finish-load');
    expect(await executor.execute(request)).toMatchObject({ ok: false, error: expect.stringContaining('unavailable') });
    expect(await executor.execute({ ...request, action: 'navigate', args: { url: request.initialUrl } })).toMatchObject({ ok: true });
    expect(await executor.execute(request)).toMatchObject({ ok: true });
  });

  it('bounds native compositor stalls so later commands are not stuck behind a screenshot forever', async () => {
    const { executor, request, contents } = await setup();
    vi.useFakeTimers();
    try {
      contents.capturePage.mockImplementation(() => new Promise(() => {}));
      contents.debugger.sendCommand.mockImplementation(async () => { throw new Error('Current display surface not available'); });
      const result = executor.execute({ ...request, action: 'screenshot' });
      await vi.advanceTimersByTimeAsync(8000);
      expect(await result).toMatchObject({ ok: false });
      expect(await executor.execute({ ...request, action: 'tabs', args: { operation: 'list' } })).toMatchObject({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it('does not present or capture a page between main-frame navigation and DOM readiness', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    const calls = contents.debugger.sendCommand.mock.calls.length;
    contents.emit('did-start-navigation', {}, 'https://example.com/next', false, true);
    executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true,
    }, lease);
    expect([...parent.contentView.children][0].visible).toBe(false);
    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(calls);
    await expect(executor.userCommand(request, 'preview', {})).rejects.toThrow('loading or unavailable');
    contents.emit('dom-ready');
    await new Promise(resolve => setImmediate(resolve));
    expect([...parent.contentView.children][0].visible).toBe(true);
    expect(contents.debugger.sendCommand).toHaveBeenLastCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ dontSetVisibleSize: true }));
  });

  it('does not let a stale presentation completion suppress the next document', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    let finish!: (value: {}) => void;
    contents.debugger.sendCommand.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true,
    }, lease);
    const before = contents.debugger.sendCommand.mock.calls.length;
    contents.emit('render-process-gone', {}, { reason: 'crashed' });
    contents.emit('dom-ready');
    finish({});
    await new Promise(resolve => setImmediate(resolve));
    expect(contents.debugger.sendCommand).toHaveBeenCalledTimes(before + 1);
    expect([...parent.contentView.children][0].visible).toBe(true);
  });

  it.each(['Current display surface not available for capture', 'UnknownVizError'])('retries transient compositor error %s without exposing the page early', async (error) => {
    const { executor, parent, request, lease, contents } = await setup();
    const captures = contents.capturePage.mock.calls.length;
    contents.capturePage.mockRejectedValueOnce(new Error(error));
    executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true,
    }, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect([...parent.contentView.children][0].visible).toBe(false);
    await vi.waitFor(() => expect([...parent.contentView.children][0].visible).toBe(true));
    expect(contents.capturePage).toHaveBeenCalledTimes(captures + 2);
  });

  it('recovers a failed presentation without requiring the user to change geometry', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    contents.debugger.sendCommand.mockRejectedValueOnce(new Error('Temporary compositor failure'));
    executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true,
    }, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect([...parent.contentView.children][0].visible).toBe(false);
    await vi.waitFor(() => expect([...parent.contentView.children][0].visible).toBe(true));
  });

  it('does not race native capture with the logical screenshot on a mounted Portal', async () => {
    const { executor, request, contents } = await setup();
    const png = Buffer.alloc(24); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
    const before = contents.capturePage.mock.calls.length;
    contents.debugger.sendCommand.mockImplementation(async method => {
      if (method === 'Page.captureScreenshot') expect(contents.capturePage).toHaveBeenCalledTimes(before);
      return { data: png.toString('base64') };
    });
    expect(await executor.execute({ ...request, action: 'screenshot' })).toMatchObject({ ok: true });
  });

  it('discards screenshots if navigation replaces the masked document', async () => {
    const { executor, request, contents } = await setup();
    let finish!: (result: { data: string }) => void;
    contents.debugger.sendCommand.mockImplementation(async method => {
      if (method === 'Page.captureScreenshot') return new Promise(resolve => { finish = resolve; });
      return {};
    });
    const capture = executor.execute({ ...request, action: 'screenshot' });
    await new Promise(resolve => setImmediate(resolve));
    contents.emit('did-start-navigation', {}, 'https://example.com/new', false, true);
    contents.emit('dom-ready');
    const png = Buffer.alloc(24); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
    finish({ data: png.toString('base64') });
    expect(await capture).toMatchObject({ ok: false, error: expect.stringContaining('page changed during capture') });
  });

  it('hides only native presentation during motion without closing or disabling the shared browser', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    const clip = [...parent.contentView.children][0];
    const geometry = { bounds: { x: 320, y: 140, width: 800, height: 600 }, clip: { x: 320, y: 140, width: 800, height: 400 }, zoom: 1, visible: true };
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, moving: true }, lease);
    expect(clip.visible).toBe(false);
    expect((await executor.execute(request)).ok).toBe(true);
    expect((await executor.inspect(request)).visible).toBe(true);
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, moving: false }, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect(clip.visible).toBe(true);
    expect(clip.setBounds).toHaveBeenLastCalledWith(geometry.clip);
    expect((await executor.inspect(request)).webContentsId).toBe(contents.id);
    expect(ContentsView.instances).toHaveLength(1);
  });
  it('moves the clipping surface without blinking the active tab or repeatedly resetting its zoom', async () => {
    const { executor, request, lease, contents } = await setup();
    const view = ContentsView.instances[0];
    const visibility = vi.spyOn(view, 'setVisible');
    const initialZoomCalls = contents.setZoomFactor.mock.calls.length;
    for (let x = 0; x < 60; x++) executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100 + x, y: 100, width: 800, height: 600 },
      clip: { x: 100 + x, y: 100, width: 800, height: 600 }, zoom: 1, visible: true,
    }, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect(visibility).not.toHaveBeenCalled();
    expect(contents.setZoomFactor).toHaveBeenCalledTimes(initialZoomCalls);
    expect(view.visible).toBe(true);
    expect((await executor.inspect(request)).webContentsId).toBe(contents.id);
  });
  it('bounds the actual native child and scales its presentation without origin-shared page zoom', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    const view = ContentsView.instances[0];
    const zoomCalls = contents.setZoomFactor.mock.calls.length;
    const geometry = { bounds: { x: -40, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 140, width: 200, height: 200 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };
    executor.setGeometry(request.workspaceId, request.nodeId, geometry, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 0, y: 0, width: 200, height: 200 });
    expect(contents.debugger.sendCommand).toHaveBeenLastCalledWith('Emulation.setDeviceMetricsOverride', {
      width: 800, height: 600, deviceScaleFactor: 0, mobile: false, scale: 0.5, dontSetVisibleSize: true,
    });
    expect(contents.setZoomFactor).toHaveBeenCalledTimes(zoomCalls);
    const clip = [...parent.contentView.children][0];
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, clip: { ...geometry.clip, width: 0 } }, lease);
    expect(clip.visible).toBe(false);
  });

  it('does not resurrect a hidden surface when an asynchronous presentation finishes', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    let finish!: (value: {}) => void;
    contents.debugger.sendCommand.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const geometry = { bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };
    executor.setGeometry(request.workspaceId, request.nodeId, geometry, lease);
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, visible: false }, lease);
    finish({});
    await new Promise(resolve => setImmediate(resolve));
    expect([...parent.contentView.children][0].visible).toBe(false);
  });

  it('serializes full captures off the visible hierarchy and preserves changes made while capturing', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    const clip = [...parent.contentView.children][0], view = ContentsView.instances[0];
    const geometry = { bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };
    executor.setGeometry(request.workspaceId, request.nodeId, geometry, lease);
    await new Promise(resolve => setImmediate(resolve));
    const png = Buffer.alloc(24); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20);
    const data = { data: png.toString('base64') };
    let finish!: (result: typeof data) => void;
    let captures = 0;
    contents.debugger.sendCommand.mockImplementation(async method => {
      if (method !== 'Page.captureScreenshot') return {};
      expect(clip.visible).toBe(false);
      expect(clip.children.has(view)).toBe(false);
      if (++captures === 1) return new Promise(resolve => { finish = resolve; });
      return data;
    });
    const first = executor.userCommand(request, 'preview', {});
    const second = executor.userCommand(request, 'capture', {});
    await new Promise(resolve => setImmediate(resolve));
    expect(captures).toBe(1);
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, zoom: 0.75, visible: false }, lease);
    finish(data);
    await Promise.all([first, second]);
    expect(captures).toBe(2);
    expect(clip.visible).toBe(false);
    expect(clip.children.has(view)).toBe(true);
    executor.setGeometry(request.workspaceId, request.nodeId, { ...geometry, zoom: 0.75 }, lease);
    await new Promise(resolve => setImmediate(resolve));
    expect(clip.visible).toBe(true);
    expect(contents.debugger.sendCommand).toHaveBeenLastCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ scale: 0.75 }));
  });

  it('restores presentation after screenshot errors and waits for a correctly sized native frame', async () => {
    const { executor, parent, request, lease, contents } = await setup();
    const clip = [...parent.contentView.children][0], view = ContentsView.instances[0];
    const geometry = { bounds: { x: 100, y: 100, width: 400, height: 300 },
      clip: { x: 100, y: 100, width: 400, height: 300 }, viewport: { width: 800, height: 600 }, zoom: 0.5, visible: true };
    executor.setGeometry(request.workspaceId, request.nodeId, geometry, lease);
    await new Promise(resolve => setImmediate(resolve));
    contents.debugger.sendCommand.mockImplementation(async method => {
      if (method === 'Page.captureScreenshot') throw new Error('Screenshot failed');
      return {};
    });
    let painted!: (image: Awaited<ReturnType<Contents['capturePage']>>) => void;
    contents.capturePage.mockImplementationOnce(() => new Promise(resolve => { painted = resolve; }));
    const capture = executor.userCommand(request, 'preview', {});
    const result = expect(capture).rejects.toThrow('Screenshot failed');
    await new Promise(resolve => setImmediate(resolve));
    expect(clip.children.has(view)).toBe(true);
    expect(clip.visible).toBe(false);
    painted({ toDataURL: () => '', getSize: () => ({ width: 400, height: 300 }) });
    await result;
    expect(clip.visible).toBe(true);
  });

  it('changes document revision only when a document finishes loading, including same-URL reloads', async () => {
    const { executor, request, contents } = await setup();
    const before = (await executor.inspect(request)).documentRevision;
    contents.emit('page-title-updated', {}, 'Unread message');
    await executor.execute(request);
    expect((await executor.inspect(request)).documentRevision).toBe(before);
    contents.emit('did-finish-load');
    expect((await executor.inspect(request)).documentRevision).toBe(before + 1);
  });
  it('executes against the same contents presented in the Canvas, including after remount', async () => {
    const { executor, parent, request, lease, state, contents } = await setup();
    expect((await executor.execute(request)).ok).toBe(true);
    expect(contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce();
    const newLease = randomUUID();
    expect((await executor.surface(request, parent, newLease)).webContentsId).toBe(state.webContentsId);
    executor.detach(request.workspaceId, request.nodeId, lease);
    expect((await executor.inspect(request)).visible).toBe(true);
    expect(ContentsView.instances).toHaveLength(1);
    executor.detach(request.workspaceId, request.nodeId, newLease);
    expect((await executor.execute(request)).ok).toBe(false);
  });

  it('adopts the popup guest instead of creating another page or OS window', async () => {
    const { executor, request, contents } = await setup();
    const response = contents.handler({ url: 'https://example.com/login', disposition: 'new-window' });
    expect(response.action).toBe('allow');
    const guest = new Contents();
    guest.url = 'https://example.com/login';
    expect(response.createWindow({ webContents: guest, webPreferences: {} })).toBe(guest);
    await new Promise((resolve) => setImmediate(resolve));
    expect((await executor.inspect(request)).webContentsId).toBe(guest.id);
    expect(ContentsView.instances[1].options.webContents).toBe(guest);
    expect(ContentsView.instances[1].options.webPreferences).toMatchObject({
      sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true,
    });
    guest.close();
    expect((await executor.inspect(request)).webContentsId).toBe(contents.id);
  });

  it('navigates a link popup when Electron has not supplied a guest', async () => {
    const { executor, request, contents } = await setup();
    const response = contents.handler({ url: 'https://example.com/report', disposition: 'new-window' });
    const guest = response.createWindow({ webPreferences: {} });
    await new Promise((resolve) => setImmediate(resolve));
    expect(guest.url).toBe('https://example.com/report');
    expect((await executor.inspect(request)).tabs).toHaveLength(2);
  });

  it('routes new-tab links to Canvas and rejects privileged popup destinations', async () => {
    const { onOpenRequest, contents } = await setup();
    expect(contents.handler({ url: 'https://example.com/report', disposition: 'foreground-tab' })).toEqual({ action: 'deny' });
    expect(onOpenRequest).toHaveBeenCalledWith({ sourceWebContentsId: contents.id, url: 'https://example.com/report' });
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://unapproved.example/login']) {
      expect(contents.handler({ url, disposition: 'new-window' })).toEqual({ action: 'deny' });
    }
    expect(ContentsView.instances).toHaveLength(1);
  });
});
