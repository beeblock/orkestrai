import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { workstreamService } from '$lib/modules/agent-room/application/services/WorkstreamService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { controlCenterService } from '$lib/modules/agent-room/application/services/ControlCenterService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { AgentFloor } from '$lib/modules/agent-room/domain/models/AgentFloor.js';
import { AgentReview } from '$lib/modules/agent-room/domain/models/AgentReview.js';

describe('WorkstreamService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('projects task, assignee, floor, review, activity, and evidence into one workstream', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Delivery', workingDir: '/tmp' });
    const floor = await AgentFloor.create({
      id: uuidv7(),
      workspace_id: workspace.id,
      name: 'API hardening',
      branch: 'orkestrai/api-hardening',
      path: '/tmp/api-hardening',
      status: 'active',
    });
    const agent = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      floorId: String(floor.getAttribute('id')),
      type: 'terminal',
      title: 'API Engineer',
      payload: { provider: 'codex' },
    });
    const board = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'tasks', title: 'Delivery board' });
    const task = await taskBoardService.create(workspace.id, {
      title: 'Harden API authentication',
      description: 'Add regression coverage and review the delivery.',
      assigneeNodeId: agent.id,
      createdBy: 'automation',
      dispatch: false,
    });
    const now = new Date().toISOString();
    await AgentReview.create({
      id: uuidv7(),
      workspace_id: workspace.id,
      task_id: task.id,
      assignee_node_id: agent.id,
      title: 'Authentication review',
      summary: null,
      status: 'changes_requested',
      revision: 'abc123',
      selected_paths_json: JSON.stringify(['src/auth.ts']),
      evidence_json: JSON.stringify(['Focused tests pass']),
      tests_json: JSON.stringify(['npm test']),
      risks_json: JSON.stringify(['Token rotation']),
      decision_note: null,
      decided_at: now,
      created_at: now,
      updated_at: now,
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'system:review_changes_requested',
      taskId: task.id,
      category: 'review',
      verb: 'requested',
      objectType: 'review',
      objectTitle: 'Authentication review',
      correlationId: `task:${task.id}`,
    });

    const snapshot = await workstreamService.snapshot(workspace.id);

    expect(snapshot.taskBoardNodeId).toBe(board.id);
    expect(snapshot.counts.blocked).toBe(1);
    expect(snapshot.workstreams[0]).toMatchObject({
      id: task.id,
      title: 'Harden API authentication',
      stage: 'blocked',
      assigneeTitle: 'API Engineer',
      floor: { name: 'API hardening', branch: 'orkestrai/api-hardening' },
      reviews: [{ title: 'Authentication review', evidenceCount: 1, testCount: 1, riskCount: 1 }],
    });
    expect(snapshot.workstreams[0].timeline).toHaveLength(1);
    expect(snapshot.workstreams[0].git.paths).toEqual(['src/auth.ts']);
  });

  it('reports decisions and reviews that are not linked to a Kanban task', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Unlinked', workingDir: '/tmp' });
    const now = new Date().toISOString();
    await AgentReview.create({
      id: uuidv7(), workspace_id: workspace.id, task_id: null, assignee_node_id: null,
      title: 'Loose review', summary: null, status: 'pending', revision: 'head',
      selected_paths_json: '[]', evidence_json: '[]', tests_json: '[]', risks_json: '[]',
      decision_note: null, decided_at: null, created_at: now, updated_at: now,
    });

    const snapshot = await workstreamService.snapshot(workspace.id);
    expect(snapshot.workstreams).toEqual([]);
    expect(snapshot.unlinked.reviews).toBe(1);
  });

  it('returns a blocked workstream to active when its terminal resumes', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Recovered delivery', workingDir: '/tmp' });
    const agent = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Delivery lead',
      payload: { provider: 'codex' },
    });
    const task = await taskBoardService.create(workspace.id, {
      title: 'Validate installed build',
      assigneeNodeId: agent.id,
      createdBy: 'automation',
      dispatch: false,
    });
    await controlCenterService.recordActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'blocked',
      action: 'Waiting for the installed app to close',
      taskId: task.id,
    });
    expect((await workstreamService.snapshot(workspace.id)).workstreams[0].stage).toBe('blocked');

    await controlCenterService.recordLifecycleActivity({
      workspaceId: workspace.id,
      nodeId: agent.id,
      state: 'starting',
      action: 'system:pty_resumed',
    });

    const snapshot = await workstreamService.snapshot(workspace.id);
    expect(snapshot.workstreams[0].stage).toBe('active');
    expect(snapshot.workstreams[0].timeline.at(-1)).toMatchObject({
      state: 'starting',
      taskId: task.id,
    });
  });
});
