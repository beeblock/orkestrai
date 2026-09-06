import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { CreateDesignExplorationDto } from '$lib/modules/agent-room/application/dto/CreateDesignExplorationDto.js';
import { designExplorationService } from '$lib/modules/agent-room/application/services/DesignExplorationService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { createDesignExplorationSchema } from '$lib/modules/agent-room/contracts/schemas/create-design-exploration.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

function exploration(overrides: Record<string, unknown> = {}) {
  return CreateDesignExplorationDto.from(createDesignExplorationSchema.parse({
    title: 'Three checkout directions',
    objective: 'Design and implement three complete checkout directions.',
    audience: 'Mobile and desktop customers',
    platform: 'responsive-web',
    codeTarget: 'svelar',
    constraints: 'Reuse the current component library.',
    references: 'Existing checkout flow.',
    includeDarkMode: true,
    executionMode: 'manual',
    locale: 'en',
    ...overrides,
  }));
}

describe('DesignExplorationService', () => {
  useSvelarTest({ refreshDatabase: true });

  it('creates one staged package with a spec, three concepts, visual review and linked tasks', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Exploration', workingDir: '/tmp' });
    const terminal = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Designer',
      payload: { provider: 'codex' },
    });

    const result = await designExplorationService.create(workspace.id, exploration());
    const nodes = await workspaceRepository.listNodes(workspace.id);
    const tasks = await taskBoardService.list(workspace.id);

    expect(result.designNodes).toHaveLength(3);
    expect(result.taskIds).toHaveLength(8);
    expect(result.tasksNodeCreated).toBe(true);
    expect(result.dispatched).toBe(false);
    expect(nodes.filter((node) => node.type === 'design').map((node) => node.title)).toEqual([
      'UI A - Clarity',
      'UI B - Expressive',
      'UI C - Efficient',
    ]);
    expect(tasks).toHaveLength(8);
    expect(tasks.every((task) => task.noteId === result.note.id)).toBe(true);
    expect(tasks.filter((task) => task.title.startsWith('2')).every((task) => task.description?.includes('orkestrai:design-node='))).toBe(true);
    expect(tasks.find((task) => task.title.startsWith('3.'))?.description).toContain('orkestrai:design-review=');
    expect(String((result.note.payload as { content?: string }).content)).toContain('Required output for every direction');
    expect(result.edges.some((edge) => edge.sourceNodeId === result.note.id && edge.targetNodeId === terminal.id)).toBe(true);
    expect((result.group.payload as { workflowKind?: string }).workflowKind).toBe('design-exploration');
    expect(result.designNodes.every((node) => (node.payload as { visualReview?: { status?: string } }).visualReview?.status === 'pending')).toBe(true);
  });

  it('delegates only when the selected leader has a live PTY session', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Delegated exploration', workingDir: '/tmp' });
    const inactive = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Inactive leader',
      payload: { provider: 'claude', maestro: true, sessionId: 'missing' },
    });
    await expect(designExplorationService.create(workspace.id, exploration({
      executionMode: 'leader',
      leaderNodeId: inactive.id,
    }))).rejects.toThrow('leader_inactive');
    expect((await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'design')).toHaveLength(0);

    // Raw mode mirrors agent TUIs and avoids the macOS canonical TTY line limit.
    const session = ptySessionManager.create({
      command: '/bin/sh',
      args: ['-c', 'stty raw -echo; cat'],
      cwd: '/tmp',
      provider: 'claude',
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    await workspaceRepository.updateNode(inactive.id, {
      payload: { provider: 'claude', maestro: true, sessionId: session.id },
    });
    const delegated = await designExplorationService.create(workspace.id, exploration({
      executionMode: 'leader',
      leaderNodeId: inactive.id,
    }));
    expect(delegated.dispatched).toBe(true);
    expect((await taskBoardService.list(workspace.id))[0]).toMatchObject({
      assigneeNodeId: inactive.id,
      status: 'doing',
      noteId: delegated.note.id,
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const attached = ptySessionManager.attach(session.id, () => {});
    attached.detach();
    expect(attached.scrollback).toContain('Required output for every direction');
    expect(attached.scrollback).toContain('Three checkout directions');
    ptySessionManager.kill(session.id);
  });

  it('removes the complete exploration package when its initial dispatch fails', async () => {
    const workspace = await workspaceRepository.createWorkspace({ name: 'Atomic exploration', workingDir: '/tmp' });
    const session = ptySessionManager.create({ command: '/bin/cat', cwd: '/tmp' });
    const leader = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'terminal',
      title: 'Leader',
      payload: { provider: 'codex', maestro: true, sessionId: session.id },
    });
    const update = vi.spyOn(taskBoardService, 'update').mockRejectedValueOnce(new Error('delivery_failed'));

    await expect(designExplorationService.create(workspace.id, exploration({
      executionMode: 'leader',
      leaderNodeId: leader.id,
    }))).rejects.toThrow('delivery_failed');

    update.mockRestore();
    expect((await workspaceRepository.listNodes(workspace.id)).map((node) => node.id)).toEqual([leader.id]);
    expect(await taskBoardService.list(workspace.id)).toEqual([]);
    expect(await workspaceRepository.listEdges(workspace.id)).toEqual([]);
    ptySessionManager.kill(session.id);
  });
});
