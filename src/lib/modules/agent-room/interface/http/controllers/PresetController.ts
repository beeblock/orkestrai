import { Controller } from '@beeblock/svelar/routing';
import { z } from 'zod';
import { presetService } from '$lib/modules/agent-room/application/services/PresetService.js';
import { normalizePresetLocale } from '$lib/modules/agent-room/application/catalogs/BuiltinPresetCatalog.js';
import { ApplyPresetRequest } from '$lib/modules/agent-room/interface/http/requests/PresetRequests.js';

const createPresetSchema = z.object({
  workspaceId: z.string().trim().min(1, 'Informe o workspace.'),
  name: z.string().trim().min(1, 'Informe o nome do preset.'),
  icon: z.string().trim().nullish(),
  description: z.string().trim().nullish(),
});

const publishTeamPackSchema = z.object({
  version: z.string().trim().min(5).max(40),
  releaseNotes: z.string().trim().max(8_000).nullish(),
  minimumOrkestraiVersion: z.string().trim().max(40).nullish(),
});

/** Presets de equipe (templates de workspace) — globais, nao por workspace. */
export class PresetController extends Controller {
  async list(event: any) {
    const url = new URL(event.request.url);
    return this.json({
      data: await presetService.list({
        includeBuiltin: url.searchParams.get('scope') === 'all',
        locale: normalizePresetLocale(url.searchParams.get('locale')),
      }),
    });
  }

  async create(event: any) {
    try {
      const input = createPresetSchema.parse(await event.request.json());
      return this.json({ data: await presetService.createFromWorkspace(input.workspaceId, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar preset.');
    }
  }

  async remove(event: any) {
    await presetService.remove(event.params.id);
    return this.json({ data: { deleted: true } });
  }

  async exportPack(event: any) {
    try {
      const url = new URL(event.request.url);
      return this.json({ data: await presetService.exportPack(event.params.id, normalizePresetLocale(url.searchParams.get('locale'))) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao exportar Team Pack.');
    }
  }

  async importPack(event: any) {
    try {
      const declaredSize = Number(event.request.headers.get('content-length') ?? 0);
      if (Number.isFinite(declaredSize) && declaredSize > 5 * 1024 * 1024) throw new Error('Team Pack excede o limite de 5 MB.');
      const source = await event.request.text();
      if (Buffer.byteLength(source) > 5 * 1024 * 1024) throw new Error('Team Pack excede o limite de 5 MB.');
      return this.json({ data: await presetService.importPack(JSON.parse(source)) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao importar Team Pack.');
    }
  }

  async revisions(event: any) {
    try {
      return this.json({ data: await presetService.revisions(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao carregar versoes do Team Pack.');
    }
  }

  async publish(event: any) {
    try {
      return this.json({ data: await presetService.publish(event.params.id, publishTeamPackSchema.parse(await event.request.json())) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao publicar a versao do Team Pack.');
    }
  }

  /** Edita metadados (nome/icone/descricao). */
  async update(event: any) {
    try {
      const input = z.object({
        name: z.string().trim().optional(),
        icon: z.string().trim().nullish(),
        description: z.string().trim().nullish(),
      }).parse(await event.request.json());
      return this.json({ data: await presetService.updateMeta(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar preset.');
    }
  }

  /** Aplica: { workspaceId } (merge) ou { name, workingDir } (novo workspace). */
  async apply(event: any) {
    try {
      const input = await ApplyPresetRequest.validate(event);
      if (input.workspaceId) {
        return this.json({ data: await presetService.apply(event.params.id, { workspaceId: input.workspaceId, locale: input.locale }) });
      }
      if (!input.name?.trim() || !input.workingDir?.trim()) {
        throw new Error('Informe workspaceId (aplicar aqui) ou name+workingDir (novo workspace).');
      }
      return this.json({
        data: await presetService.apply(event.params.id, {
          name: input.name,
          workingDir: input.workingDir,
          runtimeKind: input.runtimeKind,
          wslDistribution: input.wslDistribution,
          wslWorkingDir: input.wslWorkingDir,
          groupId: input.groupId,
          locale: input.locale,
        }),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao aplicar preset.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
