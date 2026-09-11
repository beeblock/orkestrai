function canUseAppMicrophone({ contentsId, mainContentsId, url, requestingUrl, permission, mediaTypes, serverPort }) {
  if (!contentsId || contentsId !== mainContentsId || permission !== 'media' || !serverPort) return false;
  if (mediaTypes?.some((type) => type !== 'audio')) return false;
  const origin = `http://127.0.0.1:${serverPort}`;
  try {
    return new URL(url).origin === origin && (!requestingUrl || new URL(requestingUrl).origin === origin);
  } catch { return false; }
}

module.exports = { canUseAppMicrophone };
