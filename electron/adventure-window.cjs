'use strict';

/**
 * The Adventure strip: a transparent, frameless window that floats just above
 * the macOS Dock or the Windows taskbar, where the team's agents fight as a
 * pixel-art party. It never takes focus when it appears and lets every click
 * through to the apps below, except where the page says the pointer is over a
 * hero, the HUD or a card (`setInteractive`).
 */
const STRIP_HEIGHT = 320;

function createAdventureWindowController({ BrowserWindow, screen, preloadPath, urlFor, diagnostics }) {
  let window = null;
  let interactive = false;

  function bounds() {
    const { workArea } = screen.getPrimaryDisplay();
    return { x: workArea.x, y: workArea.y + workArea.height - STRIP_HEIGHT, width: workArea.width, height: STRIP_HEIGHT };
  }

  function place() {
    if (window && !window.isDestroyed()) window.setBounds(bounds());
  }

  function open() {
    const url = urlFor('/adventure');
    if (!url) return false;
    if (window && !window.isDestroyed()) {
      if (!window.isVisible()) window.showInactive();
      return true;
    }
    window = new BrowserWindow({
      ...bounds(),
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#00000000',
      title: 'Orkestrai Adventure',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        preload: preloadPath,
      },
    });
    // Above ordinary windows, below menus and alerts; on every Space but not over full-screen apps.
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    interactive = false;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(urlFor('/') ?? '\u0000')) event.preventDefault();
    });
    window.once('ready-to-show', () => window?.showInactive());
    window.on('closed', () => { window = null; });
    void window.loadURL(url).catch((error) => diagnostics?.write?.('warn', 'adventure', 'Adventure strip failed to load.', error));
    return true;
  }

  function close() {
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
  }

  function setInteractive(next, sender) {
    if (!window || window.isDestroyed() || sender !== window.webContents) return;
    const value = Boolean(next);
    if (value === interactive) return;
    interactive = value;
    window.setIgnoreMouseEvents(!value, { forward: true });
  }

  /** The server moved to another port: follow it. */
  function reload() {
    if (!window || window.isDestroyed()) return;
    const url = urlFor('/adventure');
    if (url) void window.loadURL(url).catch(() => undefined);
  }

  screen.on('display-metrics-changed', place);
  screen.on('display-added', place);
  screen.on('display-removed', place);

  return { open, close, setInteractive, reload, isOpen: () => Boolean(window && !window.isDestroyed()), isSender: (sender) => Boolean(window && !window.isDestroyed() && sender === window.webContents) };
}

module.exports = { createAdventureWindowController, STRIP_HEIGHT };
