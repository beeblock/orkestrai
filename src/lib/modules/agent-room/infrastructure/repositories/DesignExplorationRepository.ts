import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type { CreateDesignExplorationDto } from '../../application/dto/CreateDesignExplorationDto.js';
import type { CanvasEdge, CanvasNode } from '../../domain/types.js';
import {
  DESIGN_EXPLORATION_DIRECTIONS,
  designExplorationBrief,
  designExplorationCopy,
  type DesignExplorationLayout,
} from '../../domain/design-exploration.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentCanvasEdge } from '../../domain/models/AgentCanvasEdge.js';
import { AgentCanvasNode } from '../../domain/models/AgentCanvasNode.js';
import { workspaceRepository } from './WorkspaceRepository.js';

export type PersistedDesignExploration = {
  id: string;
  group: CanvasNode;
  note: CanvasNode;
  tasksNode: CanvasNode;
  tasksNodeCreated: boolean;
  designNodes: CanvasNode[];
  taskIds: string[];
  edges: CanvasEdge[];
};

export class DesignExplorationRepository {
  async create(input: {
    workspaceId: string;
    data: CreateDesignExplorationDto;
    layout: DesignExplorationLayout;
    existingTasksNode: CanvasNode | null;
    terminals: CanvasNode[];
    leader: CanvasNode | null;
  }): Promise<PersistedDesignExploration> {
    return Connection.transaction(async () => {
      const explorationId = uuidv7();
      const localized = designExplorationCopy(input.data.locale);
      const note = await workspaceRepository.createNode({
        workspaceId: input.workspaceId,
        type: 'note',
        title: localized.noteTitle,
        ...input.layout.note,
        payload: { content: '', explorationId, workflowKind: 'design-exploration' },
      });
      const updatedNote = await workspaceRepository.updateNode(note.id, {
        payload: {
          content: designExplorationBrief(input.data, note.id),
          explorationId,
          workflowKind: 'design-exploration',
        },
      });
      if (!updatedNote) throw new Error('Could not create the exploration brief.');

      const tasksNode = input.existingTasksNode ?? await workspaceRepository.createNode({
        workspaceId: input.workspaceId,
        type: 'tasks',
        title: input.data.locale === 'pt-BR' ? 'Tarefas' : input.data.locale === 'es' ? 'Tareas' : 'Tasks',
        ...input.layout.tasks,
        payload: {},
      });

      const designNodes: CanvasNode[] = [];
      for (const [index, direction] of DESIGN_EXPLORATION_DIRECTIONS.entries()) {
        designNodes.push(await workspaceRepository.createNode({
          workspaceId: input.workspaceId,
          type: 'design',
          title: localized.directions[direction].title,
          ...input.layout.designs[index],
          payload: {
            schemaVersion: 1,
            workflowKind: 'design-exploration',
            explorationId,
            direction,
            intent: localized.directions[direction].intent,
            platform: input.data.platform,
            codeTarget: input.data.codeTarget,
            includeDarkMode: input.data.includeDarkMode,
            explorationWork: {
              phase: 'waiting',
              taskId: null,
              assigneeNodeId: null,
              startedAt: null,
              lastProgressAt: null,
            },
            visualReview: {
              status: 'pending',
              revision: null,
              note: '',
              reviewedAt: null,
            },
          },
        }));
      }

      const taskIds: string[] = [];
      const now = new Date().toISOString();
      for (const task of localized.tasks) {
        const taskId = uuidv7();
        taskIds.push(taskId);
        const designNode = task.direction
          ? designNodes[DESIGN_EXPLORATION_DIRECTIONS.indexOf(task.direction)]
          : null;
        const marker = designNode
          ? `<!-- orkestrai:design-node=${designNode.id} -->`
          : task.kind === 'review'
            ? `<!-- orkestrai:design-review=${explorationId} -->`
            : `<!-- orkestrai:design-stage=${task.kind};exploration=${explorationId} -->`;
        await AgentBoardTask.query().insert({
          id: taskId,
          workspace_id: input.workspaceId,
          title: task.title,
          description: `${task.description}\n\nSpec: ${note.id}\n\n${marker}`,
          status: 'todo',
          assignee_node_id: null,
          note_node_id: note.id,
          created_by: 'design-exploration',
          created_at: now,
          updated_at: now,
        });
      }

      const members = [note.id, ...designNodes.map((node) => node.id)];
      if (!input.existingTasksNode) members.splice(1, 0, tasksNode.id);
      const group = await workspaceRepository.createNode({
        workspaceId: input.workspaceId,
        type: 'group',
        title: localized.groupTitle,
        ...input.layout.group,
        zIndex: -1,
        payload: {
          members,
          workflowKind: 'design-exploration',
          explorationId,
          designNodeIds: designNodes.map((node) => node.id),
          taskIds,
          platform: input.data.platform,
          codeTarget: input.data.codeTarget,
          executionMode: input.data.executionMode,
        },
      });

      const edges: CanvasEdge[] = [];
      for (const terminal of input.terminals) {
        edges.push(await workspaceRepository.createEdge({
          workspaceId: input.workspaceId,
          sourceNodeId: note.id,
          targetNodeId: terminal.id,
        }));
      }
      if (input.leader) {
        for (const designNode of designNodes) {
          edges.push(await workspaceRepository.createEdge({
            workspaceId: input.workspaceId,
            sourceNodeId: input.leader.id,
            targetNodeId: designNode.id,
          }));
        }
      }

      return {
        id: explorationId,
        group,
        note: updatedNote,
        tasksNode,
        tasksNodeCreated: !input.existingTasksNode,
        designNodes,
        taskIds,
        edges,
      };
    });
  }

  /** Compensates a post-persistence dispatch failure as one atomic cleanup. */
  async remove(created: PersistedDesignExploration): Promise<void> {
    const nodeIds = [
      created.group.id,
      created.note.id,
      ...created.designNodes.map((node) => node.id),
      ...(created.tasksNodeCreated ? [created.tasksNode.id] : []),
    ];
    await Connection.transaction(async () => {
      await AgentBoardTask.query().whereIn('id', created.taskIds).delete();
      await AgentCanvasEdge.query().whereIn('id', created.edges.map((edge) => edge.id)).delete();
      await AgentCanvasNode.query().whereIn('id', nodeIds).delete();
    });
  }
}

export const designExplorationRepository = new DesignExplorationRepository();
