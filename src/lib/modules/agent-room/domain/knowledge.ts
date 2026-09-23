export type KnowledgeKind = 'note' | 'file' | 'task' | 'memory' | 'image' | 'design' | 'codeGraph';
export type KnowledgePassage = { locator: string; text: string; page?: number; sheet?: string; row?: number; cells?: Array<{ address: string; text: string }> };
export type KnowledgeDocument = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  nodeId: string | null;
  path: string | null;
  tags: string[];
  status: 'ready' | 'empty' | 'unsupported' | 'error' | 'missing';
  hash: string;
  fingerprint: string;
  revision: number;
  indexedAt: string;
  truncated: boolean;
  passages: KnowledgePassage[];
};
export type KnowledgeItem = Omit<KnowledgeDocument, 'passages' | 'fingerprint'> & { excerpt: string; locator: string; score: number };
export type KnowledgeLink = { source: string; target: string; kind: 'canvas' | 'wiki' | 'source' | 'task' };
export type KnowledgeResult = { items: KnowledgeItem[]; links: KnowledgeLink[]; total: number; truncated: boolean; indexedAt: string };

export function knowledgeNormalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function knowledgeTerms(value: string): string[] {
  return [...new Set(knowledgeNormalize(value).match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])].slice(0, 16);
}

export function knowledgeTags(content: string, explicit: unknown = []): string[] {
  const fromText = [...content.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]{1,48})/gu)].map(match => match[1]);
  return [...new Set([...fromText, ...(Array.isArray(explicit) ? explicit.filter((v): v is string => typeof v === 'string') : [])].map(tag => tag.toLowerCase().slice(0, 48)))].slice(0, 24);
}

export function knowledgeWikiLinks(content: string): string[] {
  return [...new Set([...content.matchAll(/\[\[([^\]\n]{1,240})\]\]/g)].map(match => match[1].split('|')[0].split('#')[0].trim()).filter(Boolean))].slice(0, 100);
}

export function textPassages(content: string): KnowledgePassage[] {
  const lines = content.slice(0, 250_000).split(/\r?\n/);
  const passages: KnowledgePassage[] = [];
  let text = '', start = 1;
  for (const [i, line] of lines.entries()) {
    if (text.length + line.length > 1800 && text) {
      passages.push({ locator: `L${start}-${i}`, text });
      text = ''; start = i + 1;
    }
    text += `${line.slice(0, 6000)}\n`;
    if (passages.length >= 200) break;
  }
  if (text.trim() && passages.length < 200) passages.push({ locator: `L${start}-${lines.length}`, text: text.trim() });
  return passages;
}

export function knowledgeTextTruncated(content: string): boolean {
  return content.length > 250_000 || content.split(/\r?\n/).some(line => line.length > 6000);
}
