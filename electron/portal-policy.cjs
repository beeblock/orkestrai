const PORTAL_PARTITION = 'persist:orkestrai-portals';

function publicPortalUrl(candidate) {
  if (candidate === 'about:blank') return candidate;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return 'about:blank';
    url.username = ''; url.password = '';
    const privateKey = /token|secret|password|passwd|authorization|^auth$|^code$|^state$|^nonce$|^session(?:id)?$|^sid$|^otp$|^csrf/i;
    for (const key of [...url.searchParams.keys()]) if (privateKey.test(key)) url.searchParams.delete(key);
    const fragment = new URLSearchParams(url.hash.slice(1));
    if ([...fragment.keys()].some((key) => privateKey.test(key)) || /^#(?:eyJ|[A-Za-z0-9_-]{40,}$)/.test(url.hash)) url.hash = '';
    return url.toString();
  } catch { return 'about:blank'; }
}

function managedPortalPartition(workspaceId, nodeId, profileId = 'default', profileScope = 'workspace') {
  const clean = (value) => String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'default';
  const owner = profileScope === 'private' ? clean(nodeId) : clean(workspaceId);
  return `persist:orkestrai-portal-${owner}-${clean(profileId)}`;
}

function isAllowedPortalUrl(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 4096) return false;
  if (candidate === 'about:blank') return true;
  try {
    const url = new URL(candidate);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

function shouldOpenPortalInCanvas(url, disposition) {
  return (disposition === 'foreground-tab' || disposition === 'background-tab')
    && url !== 'about:blank'
    && isAllowedPortalUrl(url);
}

function portalWindowOpenResponse(url, createWindow) {
  // A popup without an embedded host must never fall back to a BrowserWindow.
  if (!isAllowedPortalUrl(url) || typeof createWindow !== 'function') return { action: 'deny' };
  return {
    action: 'allow',
    createWindow,
    overrideBrowserWindowOptions: {
      webPreferences: {
        partition: PORTAL_PARTITION,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    },
  };
}

module.exports = { PORTAL_PARTITION, managedPortalPartition, isAllowedPortalUrl, portalWindowOpenResponse, shouldOpenPortalInCanvas, publicPortalUrl };
