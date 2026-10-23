import { Controller } from '@beeblock/svelar/routing';
import { z } from 'zod/v3';
import { skillMarketService } from '$lib/modules/agent-room/application/services/SkillMarketService.js';

const installSchema = z.object({
  source: z.string().trim().min(3, 'Informe o source (owner/repo).'),
  skillId: z.string().trim().min(1, 'Informe o skillId.'),
});

/** Marketplace de skills do skills.sh (busca publica + instalar no workspace). */
export class SkillMarketController extends Controller {
  async search(event: any) {
    try {
      const query = String(event.url.searchParams.get('q') ?? '');
      const results = await skillMarketService.search(query);
      return this.json({ data: results });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao buscar skills.');
    }
  }

  async listInstalled(event: any) {
    try {
      const installed = await skillMarketService.listInstalled(event.params.id);
      return this.json({ data: installed });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar skills instaladas.');
    }
  }

  async install(event: any) {
    try {
      const input = installSchema.parse(await event.request.json());
      const installed = await skillMarketService.install(event.params.id, input);
      return this.json({ data: installed }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao instalar skill.');
    }
  }

  async uninstall(event: any) {
    try {
      const result = await skillMarketService.uninstall(event.params.id, event.params.skillId);
      return this.json({ data: result });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover skill.');
    }
  }
}
