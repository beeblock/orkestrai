export function normalizeCodeGraphContractPath(value: unknown): string | null {
  let path = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 2_000);
  if (!path) return null;
  path = path.replace(/^['"`]|['"`]$/g, '');
  if (/^(?:ws|wss|grpc):/i.test(path)) return null;
  path = path.replace(/^(?:\{\{[^{}]{1,100}\}\}|\$\{[^{}]{1,100}\})+/, '');
  if (/^https?:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  } else {
    path = path.split(/[?#]/, 1)[0];
  }
  path = path
    .replace(/\[\[?\.{3}[^\]]+\]?\]/g, '{param}')
    .replace(/\[\[?[^\]]+\]?\]/g, '{param}')
    .replace(/\{\{[^{}]+\}\}|\$\{[^{}]+\}|:[A-Za-z_$][\w$-]*|\{[^{}]+\}/g, '{param}')
    .replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) path = `/${path}`;
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path.slice(0, 500) || '/';
}
