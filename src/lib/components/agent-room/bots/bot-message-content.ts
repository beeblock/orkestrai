import { botArtifactLinks, botArtifactSchema } from '$lib/modules/agent-room/domain/bot-artifacts.js';

/** Resolve only artifact links already verified by Core, leaving other Markdown intact. */
export function botMessageContent(body: string, meta: Record<string, unknown>, workspaceId: string): string {
  const paths = new Set((Array.isArray(meta.artifacts) ? meta.artifacts.slice(0, 7) : []).flatMap(raw => {
    const parsed = botArtifactSchema.safeParse(raw);
    return parsed.success && parsed.data.sha256 ? [parsed.data.path] : [];
  }));
  return body.replace(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g, match => {
    const artifact = botArtifactLinks(match)[0];
    if (!artifact || !paths.has(artifact.path)) return match;
    const label = match.slice(0, match.indexOf(']') + 1);
    return `${label}(/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/fs/raw?path=${encodeURIComponent(artifact.path)})`;
  });
}
