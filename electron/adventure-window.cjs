'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * The Adventure strip: a transparent, frameless window that floats just above
 * the macOS Dock or the Windows taskbar, where the team's agents fight as a
 * pixel-art party. It never takes focus when it appears and lets every click
 * through to the apps below, except where the page says the pointer is over a
 * hero, the HUD or a card (`setInteractive`).
 *
 * The owner can drag it by its grip: across the full width it only moves up
 * and down (and to another display); compact, it goes anywhere. Where it was
 * left is remembered per display, and "Back to the Dock" forgets it.
 */
const STRIP_HEIGHT = 320;
const COMPACT_WIDTH = 760;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 480;
const PLACEMENT_FILE = 'adventure-strip.json';

/** The page's wish: full width or compact, and how tall the window must be for its size. */
function normalizeLayout(input) {
  const width = input && input.width === 'compact' ? 'compact' : 'full';
  const height = Number.isFinite(input && input.height) ? Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, input.height))) : STRIP_HEIGHT;
  return { width, height };
}

/**
 * Where the strip goes on a display. `saved` is where the owner left it: its
 * left edge from the work area's left and its bottom edge from the work
 * area's bottom (so it keeps hugging the Dock when the Dock resizes).
 */
function stripBounds(workArea, layout, saved) {
  const width = layout.width === 'compact' ? Math.min(COMPACT_WIDTH, workArea.width) : workArea.width;
  const height = Math.min(layout.height, workArea.height);
  const bottom = saved ? Math.max(0, Math.min(workArea.height - height, saved.bottom)) : 0;
  const centered = Math.round((workArea.width - width) / 2);
  const left = layout.width === 'compact' && saved && Number.isFinite(saved.left) ? Math.max(0, Math.min(workArea.width - width, saved.left)) : centered;
  return { x: workArea.x + (layout.width === 'compact' ? left : 0), y: workArea.y + workArea.height - height - bottom, width, height };
}

/** Where a drag may take the strip: kept on the display under its middle, full width pinned to the edges. */
function constrainMove(bounds, workArea, layout) {
  const width = layout.width === 'compact' ? Math.min(COMPACT_WIDTH, workArea.width) : workArea.width;
  const height = Math.min(layout.height, workArea.height);
  const x = layout.width === 'compact' ? Math.max(workArea.x, Math.min(workArea.x + workArea.width - width, bounds.x)) : workArea.x;
  const y = Math.max(workArea.y, Math.min(workArea.y + workArea.height - height, bounds.y));
  return { x, y, width, height };
}

/** What to remember of bounds on a display. */
function placementOf(bounds, display) {
  const { workArea } = display;
  return { displayId: display.id, left: bounds.x - workArea.x, bottom: workArea.y + workArea.height - (bounds.y + bounds.height) };
}

function createAdventureWindowController({ BrowserWindow, screen, preloadPath, urlFor, diagnostics, userDataPath }) {
  let window = null;
  let interactive = false;
  let layout = normalizeLayout(null);
  const file = userDataPath ? path.join(userDataPath, PLACEMENT_FILE) : null;
  let saved = readSaved();

  function readSaved() {
    if (!file) return null;
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      return value && Number.isFinite(value.bottom) ? { displayId: Number(value.displayId) || null, left: Number(value.left) || 0, bottom: value.bottom } : null;
    } catch {
      return null;
    }
  }

  function writeSaved() {
    if (!file) return;
    try {
      if (saved) fs.writeFileSync(file, `${JSON.stringify(saved)}\n`);
      else fs.rmSync(file, { force: true });
    } catch (error) {
      diagnostics?.write?.('warn', 'adventure', 'Adventure strip position was not saved.', error);
    }
  }

  function display() {
    const displays = screen.getAllDisplays();
    return (saved && displays.find((candidate) => candidate.id === saved.displayId)) || screen.getPrimaryDisplay();
  }

  function bounds() {
    return stripBounds(display().workArea, layout, saved);
  }

  function place() {
    if (window && !window.isDestroyed()) window.setBounds(bounds());
  }

  function notify() {
    if (window && !window.isDestroyed()) window.webContents.send('orkestrai:adventure-placement', { moved: Boolean(saved) });
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
      movable: true,
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
    // Dragged by its grip: keep it on a display, full width pinned to the edges.
    window.on('will-move', (event, next) => {
      const target = screen.getDisplayMatching(next);
      const allowed = constrainMove(next, target.workArea, layout);
      if (allowed.x !== next.x || allowed.y !== next.y || allowed.width !== next.width) {
        event.preventDefault();
        window?.setBounds(allowed);
      }
    });
    window.on('moved', () => {
      if (!window || window.isDestroyed()) return;
      let current = window.getBounds();
      // Linux has no will-move: hold the same rules once the drag ends.
      const target = screen.getDisplayMatching(current);
      const allowed = constrainMove(current, target.workArea, layout);
      if (allowed.x !== current.x || allowed.y !== current.y || allowed.width !== current.width) {
        window.setBounds(allowed);
        current = allowed;
      }
      saved = placementOf(current, target);
      writeSaved();
      notify();
    });
    window.once('ready-to-show', () => window?.showInactive());
    window.webContents.on('did-finish-load', notify);
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

  /** The page's size and width settings changed. */
  function setLayout(next, sender) {
    if (!window || window.isDestroyed() || sender !== window.webContents) return;
    const value = normalizeLayout(next);
    if (value.width === layout.width && value.height === layout.height) return;
    layout = value;
    place();
  }

  /** Back to the Dock: forget where the owner left it. */
  function resetPosition() {
    saved = null;
    writeSaved();
    place();
    notify();
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

  return {
    open,
    close,
    setInteractive,
    setLayout,
    resetPosition,
    reload,
    isOpen: () => Boolean(window && !window.isDestroyed()),
    isSender: (sender) => Boolean(window && !window.isDestroyed() && sender === window.webContents),
  };
}

module.exports = { createAdventureWindowController, normalizeLayout, stripBounds, constrainMove, placementOf, STRIP_HEIGHT, COMPACT_WIDTH };
