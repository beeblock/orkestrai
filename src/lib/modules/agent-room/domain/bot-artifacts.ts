import { z } from 'zod/v3';

export const botArtifactSchema = z.object({ path: z.string().min(1).max(2000), name: z.string().min(1).max(180), mimeType: z.string().min(1).max(120), image: z.boolean(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type BotArtifact = z.infer<typeof botArtifactSchema>;
const mime: Record<string, string> = Object.assign(Object.create(null), { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' });
Object.assign(mime, { md: 'text/markdown', json: 'application/json', zip: 'application/zip', tar: 'application/x-tar', gz: 'application/gzip',
  doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf', webm: 'video/webm', m4a: 'audio/mp4', flac: 'audio/flac' });

function links(): RegExp { return /!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g; }
function decodedPath(value: string): string | null {
  try {
    const path = decodeURIComponent(value).replace(/\\/g, '/').replace(/^\.\//, '');
    return !path || /[\u0000-\u001f\u007f]/.test(path) || path.split('/').some(part => part === '..' || /^(?:\.env|credentials?|secrets?)(?:\.|$)/i.test(part)) ? null : path;
  } catch { return null; }
}

/** Map only explicit absolute links under an authenticated workspace root.
 * This is lexical normalization, never permission to read: the server still
 * resolves symlinks, checks its filesystem policy, size and exact file hash.
 * Public workers supply relative, separately approved paths and get no roots.
 */
export function normalizeBotArtifactLinks(body: string, workspaceRoots: readonly string[]): string {
  return body.replace(links(), (whole, label, angle, bare) => {
    const path = decodedPath(angle ?? bare);
    if (!path || !mime[path.split('.').at(-1)?.toLowerCase() ?? '']) return whole;
    for (const candidate of workspaceRoots) {
      const root = candidate.replace(/\\/g, '/').replace(/\/+$/, '');
      if (!root || !/^(?:\/|[a-z]:\/)/i.test(root)) continue;
      // Windows drive/UNC paths are case-insensitive; Linux guest roots are not.
      const windows = /^[a-z]:\//i.test(root) || root.startsWith('//');
      const prefix = root + '/';
      if (!(windows ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix))) continue;
      const relative = path.slice(prefix.length);
      if (!relative || relative.startsWith('/')) continue;
      const encoded = relative.split('/').map(part => encodeURIComponent(part)).join('/');
      return `${whole.startsWith('!') ? '!' : ''}[${label}](<${encoded}>)`;
    }
    return whole;
  });
}

/** Native media already carries its filename/caption; never send dead local
 * Markdown links alongside it. Remove only files verified for this result.
 */
export function botArtifactText(body: string, artifacts: readonly BotArtifact[]): string {
  const paths = new Set(artifacts.map(file => file.path));
  return body.replace(links(), (whole, _label, angle, bare) => {
    const path = decodedPath(angle ?? bare);
    return path && paths.has(path) ? '' : whole;
  }).replace(/\n{3,}/g, '\n\n').trim();
}

/** Only explicit workspace-relative artifact links, never fetched model-generated URLs. */
export function botArtifactLinks(body: string): BotArtifact[] {
  const files: BotArtifact[] = [];
  for (const match of body.matchAll(links())) {
    const path = decodedPath(match[2] ?? match[3]);
    if (!path || path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path)) continue;
    const name = path.split('/').at(-1) ?? '', extension = name.split('.').at(-1)?.toLowerCase() ?? '';
    if (!mime[extension] || path.length > 2000 || name.length > 180 || files.some(file => file.path === path)) continue;
    files.push({ path, name, mimeType: mime[extension], image: mime[extension].startsWith('image/') });
    if (files.length >= 6) break;
  }
  return files;
}

/** Avoid splitting a UTF-16 surrogate pair at provider character limits. */
export function channelTextChunks(body: string, limit = 4000): string[] {
  const parts: string[] = [];
  for (let at = 0; at < body.length;) {
    let end = Math.min(at + limit, body.length);
    if (end < body.length && /[\uD800-\uDBFF]/.test(body[end - 1])) end--;
    parts.push(body.slice(at, end)); at = end;
  }
  return parts.filter(part => part.trim());
}
