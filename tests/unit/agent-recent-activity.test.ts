import { describe, expect, it } from 'vitest';
import { recentAgentActivity } from '../../src/lib/components/agent-room/chat/agent-recent-activity.js';
import type { AgentActivity } from '../../src/lib/modules/agent-room/domain/types.js';

const event = (id: string, nodeId: string, state: string, objectTitle: string | null = null) => ({ id, nodeId, state, objectTitle }) as unknown as AgentActivity;

describe('recentAgentActivity', () => {
  it('keeps the newest events of the agent, newest first', () => {
    // The Control Center snapshot lists activity newest first.
    const snapshot = [
      event('9', 'naming', 'idle'),
      event('8', 'naming', 'working'),
      event('7', 'other', 'working', 'Other task'),
      event('6', 'naming', 'working', 'Naming round 4'),
      ...Array.from({ length: 10 }, (_, index) => event(`old-${index}`, 'naming', 'working', `Round ${3 - Math.min(index, 2)}`)),
    ];
    const recent = recentAgentActivity(snapshot, 'naming');
    expect(recent[0].objectTitle).toBe('Naming round 4');
    expect(recent).toHaveLength(8);
    expect(recent.every((item) => item.nodeId === 'naming' && item.objectTitle)).toBe(true);
  });

  it('falls back to state changes when nothing else happened', () => {
    const snapshot = [event('2', 'naming', 'idle'), event('1', 'naming', 'working')];
    expect(recentAgentActivity(snapshot, 'naming').map((item) => item.id)).toEqual(['2', '1']);
    expect(recentAgentActivity([event('3', 'naming', 'blocked'), event('2', 'naming', 'idle')], 'naming').map((item) => item.id)).toEqual(['3']);
  });
});
