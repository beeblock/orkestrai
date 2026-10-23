import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod/v3';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { taskHandoffService } from '$lib/modules/agent-room/application/services/TaskHandoffService.js';
import {
  taskHandoffSchema,
  createBoardTaskSchema,
  updateBoardTaskSchema,
} from '$lib/modules/agent-room/contracts/schemas/taskSchemas.js';
import { workspaceAttachmentSchema } from '$lib/modules/agent-room/contracts/schemas/workspaceAttachmentSchemas.js';

function requestOf(schema: unknown) {
  return class extends FormRequest {
    rules() {
      return schema;
    }
    authorize() {
      return true;
    }
  };
}

export class TaskBoardController extends Controller {
  async listTasks(event: any) {
    return this.json({ data: await taskBoardService.list(event.params.id) });
  }

  /** The owner passes an agent's open task to another agent, with a brief. */
  async handoffTask(event: any) {
    try {
      const input = await (requestOf(taskHandoffSchema)).validate(event);
      return this.json({ data: await taskHandoffService.handoff(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao passar a tarefa.');
    }
  }

  async createTask(event: any) {
    try {
      const input = await (requestOf(createBoardTaskSchema)).validate(event);
      return this.json(
        {
          data: await taskBoardService.create(event.params.id, {
            title: input.title,
            description: input.description ?? null,
            images: input.images ?? [],
            attachments: input.attachments ?? [],
            assigneeNodeId: input.assigneeNodeId ?? null,
            noteId: input.noteId ?? null,
            createdBy: input.createdBy ?? 'user',
            status: input.status,
          }),
        },
        201
      );
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar tarefa.');
    }
  }

  async updateTask(event: any) {
    try {
      const input = await (requestOf(updateBoardTaskSchema)).validate(event);
      return this.json({
        data: await taskBoardService.update(event.params.id, event.params.taskId, {
          title: input.title,
          description: input.description,
          status: input.status,
          assigneeNodeId: input.assigneeNodeId,
          imagePath: input.imagePath,
          noteId: input.noteId,
        }),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar tarefa.');
    }
  }

  async removeTask(event: any) {
    try {
      await taskBoardService.remove(event.params.id, event.params.taskId);
      return this.json({ data: { deleted: true } });
    } catch (error) {
      return this.errorResponse(error, 'Tarefa nao encontrada.', 404);
    }
  }

  /** Anexa imagem de referencia: { path } (arquivo ja gravado via fs/write-binary). */
  async attachImage(event: any) {
    try {
      const input = z.object({ path: z.string().trim().min(1, 'Informe o path da imagem.') }).parse(await event.request.json());
      return this.json({ data: await taskBoardService.attachImage(event.params.id, event.params.taskId, input.path) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao anexar imagem.');
    }
  }

  /** Remove imagem: ?path=... */
  async detachImage(event: any) {
    try {
      const path = String(event.url.searchParams.get('path') ?? '');
      if (!path) return this.errorResponse(new Error('Informe ?path='), 'Informe o path da imagem.', 422);
      return this.json({ data: await taskBoardService.detachImage(event.params.id, event.params.taskId, path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover imagem.');
    }
  }

  async attachAttachment(event: any) {
    try {
      const input = z.object({ attachment: workspaceAttachmentSchema }).parse(await event.request.json());
      return this.json({
        data: await taskBoardService.attachAttachment(event.params.id, event.params.taskId, input.attachment),
      }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao anexar item.');
    }
  }

  async detachAttachment(event: any) {
    try {
      const attachmentId = z.string().uuid().parse(event.url.searchParams.get('attachmentId'));
      return this.json({
        data: await taskBoardService.detachAttachment(event.params.id, event.params.taskId, attachmentId),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover anexo.');
    }
  }

  /** Historico: concluidas + arquivadas, da mais recente para a mais antiga. */
  async historyTasks(event: any) {
    return this.json({ data: await taskBoardService.history(event.params.id) });
  }

  /** Arquiva uma tarefa concluida (sai do quadro, fica no historico). */
  async archiveTask(event: any) {
    try {
      return this.json({ data: await taskBoardService.archive(event.params.id, event.params.taskId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao arquivar tarefa.');
    }
  }

  /** Arquiva TODAS as concluidas do quadro de uma vez. */
  async archiveDoneTasks(event: any) {
    return this.json({ data: await taskBoardService.archiveDone(event.params.id) });
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
