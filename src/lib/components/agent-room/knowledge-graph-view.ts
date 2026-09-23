import type { KnowledgeItem, KnowledgeLink } from '$lib/modules/agent-room/domain/knowledge.js';

export const graphColors: Record<KnowledgeItem['kind'], string> = {
  note: '#e8ac45', file: '#47b8e5', task: '#4fc99b', memory: '#e47fba',
  image: '#eb8b63', design: '#a897ef', codeGraph: '#8ba8c1',
};
export const graphPalette = ['#50cbd3', '#e694bd', '#a69af4', '#8cc775', '#efb65c', '#72aaf0', '#f18a79', '#b5c95a'];
export function graphLinks(ids: string[], links: KnowledgeLink[]): KnowledgeLink[] {
  const known = new Set(ids), seen = new Set<string>();
  return links.filter(link => {
    if (link.source === link.target || !known.has(link.source) || !known.has(link.target)) return false;
    const key = JSON.stringify([link.source, link.target].sort());
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function graphPointer(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>) {
  return { x: (clientX - rect.left) / Math.max(1, rect.width) * 2 - 1, y: 1 - (clientY - rect.top) / Math.max(1, rect.height) * 2 };
}
