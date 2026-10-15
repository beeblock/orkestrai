import { describe, expect, it, vi } from 'vitest';
import { createContentCache } from '../../src/lib/components/agent-room/bounded-content-cache.js';

describe('bounded renderer content cache', () => {
  it('renders each unchanged content once across consumers and never trusts new content', () => {
    const render = vi.fn((text: string) => `safe:${text}`);
    const cached = createContentCache(render);
    expect(cached('same')).toBe('safe:same'); expect(cached('same')).toBe('safe:same');
    expect(cached('<script>')).toBe('safe:<script>');
    expect(render).toHaveBeenCalledTimes(2);
  });
  it('evicts by both LRU count and UTF-16 bytes and never caches oversized content', () => {
    const render = vi.fn((text: string) => text);
    const cached = createContentCache(render, 2, 16);
    cached('a'); cached('b'); cached('a'); cached('c'); cached('b');
    expect(render.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c', 'b']);
    cached('oversized'); cached('oversized');
    expect(render.mock.calls.slice(-2)).toEqual([['oversized'], ['oversized']]);
  });
});
