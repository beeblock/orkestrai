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
  setWindowOpenHandler(handler: typeof this.handler) { this.handler = handler; }
  async loadURL(url: string) { this.url = url; this.emit('did-navigate', {}, url); }
  executeJavaScriptInIsolatedWorld = vi.fn(async () => []);
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
afterEach(() => {
  active.splice(0).forEach((executor) => executor.closeAll());
  ContentsView.instances = [];
});

async function setup() {
  const cookies = new EventEmitter();
  const onOpenRequest = vi.fn();
  const executor = createManagedPortalExecutor({
    WebContentsView: ContentsView, View,
    session: { fromPartition: () => ({ cookies, setPermissionRequestHandler: vi.fn() }) },
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
    clip: { x: 200, y: 160, width: 500, height: 350 }, zoom: 1, visible: true,
  }, lease);
  return { executor, parent, request, lease, state, onOpenRequest, contents: ContentsView.instances[0].webContents };
}

describe('embedded Portal surface lifecycle', () => {
  it('moves the clipping surface without blinking the active tab or repeatedly resetting its zoom', async () => {
    const { executor, request, lease, contents } = await setup();
    const view = ContentsView.instances[0];
    const visibility = vi.spyOn(view, 'setVisible');
    const initialZoomCalls = contents.setZoomFactor.mock.calls.length;
    for (let x = 0; x < 60; x++) executor.setGeometry(request.workspaceId, request.nodeId, {
      bounds: { x: 100 + x, y: 100, width: 800, height: 600 },
      clip: { x: 100 + x, y: 100, width: 800, height: 600 }, zoom: 1, visible: true,
    }, lease);
    expect(visibility).not.toHaveBeenCalled();
    expect(contents.setZoomFactor).toHaveBeenCalledTimes(initialZoomCalls);
    expect(view.visible).toBe(true);
    expect((await executor.inspect(request)).webContentsId).toBe(contents.id);
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
