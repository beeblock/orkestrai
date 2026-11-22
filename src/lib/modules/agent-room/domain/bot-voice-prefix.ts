/** Map only a leading spoken bot name, never a word elsewhere in the transcript. */
export function voicePrefixBody(text: string, prefixes: readonly string[] = []): string {
  if (prefixes.some(prefix => text.startsWith(prefix))) return text;
  for (const prefix of prefixes) {
    if (!/^[@#][\p{L}\p{N}_-]+$/u.test(prefix)) continue;
    const name = prefix.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^(?:(?:hashtag|arroba|hash tag)\\s+)?${name}(?=[\\s,:.!?]|$)`, 'iu').exec(text.trimStart());
    if (match) return prefix + text.trimStart().slice(match[0].length);
  }
  return text;
}
