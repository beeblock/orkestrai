import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { ChangeCodeGraphDto, CodeGraphContractDto, CodeGraphHandoffDto, CodeGraphQualityDto, IndexCodeGraphDto, OverviewCodeGraphDto, SearchCodeGraphDto, TraverseCodeGraphDto } from '../../../application/dto/CodeGraphDto.js';
import { indexCodeGraphAction } from '../../../application/actions/IndexCodeGraphAction.js';
import { codeGraphIndexService } from '../../../application/services/CodeGraphIndexService.js';
import { codeGraphChangeIntelligenceService } from '../../../application/services/CodeGraphChangeIntelligenceService.js';
import { codeGraphHandoffService } from '../../../application/services/CodeGraphHandoffService.js';
import { codeGraphContractService } from '../../../application/services/CodeGraphContractService.js';
import { codeGraphQualityService } from '../../../application/services/CodeGraphQualityService.js';
import { ChangeCodeGraphRequest, CodeGraphContractRequest, CodeGraphHandoffRequest, CodeGraphQualityRequest, IndexCodeGraphRequest, OverviewCodeGraphRequest, SearchCodeGraphRequest, TraverseCodeGraphRequest } from '../requests/CodeGraphRequests.js';

export class CodeGraphController extends Controller {
  async status(event: RequestEvent) {
    try {
      return this.json({ data: await codeGraphIndexService.status(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not load the code graph.');
    }
  }

  async index(event: RequestEvent) {
    try {
      const input = await IndexCodeGraphRequest.validate(event);
      const dto = IndexCodeGraphDto.from(event.params.id, input);
      return this.json({ data: await indexCodeGraphAction.execute(dto) });
    } catch (error) {
      return this.failure(error, 'Could not index the workspace code.');
    }
  }

  async search(event: RequestEvent) {
    try {
      const input = await SearchCodeGraphRequest.validate(event);
      const dto = SearchCodeGraphDto.from(event.params.id, input);
      return this.json({ data: await codeGraphIndexService.search(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not search the code graph.');
    }
  }

  async symbol(event: RequestEvent) {
    try {
      const data = await codeGraphIndexService.symbol(event.params.id, event.params.symbolId);
      return data ? this.json({ data }) : this.json({ error: 'Code graph symbol not found.' }, 404);
    } catch (error) {
      return this.failure(error, 'Could not load the code graph symbol.');
    }
  }

  async overview(event: RequestEvent) {
    try {
      const input = await OverviewCodeGraphRequest.validate(event);
      const dto = OverviewCodeGraphDto.from(event.params.id, input);
      return this.json({ data: await codeGraphIndexService.overview(dto.workspaceId, dto.projectId, dto.limit) });
    } catch (error) {
      return this.failure(error, 'Could not load the code graph overview.');
    }
  }

  async graph(event: RequestEvent) {
    try {
      const input = await TraverseCodeGraphRequest.validate(event);
      const dto = TraverseCodeGraphDto.from(event.params.id, event.params.symbolId, input);
      return this.json({ data: await codeGraphIndexService.subgraph(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not traverse the code graph.');
    }
  }

  async changes(event: RequestEvent) {
    try {
      const input = await ChangeCodeGraphRequest.validate(event);
      const dto = ChangeCodeGraphDto.from(event.params.id, input);
      return this.json({ data: await codeGraphChangeIntelligenceService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze code changes.');
    }
  }

  async handoff(event: RequestEvent) {
    try {
      const input = await CodeGraphHandoffRequest.validate(event);
      const dto = CodeGraphHandoffDto.from(event.params.id, input);
      return this.json({ data: await codeGraphHandoffService.create(dto.workspaceId, dto.options, 'user') }, 201);
    } catch (error) {
      return this.failure(error, 'Could not create the code intelligence handoff.');
    }
  }

  async contracts(event: RequestEvent) {
    try {
      const input = await CodeGraphContractRequest.validate(event);
      const dto = CodeGraphContractDto.from(event.params.id, input);
      return this.json({ data: await codeGraphContractService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze API contracts.');
    }
  }

  async quality(event: RequestEvent) {
    try {
      const input = await CodeGraphQualityRequest.validate(event);
      const dto = CodeGraphQualityDto.from(event.params.id, input);
      return this.json({ data: await codeGraphQualityService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze code quality.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
