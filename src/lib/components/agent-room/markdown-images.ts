/** Images that point at workspace files load through the same route the Canvas uses. */
export function withWorkspaceImages(html: string, workspaceId: string | null | undefined): string {
  if (!workspaceId) return html;
  return html.replace(/<img([^>]*?)\ssrc="([^"]+)"/g, (match, before: string, src: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/api\/|#)/i.test(src)) return match;
    const path = src.replace(/^\.\//, '');
    return `<img${before} src="/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/fs/raw?path=${encodeURIComponent(path)}"`;
  });
}
