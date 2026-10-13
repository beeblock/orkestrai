import { describe, expect, it } from 'vitest';
import { edgeIntersectsViewport, edgePerformanceProfile, normalizeEdgeRenderingPreference, staticEdgePath } from '$lib/components/agent-room/canvas/edge-performance.js';
import { connectedEdgesFor, floatingAnchorFor, floatingAnchorForSnapshot, nodeIndexFor } from '$lib/components/agent-room/canvas/floating-anchor.js';

describe('adaptive canvas edge performance', () => {
  it('computes a 189-connection hub anchor once per immutable snapshot', () => {
    let reads = 0;
    const nodes = Array.from({ length: 190 }, (_, i) => ({
      id: String(i), get position() { reads++; return { x: i * 400, y: i * 100 }; }, width: 320, height: 200,
    }));
    const edges = nodes.slice(1).map(node => ({ source: '0', target: node.id }));
    const first = floatingAnchorForSnapshot('0', nodes, edges);
    const firstReads = reads;
    for (let i = 0; i < 189; i++) expect(floatingAnchorForSnapshot('0', nodes, edges)).toBe(first);
    expect(reads).toBe(firstReads);
    expect(firstReads).toBeLessThan(1_000);
    const moved = nodes.map(node => node.id === '0' ? { ...node, position: { x: 900, y: 600 } } : node);
    expect(floatingAnchorForSnapshot('0', moved, edges)).toEqual(floatingAnchorFor('0', moved, edges));
    expect(floatingAnchorForSnapshot('0', moved, edges)).not.toEqual(first);
    const replaced = [{ source: '0', target: '189' }];
    expect(floatingAnchorForSnapshot('0', moved, replaced)).toEqual(floatingAnchorFor('0', moved, replaced));
  });

  it('bounds snapshot retention and keeps uncached mutable geometry correct', () => {
    const a = [{ id: 'a', position: { x: 0, y: 0 } }, { id: 'b', position: { x: 300, y: 0 } }];
    const edges = [{ source: 'a', target: 'b' }];
    const first = floatingAnchorForSnapshot('a', a, edges);
    for (let i = 0; i < 5; i++) floatingAnchorForSnapshot('a', a.map(node => ({ ...node })), edges);
    expect(floatingAnchorForSnapshot('a', a, edges)).not.toBe(first);
    const before = floatingAnchorFor('a', a, edges);
    a[1].position.y = 500;
    expect(floatingAnchorFor('a', a, edges)).not.toEqual(before);
  });
  it('keeps full rope physics for ordinary workspaces', () => {
    expect(edgePerformanceProfile({ edgeCount: 40, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: false })).toMatchObject({
      mode: 'physics', segments: 12, iterations: 4, fps: 60,
    });
  });

  it('uses static geometry for dense idle edges but preserves active feedback', () => {
    expect(edgePerformanceProfile({ edgeCount: 250, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: false }).mode).toBe('curve');
    expect(edgePerformanceProfile({ edgeCount: 250, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: true })).toMatchObject({
      mode: 'curve', animateActivity: true,
    });
    expect(edgePerformanceProfile({ edgeCount: 500, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: true })).toMatchObject({
      mode: 'curve', animateActivity: true,
    });
  });

  it('lets the user force static or elastic rendering', () => {
    expect(edgePerformanceProfile({ edgeCount: 20, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: true, preference: 'static' })).toEqual({
      mode: 'curve', segments: 0, iterations: 0, fps: 0, animateActivity: false,
    });
    expect(edgePerformanceProfile({ edgeCount: 600, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: false, preference: 'elastic' })).toMatchObject({
      mode: 'physics', segments: 5, iterations: 1, fps: 24,
    });
    expect(normalizeEdgeRenderingPreference('invalid')).toBe('auto');
  });

  it('keeps communication color without continuous SVG painting in very large automatic canvases', () => {
    expect(edgePerformanceProfile({ edgeCount: 876, documentVisible: true, inViewport: true, reducedMotion: false, emphasized: true })).toMatchObject({
      mode: 'curve', fps: 0, animateActivity: false,
    });
  });

  it('pauses work outside the viewport and respects reduced motion', () => {
    expect(edgePerformanceProfile({ edgeCount: 20, documentVisible: false, inViewport: true, reducedMotion: false, emphasized: true }).fps).toBe(0);
    expect(edgePerformanceProfile({ edgeCount: 20, documentVisible: true, inViewport: false, reducedMotion: false, emphasized: true }).mode).toBe('line');
    expect(edgePerformanceProfile({ edgeCount: 20, documentVisible: true, inViewport: true, reducedMotion: true, emphasized: true })).toMatchObject({
      mode: 'curve', animateActivity: false,
    });
  });

  it('detects visible geometry and builds stable static paths', () => {
    const anchors = { ax: 100, ay: 100, bx: 400, by: 250 };
    expect(edgeIntersectsViewport(anchors, { x: 0, y: 0, zoom: 1 }, 800, 600)).toBe(true);
    expect(edgeIntersectsViewport(anchors, { x: -2_000, y: -2_000, zoom: 1 }, 800, 600)).toBe(false);
    expect(staticEdgePath(anchors, 'curve').path).toContain(' Q ');
    expect(staticEdgePath(anchors, 'line').path).toContain(' L ');
  });

  it('indexes nodes and adjacency once per immutable canvas snapshot', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges = [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'a' },
      { source: 'b', target: 'c' },
    ];
    expect(nodeIndexFor(nodes)).toBe(nodeIndexFor(nodes));
    expect(nodeIndexFor(nodes).get('c')).toBe(nodes[2]);
    expect(connectedEdgesFor('a', edges)).toEqual([edges[0], edges[1]]);
    expect(connectedEdgesFor('a', edges)).toBe(connectedEdgesFor('a', edges));
    expect(connectedEdgesFor('missing', edges)).toEqual([]);
  });
});
