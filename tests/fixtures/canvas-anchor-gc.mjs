import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { floatingAnchorForSnapshot } from '../../src/lib/components/agent-room/canvas/floating-anchor.ts';
import { readWorkspaceViewCache, writeWorkspaceViewCache } from '../../src/lib/components/agent-room/workspace-view-cache.ts';

assert.equal(typeof globalThis.gc, 'function', 'Run this fixture with --expose-gc');
function mountAndReleaseCanvas() {
  const nodes = [
    { id: 'leader', position: { x: 0, y: 0 }, data: { onSelect: () => nodes } },
    { id: 'agent', position: { x: 500, y: 0 }, data: { onSelect: () => nodes } },
  ];
  const edges = [{ source: 'leader', target: 'agent' }];
  assert.ok(floatingAnchorForSnapshot('leader', nodes, edges));
  return { nodes: new WeakRef(nodes), edges: new WeakRef(edges) };
}
const released = mountAndReleaseCanvas();
function cacheAndExpireWorkspace() {
  const snapshot = { workspace: { id: 'expired' }, nodes: [{ payload: { content: 'old workspace' } }], edges: [], floors: [] };
  writeWorkspaceViewCache(snapshot);
  const now = Date.now;
  try {
    Date.now = () => now() + 61_000;
    assert.equal(readWorkspaceViewCache('expired'), null);
  } finally { Date.now = now; }
  return new WeakRef(snapshot);
}
const expired = cacheAndExpireWorkspace();
for (let cycle = 0; cycle < 12; cycle++) { await setImmediate(); globalThis.gc(); }
await setImmediate();
assert.equal(released.nodes.deref(), undefined, 'Anchor cache retains a closed Canvas and its callback closures');
assert.equal(released.edges.deref(), undefined, 'Anchor cache retains a closed Canvas edge graph');
assert.equal(expired.deref(), undefined, 'Workspace cache retains an expired snapshot');
console.log(JSON.stringify({ closedCanvasCollection: 'passed', callbacksAndGraphReleased: true, expiredWorkspaceReleased: true }));
