import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { ChangeCodeGraphDto, CodeGraphCompareDto, CodeGraphContextDto, CodeGraphContractDto, CodeGraphEvidenceImportDto, CodeGraphHandoffDto, CodeGraphInvestigationCreateDto, CodeGraphInvestigationUpdateDto, CodeGraphLocateDto, CodeGraphQualityDto, CodeGraphRevisionsDto, CodeGraphSemanticSearchDto, IndexCodeGraphDto, OverviewCodeGraphDto, SearchCodeGraphDto, TraverseCodeGraphDto } from '../../../application/dto/CodeGraphDto.js';
import { indexCodeGraphAction } from '../../../application/actions/IndexCodeGraphAction.js';
import { CodeGraphAccessError, codeGraphIndexService } from '../../../application/services/CodeGraphIndexService.js';
import { codeGraphChangeIntelligenceService } from '../../../application/services/CodeGraphChangeIntelligenceService.js';
import { codeGraphHandoffService } from '../../../application/services/CodeGraphHandoffService.js';
import { codeGraphContractService } from '../../../application/services/CodeGraphContractService.js';
import { codeGraphQualityService } from '../../../application/services/CodeGraphQualityService.js';
import { codeGraphSemanticService } from '../../../application/services/CodeGraphSemanticService.js';
import { codeGraphRuntimeEvidenceService } from '../../../application/services/CodeGraphRuntimeEvidenceService.js';
import { codeGraphOperationsService } from '../../../application/services/CodeGraphOperationsService.js';
import { codeGraphInvestigationRepository } from '../../../infrastructure/repositories/CodeGraphInvestigationRepository.js';
import { ChangeCodeGraphRequest, CodeGraphCompareRequest, CodeGraphContextRequest, CodeGraphContractRequest, CodeGraphEvidenceImportRequest, CodeGraphEvidenceSnapshotRequest, CodeGraphHandoffRequest, CodeGraphInvestigationCreateRequest, CodeGraphInvestigationUpdateRequest, CodeGraphLocateRequest, CodeGraphQualityRequest, CodeGraphRevisionsRequest, CodeGraphSemanticActionRequest, CodeGraphSemanticSearchRequest, IndexCodeGraphRequest, OverviewCodeGraphRequest, SearchCodeGraphRequest, TraverseCodeGraphRequest } from '../requests/CodeGraphRequests.js';

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
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await ChangeCodeGraphRequest.validate(event);
      const dto = ChangeCodeGraphDto.from(event.params.id, input);
      return this.json({ data: await codeGraphChangeIntelligenceService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze code changes.');
    }
  }

  async handoff(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphHandoffRequest.validate(event);
      const dto = CodeGraphHandoffDto.from(event.params.id, input);
      return this.json({ data: await codeGraphHandoffService.create(dto.workspaceId, dto.options, 'user') }, 201);
    } catch (error) {
      return this.failure(error, 'Could not create the code intelligence handoff.');
    }
  }

  async contracts(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphContractRequest.validate(event);
      const dto = CodeGraphContractDto.from(event.params.id, input);
      return this.json({ data: await codeGraphContractService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze API contracts.');
    }
  }

  async quality(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphQualityRequest.validate(event);
      const dto = CodeGraphQualityDto.from(event.params.id, input);
      return this.json({ data: await codeGraphQualityService.analyze(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not analyze code quality.');
    }
  }

  async semantic(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const query = event.url.searchParams.get('q');
      if (!query) return this.json({ data: await codeGraphSemanticService.ensureFresh(event.params.id) });
      const input = await CodeGraphSemanticSearchRequest.validate(event);
      const dto = CodeGraphSemanticSearchDto.from(event.params.id, input);
      return this.json({ data: await codeGraphSemanticService.search(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not use the semantic code index.');
    }
  }

  async updateSemantic(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphSemanticActionRequest.validate(event);
      return this.json({ data: input.action === 'build'
        ? await codeGraphSemanticService.build(event.params.id)
        : await codeGraphSemanticService.clear(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not update the semantic code index.');
    }
  }

  async evidence(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphEvidenceSnapshotRequest.validate(event);
      return this.json({ data: await codeGraphRuntimeEvidenceService.snapshot(event.params.id, input.limit) });
    } catch (error) {
      return this.failure(error, 'Could not load runtime evidence.');
    }
  }

  async importEvidence(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const input = await CodeGraphEvidenceImportRequest.validate(event);
      const dto = CodeGraphEvidenceImportDto.from(event.params.id, input);
      return this.json({ data: await codeGraphRuntimeEvidenceService.import(dto.workspaceId, dto.options) }, 201);
    } catch (error) {
      return this.failure(error, 'Could not import runtime evidence.');
    }
  }

  async context(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const dto = CodeGraphContextDto.from(event.params.id, await CodeGraphContextRequest.validate(event));
      return this.json({ data: await codeGraphOperationsService.context(dto.workspaceId, dto.options) });
    } catch (error) {
      return this.failure(error, 'Could not build the bounded code context.');
    }
  }

  async operations(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      return this.json({ data: await codeGraphOperationsService.operations(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not load the operational code graph.');
    }
  }

  async explain(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const data = await codeGraphOperationsService.explain(event.params.id, event.params.edgeId);
      return data ? this.json({ data }) : this.json({ error: 'Code graph relationship not found.' }, 404);
    } catch (error) {
      return this.failure(error, 'Could not explain the code relationship.');
    }
  }

  async locate(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const dto = CodeGraphLocateDto.from(event.params.id, await CodeGraphLocateRequest.validate(event));
      return this.json({ data: await codeGraphOperationsService.locate(dto.workspaceId, dto.path, dto.line) });
    } catch (error) {
      return this.failure(error, 'Could not locate the editor symbol in the code graph.');
    }
  }

  async revisions(event: RequestEvent) {
    try {
      const dto = CodeGraphRevisionsDto.from(event.params.id, await CodeGraphRevisionsRequest.validate(event));
      return this.json({ data: await codeGraphIndexService.revisions(dto.workspaceId, dto.projectId, dto.limit) });
    } catch (error) {
      return this.failure(error, 'Could not load code graph revisions.');
    }
  }

  async compare(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const dto = CodeGraphCompareDto.from(event.params.id, await CodeGraphCompareRequest.validate(event));
      return this.json({ data: await codeGraphOperationsService.compare(dto.workspaceId, dto.projectId, dto.from, dto.to) });
    } catch (error) {
      return this.failure(error, 'Could not compare code graph revisions.');
    }
  }

  async investigations(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      return this.json({ data: await codeGraphInvestigationRepository.list(event.params.id) });
    } catch (error) {
      return this.failure(error, 'Could not load saved investigations.');
    }
  }

  async investigation(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const data = await codeGraphInvestigationRepository.get(event.params.id, event.params.investigationId);
      return data ? this.json({ data }) : this.json({ error: 'Saved investigation not found.' }, 404);
    } catch (error) {
      return this.failure(error, 'Could not load the saved investigation.');
    }
  }

  async createInvestigation(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const dto = CodeGraphInvestigationCreateDto.from(event.params.id, await CodeGraphInvestigationCreateRequest.validate(event));
      return this.json({ data: await codeGraphInvestigationRepository.create(dto.workspaceId, {
        name: dto.name,
        state: dto.state,
        createdBy: 'user',
      }) }, 201);
    } catch (error) {
      return this.failure(error, 'Could not save the investigation.');
    }
  }

  async updateInvestigation(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const dto = CodeGraphInvestigationUpdateDto.from(event.params.id, event.params.investigationId, await CodeGraphInvestigationUpdateRequest.validate(event));
      const data = await codeGraphInvestigationRepository.update(dto.workspaceId, dto.investigationId, { name: dto.name, state: dto.state });
      return data ? this.json({ data }) : this.json({ error: 'Saved investigation not found.' }, 404);
    } catch (error) {
      return this.failure(error, 'Could not update the saved investigation.');
    }
  }

  async deleteInvestigation(event: RequestEvent) {
    try {
      await codeGraphIndexService.assertAvailable(event.params.id);
      const deleted = await codeGraphInvestigationRepository.delete(event.params.id, event.params.investigationId);
      return deleted ? this.json({ data: { deleted: true } }) : this.json({ error: 'Saved investigation not found.' }, 404);
    } catch (error) {
      return this.failure(error, 'Could not delete the saved investigation.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json(
      { error: error instanceof Error ? error.message : fallback },
      error instanceof CodeGraphAccessError ? error.status : 400,
    );
  }
}
