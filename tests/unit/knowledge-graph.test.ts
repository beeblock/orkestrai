import { describe, expect, it } from 'vitest';
import { graphLinks, graphPointer, layoutKnowledgeGraph, knowledgeCommunities } from '$lib/components/agent-room/knowledge-graph-layout.js';

describe('knowledge network layout', () => {
  it('colors relationship communities around their actual hubs without adding links', () => {
    const ids = ['hub-a', 'a1', 'a2', 'hub-b', 'b1', 'b2', 'alone'];
    const links = ['a1', 'a2', 'b1', 'b2'].map(target => ({ source: target.startsWith('a') ? 'hub-a' : 'hub-b', target, kind: 'wiki' as const }));
    const groups = knowledgeCommunities(ids, links);
    expect(groups.a1).toBe('hub-a'); expect(groups.a2).toBe('hub-a');
    expect(groups.b1).toBe('hub-b'); expect(groups.alone).toBe('alone');
    expect(knowledgeCommunities([], [])).toEqual({});
  });
  it('uses only actual relationships, de-duplicates undirected pairs and drops dangling links', () => {
    expect(graphLinks(['a', 'b'], [
      { source: 'a', target: 'b', kind: 'wiki' }, { source: 'b', target: 'a', kind: 'canvas' },
      { source: 'a', target: 'gone', kind: 'wiki' }, { source: 'a', target: 'a', kind: 'wiki' },
    ])).toEqual([{ source: 'a', target: 'b', kind: 'wiki' }]);
  });
  it('produces finite, deterministic coordinates including isolated nodes and preserves existing positions on updates', () => {
    const input = { ids: ['a', 'b', 'isolated'], links: [{ source: 'a', target: 'b', kind: 'wiki' as const }], previous: {} };
    const first = layoutKnowledgeGraph(input);
    expect(layoutKnowledgeGraph(input)).toEqual(first);
    expect(new Set(Object.values(first).map(p => JSON.stringify(p))).size).toBe(3);
    expect(Object.values(first).every(p => Object.values(p).every(Number.isFinite))).toBe(true);
    const changed = layoutKnowledgeGraph({ ...input, ids: [...input.ids, 'new'], links: [...input.links, { source: 'b', target: 'new', kind: 'wiki' }], previous: first });
    for (const id of input.ids) expect(changed[id]).toEqual(first[id]);
    expect(changed.new).toBeDefined();
    expect(layoutKnowledgeGraph({ ids: [], links: [], previous: first })).toEqual({});
  });
  it('maps hover coordinates through outer canvas translation and scale, not CSS client dimensions', () => {
    expect(graphPointer(300, 200, { left: 100, top: 100, width: 400, height: 200 })).toEqual({ x: 0, y: 0 });
    expect(graphPointer(50, 100, { left: -150, top: 0, width: 800, height: 400 })).toEqual({ x: -0.5, y: 0.5 });
  });
  it('lays out a dense workspace within a bounded worker budget', () => {
    const ids = Array.from({ length: 300 }, (_, i) => `source-${i}`);
    const links = ids.slice(1).map((target, i) => ({ source: ids[Math.floor(i / 3)], target, kind: 'wiki' as const }));
    const start = performance.now();
    const positions = layoutKnowledgeGraph({ ids, links, previous: {} });
    expect(Object.keys(positions)).toHaveLength(300);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
