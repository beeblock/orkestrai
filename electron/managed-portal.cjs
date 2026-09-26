const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { managedPortalPartition, isAllowedPortalUrl, shouldOpenPortalInCanvas, publicPortalUrl } = require('./portal-policy.cjs');
const { portalPresentation } = require('./portal-presentation.cjs');

const MAX_RESULT_CHARS = 500_000;
const { INIT_SCRIPT, SNAPSHOT_SCRIPT } = require('./portal-dom.cjs');
const WORLD = 734;

function publicError(error) {
  return String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 2000) || 'Managed browser command failed.';
}

function bounded(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_RESULT_CHARS) return value;
  return { truncated: true, content: serialized.slice(0, MAX_RESULT_CHARS) };
}

function createManagedPortalExecutor({ WebContentsView, View, session, diagnostics, onState, onOpenRequest }) {
  const sessions = new Map();
  const queues = new Map();
  const opening = new Map();

  function dispose(managed) {
    managed.disposed = true;
    managed.visible = false;
    managed.clip.setVisible(false);
    if (managed.parent && !managed.parent.isDestroyed()) managed.parent.contentView.removeChildView(managed.clip);
    managed.parent = null;
    managed.cleanup?.();
    for (const tab of [...managed.tabs.values()]) if (!tab.window.isDestroyed()) tab.window.destroy();
    sessions.delete(managed.key);
  }

  function world(tab, expression) {
    return tab.window.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `${INIT_SCRIPT}; ${expression}` }], true);
  }

  function layout(managed) {
    if (managed.disposed) return;
    if (!managed.parent || !managed.geometry || !managed.visible) { managed.clip.setVisible(false); return; }
    // DOM transforms and native View geometry cannot be committed atomically.
    // The renderer presents its cached page during motion without changing the
    // session or revoking the agent's access to the visible Portal.
    if (managed.geometry.moving) { managed.clip.setVisible(false); return; }
    const { frame, metrics, previewOnly } = portalPresentation(managed.geometry);
    if (!frame.width || !frame.height) { managed.clip.setVisible(false); return; }
    managed.clip.setBounds(frame);
    const tab = managed.tabs.get(managed.activeTabId);
    if (!tab) return;
    if (!tab.documentReady || tab.capturing || tab.presentationPending) { managed.clip.setVisible(false); return; }
    const contentBounds = { x: 0, y: 0, width: frame.width, height: frame.height };
    const boundsKey = JSON.stringify(contentBounds);
    if (tab.boundsKey !== boundsKey) { tab.view.setBounds(contentBounds); tab.boundsKey = boundsKey; }
    const presentationKey = JSON.stringify(metrics);
    if (tab.presentationKey !== presentationKey) {
      managed.clip.setVisible(false);
      if (tab.presentationPending || tab.failedPresentationKey === presentationKey) return;
      tab.presentationPending = true;
      const epoch = tab.presentationEpoch;
      tab.presentationFlight = debuggerCommand(tab, 'Emulation.setDeviceMetricsOverride', metrics).then(async () => {
        if (epoch !== tab.presentationEpoch || !tab.documentReady) return;
        // Pump a correctly sized frame while the enclosing native View is hidden.
        // stayHidden would leave an initially hidden renderer without a frame.
        await capturePresentedPage(tab);
        if (epoch !== tab.presentationEpoch || !tab.documentReady) return;
        tab.presentationKey = presentationKey;
        tab.failedPresentationKey = undefined;
      }).catch(() => {
        if (epoch !== tab.presentationEpoch) return;
        tab.failedPresentationKey = presentationKey;
        diagnostics?.write?.('warn', 'managed-portal', 'Could not apply Portal presentation.', { nodeId: managed.nodeId });
      }).finally(() => {
        tab.presentationPending = false;
        if (!tab.window.isDestroyed()) layout(managed);
      });
      return;
    }
    if (previewOnly) { managed.clip.setVisible(false); return; }
    for (const candidate of managed.tabs.values()) {
      const visible = candidate === tab;
      if (candidate.presented !== visible) { candidate.view.setVisible(visible); candidate.presented = visible; }
    }
    managed.clip.setVisible(true);
  }

  async function debuggerCommand(tab, method, parameters) {
    const dbg = tab.window.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    return dbg.sendCommand(method, parameters);
  }

  async function capturePresentedPage(tab) {
    // did-finish-load can precede the first compositor surface. Retry only this
    // transient native error; never wait indefinitely or retry a closed page.
    for (let attempt = 0; ; attempt++) {
      if (tab.managed.disposed || tab.window.isDestroyed() || !tab.documentReady) throw new Error('Portal page is loading or unavailable.');
      try { return await tab.window.webContents.capturePage(); }
      catch (error) {
        if (attempt >= 19 || !String(error?.message).includes('Current display surface not available')) throw error;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  function capturePage(tab, rect, maxDimension, protect = false) {
    const next = (tab.captureFlight || Promise.resolve()).catch(() => {}).then(() => captureDetachedPage(tab, rect, maxDimension, protect));
    tab.captureFlight = next;
    return next.finally(() => { if (tab.captureFlight === next) tab.captureFlight = undefined; });
  }

  async function captureDetachedPage(tab, rect, maxDimension, protect) {
    const { managed, view } = tab;
    if (managed.disposed || tab.window.isDestroyed()) throw new Error('The Portal tab was closed.');
    if (!tab.documentReady) throw new Error('Portal page is loading or unavailable.');
    const epoch = tab.presentationEpoch;
    // CDP screenshots temporarily resize the native widget to the logical page.
    // Never let that widget participate in the window's visible view hierarchy.
    tab.capturing = true;
    let result;
    try {
      await tab.presentationFlight;
      if (managed.disposed || tab.window.isDestroyed()) throw new Error('The Portal tab was closed.');
      view.setVisible(false); tab.presented = false;
      managed.clip.removeChildView(view);
      if (managed.activeTabId === tab.id) managed.clip.setVisible(false);
      result = await captureLogicalPage(tab, rect, maxDimension, protect);
    } finally {
      if (!managed.disposed && !tab.window.isDestroyed()) {
        tab.boundsKey = undefined;
        tab.presentationKey = undefined;
        tab.failedPresentationKey = undefined;
        managed.clip.addChildView(view);
        tab.capturing = false;
        layout(managed);
        await tab.presentationFlight;
      }
    }
    // Navigation can replace the masked document, including during restoration.
    if (epoch !== tab.presentationEpoch) throw new Error('Portal page changed during capture. Retry on the current page.');
    return result;
  }

  async function captureLogicalPage(tab, rect, maxDimension, protect) {
    const scroll = await tab.window.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: '({ x: scrollX, y: scrollY, density: devicePixelRatio, width: innerWidth, height: innerHeight })' }]);
    const viewport = tab.managed.geometry?.viewport ?? { width: scroll.width, height: scroll.height };
    const area = rect ?? { x: 0, y: 0, ...viewport };
    const scale = maxDimension ? Math.min(1, maxDimension / (Math.max(area.width, area.height) * scroll.density)) : 1;
    // Capture the logical page, not just the slice visible beside Canvas controls.
    const capture = async () => {
      const paint = capturePresentedPage(tab).then(() => undefined, error => error);
      if (!tab.managed.geometry) {
        const error = await paint;
        if (error) throw error;
      }
      try {
        return await debuggerCommand(tab, 'Page.captureScreenshot', {
          format: 'png', captureBeyondViewport: true, clip: { ...area, x: area.x + scroll.x, y: area.y + scroll.y, scale },
        });
      } finally {
        const error = await paint;
        if (error) throw error;
      }
    };
    let result;
    if (protect) {
      await world(tab, 'globalThis.__orkestraiControlledPortal.mask(true)');
      try {
        // CDP captures a newly composited frame after the synchronous mask update.
        // A requestAnimationFrame promise can stall hidden isolated-world scripts.
        result = await capture();
      } finally { await world(tab, 'globalThis.__orkestraiControlledPortal.mask(false)').catch(() => {}); }
    } else result = await capture();
    const { data } = result;
    const png = Buffer.from(data, 'base64');
    return { dataUrl: `data:image/png;base64,${data}`, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  }

  function configureContents(contents, managed, tabId) {
    contents.setWindowOpenHandler(({ url, disposition, referrer, postBody }) => {
      if (url !== 'about:blank' && !hostAllowed(url, managed.profile.allowedHosts, contents.getURL())) return { action: 'deny' };
      if (onOpenRequest && managed.parent && managed.visible && shouldOpenPortalInCanvas(url, disposition)) {
        onOpenRequest({ sourceWebContentsId:contents.id,url }); return { action:'deny' };
      }
      if (managed.tabs.size >= 20) return { action: 'deny' };
      // Adopt Electron's guest: replacing it breaks window.opener and popup bootstrap.
      return { action:'allow', createWindow:(options) => {
        const tab = createNativeTab(managed, true, undefined, options.webPreferences, options.webContents);
        setImmediate(() => {
          if (tab.window.isDestroyed()) return;
          // Link-driven opens may not supply a pre-created guest or initiate navigation.
          if (!options.webContents && url !== 'about:blank') {
            void tab.window.webContents.loadURL(url, {
              httpReferrer: referrer,
              ...(postBody ? { postData: postBody.data, extraHeaders: `content-type: ${postBody.contentType}${postBody.boundary ? `; boundary=${postBody.boundary}` : ''}` } : {}),
            }).catch(() => undefined);
          }
          layout(managed); onState?.(managed.workspaceId, managed.nodeId, state(managed));
        });
        return tab.window.webContents;
      } };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedPortalUrl(url) || !hostAllowed(url, managed.profile.allowedHosts, contents.getURL())) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!hostAllowed(url, managed.profile.allowedHosts, contents.getURL())) event.preventDefault();
    });
    for (const event of ['did-navigate', 'did-navigate-in-page', 'did-finish-load', 'page-title-updated']) {
      contents.on(event, () => {
        if (event === 'did-finish-load') {
          const tab = managed.tabs.get(tabId);
          if (tab) tab.documentRevision++;
        }
        onState?.(managed.workspaceId, managed.nodeId, state(managed));
      });
    }
    contents.on('did-navigate', (_event, url) => {
      const tab = managed.tabs.get(tabId);
      if (tab) tab.url = url;
    });
    contents.on('page-title-updated', (_event, title) => {
      const tab = managed.tabs.get(tabId);
      if (tab) tab.title = String(title).slice(0, 300);
    });
  }

  function hostAllowed(candidate, allowedHosts, currentUrl) {
    try {
      const url = new URL(candidate);
      const current = currentUrl && isAllowedPortalUrl(currentUrl) ? new URL(currentUrl).hostname.toLowerCase() : '';
      const allowed = new Set([...(allowedHosts ?? []), current].filter(Boolean).map((host) => String(host).toLowerCase()));
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && (allowed.size === 0 || allowed.has(url.hostname.toLowerCase()));
    } catch { return false; }
  }

  async function load(tab, url, timeoutMs) {
    if (!hostAllowed(url, tab.managed.profile.allowedHosts, tab.window.webContents.getURL())) throw new Error('Navigation host is not allowed by this Portal.');
    let timer;
    try { await Promise.race([
      tab.window.loadURL(url),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Portal navigation timed out.')), timeoutMs); }),
    ]); } finally { clearTimeout(timer); }
    tab.url = tab.window.webContents.getURL();
    tab.title = tab.window.webContents.getTitle();
  }

  function createNativeTab(managed, activate, persistedId, preferences = {}, webContents) {
    const tabId = persistedId && !managed.tabs.has(persistedId) ? persistedId : crypto.randomUUID();
    if (managed.tabs.size >= 20) throw new Error('Portal tab limit reached.');
    const view = new WebContentsView({
      ...(webContents ? { webContents } : {}),
      webPreferences: {
        ...preferences,
        partition: managed.partition, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
        backgroundThrottling: false,
      },
    });
    const contents = view.webContents;
    // Page zoom is shared by origin within a session. Canvas zoom must never use it.
    contents.setZoomFactor(1);
    const window = { webContents: contents, loadURL: (url) => contents.loadURL(url),
      isDestroyed: () => contents.isDestroyed(), destroy: () => contents.close() };
    view.setBounds({ x: 0, y: 0, width: 1440, height: 1000 });
    view.setVisible(false); managed.clip.addChildView(view);
    const tab = { id: tabId, managed, window, view, url: 'about:blank', title: '', documentRevision: 0,
      documentReady: false, presentationEpoch: 0 };
    managed.tabs.set(tabId, tab);
    configureContents(window.webContents, managed, tabId);
    const invalidateDocument = () => {
      tab.documentReady = false;
      tab.presentationEpoch++;
      tab.presentationKey = undefined;
      tab.failedPresentationKey = undefined;
      layout(managed);
    };
    contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      if (isMainFrame && !isInPlace) invalidateDocument();
    });
    contents.on('render-process-gone', invalidateDocument);
    contents.on('dom-ready', () => {
      tab.documentReady = true;
      layout(managed);
    });
    contents.on('did-finish-load', () => {
      // Older builds persisted Canvas scale as per-origin browser zoom.
      if (contents.getZoomFactor() !== 1) contents.setZoomFactor(1);
      tab.documentReady = true;
      layout(managed);
    });
    contents.on('destroyed', () => {
      managed.tabs.delete(tabId);
      managed.clip.removeChildView(view);
      if (managed.activeTabId === tabId) managed.activeTabId = managed.tabs.keys().next().value;
      if (managed.parent) { layout(managed); onState?.(managed.workspaceId,managed.nodeId,state(managed)); }
    });
    if (activate || !managed.activeTabId) managed.activeTabId = tabId;
    return tab;
  }

  async function createTab(managed, url, activate, persistedId) {
    const tab = createNativeTab(managed, activate, persistedId);
    // A failed load still leaves an inspectable page that the user can retry.
    if (url && url !== 'about:blank') await load(tab, url, 30_000).catch(() => { tab.url = url; });
    return tab;
  }

  async function getManagedNow(request) {
    const key = `${request.workspaceId}:${request.nodeId}:${request.profile.profileScope}:${request.profile.profileId}`;
    let managed = sessions.get(key);
    if (!managed) {
      for (const old of sessions.values()) {
        if (old.workspaceId === request.workspaceId && old.nodeId === request.nodeId) dispose(old);
      }
      const partition = managedPortalPartition(request.workspaceId, request.nodeId, request.profile.profileId, request.profile.profileScope);
      managed = { key, partition, workspaceId: request.workspaceId, nodeId: request.nodeId,
        profile: request.profile, tabs: new Map(), activeTabId: null,
        clip: new View(), parent: null, geometry: null, visible: false };
      sessions.set(key, managed);
      const portalSession = session.fromPartition(partition);
      portalSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      const flushCookies = () => {
        void portalSession.flushStorageData();
        void Promise.resolve(portalSession.cookies.flushStore()).catch(() => undefined);
      };
      portalSession.cookies.on('changed', flushCookies);
      managed.cleanup = () => portalSession.cookies.removeListener('changed', flushCookies);
      const restorableTabs = Array.isArray(request.initialTabs)
        ? request.initialTabs
            .filter((tab) => tab && typeof tab.id === 'string' && isAllowedPortalUrl(tab.url))
            .slice(0, 20)
        : [];
      for (const persisted of restorableTabs) {
        if (!hostAllowed(persisted.url, managed.profile.allowedHosts, request.initialUrl)) continue;
        try {
          await createTab(managed, persisted.url, persisted.id === request.initialActiveTabId, persisted.id);
        } catch (error) {
          diagnostics?.write?.('warn', 'managed-portal', 'Could not restore a Portal tab.', {
            nodeId: request.nodeId,
            tabId: persisted.id,
            error: 'Portal tab could not be restored.',
          });
        }
      }
      if (managed.tabs.size === 0) await createTab(managed, request.initialUrl, true);
      if (!managed.tabs.has(managed.activeTabId)) managed.activeTabId = managed.tabs.keys().next().value;
    } else {
      managed.profile = request.profile;
    }
    return managed;
  }

  async function getManaged(request) {
    const key = `${request.workspaceId}:${request.nodeId}`;
    if (opening.has(key)) await opening.get(key);
    const promise = getManagedNow(request);
    opening.set(key, promise);
    try { return await promise; } finally { if (opening.get(key) === promise) opening.delete(key); }
  }

  function activeTab(managed) {
    const tab = managed.tabs.get(managed.activeTabId);
    if (!tab || tab.window.isDestroyed()) throw new Error('The active Portal tab is unavailable.');
    return tab;
  }

  function state(managed) {
    const tab = managed.tabs.get(managed.activeTabId);
    return {
      url: publicPortalUrl(tab?.window.webContents.getURL() || tab?.url || 'about:blank'),
      webContentsId: tab?.window.webContents.id,
      visible: !!managed.parent?.isVisible() && managed.visible,
      paused: managed.pauseLocked || managed.profile.paused,
      title: tab?.window.webContents.getTitle() || tab?.title || '',
      activeTabId: managed.activeTabId,
      documentRevision: tab?.documentRevision ?? 0,
      tabs: [...managed.tabs.values()].filter((item) => !item.window.isDestroyed()).map((item) => ({
        id: item.id, url: publicPortalUrl(item.window.webContents.getURL() || item.url), title: item.window.webContents.getTitle() || item.title,
      })),
    };
  }

  async function ensureSnapshot(tab) {
    return world(tab, 'globalThis.__orkestraiControlledPortal.snapshot()');
  }

  async function withRef(tab, ref, expression) {
    return world(tab, `(() => { const el = globalThis.__orkestraiControlledPortal.resolve(${JSON.stringify(ref)}); ${expression} })()`);
  }

  async function waitFor(tab, args, timeoutMs) {
    if (args.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(args.delayMs, timeoutMs)));
      return { waitedMs: Math.min(args.delayMs, timeoutMs) };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (args.urlIncludes && tab.window.webContents.getURL().includes(args.urlIncludes)) return { matched: 'url' };
      const matched = await world(tab, `(() => ({ ref: ${args.ref ? `!!globalThis.__orkestraiControlledPortal.resolve(${JSON.stringify(args.ref)})` : 'false'}, text: ${args.text ? `globalThis.__orkestraiControlledPortal.extract({kind:'text'}).includes(${JSON.stringify(args.text)})` : 'false'} }))()`).catch(() => ({}));
      if ((args.ref && matched.ref) || (args.text && matched.text)) return { matched: args.ref ? 'ref' : 'text' };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Portal wait condition timed out.');
  }

  async function execute(request) {
    try {
      const managed = await getManaged(request);
      if (managed.profile.paused || managed.pauseLocked) throw new Error('Portal control is paused by the user.');
      if (!managed.profile.allowBackground && (!managed.parent?.isVisible() || !managed.visible)) throw new Error('Open this Portal or explicitly enable background control.');
      let tab = activeTab(managed);
      let result;
      switch (request.action) {
        case 'navigate':
          await load(tab, String(request.args.url), request.timeoutMs);
          result = { navigated: publicPortalUrl(tab.window.webContents.getURL()) };
          break;
        case 'tabs': {
          const operation = request.args.operation;
          if (operation === 'new') tab = await createTab(managed, String(request.args.url), true);
          if (operation === 'activate') {
            if (!managed.tabs.has(request.args.tabId)) throw new Error('Portal tab not found.');
            managed.activeTabId = request.args.tabId;
          }
          if (operation === 'close') {
            if (managed.tabs.size <= 1) throw new Error('A Portal must keep at least one tab.');
            const closing = managed.tabs.get(request.args.tabId);
            if (!closing) throw new Error('Portal tab not found.');
            closing.window.destroy();
            if (managed.activeTabId === request.args.tabId) managed.activeTabId = managed.tabs.keys().next().value;
          }
          result = state(managed).tabs;
          break;
        }
        case 'snapshot': result = { url: publicPortalUrl(tab.window.webContents.getURL()), title: tab.window.webContents.getTitle(), elements: await ensureSnapshot(tab) }; break;
        case 'click': result = await world(tab, `globalThis.__orkestraiControlledPortal.act(${JSON.stringify(request.args.ref)}, 'click', {})`); break;
        case 'type': {
          result = await world(tab, `globalThis.__orkestraiControlledPortal.act(${JSON.stringify(request.args.ref)}, 'type', ${JSON.stringify(request.args)})`);
          if (request.args.submit) tab.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' }), tab.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
          break;
        }
        case 'select': result = await world(tab, `globalThis.__orkestraiControlledPortal.act(${JSON.stringify(request.args.ref)}, 'select', ${JSON.stringify(request.args)})`); break;
        case 'upload': {
          const marker = crypto.randomUUID();
          await withRef(tab, request.args.ref, `if (el.type !== 'file') throw new Error('Not a file input'); el.setAttribute('data-orkestrai-upload', ${JSON.stringify(marker)});`);
          const selector = `[data-orkestrai-upload="${marker}"]`;
          const dbg = tab.window.webContents.debugger;
          const owned = !dbg.isAttached();
          if (owned) dbg.attach('1.3');
          try {
          const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) throw new Error('Upload element reference is stale.');
          await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: request.args.paths });
          } finally {
            await world(tab, `document.querySelector(${JSON.stringify(selector)})?.removeAttribute('data-orkestrai-upload')`).catch(() => {});
            if (owned && dbg.isAttached()) dbg.detach();
          }
          result = { uploaded: request.args.paths.map((file) => path.basename(file)) };
          break;
        }
        case 'download': {
          const directory = String(request.args.downloadDirectory);
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          result = await new Promise((resolve, reject) => {
            const portalSession = tab.window.webContents.session;
            let activeItem;
            const timer = setTimeout(() => { portalSession.removeListener('will-download', listener); activeItem?.cancel(); reject(new Error('Portal download timed out.')); }, request.timeoutMs);
            const listener = (_event, item, source) => {
              if (source?.id !== tab.window.webContents.id) return;
              if (activeItem) { item.cancel(); return; }
              activeItem = item;
              const safeName = path.basename(String(request.args.filename || item.getFilename())).slice(0, 255);
              const savePath = path.join(directory, safeName);
              if (!safeName || ['.', '..'].includes(safeName) || fs.existsSync(savePath)) {
                item.cancel(); clearTimeout(timer); portalSession.removeListener('will-download', listener);
                reject(new Error('Portal download cannot overwrite an existing file.')); return;
              }
              item.setSavePath(savePath);
              item.once('done', (_doneEvent, status) => {
                clearTimeout(timer); portalSession.removeListener('will-download', listener);
                status === 'completed' ? resolve({ path: savePath, status }) : reject(new Error(`Download ${status}.`));
              });
            };
            portalSession.on('will-download', listener);
            void withRef(tab, request.args.ref, `el.click(); return true;`).catch((error) => { clearTimeout(timer); portalSession.removeListener('will-download', listener); activeItem?.cancel(); reject(error); });
          });
          break;
        }
        case 'wait': result = await waitFor(tab, request.args, request.timeoutMs); break;
        case 'screenshot': {
          result = await capturePage(tab, undefined, undefined, true);
          if (result.dataUrl.length > 28_000_000) throw new Error('Portal screenshot exceeds the 20 MB capture limit.');
          break;
        }
        case 'extract': {
          result = await world(tab, `globalThis.__orkestraiControlledPortal.extract(${JSON.stringify(request.args)})`);
          break;
        }
        case 'dom': result = await world(tab, 'globalThis.__orkestraiControlledPortal.safeDom()'); break;
        case 'eval': throw new Error('Arbitrary scripts are disabled for managed agent control. Use typed Portal tools.');
        default: throw new Error('Unsupported managed Portal action.');
      }
      layout(managed);
      onState?.(managed.workspaceId, managed.nodeId, state(managed));
      return { ok: true, result: request.action === 'screenshot' ? result : bounded(result), state: state(managed) };
    } catch (error) {
      return { ok: false, error: /^Portal |^Open this Portal|^Protected |^Navigation host|^Arbitrary /.test(error.message || '') ? publicError(error) : 'Portal action could not be confirmed.' };
    }
  }

  async function surface(request, parent, lease) {
    const managed = await getManaged(request);
    managed.lease = lease;
    if (managed.parent !== parent) {
      managed.parent?.contentView.removeChildView(managed.clip);
      managed.parent = parent; parent.contentView.addChildView(managed.clip);
      parent.once('closed', () => { if (managed.parent === parent) { managed.parent = null; managed.visible = false; } });
    }
    layout(managed); return state(managed);
  }

  function setGeometry(workspaceId, nodeId, geometry, lease) {
    for (const managed of sessions.values()) if (managed.workspaceId === workspaceId && managed.nodeId === nodeId && managed.lease === lease) {
      managed.geometry = geometry; managed.visible = geometry.visible; layout(managed);
    }
  }

  function detach(workspaceId, nodeId, lease) {
    for (const managed of sessions.values()) if (managed.workspaceId === workspaceId && managed.nodeId === nodeId && managed.lease === lease) {
      managed.visible = false; layout(managed);
      managed.parent?.contentView.removeChildView(managed.clip); managed.parent = null;
    }
  }

  async function inspect(request) {
    const managed = await getManaged(request); const tab = activeTab(managed);
    return { ...state(managed), element: request.args.ref ? await world(tab, `globalThis.__orkestraiControlledPortal.inspect(${JSON.stringify(request.args.ref)})`) : null };
  }

  async function userCommand(request, method, args) {
    const managed = await getManaged(request); const tab = activeTab(managed);
    if (method === 'navigate') { await load(tab, args.url, 30000); return state(managed); }
    if (method === 'inspectScript') return tab.window.webContents.executeJavaScript(String(args.code), true);
    if (method === 'capture') return (await capturePage(tab, args.rect)).dataUrl;
    if (method === 'preview') return (await capturePage(tab, undefined, 1600)).dataUrl;
    if (method === 'state') return state(managed);
    if (method === 'pause' || method === 'resume') { managed.pauseLocked = method === 'pause'; return state(managed); }
    if (method === 'activate') {
      if (!managed.tabs.has(args.tabId)) throw new Error('Portal tab not found.');
      managed.activeTabId = args.tabId; layout(managed); return state(managed);
    }
    if (method === 'close') {
      dispose(managed); return null;
    }
    throw new Error('Unsupported Portal surface operation.');
  }

  async function queuedExecute(request) {
    const key = `${request.workspaceId}:${request.nodeId}`;
    const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(() => execute(request));
    queues.set(key, next);
    try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
  }

  function closeAll() {
    for (const managed of [...sessions.values()]) dispose(managed);
  }

  return { execute: queuedExecute, inspect, surface, setGeometry, detach, userCommand, closeAll };
}

module.exports = { createManagedPortalExecutor, SNAPSHOT_SCRIPT };
