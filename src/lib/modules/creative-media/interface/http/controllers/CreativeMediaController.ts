import { Controller } from '@beeblock/svelar/routing';
import { CreativeVideoUploadDto } from '../../../application/dto/CreativeMediaDto.js';
import { CreativeVideoUploadRequest } from '../requests/CreativeMediaRequest.js';
import { CreativeMediaFiles } from '../../../application/services/CreativeMediaFiles.js';
import { FormValidationError } from '@beeblock/svelar/forms';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { CreativeMediaDto, type CreativeCommand } from '../../../application/dto/CreativeMediaDto.js';
import { ExecuteCreativeMediaAction } from '../../../application/actions/ExecuteCreativeMediaAction.js';
import { CreativeProviderDto } from '../../../application/dto/CreativeProviderDto.js';
import { ExecuteCreativeProviderAction } from '../../../application/actions/ExecuteCreativeProviderAction.js';
import { creativeProviderService } from '../../../application/services/CreativeProviderService.js';
import { creativeWorkflowService } from '../../../application/services/CreativeWorkflowService.js';
import { CreativeMediaError } from '../../../domain/types.js';
import { CREATIVE_MODELS } from '../../../domain/catalog.js';
import { creativeVideoResponse } from '../../../application/services/CreativeVideoPlayback.js';
import { CreativeProfileRequest, CreativePolicyRequest, CreativeWorkflowRequest, CreativeRunRequest, CreativeRunCommandRequest, CreativeBridgeRequest, creativeBodyEvent } from '../requests/CreativeMediaRequest.js';

export class CreativeMediaController extends Controller {
  uploadVideo(event: any) { return this.respond(async () => {
    this.owner(event);
    const input = await CreativeVideoUploadRequest.validate(creativeBodyEvent(event));
    return new CreativeMediaFiles().importVideo(CreativeVideoUploadDto.from(event.params.id, input));
  }); }
  models(event: any) { return this.respond(async () => {
    this.owner(event);
    return new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(event.params.id, { type: 'user' }, 'models', undefined, Object.fromEntries(event.url.searchParams)));
  }); }
  video(event: any) { return creativeVideoResponse(event.params.id, event.params.assetId, event.request); }
  private async respond(operation: () => Promise<unknown>) {
    try { return this.json({ data: await operation() }); }
    catch (error) {
      const validation = error instanceof FormValidationError || (error as Error)?.name === 'ZodError';
      return this.json({ error: error instanceof CreativeMediaError ? error.code : validation ? 'creative_invalid_input' : 'creative_request_failed', ...(error instanceof CreativeMediaError && error.billing ? { billing: error.billing } : {}) }, error instanceof CreativeMediaError ? error.status : validation ? 422 : 500);
    }
  }
  private owner(event: any) {
    const origin = event.request.headers.get('origin');
    if (event.request.headers.has('authorization') || event.request.headers.has('x-orkestrai-agent-token') || (event.request.method !== 'GET' && origin !== event.url.origin)) throw new CreativeMediaError('creative_owner_required', 403);
  }
  profiles(event: any) { return this.respond(async () => { this.owner(event); return creativeProviderService.profiles(); }); }
  saveProfile(event: any) { return this.respond(async () => {
    this.owner(event);
    return new ExecuteCreativeProviderAction().execute(CreativeProviderDto.save(await CreativeProfileRequest.validate(creativeBodyEvent(event)), event.params.profileId));
  }); }
  removeProfile(event: any) { return this.respond(async () => { this.owner(event); return new ExecuteCreativeProviderAction().execute(CreativeProviderDto.remove(event.params.profileId)); }); }
  index(event: any) { return this.respond(async () => {
    this.owner(event);
    await creativeWorkflowService.assertActor(event.params.id, { type: 'user' }, false);
    const profiles = await creativeProviderService.profiles();
    const policies = [];
    for (const profile of profiles) {
      const policy = await creativeProviderService.repository.policy(event.params.id, profile.id);
      if (policy) policies.push(policy);
    }
    const inputs = (await creativeWorkspaceGateway.nodes(event.params.id)).filter(node => ['image', 'video', 'note'].includes(node.type)).map(node => ({ id: node.id, type: node.type, title: node.title, ...(['image', 'video'].includes(node.type) && typeof (node.payload as { path?: unknown }).path === 'string' ? { path: (node.payload as { path: string }).path } : {}) }));
    return { profiles, policies, inputs, catalog: Object.values(CREATIVE_MODELS), workflows: await creativeWorkflowService.list(event.params.id) };
  }); }
  savePolicy(event: any) { return this.respond(async () => {
    this.owner(event);
    return new ExecuteCreativeProviderAction().execute(CreativeProviderDto.policy(event.params.id, event.params.profileId, await CreativePolicyRequest.validate(creativeBodyEvent(event))));
  }); }
  private ownerCommand(event: any, command: CreativeCommand, Request?: typeof CreativeWorkflowRequest | typeof CreativeRunRequest) { return this.respond(async () => {
    this.owner(event);
    const input = Request === CreativeRunRequest ? await CreativeRunRequest.validate(creativeBodyEvent(event))
      : Request ? await CreativeWorkflowRequest.validate(creativeBodyEvent(event)) : undefined;
    return new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(event.params.id, { type: 'user' }, command, event.params.nodeId, input));
  }); }
  read(event: any) { return this.ownerCommand(event, 'read'); }
  create(event: any) { return this.ownerCommand(event, 'create', CreativeWorkflowRequest); }
  update(event: any) { return this.ownerCommand(event, 'update', CreativeWorkflowRequest); }
  preview(event: any) { return this.ownerCommand(event, 'preview'); }
  run(event: any) { return this.ownerCommand(event, 'run', CreativeRunRequest); }
  remove(event: any) { return this.ownerCommand(event, 'remove'); }
  command(event: any) { return this.respond(async () => {
    this.owner(event);
    const input = await CreativeRunCommandRequest.validate(creativeBodyEvent(event));
    return new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(event.params.id, { type: 'user' }, input.command, undefined, undefined, input.runId));
  }); }
  bridge(event: any) { return this.respond(async () => {
    const token = /^Bearer (.+)$/.exec(event.request.headers.get('authorization') ?? '')?.[1];
    if (!token) throw new CreativeMediaError('creative_agent_required', 401);
    const workspace = await bridgeService.resolveWorkspaceByToken(token);
    const nodeId = ptySessionManager.resolveBridgeAgent(workspace.id, event.request.headers.get('x-orkestrai-agent-token') ?? '');
    if (!nodeId) throw new CreativeMediaError('creative_agent_required', 403);
    const input = await CreativeBridgeRequest.validate(creativeBodyEvent(event));
    return new ExecuteCreativeMediaAction().execute(CreativeMediaDto.from(workspace.id, { type: 'agent', nodeId, taskId: input.taskId }, input.command, input.nodeId, input.input, input.runId));
  }); }
}
