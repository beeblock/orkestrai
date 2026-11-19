import { z } from 'zod/v3';

export const botArtifactSchema = z.object({ path: z.string().min(1).max(2000), name: z.string().min(1).max(180), mimeType: z.string().min(1).max(120), image: z.boolean(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();
export type BotArtifact = z.infer<typeof botArtifactSchema>;
const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf', csv: 'text/csv', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', mp4: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg' };

/** Only explicit workspace-relative artifact links, never fetched model-generated URLs. */
export function botArtifactLinks(body: string): BotArtifact[] {
  const files: BotArtifact[] = [];
  for (const match of body.matchAll(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g)) {
    let path = match[2] ?? match[3];
    try { path = decodeURIComponent(path).replace(/\\/g, '/').replace(/^\.\//, ''); } catch { continue; }
    if (!path || path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path) || path.split('/').some(part => part === '..' || /^(?:\.env|credentials?|secrets?)(?:\.|$)/i.test(part))) continue;
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
