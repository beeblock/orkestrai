import { describe, expect, it } from 'vitest';
import { computeNoteStacks, hiddenStackedNotes } from '../../src/lib/components/agent-room/canvas/note-stacks.js';

const nodes = [
  { id: 'agent', type: 'terminal' },
  { id: 'other', type: 'terminal' },
  { id: 'n1', type: 'note' },
  { id: 'n2', type: 'note' },
  { id: 'n3', type: 'note' },
  { id: 'shared', type: 'note' },
  { id: 'solo', type: 'note' },
  { id: 'portal', type: 'portal' },
  { id: 'p1', type: 'note' },
  { id: 'p2', type: 'note' },
];

describe('note stacks', () => {
  it('stacks notes whose only link is one agent, newest last', () => {
    const edges = [
      { source: 'agent', target: 'n1' },
      { source: 'n2', target: 'agent' },
      { source: 'agent', target: 'n3' },
      { source: 'agent', target: 'shared' },
      { source: 'other', target: 'shared' },
      { source: 'other', target: 'solo' },
      { source: 'portal', target: 'p1' },
      { source: 'portal', target: 'p2' },
    ];
    expect(computeNoteStacks(nodes, edges)).toEqual([{ agentId: 'agent', noteIds: ['n1', 'n2', 'n3'] }]);
  });

  it('counts a repeated edge as one link and hides all but the newest note', () => {
    const edges = [
      { source: 'agent', target: 'n1' },
      { source: 'n1', target: 'agent' },
      { source: 'agent', target: 'n2' },
    ];
    const stacks = computeNoteStacks(nodes, edges);
    expect(stacks).toEqual([{ agentId: 'agent', noteIds: ['n1', 'n2'] }]);
    expect([...hiddenStackedNotes(stacks, new Set())]).toEqual(['n1']);
    expect(hiddenStackedNotes(stacks, new Set(['agent'])).size).toBe(0);
  });
});
