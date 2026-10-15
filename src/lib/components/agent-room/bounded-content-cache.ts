/** Renderer-local LRU. Never persist content or retain unbounded board history. */
export function createContentCache(render: (content: string) => string, maxEntries = 128, maxBytes = 4 * 1024 * 1024) {
  const entries = new Map<string, string>();
  let bytes = 0;
  return (content: string): string => {
    const hit = entries.get(content);
    if (hit !== undefined) {
      entries.delete(content); entries.set(content, hit);
      return hit;
    }
    const output = render(content);
    const size = 2 * (content.length + output.length);
    if (size <= maxBytes && maxEntries > 0) {
      while (entries.size && (entries.size >= maxEntries || bytes + size > maxBytes)) {
        const [key, value] = entries.entries().next().value!;
        bytes -= 2 * (key.length + value.length); entries.delete(key);
      }
      entries.set(content, output); bytes += size;
    }
    return output;
  };
}
