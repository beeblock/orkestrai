import { describe, expect, it } from 'vitest';
import { handoffDescription, pickHandoffTask } from '$lib/modules/agent-room/application/services/TaskHandoffService.js';
import type { BoardTask } from '$lib/modules/agent-room/application/services/TaskBoardService.js';

function task(partial: Partial<BoardTask>): BoardTask {
  return {
    id: partial.id ?? 't', workspaceId: 'w', title: partial.title ?? 'Task', description: partial.description ?? null,
    status: partial.status ?? 'todo', assigneeNodeId: partial.assigneeNodeId ?? null, assigneeTitle: null, imagePath: null,
    images: [], attachments: [], createdBy: 'owner', createdAt: '2026-10-18T00:00:00Z', updatedAt: partial.updatedAt ?? '2026-10-18T00:00:00Z',
    archivedAt: partial.archivedAt ?? null,
  } as BoardTask;
}

describe('task handoff', () => {
  it('passes the open task the agent is doing, newest first', () => {
    const tasks = [
      task({ id: 'done', assigneeNodeId: 'a', status: 'done', updatedAt: '2026-10-18T05:00:00Z' }),
      task({ id: 'todo', assigneeNodeId: 'a', status: 'todo', updatedAt: '2026-10-18T04:00:00Z' }),
      task({ id: 'doing-old', assigneeNodeId: 'a', status: 'doing', updatedAt: '2026-10-18T01:00:00Z' }),
      task({ id: 'doing-new', assigneeNodeId: 'a', status: 'doing', updatedAt: '2026-10-18T03:00:00Z' }),
      task({ id: 'other', assigneeNodeId: 'b', status: 'doing', updatedAt: '2026-10-18T06:00:00Z' }),
    ];
    expect(pickHandoffTask(tasks, 'a')?.id).toBe('doing-new');
    expect(pickHandoffTask(tasks.filter((item) => item.status !== 'doing'), 'a')?.id).toBe('todo');
    expect(pickHandoffTask(tasks, 'nobody')).toBeNull();
  });

  it('appends the brief after the existing description', () => {
    expect(handoffDescription(task({ description: 'Build the form.' }), 'Codex Lider', 'Keep the tests green')).toBe('Build the form.\n\n---\nHandoff from Codex Lider.\nOwner note: Keep the tests green');
    expect(handoffDescription(task({}), 'Ada', null)).toBe('Handoff from Ada.');
  });
});
