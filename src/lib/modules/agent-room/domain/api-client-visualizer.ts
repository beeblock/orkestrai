const VISUALIZER_CSP = [
  "default-src 'none'",
  "img-src http: https: data: blob:",
  "media-src http: https: data: blob:",
  "style-src 'unsafe-inline' http: https: data:",
  "font-src http: https: data:",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "script-src 'none'",
].join('; ');

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function visualizerBaseUrl(requestUrl: string): string {
  try {
    const parsed = new URL(requestUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'about:blank';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return 'about:blank';
  }
}

/**
 * Gives Postman visualizers an explicit, credential-free base URL. Without a
 * base, relative media paths inside srcdoc target Orkestrai's own HTTP server.
 */
export function apiClientVisualizerDocument(content: string, requestUrl: string): string {
  const bounded = content.slice(0, 1_000_000).replace(/<base\b[^>]*>/gi, '');
  const head = `<base href="${escapeAttribute(visualizerBaseUrl(requestUrl))}"><meta http-equiv="Content-Security-Policy" content="${escapeAttribute(VISUALIZER_CSP)}">`;
  if (/<head(?:\s[^>]*)?>/i.test(bounded)) {
    return bounded.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${head}`);
  }
  if (/<html(?:\s[^>]*)?>/i.test(bounded)) {
    return bounded.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${head}</head>`);
  }
  return `<!doctype html><html><head>${head}</head><body>${bounded}</body></html>`;
}
