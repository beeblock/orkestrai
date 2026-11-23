/** WhatsApp supports native emphasis and bare web links, not Markdown links.
 * Preserve code blocks verbatim and leave already-native single markers alone.
 */
export function formatWhatsAppText(body: string): string {
  return body.split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, index) => index % 2 ? part : part
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*([^*\n]+)\*\*/g, '*$1*')
    .replace(/__([^_\n]+)__/g, '*$1*')
    .replace(/~~([^~\n]+)~~/g, '~$1~')
    .replace(/!?\[([^\]\n]+)\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/g, (_whole, label, url) => label === url ? url : `${label}: ${url}`)
  ).join('');
}
