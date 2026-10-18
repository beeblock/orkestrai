import { taskBoardService, type BoardTask } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import type { TerminalNodePayload } from '$lib/modules/agent-room/domain/types.js';

export type HandoffInput = { fromNodeId: string; toNodeId: string; note?: string | null };
export type HandoffResult = { taskId: string; title: string; fromTitle: string; toTitle: string };

const MAX_BRIEF = 2_000;

/** Picks the task to hand over: the source's open task that moved most recently. */
export function pickHandoffTask(tasks: BoardTask[], fromNodeId: string): BoardTask | null {
  const open = tasks.filter((task) => task.assigneeNodeId === fromNodeId && task.status !== 'done' && !task.archivedAt);
  if (!open.length) return null;
  const doing = open.filter((task) => task.status === 'doing');
  const pool = doing.length ? doing : open;
  return [...pool].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Appends the handoff brief to the task description, kept within a bounded size. */
export function handoffDescription(task: BoardTask, fromTitle: string, note: string | null | undefined): string {
  const brief = [`Handoff from ${fromTitle}.`, note?.trim() ? `Owner note: ${note.trim()}` : null].filter(Boolean).join('\n');
  const base = task.description?.trim() ?? '';
  return `${base}${base ? '\n\n---\n' : ''}${brief}`.slice(-MAX_BRIEF * 4);
}

/**
 * "Pass this task to …": the task moves to the other agent (who receives it
 * through the normal dispatch, with the brief in the description) and the
 * previous agent is told to stop working on it.
 */
export class TaskHandoffService {
  async handoff(workspaceId: string, input: HandoffInput): Promise<HandoffResult> {
    if (input.fromNodeId === input.toNodeId) throw new Error('Escolha outro agente para receber a tarefa.');
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, false, true);
    const agent = (id: string) => nodes.find((node) => node.id === id && node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).provider));
    const from = agent(input.fromNodeId);
    const to = agent(input.toNodeId);
    if (!from || !to) throw new Error('Agente não encontrado neste workspace.');
    const task = pickHandoffTask(await taskBoardService.list(workspaceId), from.id);
    if (!task) throw new Error('Esse agente não tem tarefa em andamento para passar.');
    const fromTitle = from.title ?? 'Agent';
    const toTitle = to.title ?? 'Agent';
    await taskBoardService.update(workspaceId, task.id, {
      assigneeNodeId: to.id,
      description: handoffDescription(task, fromTitle, input.note),
    });
    await agentInboxService.enqueue({
      workspaceId,
      toNodeId: from.id,
      fromNodeId: null,
      kind: 'owner',
      content: `The owner handed the task "${task.title}" to ${toTitle}. Stop working on it, do not complete it, and share anything useful with ${toTitle} through orkestrai ask.`,
      dedupKey: `handoff:${task.id}:${to.id}`,
      metadata: { handoff: true, toNodeId: to.id },
      taskId: task.id,
    }).catch(() => undefined);
    return { taskId: task.id, title: task.title, fromTitle, toTitle };
  }
}

export const taskHandoffService = new TaskHandoffService();
