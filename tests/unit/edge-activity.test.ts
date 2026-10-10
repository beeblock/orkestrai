import { describe, expect, it } from 'vitest';
import { applyEdgeActivity } from '$lib/components/agent-room/canvas/edge-activity.js';

describe('canvas communication activity', () => {
  const nodes = [{ id: 'leader', type: 'terminal' }, { id: 'worker', type: 'terminal' }, { id: 'note', type: 'note' }];
  const edges = [{ source: 'leader', target: 'worker', data: {} }, { source: 'note', target: 'leader', data: {} }];

  it('does not animate hundreds of asset connections for a human or system prompt', () => {
    const assets = Array.from({ length: 228 }, (_, i) => ({ source: 'leader', target: `asset-${i}`, data: {} }));
    expect(applyEdgeActivity(assets, nodes, { from: null, to: 'leader', talking: true })).toBe(assets);
    expect(applyEdgeActivity(edges, nodes, { from: 'note', to: 'leader', talking: true })).toBe(edges);
  });

  it('updates only the actual agent pair in either direction and preserves no-op snapshots', () => {
    const active = applyEdgeActivity(edges, nodes, { from: 'worker', to: 'leader', talking: true });
    expect(active[0].data).toEqual({ talking: true });
    expect(active[1]).toBe(edges[1]);
    expect(applyEdgeActivity(active, nodes, { from: 'leader', to: 'worker', talking: true })).toBe(active);
    const idle = applyEdgeActivity(active, nodes, { from: 'worker', to: 'leader', talking: false });
    expect(idle[0].data).toEqual({ talking: false });
    expect(idle[1]).toBe(edges[1]);
  });
});
