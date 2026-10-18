import { describe, expect, it } from 'vitest';
import { canvasRectsOverlap } from '../../src/lib/modules/agent-room/domain/canvas-placement.js';
import { isTeamAgentNode, occupiedOnFloor, settleFloorAgents, shownOnFloor } from '../../src/lib/modules/agent-room/domain/canvas-floors.js';

const agent = (id: string, floorId: string | null, x: number, y: number, width = 500, height = 380) => ({
  id, type: 'terminal', floorId, x, y, width, height, payload: { provider: 'claude' },
});
const node = (id: string, type: string, floorId: string | null, x: number, y: number, width = 320, height = 220, payload: unknown = {}) => ({
  id, type, floorId, x, y, width, height, payload,
});

describe('canvas floors', () => {
  it('keeps every agent on the ground floor and floor nodes on their floor', () => {
    const floorAgent = agent('dev', 'floor-1', 0, 0);
    const floorNote = node('note', 'note', 'floor-1', 0, 0);
    const shell = { ...node('shell', 'terminal', 'floor-1', 0, 0), payload: { command: '/bin/sh' } };

    expect(isTeamAgentNode(floorAgent)).toBe(true);
    expect(isTeamAgentNode(shell)).toBe(false);
    expect(shownOnFloor(floorAgent, null)).toBe(true);
    expect(shownOnFloor(floorAgent, 'floor-1')).toBe(true);
    expect(shownOnFloor(floorAgent, 'floor-2')).toBe(false);
    expect(shownOnFloor(floorNote, null)).toBe(false);
    expect(shownOnFloor(shell, null)).toBe(false);
    expect(shownOnFloor(node('board', 'tasks', null, 0, 0), 'floor-1')).toBe(false);
    // A copy made by cloning the ground layout stays on its floor.
    const clone = { ...agent('clone', 'floor-1', 0, 0), payload: { provider: 'claude', floorCloneOfNodeId: 'dev-ground' } };
    expect(shownOnFloor(clone, null)).toBe(false);
    expect(shownOnFloor(clone, 'floor-1')).toBe(true);
    expect(settleFloorAgents([agent('leader', null, 0, 0), clone])).toEqual([]);
  });

  it('counts agents from other floors as occupied on the ground floor', () => {
    const nodes = [agent('dev', 'floor-1', 600, 0), node('note', 'note', 'floor-1', 0, 0), node('board', 'tasks', null, 0, 400)];
    expect(occupiedOnFloor(nodes, null)).toEqual([
      { x: 600, y: 0, width: 500, height: 380 },
      { x: 0, y: 400, width: 320, height: 220 },
    ]);
    expect(occupiedOnFloor(nodes, 'floor-1')).toHaveLength(2);
  });

  it('moves only the floor agents that cover a ground node, below the board', () => {
    const leader = agent('leader', null, -300, 0, 850, 730);
    const panel = node('panel', 'orchestrator', null, -280, 890, 380, 560);
    const covered = agent('product', 'floor-1', -230, 560);
    const free = agent('frontend', 'floor-2', 810, 560);
    const grouped = agent('grouped', 'floor-3', -200, 100);
    const frame = node('frame', 'group', null, -400, -100, 1600, 1600, { members: ['grouped'] });
    const nodes = [leader, panel, covered, free, grouped, frame];

    const moves = settleFloorAgents(nodes);

    expect(moves.map((move) => move.id)).toEqual(['product']);
    const moved = { ...covered, ...moves[0] };
    expect(moved.y).toBeGreaterThanOrEqual(panel.y + panel.height);
    for (const other of [leader, panel, free]) expect(canvasRectsOverlap(moved, other)).toBe(false);
    expect(settleFloorAgents(nodes.map((item) => (item.id === 'product' ? moved : item)))).toEqual([]);
  });

  it('lines several moved agents up without stacking them', () => {
    const leader = agent('leader', null, 0, 0, 900, 700);
    const first = agent('a', 'floor-1', 100, 100);
    const second = agent('b', 'floor-2', 100, 100);
    const moves = settleFloorAgents([leader, first, second]);
    expect(moves).toHaveLength(2);
    const [one, two] = moves.map((move, index) => ({ ...[first, second][index], ...move }));
    expect(canvasRectsOverlap(one, two)).toBe(false);
    expect(one.y).toBe(two.y);
  });
});
