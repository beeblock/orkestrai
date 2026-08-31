import { Controller } from '@beeblock/svelar/routing';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { roleService } from '$lib/modules/agent-room/application/services/RoleService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { boardColumnService } from '$lib/modules/agent-room/application/services/BoardColumnService.js';
import { floorService } from '$lib/modules/agent-room/application/services/FloorService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { bridgeDesignApplySchema, bridgeFigmaSelectionSchema, bridgeReassignSchema, bridgeRoleEditSchema, bridgeRoleWriteSchema, bridgeFloorCreateSchema, bridgeFloorLandSchema, bridgeNoteCreateSchema } from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';
import { bridgeBoardTaskSchema, bridgeBoardTaskUpdateSchema } from '$lib/modules/agent-room/contracts/schemas/taskSchemas.js';
import { portalService } from '$lib/modules/agent-room/application/services/PortalService.js';
import { usageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { deviceService } from '$lib/modules/agent-room/application/services/DeviceService.js';
import { ExecuteDeviceCommandAction } from '$lib/modules/agent-room/application/actions/ExecuteDeviceCommandAction.js';
import { ExecuteDeviceCommandDto } from '$lib/modules/agent-room/application/dto/ExecuteDeviceCommandDto.js';
import { buildUsageRoutingReport } from '$lib/modules/agent-room/domain/usage-routing.js';
import { z } from 'zod';
import {
  BridgeAskRequest,
  BridgeConnectRequest,
  BridgeDismissRequest,
  BridgeRecruitRequest,
  BridgeNoteEditRequest,
  BridgeNoteWriteRequest,
  BridgeNotifyRequest,
  BridgeActivityRequest,
} from '$lib/modules/agent-room/interface/http/requests/BridgeRequests.js';
import { DeviceCommandRequest } from '$lib/modules/agent-room/interface/http/requests/DeviceCommandRequest.js';
import { ApplyDesignOperationsDto } from '$lib/modules/agent-room/application/dto/DesignDtos.js';
import { DesignRevisionConflictError, designDocumentService } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
import { designFigmaService } from '$lib/modules/agent-room/application/services/DesignFigmaService.js';
import { ApplyDesignFigmaSyncDto, ImportDesignFigmaDto, InspectDesignFigmaDto, PreviewDesignFigmaSyncDto } from '$lib/modules/agent-room/application/dto/DesignFigmaDtos.js';
import { acknowledgeDesignFigmaPushSchema, applyDesignFigmaSyncSchema, importDesignFigmaSchema, inspectDesignFigmaSchema, previewDesignFigmaSyncSchema } from '$lib/modules/agent-room/contracts/schemas/designFigmaSchemas.js';
import { bridgeApplyDesignDeliverySchema, bridgeImportDesignMarkupSchema, previewDesignDeliverySchema } from '$lib/modules/agent-room/contracts/schemas/design-delivery.schema.js';
import { designDeliveryService } from '$lib/modules/agent-room/application/services/DesignDeliveryService.js';
import { DesignLeaseConflictError } from '$lib/modules/agent-room/application/services/DesignCollaborationService.js';
import { auditDesignDocument } from '$lib/modules/agent-room/domain/design-quality.js';
import { createDesignTemplate, designTemplateIds } from '$lib/modules/agent-room/domain/design-templates.js';
import { uuidv7 } from '@beeblock/svelar/support';
import { isDesignExplorationPayload } from '$lib/modules/agent-room/domain/design-exploration.js';
import { ApiClientFingerprintConflictError, apiClientService } from '$lib/modules/agent-room/application/services/ApiClientService.js';
import { CreateAgentApiClientRequest, ExecuteAgentApiClientRunnerRequest, ExecuteSavedApiClientRequest, ExportAgentApiClientRequest, ImportAgentApiClientRequest, ReplaceAgentApiClientRequest, SyncAgentApiClientRequest } from '$lib/modules/agent-room/interface/http/requests/ApiClientRequests.js';
import { CreateAgentApiClientDto, ExecuteAgentApiClientRunnerDto, ExecuteSavedApiClientRequestDto, ExportAgentApiClientDto, ImportAgentApiClientDto, ReplaceAgentApiClientDto, SyncAgentApiClientDto } from '$lib/modules/agent-room/application/dto/ApiClientDtos.js';
import { ExecuteSavedApiClientRequestAction } from '$lib/modules/agent-room/application/actions/ExecuteSavedApiClientRequestAction.js';
import { apiClientSyncService } from '$lib/modules/agent-room/application/services/ApiClientSyncService.js';
import { workspaceMemoryService, WorkspaceMemoryConflictError } from '$lib/modules/agent-room/application/services/WorkspaceMemoryService.js';
import { saveWorkspaceMemorySchema, reviseWorkspaceMemorySchema } from '$lib/modules/agent-room/contracts/schemas/workspace-memory.schema.js';
import { contributeHuddleTurnSchema } from '$lib/modules/agent-room/contracts/schemas/huddle.schema.js';
import { ContributeHuddleTurnDto } from '$lib/modules/agent-room/application/dto/HuddleDtos.js';
import { huddleService } from '$lib/modules/agent-room/application/services/HuddleService.js';
import { ImageWorkflowError, imageWorkflowService } from '$lib/modules/agent-room/application/services/ImageWorkflowService.js';
import { AddImageWorkflowReferenceAction, CompleteImageWorkflowAction, ConnectImageWorkflowNodeAction, CreateImageWorkflowAction, DisconnectImageWorkflowNodeAction, FailImageWorkflowAction, RunSavedImageWorkflowAction, UpdateImageWorkflowAction, ValidateImageWorkflowOutputAction } from '$lib/modules/agent-room/application/actions/RunImageWorkflowAction.js';
import { AddImageWorkflowReferenceDto, CompleteImageWorkflowDto, ConnectImageWorkflowNodeDto, CreateImageWorkflowDto, FailImageWorkflowDto, UpdateImageWorkflowDto, ValidateImageWorkflowOutputDto } from '$lib/modules/agent-room/application/dto/ImageWorkflowDtos.js';
import { AddImageWorkflowReferenceRequest, BridgeRunImageWorkflowRequest, CompleteImageWorkflowRequest, ConnectImageWorkflowNodeRequest, CreateImageWorkflowRequest, FailImageWorkflowRequest, ImageWorkflowActorRequest, UpdateImageWorkflowRequest, ValidateImageWorkflowOutputRequest } from '$lib/modules/agent-room/interface/http/requests/ImageWorkflowRequests.js';
import { codeGraphIndexService } from '$lib/modules/agent-room/application/services/CodeGraphIndexService.js';
import { codeGraphChangeSchema, codeGraphContractSchema, codeGraphHandoffSchema, codeGraphIndexSchema, codeGraphQualitySchema, codeGraphSearchSchema, codeGraphTraversalSchema } from '$lib/modules/agent-room/contracts/schemas/codeGraphSchemas.js';
import { indexCodeGraphAction } from '$lib/modules/agent-room/application/actions/IndexCodeGraphAction.js';
import { IndexCodeGraphDto } from '$lib/modules/agent-room/application/dto/CodeGraphDto.js';
import { codeGraphChangeIntelligenceService } from '$lib/modules/agent-room/application/services/CodeGraphChangeIntelligenceService.js';
import { codeGraphHandoffService } from '$lib/modules/agent-room/application/services/CodeGraphHandoffService.js';
import { codeGraphContractService } from '$lib/modules/agent-room/application/services/CodeGraphContractService.js';
import { codeGraphQualityService } from '$lib/modules/agent-room/application/services/CodeGraphQualityService.js';

/**
 * Endpoints consumidos pela CLI `orkestrai` (autenticacao por token de
 * workspace, sem CSRF — ver hooks.server.ts csrfExcludePaths).
 */
export class BridgeController extends Controller {
  async listAgents(event: any) {
    try {
      const token = this.requireToken(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      const agents = await bridgeService.listAgents(workspace.id);
      const agentNodeId = String(event.url.searchParams.get('agentNodeId') ?? '');
      const notes = await bridgeService.notesForAgent(workspace.id, agentNodeId).catch(() => [] as string[]);
      const portals = await bridgeService.listPortals(workspace.id, agentNodeId || null);
      const designs = agentNodeId
        ? await bridgeService.designsForAgent(workspace.id, agentNodeId).catch(() => [] as Array<{ id: string; title: string }>)
        : [];
      const repositories = workspace.repositoryRoots.map(({ alias }) => ({ alias, reference: `@${alias}` }));
      return this.json({ data: { workspace: { id: workspace.id, name: workspace.name }, repositories, agents, notes, portals, designs } });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar agentes.', 401);
    }
  }

  async usage(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const nodes = await workspaceRepository.listNodes(workspace.id);
      const policy = nodes.find((node) => node.type === 'usage')?.payload ?? undefined;
      return this.json({ data: buildUsageRoutingReport(await usageService.getAll(false), policy) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao consultar uso dos providers.', 401);
    }
  }

  async codeGraphStatus(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphIndexService.status(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to load the code graph.', 401);
    }
  }

  async codeGraphIndex(event: any) {
    try {
      const input = codeGraphIndexSchema.parse(await event.request.json().catch(() => ({})));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await indexCodeGraphAction.execute(IndexCodeGraphDto.from(workspace.id, input)) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to index the workspace code.');
    }
  }

  async codeGraphSearch(event: any) {
    try {
      const input = codeGraphSearchSchema.parse(Object.fromEntries(event.url.searchParams));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphIndexService.search(workspace.id, {
        query: input.q,
        projectId: input.projectId,
        kinds: input.kinds,
        limit: input.limit,
      }) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to search the code graph.');
    }
  }

  async codeGraphSymbol(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const data = await codeGraphIndexService.symbol(workspace.id, event.params.symbolId);
      return data ? this.json({ data }) : this.json({ error: 'Code graph symbol not found.' }, 404);
    } catch (error) {
      return this.errorResponse(error, 'Failed to load the code graph symbol.');
    }
  }

  async codeGraphGraph(event: any) {
    try {
      const input = codeGraphTraversalSchema.parse(Object.fromEntries(event.url.searchParams));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphIndexService.subgraph(workspace.id, {
        symbolId: event.params.symbolId,
        direction: input.direction,
        kinds: input.kinds,
        depth: input.depth,
        limit: input.limit,
      }) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to traverse the code graph.');
    }
  }

  async codeGraphChanges(event: any) {
    try {
      const input = codeGraphChangeSchema.parse(Object.fromEntries(event.url.searchParams));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphChangeIntelligenceService.analyze(workspace.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to analyze code changes.');
    }
  }

  async codeGraphHandoff(event: any) {
    try {
      const input = codeGraphHandoffSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphHandoffService.create(workspace.id, input, 'agent') }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Failed to create the code intelligence handoff.');
    }
  }

  async codeGraphContracts(event: any) {
    try {
      const input = codeGraphContractSchema.parse(Object.fromEntries(event.url.searchParams));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphContractService.analyze(workspace.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to analyze API contracts.');
    }
  }

  async codeGraphQuality(event: any) {
    try {
      const input = codeGraphQualitySchema.parse(Object.fromEntries(event.url.searchParams));
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await codeGraphQualityService.analyze(workspace.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to analyze code quality.');
    }
  }

  async memoryList(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await workspaceMemoryService.list(workspace.id, {
        query: event.url.searchParams.get('q') ?? '',
        includeHistory: event.url.searchParams.get('history') === '1',
      }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao consultar a memoria do workspace.', 401);
    }
  }

  async memoryCreate(event: any) {
    try {
      const input = saveWorkspaceMemorySchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await workspaceMemoryService.create(workspace.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao salvar a memoria do workspace.');
    }
  }

  async memoryRevise(event: any) {
    try {
      const input = reviseWorkspaceMemorySchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await workspaceMemoryService.revise(workspace.id, event.params.memoryId, input) });
    } catch (error) {
      if (error instanceof WorkspaceMemoryConflictError) return this.json({ error: error.message, current: error.current }, 409);
      return this.errorResponse(error, 'Falha ao revisar a memoria do workspace.');
    }
  }

  async memoryArchive(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await workspaceMemoryService.archive(workspace.id, event.params.memoryId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao arquivar a memoria do workspace.');
    }
  }

  async huddleList(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await huddleService.snapshot(workspace.id, event.url.searchParams.get('selected')) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao consultar huddles.', 401);
    }
  }

  async huddleContribute(event: any) {
    try {
      const input = contributeHuddleTurnSchema.extend({ from: z.string().uuid() }).parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await huddleService.contribute(workspace.id, event.params.huddleId, input.from, ContributeHuddleTurnDto.from(input)) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao registrar fala no huddle.');
    }
  }

  async listNotes(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const agentNodeId = String(event.url.searchParams.get('agentNodeId') ?? '').trim();
      return this.json({ data: await bridgeService.listNotes(workspace.id, agentNodeId || null) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar notas.', 401);
    }
  }

  async listApiClients(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const agentNodeId = String(event.url.searchParams.get('agentNodeId') ?? '').trim();
      return this.json({ data: await apiClientService.list(workspace.id, agentNodeId || null) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar clientes de API.', 401);
    }
  }

  async listImageWorkflows(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await imageWorkflowService.list(workspace.id) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to list image workflows.', 401);
    }
  }

  async createImageWorkflow(event: any) {
    try {
      const input = await CreateImageWorkflowRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await new CreateImageWorkflowAction().execute(new CreateImageWorkflowDto(workspace.id, input, actor)) }, 201);
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to create image workflow.');
    }
  }

  async readImageWorkflow(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await imageWorkflowService.read(workspace.id, event.params.nodeId) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Image workflow not found.', 404);
    }
  }

  async runImageWorkflow(event: any) {
    try {
      const input = await BridgeRunImageWorkflowRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = input.from
        ? (await bridgeService.listAgents(workspace.id)).find((agent) => (
            agent.nodeId === input.from || agent.title.toLowerCase() === input.from?.toLowerCase()
          ))?.nodeId ?? null
        : null;
      const result = await new RunSavedImageWorkflowAction().execute(
        workspace.id,
        event.params.nodeId,
        input,
        actor,
      );
      return this.json({ data: result }, 201);
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to run image workflow.');
    }
  }

  async updateImageWorkflow(event: any) {
    try {
      const input = await UpdateImageWorkflowRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await new UpdateImageWorkflowAction().execute(new UpdateImageWorkflowDto(workspace.id, event.params.nodeId, input, actor)) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to update image workflow.');
    }
  }

  async connectImageWorkflowNode(event: any) {
    try {
      const input = await ConnectImageWorkflowNodeRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await new ConnectImageWorkflowNodeAction().execute(new ConnectImageWorkflowNodeDto(workspace.id, event.params.nodeId, input, actor)) }, 201);
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to connect image workflow node.');
    }
  }

  async disconnectImageWorkflowNode(event: any) {
    try {
      const input = await ConnectImageWorkflowNodeRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await new DisconnectImageWorkflowNodeAction().execute(new ConnectImageWorkflowNodeDto(workspace.id, event.params.nodeId, input, actor)) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to disconnect image workflow node.');
    }
  }

  async addImageWorkflowReference(event: any) {
    try {
      const input = await AddImageWorkflowReferenceRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await new AddImageWorkflowReferenceAction().execute(new AddImageWorkflowReferenceDto(workspace.id, event.params.nodeId, input, actor)) }, 201);
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to add image workflow reference.');
    }
  }

  async deleteImageWorkflow(event: any) {
    try {
      const input = await ImageWorkflowActorRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await imageWorkflowService.remove(workspace.id, event.params.nodeId, actor) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to delete image workflow.');
    }
  }

  async completeImageWorkflow(event: any) {
    try {
      const input = await CompleteImageWorkflowRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = (await bridgeService.listAgents(workspace.id)).find((agent) => agent.nodeId === input.from)?.nodeId;
      if (!actor) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
      return this.json({ data: await new CompleteImageWorkflowAction().execute(
        CompleteImageWorkflowDto.from(workspace.id, event.params.nodeId, input, actor),
      ) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to complete image workflow.');
    }
  }

  async validateImageWorkflowOutput(event: any) {
    try {
      const input = await ValidateImageWorkflowOutputRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = (await bridgeService.listAgents(workspace.id)).find((agent) => agent.nodeId === input.from)?.nodeId;
      if (!actor) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
      return this.json({ data: await new ValidateImageWorkflowOutputAction().execute(
        ValidateImageWorkflowOutputDto.from(workspace.id, event.params.nodeId, input, actor),
      ) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to validate image workflow output.');
    }
  }

  async failImageWorkflow(event: any) {
    try {
      const input = await FailImageWorkflowRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = (await bridgeService.listAgents(workspace.id)).find((agent) => agent.nodeId === input.from)?.nodeId;
      if (!actor) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
      return this.json({ data: await new FailImageWorkflowAction().execute(
        FailImageWorkflowDto.from(workspace.id, event.params.nodeId, input, actor),
      ) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to report image workflow failure.');
    }
  }

  async cancelImageWorkflow(event: any) {
    try {
      const input = await ImageWorkflowActorRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const actor = await this.resolveImageWorkflowActor(workspace.id, input.from);
      return this.json({ data: await imageWorkflowService.cancel(workspace.id, event.params.nodeId, actor) });
    } catch (error) {
      return this.imageWorkflowError(error, 'Failed to cancel image workflow.');
    }
  }

  async executeApiClientRequest(event: any) {
    try {
      const input = await ExecuteSavedApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await new ExecuteSavedApiClientRequestAction().execute({
        workspaceId: workspace.id,
        nodeId: event.params.nodeId,
        dto: ExecuteSavedApiClientRequestDto.from(input),
      }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao executar request salvo.');
    }
  }

  async createApiClient(event: any) {
    try {
      const input = await CreateAgentApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const data = await apiClientService.createForAgent(workspace.id, CreateAgentApiClientDto.from(input));
      bridgeService.notifyWorkspaceChanged(workspace.id);
      return this.json({ data }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar cliente de API.');
    }
  }

  async importApiClient(event: any) {
    try {
      const input = await ImportAgentApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const data = await apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from(input));
      bridgeService.notifyWorkspaceChanged(workspace.id);
      return this.json({ data }, input.nodeId ? 200 : 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao importar cliente de API.');
    }
  }

  async readApiClient(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const from = String(event.url.searchParams.get('agentNodeId') ?? '').trim();
      if (!from) throw new Error('agentNodeId is required.');
      return this.json({ data: await apiClientService.readForAgent(workspace.id, event.params.nodeId, from) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler cliente de API.', 401);
    }
  }

  async replaceApiClient(event: any) {
    try {
      const input = await ReplaceAgentApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const data = await apiClientService.replaceForAgent(workspace.id, event.params.nodeId, ReplaceAgentApiClientDto.from(input));
      const repository = data.repository;
      const repositorySync = input.syncToSource && repository.linked && ['bruno', 'postman', 'openCollection'].includes(String(repository.kind))
        ? await apiClientSyncService.executeForAgent(workspace.id, event.params.nodeId, SyncAgentApiClientDto.from({ action: 'push', from: input.from }))
        : null;
      bridgeService.notifyWorkspaceChanged(workspace.id);
      const conflict = repositorySync && 'status' in repositorySync && repositorySync.status === 'conflict';
      const refreshed = conflict || !repositorySync
        ? data
        : await apiClientService.readForAgent(workspace.id, event.params.nodeId, input.from);
      return this.json({
        ...(conflict ? { error: 'The repository collection changed externally. Review sync status and choose pull or push explicitly.' } : {}),
        data: { ...refreshed, repositorySync },
      }, conflict ? 409 : 200);
    } catch (error) {
      if (error instanceof ApiClientFingerprintConflictError) {
        return this.json({ error: error.message, currentFingerprint: error.currentFingerprint }, 409);
      }
      return this.errorResponse(error, 'Falha ao atualizar cliente de API.');
    }
  }

  async syncApiClient(event: any) {
    try {
      const input = await SyncAgentApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const data = await apiClientSyncService.executeForAgent(workspace.id, event.params.nodeId, SyncAgentApiClientDto.from(input));
      const conflict = 'status' in data && data.status === 'conflict';
      if (input.action !== 'status' && !conflict) bridgeService.notifyWorkspaceChanged(workspace.id);
      return this.json({ data });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao sincronizar cliente de API.');
    }
  }

  async exportApiClient(event: any) {
    try {
      const input = await ExportAgentApiClientRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await apiClientService.exportForAgent(workspace.id, event.params.nodeId, ExportAgentApiClientDto.from(input)) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao exportar cliente de API.');
    }
  }

  async executeApiClientRunner(event: any) {
    try {
      const input = await ExecuteAgentApiClientRunnerRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await apiClientService.executeRunnerForAgent(
        workspace.id,
        event.params.nodeId,
        event.params.runnerId,
        ExecuteAgentApiClientRunnerDto.from(input),
      ) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao executar runner do cliente de API.');
    }
  }

  async deviceList(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await deviceService.snapshot(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar dispositivos.', 401);
    }
  }

  async deviceCommand(event: any) {
    try {
      const input = await DeviceCommandRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await new ExecuteDeviceCommandAction().execute({
        workspaceId: workspace.id,
        dto: ExecuteDeviceCommandDto.from(input),
      }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao controlar dispositivo.');
    }
  }

  async listDesigns(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const designs = (await workspaceRepository.listNodes(workspace.id)).filter((node) => node.type === 'design');
      const data = await Promise.all(designs.map(async (node) => {
        const document = await designDocumentService.get(workspace.id, node.id);
        const payload = node.payload as Record<string, unknown>;
        const work = (payload.explorationWork ?? {}) as Record<string, unknown>;
        const review = (payload.visualReview ?? {}) as Record<string, unknown>;
        const lastProgressAt = typeof work.lastProgressAt === 'string' ? work.lastProgressAt : document.updatedAt;
        const stalled = work.phase === 'active'
          && Date.now() - Date.parse(lastProgressAt) >= 5 * 60 * 1_000;
        const reviewStatus = review.status === 'approved' && review.revision === document.revision
          ? 'approved'
          : review.status === 'changes_requested' && review.revision === document.revision
            ? 'changes_requested'
            : document.revision > 0
              ? 'pending'
              : 'empty';
        return {
          nodeId: node.id,
          title: node.title || document.name,
          revision: document.revision,
          pages: document.pages.length,
          elements: document.elements.length,
          updatedAt: document.updatedAt,
          workflowKind: isDesignExplorationPayload(payload) ? 'design-exploration' : payload.workflowKind ?? null,
          direction: payload.direction ?? null,
          progress: stalled ? 'stalled' : work.phase ?? null,
          lastProgressAt,
          reviewStatus,
          reviewRevision: review.revision ?? null,
          reviewNote: review.note ?? '',
        };
      }));
      return this.json({ data });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar documentos de design.', 401);
    }
  }

  async readDesign(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await designDocumentService.get(workspace.id, event.params.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Documento de design nao encontrado.', 404);
    }
  }

  async auditDesign(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const document = await designDocumentService.get(workspace.id, event.params.nodeId);
      return this.json({ data: auditDesignDocument(document) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao auditar documento de design.', 404);
    }
  }

  async applyDesignTemplate(event: any) {
    try {
      const input = z.object({
        templateId: z.enum(designTemplateIds as [typeof designTemplateIds[number], ...typeof designTemplateIds[number][]]),
        baseRevision: z.number().int().min(0),
        token: z.string().optional(),
        from: z.string().trim().max(120).optional(),
        taskId: z.string().uuid().nullable().optional(),
      }).parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const current = await designDocumentService.get(workspace.id, event.params.nodeId);
      if (current.revision !== input.baseRevision) throw new DesignRevisionConflictError(current);
      const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspace.id,
        event.params.nodeId,
        input.baseRevision,
        createDesignTemplate(input.templateId, current, uuidv7),
        { kind: 'agent', id: input.from ?? null, name: input.from ?? null, taskId: input.taskId ?? null },
        `Apply ${input.templateId} design template`,
        input.from ?? null,
      ));
      return this.json({ data: document });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.errorResponse(error, 'Falha ao aplicar template de design.');
    }
  }

  async applyDesign(event: any) {
    try {
      const input = bridgeDesignApplySchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspace.id,
        event.params.nodeId,
        input.baseRevision,
        input.operations,
        { kind: 'agent', id: input.from ?? null, name: input.from ?? null, taskId: input.taskId ?? null },
        input.summary,
        input.from ?? null,
      ));
      return this.json({ data: document });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) {
        return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      }
      if (error instanceof DesignLeaseConflictError) return this.json({ error: 'design_lease_conflict', data: error.lease }, 423);
      return this.errorResponse(error, 'Falha ao alterar documento de design.');
    }
  }

  async previewDesignCode(event: any) {
    try {
      const input = previewDesignDeliverySchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await designDeliveryService.preview(workspace.id, event.params.nodeId, input) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to preview generated design code.');
    }
  }

  async applyDesignCode(event: any) {
    try {
      const input = bridgeApplyDesignDeliverySchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const current = await designDocumentService.get(workspace.id, event.params.nodeId);
      if (current.revision !== input.baseRevision) throw new DesignRevisionConflictError(current);
      const applied = await designDeliveryService.apply(workspace.id, event.params.nodeId, input);
      const existing = current.codeArtifacts.find((artifact) => artifact.path === applied.artifact.path);
      const { id: _generatedId, ...artifactChanges } = applied.artifact;
      const operation = existing
        ? { kind: 'update-code-artifact' as const, artifactId: existing.id, changes: artifactChanges }
        : { kind: 'add-code-artifact' as const, artifact: applied.artifact };
      const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspace.id,
        event.params.nodeId,
        input.baseRevision,
        [operation],
        { kind: 'agent', id: input.from ?? null, name: input.from ?? null, taskId: input.taskId ?? null },
        input.summary ?? `Generate ${input.framework} code at ${applied.path}`,
        input.from ?? null,
      ));
      return this.json({ data: { ...applied, revision: document.revision } });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      if (error instanceof DesignLeaseConflictError) return this.json({ error: 'design_lease_conflict', data: error.lease }, 423);
      return this.errorResponse(error, 'Failed to write generated design code.');
    }
  }

  async importDesignCode(event: any) {
    try {
      const input = bridgeImportDesignMarkupSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const imported = await designDeliveryService.import(workspace.id, event.params.nodeId, input);
      const document = await designDocumentService.apply(new ApplyDesignOperationsDto(
        workspace.id,
        event.params.nodeId,
        input.baseRevision,
        imported.operations,
        { kind: 'agent', id: input.from ?? null, name: input.from ?? null, taskId: input.taskId ?? null },
        input.summary ?? `Import ${input.format} as ${input.name}`,
        input.from ?? null,
      ));
      return this.json({ data: { ...imported, revision: document.revision } });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      if (error instanceof DesignLeaseConflictError) return this.json({ error: 'design_lease_conflict', data: error.lease }, 423);
      return this.errorResponse(error, 'Failed to import code into the design.');
    }
  }

  async importFigmaSelection(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const contentLength = Number(event.request.headers.get('content-length') ?? 0);
      if (contentLength > 60 * 1024 * 1024) throw new Error('Figma plugin payload exceeds the 60 MB limit.');
      const input = bridgeFigmaSelectionSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.importPluginSelection({
        workspaceId: workspace.id,
        nodeId: event.params.nodeId,
        ...input,
      }) });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.errorResponse(error, 'Failed to import the Figma plugin selection.');
    }
  }

  async inspectFigma(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const input = inspectDesignFigmaSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.inspect(InspectDesignFigmaDto.from(workspace.id, event.params.nodeId, input)) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to inspect the Figma file.');
    }
  }

  async importFigma(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const input = importDesignFigmaSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.import(ImportDesignFigmaDto.from(workspace.id, event.params.nodeId, input)) });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.errorResponse(error, 'Failed to import the Figma selection.');
    }
  }

  async previewFigmaSync(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const input = previewDesignFigmaSyncSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.preview(PreviewDesignFigmaSyncDto.from(workspace.id, event.params.nodeId, input)) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to preview Figma synchronization.');
    }
  }

  async applyFigmaSync(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const input = applyDesignFigmaSyncSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.applySync(ApplyDesignFigmaSyncDto.from(workspace.id, event.params.nodeId, input)) });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.errorResponse(error, 'Failed to synchronize the Figma source.');
    }
  }

  async acknowledgeFigmaPush(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const input = acknowledgeDesignFigmaPushSchema.parse(await event.request.json());
      return this.json({ data: await designFigmaService.acknowledgePush(
        workspace.id,
        event.params.nodeId,
        input.linkId,
        input.baseRevision,
        input.nodeIds,
      ) });
    } catch (error) {
      if (error instanceof DesignRevisionConflictError) return this.json({ error: 'design_revision_conflict', data: error.current }, 409);
      return this.errorResponse(error, 'Failed to acknowledge Figma plugin updates.');
    }
  }

  async readFigmaAsset(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const asset = await designDocumentService.readAsset(workspace.id, event.params.nodeId, event.params.assetId);
      return new Response(Uint8Array.from(asset.bytes).buffer, {
        headers: {
          'Content-Type': asset.mimeType,
          'Content-Length': String(asset.bytes.byteLength),
          'Cache-Control': 'private, max-age=300',
          'Content-Disposition': `inline; filename="${asset.name.replace(/["\\]/g, '_')}"`,
        },
      });
    } catch (error) {
      return this.errorResponse(error, 'Design asset not found.', 404);
    }
  }

  async ask(event: any) {
    try {
      const input = await BridgeAskRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const result = input.raw
        ? await bridgeService.askRaw(workspace.id, { to: input.to, message: input.message, from: input.from })
        : await bridgeService.ask(workspace.id, {
            to: input.to,
            message: input.message,
            from: input.from,
            timeoutMs: input.timeoutMs,
            signal: event.request.signal,
          });
      return this.json({ data: result });
    } catch (error) {
      return this.errorResponse(error, 'Falha no ask.');
    }
  }

  async readNote(event: any) {
    try {
      const token = this.requireToken(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await bridgeService.readNote(workspace.id, event.params.nodeId) });
    } catch (error) {
      return this.errorResponse(error, 'Nota nao encontrada.', 404);
    }
  }

  async writeNote(event: any) {
    try {
      const input = await BridgeNoteWriteRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.writeNote(workspace.id, event.params.nodeId, input.content) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao escrever nota.');
    }
  }

  async createNote(event: any) {
    try {
      const input = bridgeNoteCreateSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.createNote(workspace.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar nota.');
    }
  }

  async editNote(event: any) {
    try {
      const input = await BridgeNoteEditRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.editNote(workspace.id, event.params.nodeId, input.old, input.new) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao editar nota.');
    }
  }

  async notify(event: any) {
    try {
      const input = await BridgeNotifyRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.notify(workspace, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao notificar.');
    }
  }

  async activity(event: any) {
    try {
      const input = await BridgeActivityRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.reportActivity(workspace.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar o estado do agente.');
    }
  }

  async recruit(event: any) {
    try {
      const input = await BridgeRecruitRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const result = await bridgeService.recruit(workspace.id, {
        from: input.from,
        title: input.title,
        provider: input.provider,
        profile: input.profile,
        model: input.model,
        effort: input.effort,
        role: input.role,
        x: input.x,
        y: input.y,
        replace: input.replace,
        floorId: input.floorId,
      });
      return this.json({ data: result }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao recrutar agente.');
    }
  }

  async dismiss(event: any) {
    try {
      const input = await BridgeDismissRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.dismiss(workspace.id, { from: input.from, target: input.target }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao dispensar agente.');
    }
  }

  async connect(event: any) {
    try {
      const input = await BridgeConnectRequest.validate(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await bridgeService.connectNodes(workspace.id, { from: input.from, source: input.source, to: input.to }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao conectar nos.');
    }
  }

  async reassign(event: any) {
    try {
      const input = bridgeReassignSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({
        data: await bridgeService.reassignRole(workspace.id, {
          from: input.from,
          target: input.target,
          role: input.role,
          prompt: input.prompt,
        }),
      });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao reatribuir papel.');
    }
  }

  async roleShow(event: any) {
    try {
      const token = this.requireToken(event);
      const name = event.url.searchParams.get('name');
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      if (name) {
        const role = await roleService.get(workspace.id, name);
        if (!role) throw new Error(`Responsabilidade "${name}" nao encontrada.`);
        return this.json({ data: role });
      }
      return this.json({ data: await roleService.list(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler responsabilidade.', 404);
    }
  }

  async roleWrite(event: any) {
    try {
      const input = bridgeRoleWriteSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await roleService.save(workspace.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao escrever responsabilidade.');
    }
  }

  async roleEdit(event: any) {
    try {
      const input = bridgeRoleEditSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await roleService.edit(workspace.id, input.name, input.old, input.new) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao editar responsabilidade.');
    }
  }

  async portal(event: any) {
    try {
      const common = {
          token: z.string().trim().min(1).nullish(),
          nodeId: z.string().trim().min(1).max(128),
          timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
      };
      const input = z.discriminatedUnion('action', [
        z.object({ ...common, action: z.literal('navigate'), args: z.object({ url: z.string().trim().min(1).max(4_096) }).strict() }),
        z.object({ ...common, action: z.literal('eval'), args: z.object({ js: z.string().max(200_000) }).strict() }),
        z.object({ ...common, action: z.literal('screenshot'), args: z.object({}).strict().default({}) }),
        z.object({ ...common, action: z.literal('dom'), args: z.object({}).strict().default({}) }),
      ]).parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const portal = await bridgeService.resolvePortal(workspace.id, input.nodeId);
      const command = portalService.enqueue(portal.id, input.action, input.args);
      const result = await portalService.waitResult(command.id, input.timeoutMs);
      return this.json({ data: result }, result.ok ? 200 : 400);
    } catch (error) {
      return this.errorResponse(error, 'Falha na automacao do portal.');
    }
  }

  /** Cria um portal no canvas (o portal em si so abre URL depois, via `portal`). */
  async portalCreate(event: any) {
    try {
      const input = z
        .object({
          token: z.string().trim().min(1).nullish(),
          from: z.string().trim().min(1, 'Informe o agente maestro (from).'),
          url: z.string().trim().min(1, 'Informe a URL do portal.'),
          title: z.string().trim().nullish(),
          connect: z.string().trim().nullish(),
          forceNew: z.boolean().default(false),
        })
        .parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const result = await bridgeService.createPortal(workspace.id, {
        from: input.from,
        url: input.url,
        title: input.title,
        connect: input.connect,
        forceNew: input.forceNew,
      });
      return this.json({ data: result }, result.reused ? 200 : 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar portal.');
    }
  }

  /** Token da ponte de um workspace (para a UI exibir/copiar). */
  async workspaceToken(event: any) {
    try {
      const token = await bridgeService.getOrCreateToken(event.params.id, event.url.origin);
      return this.json({ data: { token } });
    } catch (error) {
      return this.errorResponse(error, 'Workspace nao encontrado.', 404);
    }
  }

  // -- Quadro de tarefas (kanban) via bridge ----------------------------------

  private async assigneeNodeId(workspaceId: string, assignee?: string | null): Promise<string | null> {
    if (!assignee) return null;
    const agents = await bridgeService.listAgents(workspaceId);
    const normalized = assignee.trim().toLowerCase();
    const agent =
      agents.find((item) => item.nodeId === assignee) ??
      agents.find((item) => item.title.toLowerCase() === normalized) ??
      agents.find((item) => item.title.toLowerCase().includes(normalized));
    if (!agent) throw new Error(`Agente "${assignee}" nao encontrado para atribuir a tarefa.`);
    return agent.nodeId;
  }

  /**
   * Nota por id ou titulo (espelha assigneeNodeId): undefined = nao mexe,
   * null/'' = desvincula, string = vincula (id, titulo exato ou parcial).
   */
  private async noteNodeId(workspaceId: string, note?: string | null): Promise<string | null | undefined> {
    if (note === undefined) return undefined;
    if (note === null || note.trim() === '') return null;
    const nodes = await workspaceRepository.listNodes(workspaceId, undefined, true);
    const notes = nodes.filter((node) => node.type === 'note');
    const normalized = note.trim().toLowerCase();
    const found =
      notes.find((node) => node.id === note) ??
      notes.find((node) => (node.title ?? '').toLowerCase() === normalized) ??
      notes.find((node) => (node.title ?? '').toLowerCase().includes(normalized));
    if (!found) throw new Error(`Nota "${note}" nao encontrada para vincular a tarefa.`);
    return found.id;
  }

  async taskList(event: any) {
    try {
      const token = this.requireToken(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await taskBoardService.list(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar tarefas.', 401);
    }
  }

  async taskColumns(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await boardColumnService.list(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar colunas.', 401);
    }
  }

  async taskCreate(event: any) {
    try {
      const input = bridgeBoardTaskSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const task = await taskBoardService.create(workspace.id, {
        title: input.title,
        description: input.description ?? null,
        assigneeNodeId: await this.assigneeNodeId(workspace.id, input.assignee),
        noteId: (await this.noteNodeId(workspace.id, input.note)) ?? null,
        createdBy: input.from ?? 'agente',
        status: input.status,
      });
      // O quadro aparece no canvas junto com a primeira tarefa.
      await bridgeService.ensureTasksBoard(workspace.id).catch(() => {});
      return this.json({ data: task }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar tarefa.');
    }
  }

  async taskUpdate(event: any) {
    try {
      const input = bridgeBoardTaskUpdateSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const task = await taskBoardService.update(workspace.id, event.params.taskId, {
        status: input.status,
        description: input.description,
        assigneeNodeId: input.assignee !== undefined ? await this.assigneeNodeId(workspace.id, input.assignee) : undefined,
        noteId: await this.noteNodeId(workspace.id, input.note),
        notifyCompletion: true,
        completedBy: input.from,
      });
      return this.json({ data: task });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao atualizar tarefa.');
    }
  }

  /** Historico do quadro (concluidas + arquivadas) via bridge. */
  async taskHistory(event: any) {
    try {
      const token = this.requireToken(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await taskBoardService.history(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao consultar o historico.', 401);
    }
  }

  // -- FS via bridge (orkestrai fs) --------------------------------------------

  async fsRead(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const path = String(event.url.searchParams.get('path') ?? '');
      if (!path) throw new Error('Informe ?path=');
      return this.json({ data: await filesystemService.read(workspace.id, path) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao ler arquivo.');
    }
  }

  async fsWrite(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const body = await event.request.json();
      return this.json({ data: await filesystemService.write(workspace.id, String(body.path ?? ''), String(body.content ?? '')) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao escrever arquivo.');
    }
  }

  async fsSearch(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const query = String(event.url.searchParams.get('q') ?? '');
      return this.json({ data: await filesystemService.search(workspace.id, query, { byContent: event.url.searchParams.get('content') === '1' }) });
    } catch (error) {
      return this.errorResponse(error, 'Falha na busca.');
    }
  }

  /** Re-despacha a tarefa para o agente atribuido (orkestrai run <taskId>). */
  async taskDispatch(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      return this.json({ data: await taskBoardService.redispatch(workspace.id, event.params.taskId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao despachar tarefa.');
    }
  }

  /** TTS sob demanda (orkestrai say): fala no desktop via broadcast do canvas. */
  async say(event: any) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.requireToken(event));
      const body = await event.request.json();
      const text = String(body.text ?? '').trim().slice(0, 500);
      if (!text) throw new Error('Informe o texto.');
      const broadcast = (globalThis as { __orkestraiBroadcast?: (payload: Record<string, unknown>) => void }).__orkestraiBroadcast;
      broadcast?.({ type: 'say', workspaceId: workspace.id, text });
      return this.json({ data: { said: true } });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao falar.');
    }
  }

  /** Arquiva uma tarefa concluida via bridge. */
  async taskArchive(event: any) {
    try {
      const token = this.tokenFrom(event, null);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await taskBoardService.archive(workspace.id, event.params.taskId) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao arquivar tarefa.');
    }
  }

  /** Arquiva TODAS as concluidas via bridge (limpeza do quadro). */
  async taskArchiveDone(event: any) {
    try {
      const token = this.tokenFrom(event, null);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await taskBoardService.archiveDone(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao arquivar concluidas.');
    }
  }

  // -- Andares (worktrees) via bridge ------------------------------------------

  async floorList(event: any) {
    try {
      const token = this.requireToken(event);
      const workspace = await bridgeService.resolveWorkspaceByToken(token);
      return this.json({ data: await floorService.list(workspace.id) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao listar andares.', 401);
    }
  }

  async floorCreate(event: any) {
    try {
      const input = bridgeFloorCreateSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      const floor = await floorService.create(workspace.id, {
        name: input.name,
        branch: input.branch ?? undefined,
        existingBranch: input.existingBranch,
        cloneLayout: input.cloneLayout,
      });
      return this.json({ data: floor }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Falha ao criar andar.');
    }
  }

  async floorPreview(event: any) {
    try {
      const token = this.requireToken(event);
      await bridgeService.resolveWorkspaceByToken(token);
      const target = event.url.searchParams.get('target') ?? undefined;
      return this.json({ data: await floorService.landingPreview(event.params.floorId, target) });
    } catch (error) {
      return this.errorResponse(error, 'Falha na previa de aterrissagem.');
    }
  }

  async floorLand(event: any) {
    try {
      const input = bridgeFloorLandSchema.parse(await event.request.json());
      await bridgeService.resolveWorkspaceByToken(this.tokenFrom(event, input.token));
      return this.json({ data: await floorService.land(event.params.floorId, input.targetBranch ?? undefined) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao aterrissar andar.');
    }
  }

  async floorRemove(event: any) {
    try {
      const token = this.requireToken(event);
      await bridgeService.resolveWorkspaceByToken(token);
      const deleteBranch = event.url.searchParams.get('deleteBranch') === 'true';
      return this.json({ data: await floorService.remove(event.params.floorId, deleteBranch) });
    } catch (error) {
      return this.errorResponse(error, 'Falha ao remover andar.');
    }
  }

  private requireToken(event: any): string {
    const header = event.request.headers.get('authorization');
    if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
    const fromQuery = event.url.searchParams.get('token');
    if (fromQuery) return fromQuery;
    throw new Error('Informe o token da ponte (Bearer ou ?token=).');
  }

  /** Token do corpo (CLI legada) com fallback para o header Authorization. */
  private tokenFrom(event: any, bodyToken?: string | null): string {
    return bodyToken ?? this.requireToken(event);
  }

  private async resolveImageWorkflowActor(workspaceId: string, from: string): Promise<string> {
    const actor = (await bridgeService.listAgents(workspaceId)).find((agent) => (
      agent.nodeId === from || agent.title.toLowerCase() === from.toLowerCase()
    ));
    if (!actor) throw new ImageWorkflowError('image_workflow_executor_unauthorized', 403);
    return actor.nodeId;
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }

  private imageWorkflowError(error: unknown, fallback: string, status = 400) {
    if (error instanceof ImageWorkflowError) return this.json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return this.json({ error: error.issues[0]?.message ?? 'image_workflow_validation_failed' }, 422);
    return this.json({ error: fallback }, status);
  }
}
