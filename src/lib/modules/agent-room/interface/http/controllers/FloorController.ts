import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod';
import {
  createFloorSchema,
  createRoutineSchema,
  hooksSchema,
  landFloorSchema,
  renameFloorSchema,
  routineEnabledSchema,
  updateRoutineSchema,
  runHooksSchema,
} from '$lib/modules/agent-room/contracts/schemas/floorSchemas.js';
import { floorService } from '$lib/modules/agent-room/application/services/FloorService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { routineService } from '$lib/modules/agent-room/application/services/RoutineService.js';
import { floorOverviewService } from '$lib/modules/agent-room/application/services/FloorOverviewService.js';







function requestOf(schema: z.ZodTypeAny) {
  return class extends FormRequest {
    rules() {
      return schema;
    }
    authorize(): boolean {
      return true;
    }
    passedValidation(data: unknown) {
      return schema.parse(data);
    }
  };
}

export class FloorController extends Controller {
  async listFloors(event: any) {
    return this.json({ data: await floorService.list(event.params.id) });
  }

  async floorOverview(event: any) {
    try {
      return this.json({ data: await floorOverviewService.get(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao carregar a visão dos andares.');
    }
  }

  async createFloor(event: any) {
    try {
      const input = await (requestOf(createFloorSchema)).validate(event);
      return this.json({ data: await floorService.create(event.params.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar andar.');
    }
  }

  async renameFloor(event: any) {
    try {
      await floorService.requireFloor(event.params.id, event.params.floorId);
      const input = await (requestOf(renameFloorSchema)).validate(event);
      return this.json({ data: await floorService.rename(event.params.floorId, input.name) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao renomear andar.');
    }
  }

  async landingPreview(event: any) {
    try {
      await floorService.requireFloor(event.params.id, event.params.floorId);
      const target = event.url.searchParams.get('target') ?? undefined;
      return this.json({ data: await floorService.landingPreview(event.params.floorId, target) });
    } catch (error) {
      return this.errorResponse(error, 'Falha no preview.');
    }
  }

  async landFloor(event: any) {
    try {
      await floorService.requireFloor(event.params.id, event.params.floorId);
      const input = await (requestOf(landFloorSchema)).validate(event);
      return this.json({ data: await floorService.land(event.params.floorId, input.targetBranch) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao aterrissar.');
    }
  }

  async removeFloor(event: any) {
    try {
      await floorService.requireFloor(event.params.id, event.params.floorId);
      const deleteBranch = event.url.searchParams.get('deleteBranch') === 'true';
      return this.json({ data: await floorService.remove(event.params.floorId, deleteBranch) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao excluir andar.');
    }
  }

  async getHooks(event: any) {
    return this.json({ data: await floorService.hooksFor(event.params.id) });
  }

  async saveHooks(event: any) {
    try {
      const input = await (requestOf(hooksSchema)).validate(event);
      return this.json({ data: await floorService.saveHooks(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao salvar hooks.');
    }
  }

  async runHooks(event: any) {
    try {
      const input = await (requestOf(runHooksSchema)).validate(event);
      const floor = await floorService.requireFloor(event.params.id, event.params.floorId);
      const workspace = await workspaceRepository.getWorkspace(floor.workspaceId);
      const kind = input.kind as 'setup' | 'run' | 'teardown';
      const commands = workspace?.hooks?.[kind] ?? [];
      return this.json({ data: await floorService.runHooks(floor, workspace!, commands) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao executar hooks.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}

export class RoutineController extends Controller {
  async listRoutines(event: any) {
    return this.json({ data: await routineService.list(event.params.id) });
  }

  async createRoutine(event: any) {
    try {
      const input = await (requestOf(createRoutineSchema)).validate(event);
      return this.json(
        {
          data: await routineService.create({
            workspaceId: event.params.id,
            targetNodeId: input.targetNodeId,
            prompt: input.prompt,
            intervalMinutes: input.intervalMinutes,
          }),
        },
        201
      );
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar rotina.');
    }
  }

  async updateRoutine(event: any) {
    try {
      const input = await (requestOf(updateRoutineSchema)).validate(event);
      const routine = await routineService.update(event.params.routineId, {
        targetNodeId: input.targetNodeId,
        prompt: input.prompt,
        intervalMinutes: input.intervalMinutes,
      });
      if (!routine) throw new Error('Rotina nao encontrada.');
      return this.json({ data: routine });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar rotina.');
    }
  }

  async setEnabled(event: any) {
    try {
      const input = await (requestOf(routineEnabledSchema)).validate(event);
      const routine = await routineService.setEnabled(event.params.routineId, input.enabled);
      if (!routine) throw new Error('Rotina nao encontrada.');
      return this.json({ data: routine });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar rotina.');
    }
  }

  async removeRoutine(event: any) {
    const removed = await routineService.remove(event.params.routineId);
    if (!removed) return this.json({ error: 'Rotina nao encontrada.' }, 404);
    return this.json({ data: { deleted: true } });
  }

  async runNow(event: any) {
    try {
      return this.json({ data: await routineService.runNow(event.params.routineId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao executar rotina.');
    }
  }

  async history(event: any) {
    return this.json({ data: await routineService.history(event.params.routineId) });
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
