/**
 * Preload do Electron: expoe uma ponte minima e segura para o renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('orkestraiDesktop', {
  /** Abre o seletor nativo de pastas (com opcao de criar nova pasta). */
  pickDirectory: () => ipcRenderer.invoke('orkestrai:pick-directory'),
  /** Seleciona uma collection, contrato OpenAPI ou ambiente local para o API Client. */
  pickApiCollection: (kind) => ipcRenderer.invoke('orkestrai:pick-api-collection', kind),
  /** Seleciona onde criar uma nova collection Bruno/OpenCollection exportada. */
  pickApiExportDirectory: () => ipcRenderer.invoke('orkestrai:pick-api-export-directory'),
  /** Abre a origem importada no Bruno/Postman instalado. */
  openApiCollection: (kind, path) => ipcRenderer.invoke('orkestrai:open-api-collection', kind, path),
  platform: process.platform,
  /** Versao atual do app (ex.: "0.0.1"). */
  appVersion: () => ipcRenderer.invoke('orkestrai:app-version'),
  automationSecretStatus: (key) => ipcRenderer.invoke('orkestrai:automation-secret-status', key),
  saveAutomationSecret: (key, value) => ipcRenderer.invoke('orkestrai:automation-secret-save', key, value),
  deleteAutomationSecret: (key) => ipcRenderer.invoke('orkestrai:automation-secret-delete', key),
  /** Checagem manual de atualizacao (a automatica roda no boot + a cada 6h). */
  checkForUpdates: () => ipcRenderer.invoke('orkestrai:update-check'),
  /** Ultimo estado conhecido, inclusive se o renderer montou depois do check do boot. */
  updateState: () => ipcRenderer.invoke('orkestrai:update-state'),
  /** Reinicia e instala a versao ja baixada quando a plataforma permite troca segura. */
  installUpdate: () => ipcRenderer.invoke('orkestrai:update-install'),
  /** Abre URL https no navegador do sistema (fallback de download manual). */
  openExternal: (url) => ipcRenderer.invoke('orkestrai:open-external', url),
  /** Abre um arquivo local no aplicativo padrão do sistema. */
  openPath: (path) => ipcRenderer.invoke('orkestrai:open-path', path),
  /** Copia texto pelo clipboard nativo, inclusive no Chromium do Windows. */
  writeClipboardText: (value) => ipcRenderer.invoke('orkestrai:clipboard-write', value),
  /** Cola texto no elemento focado sem expor o conteudo do clipboard ao renderer. */
  pasteClipboardText: () => ipcRenderer.invoke('orkestrai:clipboard-paste-text'),
  openFigmaPluginFolder: () => ipcRenderer.invoke('orkestrai:figma-plugin-folder'),
  /** Mantém o menu nativo no mesmo idioma selecionado dentro do app. */
  setMenuLocale: (locale) => ipcRenderer.invoke('orkestrai:menu-locale', locale),
  /** Executa uma acao validada da barra customizada do Windows. */
  runMenuCommand: (action) => ipcRenderer.invoke('orkestrai:menu-command', action),
  setTitlebarTheme: (theme) => ipcRenderer.invoke('orkestrai:titlebar-theme', theme),
  /** Consome uma vez um convite E2EE recebido via orkestrai:// sem persisti-lo. */
  consumeCollaborationInvite: () => ipcRenderer.invoke('orkestrai:collaboration-invite-consume'),
  onCollaborationInvite: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('orkestrai:collaboration-invite', listener);
    return () => ipcRenderer.removeListener('orkestrai:collaboration-invite', listener);
  },
  /** Ações do menu nativo são executadas pelo renderer para reutilizar os fluxos do canvas. */
  onMenuAction: (callback) => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('orkestrai:menu-action', listener);
    return () => ipcRenderer.removeListener('orkestrai:menu-action', listener);
  },
  /** Eventos do updater: available/manual/downloading/downloaded/none/error. Retorna unsubscribe. */
  onUpdate: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('orkestrai:update', listener);
    return () => ipcRenderer.removeListener('orkestrai:update', listener);
  },
});
