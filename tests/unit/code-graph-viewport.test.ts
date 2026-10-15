import { describe, expect, it, vi } from 'vitest';
import { synchronizeGraphSurface } from '$lib/components/agent-room/canvas/code-graph-viewport.js';

describe('atomic graph viewport synchronization', () => {
  it('restores picking before returning from the resize frame, without scheduling another frame', () => {
    let pickable = true;
    const calls: string[] = [];
    const surface = {
      resize: vi.fn((force?: boolean) => { expect(force).toBe(true); calls.push('resize'); pickable = false; }),
      render: vi.fn(() => { calls.push('render'); pickable = true; }),
      scheduleRender: vi.fn(),
    };
    synchronizeGraphSurface(surface);
    expect(pickable).toBe(true);
    expect(calls).toEqual(['resize', 'render']);
    expect(surface.scheduleRender).not.toHaveBeenCalled();
  });
});
