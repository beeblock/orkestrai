const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { managedPortalPartition, isAllowedPortalUrl } = require('./portal-policy.cjs');

const MAX_RESULT_CHARS = 500_000;
const SNAPSHOT_SCRIPT = `(() => {
  const interactive = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY']);
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const candidates = [...document.querySelectorAll('a,button,input,select,textarea,summary,[role],[contenteditable="true"],[tabindex]')].filter(visible).slice(0, 5000);
  return candidates.map((el, index) => {
    const ref = 'e' + (index + 1); el.setAttribute('data-orkestrai-ref', ref);
    const rect = el.getBoundingClientRect();
    const role = el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',SELECT:'combobox',TEXTAREA:'textbox'}[el.tagName] || (interactive.has(el.tagName) ? el.tagName.toLowerCase() : 'generic'));
    const name = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value || '').trim().replace(/\\s+/g,' ').slice(0,500);
    return { ref, role, name, tag: el.tagName.toLowerCase(), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', value: String(el.value || '').slice(0,1000), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } };
  });
})()`;

function publicError(error) {
  return String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 2000) || 'Managed browser command failed.';
}

function bounded(value) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= MAX_RESULT_CHARS) return value;
  return { truncated: true, content: serialized.slice(0, MAX_RESULT_CHARS) };
}

function refSelector(ref) {
  if (!/^e\d{1,6}$/.test(String(ref))) throw new Error('Invalid semantic element reference.');
  return `[data-orkestrai-ref="${ref}"]`;
}

function createManagedPortalExecutor({ BrowserWindow, session, diagnostics }) {
  const sessions = new Map();

  function configureContents(contents, managed, tabId) {
    contents.setWindowOpenHandler(({ url }) => {
      if (isAllowedPortalUrl(url)) void createTab(managed, url, true);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedPortalUrl(url) || !hostAllowed(url, managed.profile.allowedHosts, contents.getURL())) event.preventDefault();
    });
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
    await Promise.race([
      tab.window.loadURL(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Portal navigation timed out.')), timeoutMs)),
    ]);
    tab.url = tab.window.webContents.getURL();
    tab.title = tab.window.webContents.getTitle();
  }

  async function createTab(managed, url, activate, persistedId) {
    const tabId = persistedId && !managed.tabs.has(persistedId) ? persistedId : crypto.randomUUID();
    const window = new BrowserWindow({
      show: false, width: 1440, height: 1000, backgroundColor: '#ffffff',
      webPreferences: {
        partition: managed.partition, nodeIntegration: false, nodeIntegrationInSubFrames: false,
        contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false,
      },
    });
    const tab = { id: tabId, managed, window, url: 'about:blank', title: '' };
    managed.tabs.set(tabId, tab);
    configureContents(window.webContents, managed, tabId);
    window.on('closed', () => managed.tabs.delete(tabId));
    if (activate || !managed.activeTabId) managed.activeTabId = tabId;
    if (url && url !== 'about:blank') await load(tab, url, 30_000);
    return tab;
  }

  async function getManaged(request) {
    const key = `${request.workspaceId}:${request.nodeId}:${request.profile.profileScope}:${request.profile.profileId}`;
    let managed = sessions.get(key);
    if (!managed) {
      const partition = managedPortalPartition(request.workspaceId, request.nodeId, request.profile.profileId, request.profile.profileScope);
      managed = { key, partition, profile: request.profile, tabs: new Map(), activeTabId: null };
      sessions.set(key, managed);
      const portalSession = session.fromPartition(partition);
      portalSession.cookies.on('changed', () => {
        void portalSession.flushStorageData();
        void Promise.resolve(portalSession.cookies.flushStore()).catch(() => undefined);
      });
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
            error: publicError(error),
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

  function activeTab(managed) {
    const tab = managed.tabs.get(managed.activeTabId);
    if (!tab || tab.window.isDestroyed()) throw new Error('The active Portal tab is unavailable.');
    return tab;
  }

  function state(managed) {
    const tab = managed.tabs.get(managed.activeTabId);
    return {
      url: tab?.window.webContents.getURL() || tab?.url || 'about:blank',
      title: tab?.window.webContents.getTitle() || tab?.title || '',
      activeTabId: managed.activeTabId,
      tabs: [...managed.tabs.values()].filter((item) => !item.window.isDestroyed()).map((item) => ({
        id: item.id, url: item.window.webContents.getURL() || item.url, title: item.window.webContents.getTitle() || item.title,
      })),
    };
  }

  async function ensureSnapshot(tab) {
    return tab.window.webContents.executeJavaScript(SNAPSHOT_SCRIPT, true);
  }

  async function withRef(tab, ref, expression) {
    await ensureSnapshot(tab);
    const selector = JSON.stringify(refSelector(ref));
    return tab.window.webContents.executeJavaScript(`(() => { const el = document.querySelector(${selector}); if (!el) throw new Error('Element reference is stale; take a new snapshot.'); ${expression} })()`, true);
  }

  async function waitFor(tab, args, timeoutMs) {
    if (args.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(args.delayMs, timeoutMs)));
      return { waitedMs: Math.min(args.delayMs, timeoutMs) };
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (args.urlIncludes && tab.window.webContents.getURL().includes(args.urlIncludes)) return { matched: 'url' };
      const matched = await tab.window.webContents.executeJavaScript(`(() => ({ ref: ${args.ref ? `!!document.querySelector(${JSON.stringify(refSelector(args.ref))})` : 'false'}, text: ${args.text ? `document.body?.innerText?.includes(${JSON.stringify(args.text)})` : 'false'} }))()`, true);
      if ((args.ref && matched.ref) || (args.text && matched.text)) return { matched: args.ref ? 'ref' : 'text' };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Portal wait condition timed out.');
  }

  async function execute(request) {
    try {
      const managed = await getManaged(request);
      let tab = activeTab(managed);
      let result;
      switch (request.action) {
        case 'navigate':
          await load(tab, String(request.args.url), request.timeoutMs);
          result = { navigated: tab.window.webContents.getURL() };
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
        case 'snapshot': result = { url: tab.window.webContents.getURL(), title: tab.window.webContents.getTitle(), elements: await ensureSnapshot(tab) }; break;
        case 'click': result = await withRef(tab, request.args.ref, `el.scrollIntoView({block:'center',inline:'center'}); el.click(); return { clicked: true };`); break;
        case 'type': {
          result = await withRef(tab, request.args.ref, `el.focus(); if (${request.args.clear !== false}) el.value = ''; const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set; if (setter) setter.call(el, ${JSON.stringify(String(request.args.text))}); else el.textContent = ${JSON.stringify(String(request.args.text))}; el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(String(request.args.text))}})); el.dispatchEvent(new Event('change',{bubbles:true})); return { typed: true };`);
          if (request.args.submit) tab.window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ENTER' }), tab.window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ENTER' });
          break;
        }
        case 'select': result = await withRef(tab, request.args.ref, `const values = ${JSON.stringify(request.args.values)}; for (const option of el.options || []) option.selected = values.includes(option.value); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return { selected: values };`); break;
        case 'upload': {
          await ensureSnapshot(tab);
          const selector = refSelector(request.args.ref);
          const dbg = tab.window.webContents.debugger;
          if (!dbg.isAttached()) dbg.attach('1.3');
          const { root } = await dbg.sendCommand('DOM.getDocument', { depth: -1, pierce: true });
          const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector });
          if (!nodeId) throw new Error('Upload element reference is stale.');
          await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: request.args.paths });
          result = { uploaded: request.args.paths.map((file) => path.basename(file)) };
          break;
        }
        case 'download': {
          const directory = String(request.args.downloadDirectory);
          fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
          result = await new Promise(async (resolve, reject) => {
            const portalSession = tab.window.webContents.session;
            const timer = setTimeout(() => { portalSession.removeListener('will-download', listener); reject(new Error('Download did not start.')); }, request.timeoutMs);
            const listener = (_event, item) => {
              clearTimeout(timer);
              const safeName = path.basename(String(request.args.filename || item.getFilename())).slice(0, 255);
              const savePath = path.join(directory, safeName);
              item.setSavePath(savePath);
              item.once('done', (_doneEvent, status) => status === 'completed' ? resolve({ path: savePath, status }) : reject(new Error(`Download ${status}.`)));
            };
            portalSession.once('will-download', listener);
            try { await withRef(tab, request.args.ref, `el.click(); return true;`); } catch (error) { clearTimeout(timer); portalSession.removeListener('will-download', listener); reject(error); }
          });
          break;
        }
        case 'wait': result = await waitFor(tab, request.args, request.timeoutMs); break;
        case 'screenshot': {
          const image = await tab.window.webContents.capturePage();
          const dataUrl = image.toDataURL();
          if (dataUrl.length > 28_000_000) throw new Error('Portal screenshot exceeds the 20 MB capture limit.');
          result = { dataUrl, width: image.getSize().width, height: image.getSize().height };
          break;
        }
        case 'extract': {
          await ensureSnapshot(tab);
          const selector = request.args.ref ? JSON.stringify(refSelector(request.args.ref)) : 'null';
          result = await tab.window.webContents.executeJavaScript(`(() => { const root = ${selector} ? document.querySelector(${selector}) : document; if (!root) throw new Error('Element reference is stale.'); const kind = ${JSON.stringify(request.args.kind)}; if (kind === 'links') return [...root.querySelectorAll('a[href]')].slice(0,2000).map(a => ({ text:(a.innerText||'').trim().slice(0,500), href:a.href })); if (kind === 'table') return [...root.querySelectorAll('tr')].slice(0,5000).map(row => [...row.querySelectorAll('th,td')].map(cell => (cell.innerText||'').trim().slice(0,2000))); if (kind === 'attribute') return root.getAttribute(${JSON.stringify(request.args.attribute || '')}); return (root.innerText || root.textContent || '').slice(0,500000); })()`, true);
          break;
        }
        case 'dom': result = String(await tab.window.webContents.executeJavaScript('document.documentElement.outerHTML', true)).slice(0, 500_000); break;
        default: throw new Error('Unsupported managed Portal action.');
      }
      return { ok: true, result: bounded(result), state: state(managed) };
    } catch (error) {
      diagnostics?.write?.('error', 'managed-portal', publicError(error), { action: request.action, nodeId: request.nodeId });
      return { ok: false, error: publicError(error) };
    }
  }

  function closeAll() {
    for (const managed of sessions.values()) for (const tab of managed.tabs.values()) if (!tab.window.isDestroyed()) tab.window.destroy();
    sessions.clear();
  }

  return { execute, closeAll };
}

module.exports = { createManagedPortalExecutor, SNAPSHOT_SCRIPT };
