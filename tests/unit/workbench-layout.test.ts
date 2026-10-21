import { describe, expect, it } from 'vitest';
import {
  activateWorkbenchNode,
  closeWorkbenchNode,
  closeWorkbenchPane,
  collapseWorkbenchLayout,
  createWorkbenchLayout,
  cycleWorkbenchNode,
  cycleWorkbenchPane,
  MAX_WORKBENCH_PANES,
  moveWorkbenchNode,
  normalizeWorkbenchLayout,
  normalizeWorkbenchTabPlacement,
  openWorkbenchNode,
  removeWorkbenchNode,
  splitWorkbenchPane,
  workbenchPanes,
} from '../../src/lib/components/agent-room/workbench-layout.js';

describe('workbench layout', () => {
  it('starts with one primary pane and one active item', () => {
    const layout = createWorkbenchLayout('leader');
    expect(layout.version).toBe(2);
    expect(layout.activePaneId).toBe('primary');
    expect(workbenchPanes(layout)).toEqual([{
      kind: 'pane',
      id: 'primary',
      nodeIds: ['leader'],
      activeNodeId: 'leader',
    }]);
  });

  it('reuses an existing tab instead of duplicating it', () => {
    let layout = createWorkbenchLayout('leader');
    layout = openWorkbenchNode(layout, 'tasks');
    layout = openWorkbenchNode(layout, 'leader');
    expect(workbenchPanes(layout)[0].nodeIds).toEqual(['leader', 'tasks']);
    expect(workbenchPanes(layout)[0].activeNodeId).toBe('leader');
  });

  it('opens unique nodes to the right and below', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('leader'), 'tasks');
    layout = openWorkbenchNode(layout, 'tasks', { toSide: true, direction: 'horizontal' });
    layout = openWorkbenchNode(layout, 'notes', { toSide: true, direction: 'vertical' });

    expect(layout.root).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      children: [
        { kind: 'pane', id: 'primary', nodeIds: ['leader'] },
        {
          kind: 'split',
          direction: 'vertical',
          children: [
            { kind: 'pane', id: 'secondary', nodeIds: ['tasks'] },
            { kind: 'pane', id: 'pane-3', nodeIds: ['notes'] },
          ],
        },
      ],
    });
    expect(layout.activePaneId).toBe('pane-3');
  });

  it('selects the adjacent tab after closing the active tab', () => {
    let layout = createWorkbenchLayout('leader');
    layout = openWorkbenchNode(layout, 'tasks');
    layout = openWorkbenchNode(layout, 'notes');
    layout = activateWorkbenchNode(layout, 'primary', 'tasks');
    layout = closeWorkbenchNode(layout, 'primary', 'tasks');
    expect(workbenchPanes(layout)[0]).toMatchObject({
      nodeIds: ['leader', 'notes'],
      activeNodeId: 'notes',
    });
  });

  it('merges open items into the adjacent pane when a pane closes', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('leader'), 'tasks', { toSide: true });
    layout = openWorkbenchNode(layout, 'notes');
    layout = closeWorkbenchPane(layout, 'secondary');
    expect(workbenchPanes(layout)).toHaveLength(1);
    expect(workbenchPanes(layout)[0].nodeIds).toEqual(['leader', 'tasks', 'notes']);
    expect(workbenchPanes(layout)[0].activeNodeId).toBe('notes');
  });

  it('collapses a nested layout into one pane without losing items', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('leader'), 'tasks', { toSide: true });
    layout = openWorkbenchNode(layout, 'notes', { toSide: true, direction: 'vertical' });
    layout = collapseWorkbenchLayout(layout);
    expect(workbenchPanes(layout)).toHaveLength(1);
    expect(workbenchPanes(layout)[0]).toMatchObject({
      id: 'primary',
      nodeIds: ['notes', 'leader', 'tasks'],
      activeNodeId: 'notes',
    });
  });

  it('migrates a v1 layout and removes stale or duplicated items', () => {
    const layout = normalizeWorkbenchLayout({
      version: 1,
      split: true,
      activePaneId: 'secondary',
      panes: [
        { id: 'primary', nodeIds: ['leader', 'missing'], activeNodeId: 'missing' },
        { id: 'secondary', nodeIds: ['leader', 'tasks'], activeNodeId: 'tasks' },
      ],
    }, ['leader', 'tasks']);
    expect(workbenchPanes(layout)[0]).toMatchObject({ nodeIds: ['leader'], activeNodeId: 'leader' });
    expect(workbenchPanes(layout)[1]).toMatchObject({ nodeIds: ['tasks'], activeNodeId: 'tasks' });
    expect(layout.activePaneId).toBe('secondary');
  });

  it('repairs a malformed v2 tree and limits restored panes', () => {
    const rawPanes = Array.from({ length: 12 }, (_, index) => ({
      kind: 'pane',
      id: `pane-${index}`,
      nodeIds: [`node-${index}`, 'shared'],
      activeNodeId: `node-${index}`,
    }));
    let root: any = rawPanes[0];
    for (const pane of rawPanes.slice(1)) {
      root = { kind: 'split', id: `split-${pane.id}`, direction: 'sideways', children: [root, pane] };
    }
    const layout = normalizeWorkbenchLayout(
      { version: 2, activePaneId: 'missing', root },
      [...rawPanes.map((_, index) => `node-${index}`), 'shared'],
    );
    expect(workbenchPanes(layout)).toHaveLength(MAX_WORKBENCH_PANES);
    expect(workbenchPanes(layout).flatMap((pane) => pane.nodeIds).filter((id) => id === 'shared')).toHaveLength(1);
    expect(workbenchPanes(layout).some((pane) => pane.id === layout.activePaneId)).toBe(true);
  });

  it('supports eight panes and refuses a ninth split', () => {
    let layout = createWorkbenchLayout('node-1');
    for (let index = 2; index <= MAX_WORKBENCH_PANES; index += 1) {
      layout = splitWorkbenchPane(
        layout,
        layout.activePaneId,
        index % 2 ? 'vertical' : 'horizontal',
        `node-${index}`,
      );
    }
    expect(workbenchPanes(layout)).toHaveLength(8);
    const unchanged = splitWorkbenchPane(layout, layout.activePaneId, 'horizontal', 'node-9');
    expect(unchanged).toBe(layout);
  });

  it('removes a deleted node and its otherwise empty pane', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('leader'), 'tasks', { toSide: true });
    layout = removeWorkbenchNode(layout, 'tasks');
    expect(workbenchPanes(layout)).toHaveLength(1);
    expect(workbenchPanes(layout)[0].nodeIds).toEqual(['leader']);
  });

  it('moves a tab between panes without duplicating it', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('leader'), 'tasks');
    layout = splitWorkbenchPane(layout, 'primary', 'horizontal', 'notes');
    const target = workbenchPanes(layout).find((pane) => pane.id !== 'primary')!;
    layout = moveWorkbenchNode(layout, 'tasks', target.id);

    expect(workbenchPanes(layout).find((pane) => pane.id === 'primary')?.nodeIds).toEqual(['leader']);
    expect(workbenchPanes(layout).find((pane) => pane.id === target.id)?.nodeIds).toEqual(['notes', 'tasks']);
    expect(workbenchPanes(layout).flatMap((pane) => pane.nodeIds).filter((id) => id === 'tasks')).toHaveLength(1);
  });

  it('cycles items and panes in both directions', () => {
    let layout = openWorkbenchNode(createWorkbenchLayout('note-1'), 'tasks');
    expect(cycleWorkbenchNode(layout, 1).root).toMatchObject({ activeNodeId: 'note-1' });
    layout = activateWorkbenchNode(layout, 'primary', 'note-1');
    expect(cycleWorkbenchNode(layout, -1).root).toMatchObject({ activeNodeId: 'tasks' });

    layout = openWorkbenchNode(layout, 'terminal', { toSide: true });
    expect(cycleWorkbenchPane(layout, 1).activePaneId).toBe('primary');
    expect(cycleWorkbenchPane(layout, -1).activePaneId).toBe('primary');
  });

  it('normalizes the tab placement preference', () => {
    expect(normalizeWorkbenchTabPlacement('horizontal')).toBe('horizontal');
    expect(normalizeWorkbenchTabPlacement('vertical')).toBe('vertical');
    expect(normalizeWorkbenchTabPlacement('other')).toBe('horizontal');
    expect(normalizeWorkbenchTabPlacement(undefined)).toBe('horizontal');
  });
});
