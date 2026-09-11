/**
 * Processo principal do Electron — Orkestrai.
 *
 * Sobe o servidor SvelteKit (adapter-node, em build/) como processo filho
 * usando o proprio Electron como runtime Node (ELECTRON_RUN_AS_NODE=1) e
 * abre a janela apontando para ele. Modulos nativos (better-sqlite3,
 * node-pty) precisam estar rebuildados para o ABI do Electron
 * (npm run electron:rebuild).
 */
const { app, BrowserWindow, WebContentsView, View, clipboard, dialog, ipcMain, Menu, Notification, Tray, nativeImage, powerMonitor, safeStorage, session, shell } = require('electron');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { canInstallUpdatesAutomatically, isNewerVersion } = require('./update-policy.cjs');
const { createDiagnosticsLogger } = require('./diagnostics.cjs');
const { isExpectedPortalDiagnostic, isExpectedServerDiagnostic } = require('./diagnostic-filter.cjs');
const { isBackgroundRuntimeInvocation } = require('./launch-intent.cjs');
const { createManagedPortalExecutor } = require('./managed-portal.cjs');
const { performGoogleDesktopOauth } = require('./google-oauth.cjs');
const {
  BACKGROUND_CORE_ARGUMENT,
  isBackgroundCoreLaunch,
  normalizeCorePreferences,
  shouldKeepCoreRunning,
} = require('./core-runtime-policy.cjs');
const { PORTAL_PARTITION, isAllowedPortalUrl, portalWindowOpenResponse } = require('./portal-policy.cjs');

const isDev = !app.isPackaged;
const appRoot = path.resolve(__dirname, '..');
// Processos filhos (ELECTRON_RUN_AS_NODE) não leem dentro do asar: o servidor
// roda a partir dos arquivos unpacked quando empacotado.
const runtimeRoot = app.isPackaged ? appRoot.replace('app.asar', 'app.asar.unpacked') : appRoot;

let serverProcess = null;
let mainWindow = null;
let splashWindow = null;
let serverPort = null;
let tray = null;
let pendingNotifications = 0;
let menuLocale = 'en';
let pendingCollaborationInvite = null;
let portalStorageFlushTimer = null;
let diagnostics = null;
let isQuitting = false;
let serverRestartTimer = null;
let corePreferences = normalizeCorePreferences();
let serverRestartCount = 0;
const configuredPortalContents = new WeakSet();
const expectedServerExits = new WeakSet();
const coreId = crypto.randomUUID();
const coreToken = crypto.randomBytes(32).toString('base64url');
let coreStartedAt = new Date().toISOString();
let managedPortalExecutor = null;

function initializeDiagnostics() {
  app.setAppLogsPath();
  diagnostics = createDiagnosticsLogger(app.getPath('logs'));
  diagnostics.write('info', 'app', `Starting Orkestrai ${app.getVersion()} on ${process.platform} ${process.arch}`);

  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      if (!isExpectedPortalDiagnostic(values)) diagnostics?.write(level, 'main', ...values);
      original(...values);
    };
  }
  process.on('uncaughtExceptionMonitor', (error, origin) => diagnostics?.write('error', 'main', origin, error));
}

function toggleDeveloperTools() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.toggleDevTools();
  return true;
}

async function openLogsDirectory() {
  const directory = diagnostics?.directory ?? app.getPath('logs');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return shell.openPath(directory);
}

function flushPortalStorage() {
  const portalSession = session.fromPartition(PORTAL_PARTITION);
  portalSession.flushStorageData();
  void Promise.resolve(portalSession.cookies.flushStore()).catch(() => undefined);
}

function schedulePortalStorageFlush() {
  if (portalStorageFlushTimer) clearTimeout(portalStorageFlushTimer);
  portalStorageFlushTimer = setTimeout(() => {
    portalStorageFlushTimer = null;
    flushPortalStorage();
  }, 500);
}

function configurePortalSession() {
  const portalSession = session.fromPartition(PORTAL_PARTITION);
  portalSession.cookies.on('changed', schedulePortalStorageFlush);
}

function configurePortalContents(contents) {
  if (configuredPortalContents.has(contents)) return;
  configuredPortalContents.add(contents);
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPortalUrl(url) && url !== 'about:blank') {
      mainWindow?.webContents.send('orkestrai:portal-open-request', {
        sourceWebContentsId: contents.id,
        url,
      });
      return { action: 'deny' };
    }
    return portalWindowOpenResponse(url);
  });
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedPortalUrl(url)) event.preventDefault();
  });
  contents.on('did-finish-load', schedulePortalStorageFlush);
}

function parseCollaborationInvite(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 1000) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'orkestrai:' || url.hostname !== 'join' || url.username || url.password || url.port || url.search) return null;
    if (!/^\/[a-zA-Z0-9_-]{8,128}$/.test(url.pathname) || !/^#[a-zA-Z0-9_-]{43}$/.test(url.hash)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function findCollaborationInvite(argv) {
  for (const argument of argv ?? []) {
    const invite = parseCollaborationInvite(argument);
    if (invite) return invite;
  }
  return null;
}

async function receiveCollaborationInvite(candidate) {
  const invite = parseCollaborationInvite(candidate);
  if (!invite) return false;
  pendingCollaborationInvite = invite;
  if (!app.isReady()) return true;
  if (!mainWindow) await createWindow();
  if (!mainWindow) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  const remoteUrl = `http://127.0.0.1:${serverPort}/remote`;
  if (!mainWindow.webContents.getURL().startsWith(remoteUrl)) {
    await mainWindow.loadURL(remoteUrl);
  }
  mainWindow.webContents.send('orkestrai:collaboration-invite');
  return true;
}

function registerCollaborationProtocol() {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('orkestrai', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('orkestrai');
  }
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  void receiveCollaborationInvite(url);
});

function secureSecretsPath() {
  return path.join(app.getPath('userData'), 'secure', 'automation-secrets.json');
}

function validAutomationSecretKey(key) {
  return typeof key === 'string' && /^automation:[a-z0-9:_-]{1,240}$/i.test(key);
}

function readSecureSecrets() {
  try {
    const parsed = JSON.parse(fs.readFileSync(secureSecretsPath(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSecureSecrets(secrets) {
  const destination = secureSecretsPath();
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, destination);
}

function readAutomationSecret(key) {
  if (!validAutomationSecretKey(key) || !safeStorage.isEncryptionAvailable()) return null;
  const encrypted = readSecureSecrets()[key];
  if (typeof encrypted !== 'string' || !encrypted) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch {
    return null;
  }
}

function saveAutomationSecret(key, value) {
  if (!validAutomationSecretKey(key)) throw new Error('Invalid automation secret key.');
  if (typeof value !== 'string' || !value.trim()) throw new Error('Credential cannot be empty.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this device.');
  const secrets = readSecureSecrets();
  secrets[key] = safeStorage.encryptString(value.trim()).toString('base64');
  writeSecureSecrets(secrets);
  return { stored: true };
}

function deleteAutomationSecret(key) {
  if (!validAutomationSecretKey(key)) throw new Error('Invalid automation secret key.');
  const secrets = readSecureSecrets();
  const existed = Object.hasOwn(secrets, key);
  delete secrets[key];
  writeSecureSecrets(secrets);
  return { deleted: existed };
}

const MENU_COPY = {
  'pt-BR': {
    workspace: 'Workspace', canvas: 'Canvas', terminals: 'Workbench', providers: 'Central de Providers', remote: 'Entrar em workspace remoto', newWorkspace: 'Novo workspace', presets: 'Biblioteca de presets', floors: 'Andares', roles: 'Responsabilidades', huddles: 'Huddles', usage: 'Uso', ports: 'Portas',
    settings: 'Configurações', checkUpdates: 'Verificar atualizações', edit: 'Editar', view: 'Visualizar', commandPalette: 'Paleta de comandos', reload: 'Recarregar', forceReload: 'Forçar recarga', developerTools: 'Ferramentas do desenvolvedor', fullscreen: 'Tela cheia', window: 'Janela', minimize: 'Minimizar', close: 'Fechar', help: 'Ajuda', docs: 'Documentação', changelog: 'Changelog', openLogs: 'Abrir pasta de logs', reportIssue: 'Reportar problema', open: 'Abrir Orkestrai', quit: 'Sair', pickDirectory: 'Escolher pasta do workspace', exportApiCollection: 'Escolher destino da coleção Bruno', portalWindow: 'Portal do Orkestrai', coreActive: 'Core 24/7 ativo', coreWindowBound: 'Core encerra com o app', notifications: (count) => `${count} notificações`,
  },
  en: {
    workspace: 'Workspace', canvas: 'Canvas', terminals: 'Workbench', providers: 'Provider Center', remote: 'Join remote workspace', newWorkspace: 'New workspace', presets: 'Preset library', floors: 'Floors', roles: 'Roles', huddles: 'Huddles', usage: 'Usage', ports: 'Ports',
    settings: 'Settings', checkUpdates: 'Check for updates', edit: 'Edit', view: 'View', commandPalette: 'Command palette', reload: 'Reload', forceReload: 'Force reload', developerTools: 'Developer tools', fullscreen: 'Full screen', window: 'Window', minimize: 'Minimize', close: 'Close', help: 'Help', docs: 'Documentation', changelog: 'Changelog', openLogs: 'Open logs folder', reportIssue: 'Report an issue', open: 'Open Orkestrai', quit: 'Quit', pickDirectory: 'Choose workspace folder', exportApiCollection: 'Choose Bruno collection destination', portalWindow: 'Orkestrai Portal', coreActive: '24/7 Core active', coreWindowBound: 'Core stops with the app', notifications: (count) => `${count} notifications`,
  },
  es: {
    workspace: 'Workspace', canvas: 'Canvas', terminals: 'Workbench', providers: 'Central de Providers', remote: 'Entrar a workspace remoto', newWorkspace: 'Nuevo workspace', presets: 'Biblioteca de presets', floors: 'Pisos', roles: 'Roles', huddles: 'Huddles', usage: 'Uso', ports: 'Puertos',
    settings: 'Configuración', checkUpdates: 'Buscar actualizaciones', edit: 'Editar', view: 'Ver', commandPalette: 'Paleta de comandos', reload: 'Recargar', forceReload: 'Forzar recarga', developerTools: 'Herramientas de desarrollo', fullscreen: 'Pantalla completa', window: 'Ventana', minimize: 'Minimizar', close: 'Cerrar', help: 'Ayuda', docs: 'Documentación', changelog: 'Changelog', openLogs: 'Abrir carpeta de logs', reportIssue: 'Reportar un problema', open: 'Abrir Orkestrai', quit: 'Salir', pickDirectory: 'Elegir carpeta del workspace', exportApiCollection: 'Elegir destino de la colección Bruno', portalWindow: 'Portal de Orkestrai', coreActive: 'Core 24/7 activo', coreWindowBound: 'El Core se detiene con la app', notifications: (count) => `${count} notificaciones`,
  },
};

function normalizeMenuLocale(value) {
  if (value === 'pt-BR' || value === 'es') return value;
  return 'en';
}

function sendMenuAction(action) {
  if (!mainWindow) {
    createWindow().then(() => mainWindow?.webContents.send('orkestrai:menu-action', action)).catch((error) => console.error(error));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('orkestrai:menu-action', action);
}

function buildApplicationMenu() {
  const copy = MENU_COPY[menuLocale];
  const workspaceMenu = {
    label: copy.workspace,
    submenu: [
      { label: copy.canvas, accelerator: 'CmdOrCtrl+1', click: () => sendMenuAction('canvas') },
      { label: copy.terminals, accelerator: 'CmdOrCtrl+Shift+1', click: () => sendMenuAction('terminals') },
      { label: copy.providers, accelerator: 'CmdOrCtrl+2', click: () => sendMenuAction('providers') },
      { label: copy.remote, click: () => sendMenuAction('remote') },
      { label: copy.newWorkspace, accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new-workspace') },
      { label: copy.presets, accelerator: 'CmdOrCtrl+Shift+P', click: () => sendMenuAction('presets') },
      { type: 'separator' },
      { label: copy.floors, accelerator: 'CmdOrCtrl+Alt+F', click: () => sendMenuAction('floors') },
      { label: copy.roles, accelerator: 'CmdOrCtrl+Alt+R', click: () => sendMenuAction('roles') },
      { label: copy.huddles, click: () => sendMenuAction('huddles') },
      { label: copy.usage, accelerator: 'CmdOrCtrl+Alt+U', click: () => sendMenuAction('usage') },
      { label: copy.ports, accelerator: 'CmdOrCtrl+Alt+O', click: () => sendMenuAction('ports') },
      ...(process.platform === 'darwin' ? [] : [
        { type: 'separator' },
        { label: copy.settings, accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('settings') },
        { label: copy.checkUpdates, click: () => void checkForUpdates() },
        { type: 'separator' },
        { label: copy.quit, role: 'quit' },
      ]),
    ],
  };
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: copy.settings, accelerator: 'CmdOrCtrl+,', click: () => sendMenuAction('settings') },
        { label: copy.checkUpdates, click: () => void checkForUpdates() },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { label: copy.quit, role: 'quit' },
      ],
    }] : []),
    workspaceMenu,
    { label: copy.edit, submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: copy.view,
      submenu: [
        { label: copy.commandPalette, accelerator: 'CmdOrCtrl+P', click: () => sendMenuAction('command-palette') },
        { type: 'separator' },
        { label: copy.reload, role: 'reload' },
        { label: copy.forceReload, role: 'forceReload' },
        { label: copy.developerTools, accelerator: process.platform === 'darwin' ? 'Alt+Command+I' : 'Control+Shift+I', click: toggleDeveloperTools },
        { type: 'separator' },
        { label: copy.fullscreen, role: 'togglefullscreen' },
      ],
    },
    { label: copy.window, submenu: [{ label: copy.minimize, role: 'minimize' }, { label: copy.close, role: 'close' }] },
    {
      label: copy.help,
      role: 'help',
      submenu: [
        { label: copy.docs, click: () => sendMenuAction('docs') },
        { label: copy.changelog, click: () => sendMenuAction('changelog') },
        { label: copy.openLogs, click: () => void openLogsDirectory() },
        { type: 'separator' },
        { label: copy.reportIssue, click: () => shell.openExternal('https://github.com/beeblock/orkestrai/issues/new') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Splash animada com o logo enquanto o servidor sobe. */
function createSplash() {
  if (splashWindow) return;
  splashWindow = new BrowserWindow({
    width: 420,
    height: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: true,
    backgroundColor: '#0D0B2E',
    webPreferences: { contextIsolation: true },
  });
  splashWindow.center();
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow?.show());
}

function closeSplash() {
  if (!splashWindow) return;
  splashWindow.close();
  splashWindow = null;
}

/**
 * Carrega variaveis do .env do projeto (o adapter-node não carrega .env
 * sozinho; em dev o vite faz isso). Não sobrescreve variaveis já definidas.
 */
function loadDotEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function privateChildEnvKeys(dotEnv) {
  return [...new Set([
    ...(process.env.ORKESTRAI_PRIVATE_ENV_KEYS ?? '').split(',').filter(Boolean),
    ...Object.keys(dotEnv),
    'APP_KEY',
    'INTERNAL_SECRET',
    'ELECTRON_RUN_AS_NODE',
    'HOST',
    'PORT',
    'ORIGIN',
    'BODY_SIZE_LIMIT',
    'DB_PATH',
    'ORKESTRAI_DATA_DIR',
    'ORKESTRAI_PTY_MODULE',
    'ORKESTRAI_CORE_ID',
    'ORKESTRAI_CORE_TOKEN',
    'ORKESTRAI_CORE_STARTED_AT',
    'ORKESTRAI_CORE_VERSION',
  ])].join(',');
}

/** Em producao, garante um APP_KEY persistente na pasta do usuário. */
function ensureAppKey() {
  if (process.env.APP_KEY) return process.env.APP_KEY;
  const keyFile = path.join(app.getPath('userData'), '.app-key');
  if (fs.existsSync(keyFile)) return fs.readFileSync(keyFile, 'utf8').trim();
  const generated = `base64:${crypto.randomBytes(32).toString('base64')}`;
  fs.writeFileSync(keyFile, generated, { mode: 0o600 });
  return generated;
}

function findFreePort(start = 4173, attempts = 20) {
  return new Promise((resolvePort, reject) => {
    let candidate = start;
    const tryPort = () => {
      if (candidate >= start + attempts) {
        reject(new Error('Nenhuma porta livre encontrada para o servidor interno.'));
        return;
      }
      const tester = net
        .createServer()
        .once('error', () => {
          candidate += 1;
          tryPort();
        })
        .once('listening', () => {
          tester.close(() => resolvePort(candidate));
        })
        .listen(candidate, '127.0.0.1');
    };
    tryPort();
  });
}

async function waitForServer(url, timeoutMs = 30_000, headers = undefined) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Servidor interno não respondeu em ${url}`);
}

function coreHealthUrl(port = serverPort) {
  return port === null ? null : `http://127.0.0.1:${port}/api/agent-room/core/health`;
}

async function readCoreHealth() {
  const url = coreHealthUrl();
  if (!url) return null;
  try {
    const response = await fetch(url, {
      headers: { 'x-orkestrai-core-token': coreToken },
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.data ?? null;
  } catch {
    return null;
  }
}

function applyCorePreferences(input) {
  corePreferences = normalizeCorePreferences(input);
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: corePreferences.launchAtLogin,
      openAsHidden: corePreferences.launchAtLogin,
      args: corePreferences.launchAtLogin ? [BACKGROUND_CORE_ARGUMENT] : [],
    });
  }
  rebuildTrayMenu();
  return corePreferences;
}

async function refreshCorePreferences() {
  if (serverPort === null) return corePreferences;
  try {
    const response = await fetch(`http://127.0.0.1:${serverPort}/api/agent-room/settings`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return corePreferences;
    const settings = (await response.json())?.data ?? {};
    return applyCorePreferences({
      runInBackground: settings.coreRunInBackground,
      launchAtLogin: settings.coreLaunchAtLogin,
    });
  } catch {
    return corePreferences;
  }
}

/** Extrai o node-pty para o userData (macOS 15+ mata o spawn-helper dentro do bundle). */
function ensureNativePty(userDataDir) {
  if (!app.isPackaged) return null;
  const src = path.join(runtimeRoot, 'node_modules', 'node-pty');
  const dest = path.join(userDataDir, 'native', 'node-pty');
  try {
    const srcVersion = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8')).version;
    const destPkg = path.join(dest, 'package.json');
    const destVersion = fs.existsSync(destPkg) ? JSON.parse(fs.readFileSync(destPkg, 'utf8')).version : null;
    const platformDir = `${process.platform}-${process.arch}`;
    const srcPty = path.join(src, 'prebuilds', platformDir, 'pty.node');
    const destPty = path.join(dest, 'prebuilds', platformDir, 'pty.node');
    const srcHelper = path.join(src, 'prebuilds', platformDir, 'spawn-helper');
    const destHelper = path.join(dest, 'prebuilds', platformDir, 'spawn-helper');
    const cacheIncomplete = !fs.existsSync(destPty)
      || (process.platform === 'darwin' && fs.existsSync(srcHelper) && !fs.existsSync(destHelper));
    if (srcVersion !== destVersion || cacheIncomplete) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    }
    if (process.platform === 'darwin' && fs.existsSync(destHelper)) {
      fs.chmodSync(destHelper, 0o755);
    }
    return dest;
  } catch (error) {
    console.warn('[orkestrai] falha ao extrair node-pty para userData:', error?.message ?? error);
    return null;
  }
}

async function startServer(port) {
  const serverEntry = path.join(runtimeRoot, 'scripts', 'orkestrai-server.mjs');
  const dotEnv = app.isPackaged ? {} : loadDotEnv(path.join(appRoot, '.env'));
  const ptyModuleDir = ensureNativePty(app.getPath('userData'));
  const bundledCliRuntime = process.platform === 'win32'
    ? path.join(process.resourcesPath, 'orkestrai-cli-runtime', 'node.exe')
    : null;
  const privateEnvKeys = privateChildEnvKeys(dotEnv);
  coreStartedAt = new Date().toISOString();
  serverProcess = spawn(process.execPath, [serverEntry], {
    cwd: runtimeRoot,
    env: {
      ...dotEnv,
      ...process.env,
      APP_KEY: process.env.APP_KEY ?? dotEnv.APP_KEY ?? ensureAppKey(),
      ELECTRON_RUN_AS_NODE: '1',
      HOST: '127.0.0.1',
      PORT: String(port),
      // A porta e livre (muda a cada execução): configs da ponte gravados em
      // workspaces precisam da URL atual (ver também ~/.orkestrai/runtime.json).
      ORKESTRAI_API_URL: `http://127.0.0.1:${port}`,
      ORKESTRAI_CORE_ID: coreId,
      ORKESTRAI_CORE_TOKEN: coreToken,
      ORKESTRAI_CORE_STARTED_AT: coreStartedAt,
      ORKESTRAI_CORE_VERSION: app.getVersion(),
      ORKESTRAI_PRIVATE_ENV_KEYS: privateEnvKeys,
      ...(bundledCliRuntime && fs.existsSync(bundledCliRuntime)
        ? { ORKESTRAI_CLI_CONSOLE_RUNTIME: bundledCliRuntime }
        : {}),
      ...(ptyModuleDir ? { ORKESTRAI_PTY_MODULE: ptyModuleDir } : {}),
      // Em Electron, o banco e os dados ficam na pasta do usuário em producao;
      // em dev, usa a pasta do projeto como sempre.
      ...(app.isPackaged ? { ORKESTRAI_DATA_DIR: app.getPath('userData') } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });

  const requestingServer = serverProcess;
  serverProcess.on('message', (message) => {
    if (!message?.requestId) return;
    if (message.type === 'orkestrai:portal:execute' || message.type === 'orkestrai:portal:inspect') {
      const operation = message.type === 'orkestrai:portal:inspect'
        ? managedPortalExecutor.inspect(message).then((result) => ({ ok: true, result }))
        : managedPortalExecutor.execute(message);
      void operation.then((result) => {
        requestingServer?.send?.({ type: 'orkestrai:portal:result', requestId: message.requestId, result });
      }).catch((error) => {
        requestingServer?.send?.({
          type: 'orkestrai:portal:result', requestId: message.requestId,
          result: { ok: false, error: 'Portal page or element is unavailable. Take another snapshot.' },
        });
      });
      return;
    }
    if (!['orkestrai:secret:get', 'orkestrai:secret:set', 'orkestrai:secret:delete'].includes(message.type)) return;
    try {
      if (message.type === 'orkestrai:secret:set') saveAutomationSecret(message.key, message.value);
      if (message.type === 'orkestrai:secret:delete') deleteAutomationSecret(message.key);
      requestingServer?.send?.({
        type: 'orkestrai:secret:result',
        requestId: message.requestId,
        value: message.type === 'orkestrai:secret:get' ? readAutomationSecret(message.key) : null,
      });
    } catch (error) {
      requestingServer?.send?.({
        type: 'orkestrai:secret:result',
        requestId: message.requestId,
        error: error?.message ?? String(error),
      });
    }
  });

  serverProcess.stdout.on('data', (chunk) => {
    const text = String(chunk);
    process.stdout.write(`[server] ${text}`);
    for (const line of text.split(/\r?\n/)) {
      const structuredMatch = line.match(/\[orkestrai:notify\] (\{.+\})/);
      if (structuredMatch) {
        try {
          const payload = JSON.parse(structuredMatch[1]);
          showNativeNotification(String(payload.title || 'Orkestrai'), String(payload.body || ''));
          continue;
        } catch {
          // cai no formato legado abaixo
        }
      }
      const notifyMatch = line.match(/\[orkestrai:notify\] \[(.+?)\] (.+)/);
      if (notifyMatch) {
        showNativeNotification(`Orkestrai — ${notifyMatch[1]}`, notifyMatch[2]);
      }
    }
  });
  serverProcess.stderr.on('data', (chunk) => {
    if (!isExpectedServerDiagnostic([chunk])) diagnostics?.write('error', 'server', String(chunk));
    process.stderr.write(`[server] ${chunk}`);
  });
  const startedServerProcess = serverProcess;
  serverProcess.on('exit', (code, signal) => {
    const expected = expectedServerExits.has(startedServerProcess);
    if (!expected) {
      diagnostics?.write('error', 'server', `Internal server exited unexpectedly with code ${code} and signal ${signal ?? 'none'}`);
    }
    console.log(`[server] finalizado com código ${code}`);
    if (serverProcess === startedServerProcess) serverProcess = null;
    if (!expected && !isQuitting && (mainWindow || corePreferences.runInBackground)) {
      scheduleServerRecovery();
    }
  });

  await waitForServer(
    `http://127.0.0.1:${port}/api/agent-room/core/health`,
    30_000,
    { 'x-orkestrai-core-token': coreToken },
  );
  return port;
}

function scheduleServerRecovery(delayMs = 1_000) {
  if (serverRestartTimer || isQuitting) return;
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    void recoverServer();
  }, delayMs);
}

async function recoverServer() {
  if (serverProcess || isQuitting) return;
  try {
    const previousPort = serverPort;
    let port = previousPort;
    if (port === null) port = await findFreePort();
    try {
      await startServer(port);
    } catch {
      port = await findFreePort();
      serverPort = port;
      await startServer(port);
    }
    serverPort = port;
    serverRestartCount += 1;
    await refreshCorePreferences();
    if (mainWindow && !mainWindow.isDestroyed() && previousPort !== port) {
      const current = new URL(mainWindow.webContents.getURL());
      await mainWindow.loadURL(`http://127.0.0.1:${port}${current.pathname}${current.search}${current.hash}`);
    }
  } catch (error) {
    diagnostics?.write('error', 'core', 'Core recovery failed', error);
    scheduleServerRecovery(Math.min(30_000, 1_000 * 2 ** Math.min(serverRestartCount, 5)));
  }
}

async function ensureServer() {
  if (serverProcess && serverPort !== null && await readCoreHealth()) return serverPort;
  if (serverProcess) await stopServer();
  serverPort = await findFreePort();
  await startServer(serverPort);
  return serverPort;
}

function stopServer() {
  if (serverRestartTimer) {
    clearTimeout(serverRestartTimer);
    serverRestartTimer = null;
  }
  if (!serverProcess) return Promise.resolve();
  const runningServerProcess = serverProcess;
  expectedServerExits.add(runningServerProcess);
  return new Promise((resolveStop) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (serverProcess === runningServerProcess) serverProcess = null;
      resolveStop();
    };
    runningServerProcess.once('exit', finish);
    try {
      runningServerProcess.kill('SIGTERM');
    } catch {
      finish();
    }
    setTimeout(finish, 5_000).unref();
  });
}

async function restartCore() {
  await stopServer();
  await ensureServer();
  await refreshCorePreferences();
  return coreDesktopStatus();
}

async function coreDesktopStatus() {
  const health = await readCoreHealth();
  return {
    running: Boolean(health),
    coreId: health?.coreId ?? coreId,
    pid: health?.pid ?? null,
    startedAt: health?.startedAt ?? coreStartedAt,
    uptimeSeconds: health?.uptimeSeconds ?? 0,
    version: health?.version ?? app.getVersion(),
    restartCount: serverRestartCount,
    runInBackground: corePreferences.runInBackground,
    launchAtLogin: corePreferences.launchAtLogin,
    launchAtLoginSupported: app.isPackaged,
  };
}

async function createWindow() {
  // Reaproveita o servidor se já estiver vivo (janela reaberta após fechar
  // no macOS mantem o app rodando sem janela).
  await ensureServer();
  const port = serverPort;

  if (process.platform === 'darwin') app.dock.show();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Orkestrai',
    icon: path.join(appRoot, 'electron', 'resources', 'icon.png'),
    backgroundColor: '#0D0B2E',
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#c7c8d0', height: 36 },
      autoHideMenuBar: true,
    } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  if (process.platform === 'win32') mainWindow.setMenuBarVisibility(false);

  mainWindow.on('close', (event) => {
    if (!shouldKeepCoreRunning({ isQuitting, runInBackground: corePreferences.runInBackground })) return;
    event.preventDefault();
    mainWindow?.hide();
    if (process.platform === 'darwin') app.dock.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    let protocol = '';
    try {
      protocol = new URL(params.src || 'about:blank').protocol;
    } catch {
      event.preventDefault();
      return;
    }
    if (!['http:', 'https:', 'about:'].includes(protocol)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });

  mainWindow.webContents.on('did-attach-webview', (_event, guestContents) => {
    configurePortalContents(guestContents);
  });

  mainWindow.webContents.on('console-message', (details) => {
    const level = details.level;
    if (level !== 'warning' && level !== 'error') return;
    const message = details.message ?? '';
    if (isExpectedPortalDiagnostic([message])) return;
    const line = details.lineNumber ?? 0;
    const source = details.sourceId ?? 'renderer';
    diagnostics?.write(level === 'warning' ? 'warn' : 'error', 'renderer', `${source}:${line}`, message);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode === -3) return;
    diagnostics?.write('error', 'renderer', 'Load failed', { errorCode, errorDescription, validatedURL, isMainFrame });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    diagnostics?.write('error', 'renderer', 'Renderer process exited', details);
  });
  mainWindow.on('unresponsive', () => diagnostics?.write('error', 'renderer', 'Main window became unresponsive'));

  mainWindow.once('ready-to-show', () => {
    closeSplash();
    mainWindow?.show();
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

ipcMain.handle('orkestrai:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: MENU_COPY[menuLocale].pickDirectory,
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('orkestrai:pick-api-collection', async (_event, kind) => {
  if (!mainWindow) return null;
  const isPostman = kind === 'postman';
  const isNative = kind === 'native';
  const isOpenApi = kind === 'openapi';
  const isPostmanEnvironment = kind === 'postmanEnvironment';
  const isOpenCollection = kind === 'openCollection';
  const isProto = kind === 'proto';
  const isCertificate = kind === 'certificate';
  const isPrivateKey = kind === 'privateKey';
  const isPfx = kind === 'pfx';
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: isCertificate
      ? [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }]
      : isPfx
        ? [{ name: 'PKCS#12', extensions: ['p12', 'pfx'] }]
      : isPrivateKey
        ? [{ name: 'Private key', extensions: ['pem', 'key'] }]
      : isProto
      ? [{ name: 'Protocol Buffer', extensions: ['proto'] }]
      : isPostman
      ? [{ name: 'Postman Collection', extensions: ['json'] }]
      : isPostmanEnvironment
        ? [{ name: 'Postman Environment', extensions: ['json'] }]
      : isOpenApi
        ? [{ name: 'OpenAPI / Swagger', extensions: ['json', 'yml', 'yaml'] }]
      : isOpenCollection
        ? [{ name: 'OpenCollection YAML', extensions: ['yml', 'yaml'] }]
      : isNative
        ? [{ name: 'Orkestrai API Collection', extensions: ['json'] }]
        : [{ name: 'Bruno / OpenCollection', extensions: ['bru', 'yml', 'yaml'] }],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('orkestrai:pick-api-export-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: MENU_COPY[menuLocale].exportApiCollection,
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

function spawnApiApp(command, args, waitForExit = false) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: !waitForExit, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    if (waitForExit) child.once('exit', (code) => resolve(code === 0));
    else child.once('spawn', () => { child.unref(); resolve(true); });
  });
}

ipcMain.handle('orkestrai:open-api-collection', async (_event, kind, sourcePath) => {
  if (!['bruno', 'postman'].includes(kind) || typeof sourcePath !== 'string' || !sourcePath || !fs.existsSync(sourcePath)) return false;
  const appName = kind === 'bruno' ? 'Bruno' : 'Postman';
  if (process.platform === 'darwin') return spawnApiApp('/usr/bin/open', ['-a', appName, sourcePath], true);
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? '';
    const candidates = kind === 'bruno'
      ? [path.join(local, 'Programs', 'Bruno', 'Bruno.exe'), path.join(local, 'Programs', 'bruno', 'Bruno.exe')]
      : [path.join(local, 'Postman', 'Postman.exe')];
    const executable = candidates.find((candidate) => fs.existsSync(candidate));
    return executable ? spawnApiApp(executable, [sourcePath]) : false;
  }
  for (const executable of (kind === 'bruno' ? ['bruno'] : ['postman', 'Postman'])) {
    if (await spawnApiApp(executable, [sourcePath])) return true;
  }
  return false;
});

// -- Auto-update (electron-updater, releases publicos no GitHub) --------------
// O download cai num cache separado e só e ativado na troca (quitAndInstall):
// a versão atual NUNCA e tocada antes da nova estar 100% baixada e verificada
// (sha512 do latest-mac.yml). Dados do usuário ficam fora do bundle.

let autoUpdater = null;
if (app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch (error) {
    autoUpdater = null;
    console.error('[orkestrai] updater indisponivel no pacote:', error?.message ?? error);
  }
}

let latestUpdateState = { status: 'idle' };
let updateCheckPromise = null;
let automaticUpdateInstallSupported = process.platform !== 'darwin';
const MAC_LATEST_RELEASE_API = 'https://api.github.com/repos/beeblock/orkestrai/releases/latest';

function sendUpdate(payload) {
  latestUpdateState = payload;
  mainWindow?.webContents.send('orkestrai:update', payload);
}

function updateErrorPayload(error) {
  const message = String(error?.message ?? error).slice(0, 300);
  const updateInProgress = latestUpdateState.status === 'available' || latestUpdateState.status === 'downloading';
  return { status: updateInProgress ? 'error' : 'check-error', message };
}

async function checkManualMacUpdate() {
  const response = await fetch(MAC_LATEST_RELEASE_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Orkestrai updater' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub releases respondeu HTTP ${response.status}.`);
  const release = await response.json();
  const version = String(release?.tag_name ?? '').replace(/^v/, '');
  return isNewerVersion(version, app.getVersion()) ? { status: 'manual', version } : { status: 'none' };
}

async function checkForUpdates() {
  if (!autoUpdater) {
    return app.isPackaged
      ? { status: 'check-error', message: 'O módulo de atualização não está disponível neste pacote.' }
      : { status: 'unsupported' };
  }
  if (updateCheckPromise) return updateCheckPromise;

  updateCheckPromise = (async () => {
    try {
      if (process.platform === 'darwin' && !automaticUpdateInstallSupported) {
        sendUpdate({ status: 'checking' });
        const payload = await checkManualMacUpdate();
        sendUpdate(payload);
        return payload;
      }
      const result = await autoUpdater.checkForUpdates();
      if (result?.isUpdateAvailable) {
        return {
          status: automaticUpdateInstallSupported ? 'available' : 'manual',
          version: result.updateInfo.version,
        };
      }
      return { status: 'none' };
    } catch (error) {
      const payload = updateErrorPayload(error);
      if (latestUpdateState.status !== payload.status) sendUpdate(payload);
      return payload;
    } finally {
      updateCheckPromise = null;
    }
  })();

  return updateCheckPromise;
}

function setupAutoUpdater() {
  if (!autoUpdater) return;
  automaticUpdateInstallSupported = canInstallUpdatesAutomatically();
  autoUpdater.autoDownload = automaticUpdateInstallSupported;
  autoUpdater.autoInstallOnAppQuit = automaticUpdateInstallSupported;
  // Repeated Windows delta checksum failures already fall back to a complete
  // artifact. Skip the unreliable delta path and keep SHA-512 verification.
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  if (!automaticUpdateInstallSupported) {
    void checkForUpdates();
    setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref();
    return;
  }
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', (info) =>
    sendUpdate({ status: automaticUpdateInstallSupported ? 'available' : 'manual', version: info.version })
  );
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'none' }));
  autoUpdater.on('download-progress', (progress) => sendUpdate({ status: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ status: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => sendUpdate(updateErrorPayload(error)));
  void checkForUpdates();
  // Re-checa a cada 6h com o app aberto.
  setInterval(() => void checkForUpdates(), 6 * 60 * 60 * 1000).unref();
}

ipcMain.handle('orkestrai:update-check', async () => {
  return checkForUpdates();
});

ipcMain.handle('orkestrai:update-state', () => latestUpdateState);

ipcMain.handle('orkestrai:update-install', () => {
  // Install silently and relaunch after the verified update replaces this build.
  if (automaticUpdateInstallSupported) autoUpdater?.quitAndInstall(true, true);
});

ipcMain.handle('orkestrai:app-version', () => app.getVersion());

async function portalSurfaceRequest(event, input) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error('Portal surface requires the trusted app window.');
  for (const id of [input?.workspaceId, input?.nodeId]) if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid Portal identity.');
  const root = `http://127.0.0.1:${serverPort}/api/agent-room/workspaces/${input.workspaceId}`;
  const get = async (url) => { const response = await fetch(url); if (!response.ok) throw new Error('Portal workspace is unavailable.'); return (await response.json()).data; };
  const workspace = await get(root);
  const nodes = await get(root + '/nodes');
  const node = nodes.find((candidate) => candidate.id === input.nodeId && candidate.type === 'portal');
  if (!node) throw new Error('Portal does not belong to this workspace.');
  const payload = node.payload || {};
  return { workspaceId: input.workspaceId, nodeId: input.nodeId, workspaceRoot: workspace.workingDir,
    requestId: crypto.randomUUID(), timeoutMs: 30000, action: 'snapshot', args: {},
    initialUrl: payload.url || 'about:blank', initialTabs: payload.portalTabs, initialActiveTabId: payload.portalActiveTabId,
    profile: { profileId: payload.portalProfileId || 'default', profileScope: payload.portalProfileScope || 'workspace',
      allowedHosts: Array.isArray(payload.portalAllowedHosts) ? payload.portalAllowedHosts : [],
      downloadDirectory: payload.portalDownloadDirectory || '.orkestrai/downloads',
      paused: payload.portalPaused === true, allowBackground: payload.portalAllowBackground === true } };
}

ipcMain.handle('orkestrai:portal-surface', async (event, input) => {
  if (['attach', 'detach'].includes(input?.method) && (typeof input.lease !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.lease))) throw new Error('Invalid Portal surface lease.');
  const request = await portalSurfaceRequest(event, input);
  if (input.method === 'attach') return managedPortalExecutor.surface(request, mainWindow, input.lease);
  if (input.method === 'detach') return managedPortalExecutor.detach(request.workspaceId, request.nodeId, input.lease);
  if (!['navigate', 'inspectScript', 'capture', 'state', 'close', 'activate', 'pause', 'resume'].includes(input.method)) throw new Error('Unsupported Portal surface method.');
  if (JSON.stringify(input.args || {}).length > 500000) throw new Error('Portal surface input is too large.');
  return managedPortalExecutor.userCommand(request, input.method, input.args || {});
});

ipcMain.on('orkestrai:portal-layout', (event, input) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return;
  const geometry = input?.geometry;
  if (!geometry || typeof geometry.visible !== 'boolean' || !Number.isFinite(geometry.zoom) || geometry.zoom < 0.1 || geometry.zoom > 5) return;
  for (const rect of [geometry.bounds, geometry.clip]) {
    if (!rect || !['x', 'y', 'width', 'height'].every((key) => Number.isInteger(rect[key]) && Math.abs(rect[key]) < 100000)) return;
    if (rect.width < 0 || rect.height < 0) return;
  }
  managedPortalExecutor?.setGeometry(input.workspaceId, input.nodeId, geometry, input.lease);
});

ipcMain.handle('orkestrai:automation-secret-status', (_event, key) => {
  if (!validAutomationSecretKey(key)) throw new Error('Invalid automation secret key.');
  return { available: safeStorage.isEncryptionAvailable(), stored: Boolean(readAutomationSecret(key)) };
});

ipcMain.handle('orkestrai:automation-secret-save', (_event, key, value) => saveAutomationSecret(key, value));

ipcMain.handle('orkestrai:automation-secret-delete', (_event, key) => deleteAutomationSecret(key));

ipcMain.handle('orkestrai:oauth-google-connect', async (_event, input) => {
  if (!input || typeof input !== 'object' || !validAutomationSecretKey(input.storageKey)) {
    throw new Error('Invalid OAuth credential destination.');
  }
  return performGoogleDesktopOauth({
    clientId: input.clientId,
    permissions: input.permissions,
    storageKey: input.storageKey,
    openExternal: (url) => shell.openExternal(url),
    saveSecret: (key, value) => saveAutomationSecret(key, value),
  });
});

ipcMain.handle('orkestrai:figma-plugin-folder', async () => {
  const pluginPath = path.join(app.getAppPath(), 'packages', 'orkestrai-figma-plugin');
  return shell.openPath(pluginPath);
});

ipcMain.handle('orkestrai:open-external', (_event, url) => {
  // Só https — nunca abre esquema arbitrario vindo do renderer.
  if (typeof url === 'string' && url.startsWith('https://')) shell.openExternal(url);
});

ipcMain.handle('orkestrai:open-path', async (_event, candidate) => {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) return 'invalid_path';
  try {
    if (!fs.statSync(candidate).isFile()) return 'not_a_file';
  } catch {
    return 'not_found';
  }
  return shell.openPath(candidate);
});

ipcMain.handle('orkestrai:clipboard-write', (_event, value) => {
  if (typeof value !== 'string' || value.length > 5_000_000) return false;
  clipboard.writeText(value);
  return true;
});

ipcMain.handle('orkestrai:clipboard-paste-text', (event) => {
  // Do not expose clipboard contents to the renderer. Only confirm that the
  // focused main window has text, then let Chromium dispatch its native paste
  // event to the focused xterm textarea.
  if (!mainWindow || event.sender !== mainWindow.webContents || !mainWindow.isFocused()) return false;
  if (!clipboard.readText()) return false;
  event.sender.paste();
  return true;
});

ipcMain.handle('orkestrai:collaboration-invite-consume', () => {
  const invite = pendingCollaborationInvite;
  pendingCollaborationInvite = null;
  return invite;
});

ipcMain.handle('orkestrai:menu-locale', (_event, locale) => {
  menuLocale = normalizeMenuLocale(locale);
  buildApplicationMenu();
  rebuildTrayMenu();
  return menuLocale;
});

const RENDERER_MENU_ACTIONS = new Set([
  'canvas', 'terminals', 'providers', 'remote', 'new-workspace', 'presets', 'organize', 'floors', 'roles', 'huddles', 'usage', 'ports',
  'settings', 'command-palette', 'docs', 'changelog',
]);

ipcMain.handle('orkestrai:menu-command', (_event, action) => {
  if (typeof action !== 'string' || !mainWindow) return false;
  if (RENDERER_MENU_ACTIONS.has(action)) {
    sendMenuAction(action);
    return true;
  }
  const contents = mainWindow.webContents;
  if (action === 'check-updates') void checkForUpdates();
  else if (action === 'undo') contents.undo();
  else if (action === 'redo') contents.redo();
  else if (action === 'cut') contents.cut();
  else if (action === 'copy') contents.copy();
  else if (action === 'paste') contents.paste();
  else if (action === 'select-all') contents.selectAll();
  else if (action === 'reload') contents.reload();
  else if (action === 'toggle-devtools') toggleDeveloperTools();
  else if (action === 'open-logs') void openLogsDirectory();
  else if (action === 'fullscreen') mainWindow.setFullScreen(!mainWindow.isFullScreen());
  else if (action === 'minimize') mainWindow.minimize();
  else if (action === 'toggle-maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  else if (action === 'close') mainWindow.close();
  else if (action === 'report-issue') void shell.openExternal('https://github.com/beeblock/orkestrai/issues/new');
  else return false;
  return true;
});

ipcMain.handle('orkestrai:titlebar-theme', (_event, theme) => {
  if (process.platform !== 'win32' || !mainWindow || !theme || typeof theme !== 'object') return false;
  const color = String(theme.background ?? '');
  const symbolColor = String(theme.foreground ?? '');
  if (!/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(symbolColor)) return false;
  mainWindow.setTitleBarOverlay({ color, symbolColor, height: 36 });
  return true;
});

ipcMain.handle('orkestrai:core-status', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  return coreDesktopStatus();
});

ipcMain.handle('orkestrai:core-configure', async (event, preferences) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || !preferences || typeof preferences !== 'object') return null;
  applyCorePreferences(preferences);
  return coreDesktopStatus();
});

ipcMain.handle('orkestrai:core-restart', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return null;
  return restartCore();
});

function showNativeNotification(title, body) {
  if (!Notification.isSupported()) return;
  pendingNotifications += 1;
  updateTrayTitle();
  const notification = new Notification({
    title,
    body: String(body).slice(0, 200),
    // Ícone da marca no toast (Win/macOS) em vez do generico do sistema.
    icon: nativeImage.createFromPath(path.join(appRoot, 'electron', 'resources', 'icon.png')),
    silent: false,
  });
  notification.on('click', () => {
    pendingNotifications = 0;
    updateTrayTitle();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notification.show();
}

function updateTrayTitle() {
  if (!tray) return;
  tray.setToolTip(pendingNotifications > 0 ? `Orkestrai — ${MENU_COPY[menuLocale].notifications(pendingNotifications)}` : 'Orkestrai');
}

function rebuildTrayMenu() {
  if (!tray) return;
  const copy = MENU_COPY[menuLocale];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: corePreferences.runInBackground ? copy.coreActive : copy.coreWindowBound, enabled: false },
    { type: 'separator' },
    {
      label: copy.open,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow().catch((error) => console.error(error));
        }
      },
    },
    { type: 'separator' },
    { label: copy.quit, click: () => app.quit() },
  ]));
  updateTrayTitle();
}

function createTray() {
  if (tray) return;
  // macOS: imagem template (o sistema tinja claro/escuro). Win/Linux: colorida.
  const resourcesDir = path.join(appRoot, 'electron', 'resources');
  const trayFile = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const image = nativeImage.createFromPath(path.join(resourcesDir, trayFile));
  if (process.platform === 'darwin') image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('Orkestrai');
  rebuildTrayMenu();
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const invite = findCollaborationInvite(argv);
    if (invite) {
      void receiveCollaborationInvite(invite);
      return;
    }
    if (isBackgroundRuntimeInvocation(argv)) {
      // Never log raw argv: bridge commands may contain user prompts or paths.
      return;
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else {
      createWindow().catch((error) => console.error(error));
    }
  });

  app.whenReady().then(async () => {
    initializeDiagnostics();
    registerCollaborationProtocol();
    menuLocale = normalizeMenuLocale(app.getLocale().toLowerCase().startsWith('pt') ? 'pt-BR' : app.getLocale().toLowerCase().startsWith('es') ? 'es' : 'en');
    // Ícone do dock em dev (empacotado vem do electron-builder).
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock.setIcon(path.join(appRoot, 'electron', 'resources', 'icon.png'));
    }
    // Ditado por voz: permite microfone só para o proprio app (localhost).
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
      const { canUseAppMicrophone } = require('./media-permissions.cjs');
      callback(canUseAppMicrophone({
        contentsId: webContents?.id, mainContentsId: mainWindow?.webContents.id,
        url: webContents?.getURL?.() ?? '', requestingUrl: details.requestingUrl,
        permission, mediaTypes: details.mediaTypes, serverPort,
      }));
    });
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
      const { canUseAppMicrophone } = require('./media-permissions.cjs');
      return canUseAppMicrophone({
        contentsId: webContents?.id, mainContentsId: mainWindow?.webContents.id,
        url: webContents?.getURL?.() ?? '', requestingUrl: details.securityOrigin || requestingOrigin,
        permission, mediaTypes: details.mediaType ? [details.mediaType] : undefined, serverPort,
      });
    });
    configurePortalSession();
    managedPortalExecutor = createManagedPortalExecutor({ WebContentsView, View, session, diagnostics,
      onOpenRequest: (request) => mainWindow?.webContents.send('orkestrai:portal-open-request', request),
      onState: (workspaceId, nodeId, state) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('orkestrai:portal-state', { workspaceId, nodeId, state });
      },
    });
    buildApplicationMenu();
    createTray();
    const initialInvite = findCollaborationInvite(process.argv);
    await ensureServer();
    await refreshCorePreferences();
    const loginLaunch = app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin;
    const hiddenCoreLaunch = (isBackgroundCoreLaunch(process.argv) || loginLaunch) && corePreferences.runInBackground && !initialInvite;
    if (hiddenCoreLaunch) {
      if (process.platform === 'darwin') app.dock.hide();
    } else {
      createSplash();
      await createWindow();
      if (initialInvite) await receiveCollaborationInvite(initialInvite);
    }
    powerMonitor.on('resume', () => {
      void readCoreHealth().then((health) => {
        if (!health) scheduleServerRecovery(0);
      });
    });
    setupAutoUpdater();
  }).catch((error) => {
    console.error('Falha ao iniciar o Orkestrai:', error);
    closeSplash();
    app.exit(1);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error(error));
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !shouldKeepCoreRunning({ isQuitting, runInBackground: corePreferences.runInBackground })) app.quit();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    managedPortalExecutor?.closeAll();
    flushPortalStorage();
    void stopServer();
  });
  app.on('quit', () => {
    closeSplash();
    void stopServer();
  });
}

if (isDev) {
  process.on('SIGINT', () => {
    void stopServer();
    process.exit(0);
  });
}
