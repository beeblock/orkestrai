const PORTAL_PARTITION = 'persist:orkestrai-portals';

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

function portalWindowOpenResponse(url, title = 'Orkestrai Portal') {
  if (!isAllowedPortalUrl(url)) return { action: 'deny' };
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 1120,
      height: 760,
      minWidth: 480,
      minHeight: 360,
      title,
      backgroundColor: '#111116',
      autoHideMenuBar: true,
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

module.exports = { PORTAL_PARTITION, managedPortalPartition, isAllowedPortalUrl, portalWindowOpenResponse, shouldOpenPortalInCanvas };
