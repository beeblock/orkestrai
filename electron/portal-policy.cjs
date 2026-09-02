const PORTAL_PARTITION = 'persist:orkestrai-portals';

function isAllowedPortalUrl(candidate) {
  if (typeof candidate !== 'string' || candidate.length > 4096) return false;
  if (candidate === 'about:blank') return true;
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === 'http:' || protocol === 'https:';
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

module.exports = { PORTAL_PARTITION, isAllowedPortalUrl, portalWindowOpenResponse, shouldOpenPortalInCanvas };
