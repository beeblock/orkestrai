/** Exact hostnames, including bracketed IPv6. No URL, credentials, port or wildcard. */
export function normalizePortalHost(value: string): string | null {
  const host = value.trim().toLowerCase();
  if (!host || host.length > 253 || /[\s/\\?#@%]/.test(host)) return null;
  if (host.startsWith('[') ? !host.endsWith(']') : host.includes(':')) return null;
  try {
    const url = new URL(`http://${host}`);
    if (url.host !== url.hostname || url.username || url.password || url.pathname !== '/') return null;
    if (!url.hostname.startsWith('[') && !/^[a-z0-9.-]+$/.test(url.hostname)) return null;
    return url.hostname;
  } catch { return null; }
}

export function normalizePortalHosts(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).map(normalizePortalHost).filter((host): host is string => host !== null))].slice(0, 64);
}
