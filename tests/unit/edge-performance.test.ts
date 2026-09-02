import { describe, expect, it } from 'vitest';
import { edgeIntersectsViewport, edgePerformanceProfile, normalizeEdgeRenderingPreference, staticEdgePath } from '$lib/components/agent-room/canvas/edge-performance.js';
import { connectedEdgesFor, nodeIndexFor } from '$lib/components/agent-room/canvas/floating-anchor.js';

describe('adaptive canvas edge performance', () => {
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
