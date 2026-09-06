import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { ApplyDesignOperationsDto, ReviewDesignDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import { designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designReviewService } from '$lib/modules/agent-room/application/services/DesignReviewService.js';
import { designExplorationService } from '$lib/modules/agent-room/application/services/DesignExplorationService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { CreateDesignExplorationDto } from '$lib/modules/agent-room/application/dto/CreateDesignExplorationDto.js';
import { createDesignExplorationSchema } from '$lib/modules/agent-room/contracts/schemas/create-design-exploration.schema.js';
import { designOperationSchema } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';

const directories: string[] = [];

describe('DesignReviewService', () => {
  useSvelarTest({ refreshDatabase: true });

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it('requires a real concept and records human approval for the exact revision', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orkestrai-design-review-'));
    directories.push(directory);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Visual review', workingDir: directory });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'design',
      title: 'Concept A',
      payload: {
        workflowKind: 'design-exploration',
        explorationWork: { phase: 'active', taskId: null, lastProgressAt: new Date().toISOString() },
        visualReview: { status: 'pending', revision: null, note: '', reviewedAt: null },
      },
    });
    const initial = await designDocumentService.get(workspace.id, node.id);
    await expect(designReviewService.review(new ReviewDesignDto(workspace.id, node.id, 'approved', 1, '')))
      .rejects.toThrow('design_review_revision_changed');

    const operations = Array.from({ length: 10 }, (_, index) => designOperationSchema.parse({
      kind: 'create',
      element: {
        pageId: initial.activePageId,
        parentId: null,
        type: index === 0 ? 'frame' : 'rectangle',
        name: index === 0 ? 'Desktop concept' : `Concept block ${index}`,
        x: index * 20,
        y: index * 20,
        width: index === 0 ? 1440 : 160,
        height: index === 0 ? 900 : 80,
      },
    }));
    const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
      workspace.id,
      node.id,
      initial.revision,
      operations,
      { kind: 'agent', id: 'designer', name: 'Designer', taskId: null },
      'Create visual concept',
    ));
    await expect(designReviewService.review(new ReviewDesignDto(
      workspace.id,
      node.id,
      'approved',
      document.revision,
      'Too early.',
    ))).rejects.toThrow('design_review_work_active');
    const currentNode = await workspaceRepository.getNode(node.id);
    await workspaceRepository.updateNode(node.id, {
      payload: {
        ...(currentNode?.payload as Record<string, unknown>),
        explorationWork: {
          ...((currentNode?.payload as { explorationWork?: Record<string, unknown> })?.explorationWork ?? {}),
          phase: 'ready_for_review',
        },
      },
    });
    const result = await designReviewService.review(new ReviewDesignDto(
      workspace.id,
      node.id,
      'approved',
      document.revision,
      'Clear hierarchy and useful mobile direction.',
    ));

    expect(result.visualReview).toMatchObject({ status: 'approved', revision: document.revision });
    expect((await workspaceRepository.getNode(node.id))?.payload).toMatchObject({
      explorationWork: { phase: 'approved' },
      visualReview: { status: 'approved', revision: document.revision },
    });

    const commented = await designDocumentService.apply(new ApplyDesignOperationsDto(
      workspace.id,
      node.id,
      document.revision,
      [designOperationSchema.parse({
        kind: 'add-design-comment',
        comment: {
          id: uuidv7(),
          pageId: document.activePageId,
          elementId: null,
          x: 40,
          y: 40,
          status: 'open',
          messages: [{
            id: uuidv7(),
            author: { kind: 'agent', id: 'reviewer', name: 'Reviewer', color: '#2563eb' },
            body: 'Approval acknowledged.',
            mentions: [],
            createdAt: new Date().toISOString(),
          }],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          resolvedAt: null,
          resolvedBy: null,
        },
      })],
      { kind: 'agent', id: 'reviewer', name: 'Reviewer', taskId: null },
      'Record review acknowledgement',
    ));
    expect((await workspaceRepository.getNode(node.id))?.payload).toMatchObject({
      visualReview: { status: 'approved', revision: commented.revision },
    });
  });

  it('preserves review metadata written while a design revision is being persisted', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orkestrai-design-review-race-'));
    directories.push(directory);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Concurrent visual review', workingDir: directory });
    const node = await workspaceRepository.createNode({
      workspaceId: workspace.id,
      type: 'design',
      title: 'Concept A',
      payload: {
        workflowKind: 'design-exploration',
        explorationWork: { phase: 'active', taskId: 'task-a', lastProgressAt: new Date().toISOString() },
        visualReview: { status: 'pending', revision: null, note: '', reviewedAt: null },
      },
    });
    const initial = await designDocumentService.get(workspace.id, node.id);
    const originalGetNode = workspaceRepository.getNode.bind(workspaceRepository);
    let getNodeCalls = 0;
    const getNodeSpy = vi.spyOn(workspaceRepository, 'getNode').mockImplementation(async (id) => {
      const current = await originalGetNode(id);
      getNodeCalls += 1;
      if (getNodeCalls === 3 && current) {
        return {
          ...current,
          payload: {
            ...(current.payload as Record<string, unknown>),
            deliveryTarget: true,
            visualReview: { status: 'changes_requested', revision: 0, note: 'Keep this review.', reviewedAt: new Date().toISOString() },
          },
        };
      }
      return current;
    });

    try {
      await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspace.id,
        node.id,
        initial.revision,
        [designOperationSchema.parse({
          kind: 'create',
          element: {
            pageId: initial.activePageId,
            parentId: null,
            type: 'frame',
            name: 'Desktop concept',
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
          },
        })],
        { kind: 'agent', id: 'designer', name: 'Designer', taskId: 'task-a' },
        'Persist a concurrent concept revision',
      ));
    } finally {
      getNodeSpy.mockRestore();
    }

    expect((await workspaceRepository.getNode(node.id))?.payload).toMatchObject({
      deliveryTarget: true,
      visualReview: { status: 'changes_requested', note: 'Keep this review.' },
      explorationWork: { phase: 'active', revision: 1 },
    });
  });

  it('records the selected direction and refuses to close incomplete delivery stages', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orkestrai-design-delivery-gate-'));
    directories.push(directory);
    const workspace = await workspaceRepository.createWorkspace({ name: 'Todo design delivery', workingDir: directory });
    const exploration = await designExplorationService.create(workspace.id, CreateDesignExplorationDto.from(createDesignExplorationSchema.parse({
      title: 'Todo app',
      objective: 'Design and implement a complete responsive todo application.',
      audience: 'People organizing personal and team tasks',
      platform: 'responsive-web',
      codeTarget: 'svelar',
      constraints: 'Deliver a brand board, tokens, components, prototype, and applied code.',
      references: 'A focused task list with add, complete, filter, and edit flows.',
      includeDarkMode: true,
      executionMode: 'manual',
      locale: 'en',
    })));
    const selected = exploration.designNodes[0];
    const initial = await designDocumentService.get(workspace.id, selected.id);
    const elements = Array.from({ length: 10 }, (_, index) => designOperationSchema.parse({
      kind: 'create',
      element: {
        pageId: initial.activePageId,
        parentId: null,
        type: index === 0 ? 'frame' : 'rectangle',
        name: index === 0 ? 'Desktop / Todo list' : `Concept block ${index}`,
        x: index * 20,
        y: index * 20,
        width: index === 0 ? 1440 : 160,
        height: index === 0 ? 900 : 80,
      },
    }));
    const concept = await designDocumentService.apply(new ApplyDesignOperationsDto(
      workspace.id,
      selected.id,
      initial.revision,
      elements,
      { kind: 'agent', id: 'designer', name: 'Designer', taskId: null },
      'Create Todo concept',
    ));

    const activeNode = await workspaceRepository.getNode(selected.id);
    await workspaceRepository.updateNode(selected.id, {
      payload: {
        ...(activeNode?.payload as Record<string, unknown>),
        explorationWork: {
          ...((activeNode?.payload as { explorationWork?: Record<string, unknown> })?.explorationWork ?? {}),
          phase: 'ready_for_review',
        },
      },
    });

    await designReviewService.review(new ReviewDesignDto(workspace.id, selected.id, 'approved', concept.revision, 'Approved concept.'));
    const nodes = await workspaceRepository.listNodes(workspace.id);
    const group = nodes.find((node) => node.type === 'group');
    expect(group?.payload).toMatchObject({ selectedDesignNodeId: selected.id, executionMode: 'manual' });
    expect((nodes.find((node) => node.id === selected.id)?.payload as { deliveryTarget?: boolean }).deliveryTarget).toBe(true);
    expect(nodes.filter((node) => node.type === 'design' && node.id !== selected.id).every((node) => !(node.payload as { deliveryTarget?: boolean }).deliveryTarget)).toBe(true);

    const expansionTask = (await taskBoardService.list(workspace.id)).find((task) => task.title.startsWith('4.'))!;
    const reviewTask = (await taskBoardService.list(workspace.id)).find((task) => task.title.startsWith('3.'))!;
    expect(reviewTask.status).toBe('done');
    await expect(taskBoardService.update(workspace.id, expansionTask.id, { status: 'done' }))
      .rejects.toThrow('Design delivery is incomplete for expand');
  });
});
