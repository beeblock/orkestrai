import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ModelAccessService } from '$lib/modules/model-access/application/services/ModelAccessService.js';
import { CreateModelAccessDto, JoinModelAccessDto, ApproveModelAccessDto } from '$lib/modules/model-access/application/dto/ModelAccessDto.js';
import { parseInferenceInvite } from '@orkestrai/collaboration-protocol/inference';
import { createRelayServer } from '../../packages/orkestrai-relay/src/server.mjs';
import type { ModelAccessGrant, ModelAccessConnection } from '$lib/modules/model-access/domain/types.js';
import type { ModelAccessRepository } from '$lib/modules/model-access/infrastructure/repositories/ModelAccessRepository.js';
import type { InferenceProvider } from '$lib/modules/model-access/infrastructure/providers/InferenceProvider.js';
import { mkdtemp, readFile, writeFile, mkdir, rm, copyFile, readdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { delegatedImageTools } from '$lib/modules/agent-room/application/adapters/delegated-image-tools.js';
import { GuestWorkspaceTools } from '$lib/modules/model-access/infrastructure/guest/GuestWorkspaceTools.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { modelAccessService } from '$lib/modules/model-access/application/services/ModelAccessService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ImageWorkflowService } from '$lib/modules/agent-room/application/services/ImageWorkflowService.js';
import { RunImageWorkflowDto } from '$lib/modules/agent-room/application/dto/ImageWorkflowDtos.js';
import { imageWorkflowConfigSchema } from '$lib/modules/agent-room/contracts/schemas/imageWorkflowSchemas.js';

function memory() {
  const grants = new Map<string, ModelAccessGrant>(), connections = new Map<string, ModelAccessConnection>(), ledger = new Set<string>(), audits: unknown[] = [], secrets = new Map<string,string>();
  const repository = {
    grants: async () => [...grants.values()], grant: async (id: string) => structuredClone(grants.get(id) ?? null),
    async createGrant(input: any) { const grant = { ...input, id: randomUUID(), status: 'draft', revision: 1, guest: null, requestsUsed: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; grants.set(grant.id, grant); return structuredClone(grant); },
    async updateGrant(id: string, revision: number, patch: any) { const grant = grants.get(id)!; if (grant.revision !== revision) throw new Error('MODEL_ACCESS_REVISION_CONFLICT'); Object.assign(grant, patch, { revision: revision + 1 }); return structuredClone(grant); },
    async reserveRequest(id: string, revision: number, requestId: string) { const grant = grants.get(id)!; if (grant.revision !== revision || grant.status !== 'active') throw new Error('INFERENCE_NOT_ACTIVE'); if (ledger.has(requestId)) throw new Error('INFERENCE_DUPLICATE_REQUEST'); ledger.add(requestId); grant.requestsUsed++; },
    async finishRequest() {}, async recoverRequests() {},
    connections: async () => [...connections.values()], connection: async (id: string) => structuredClone(connections.get(id) ?? null),
    async createConnection(input: any) { const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; connections.set(row.id, row); return structuredClone(row); },
    async updateConnection(id: string, patch: any) { Object.assign(connections.get(id)!, patch); return structuredClone(connections.get(id)!); },
    async audit(...args: unknown[]) { audits.push(args); }, audits: async () => audits,
  } as unknown as ModelAccessRepository;
  return { grants, connections, ledger, audits, secrets, repository, vault: { get: async (key: string) => secrets.get(key) ?? null, set: async (key: string, value: string) => { secrets.set(key, value); }, delete: async (key: string) => { secrets.delete(key); } } };
}
const services: ModelAccessService[] = []; let relay: ReturnType<typeof createRelayServer> | undefined;
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.stop())); await relay?.close(); relay = undefined; vi.restoreAllMocks(); });
async function wait<T>(fn: () => Promise<T>, accept: (value: T) => boolean): Promise<T> { for (let i=0;i<150;i++) { const value = await fn(); if (accept(value)) return value; await new Promise(resolve => setTimeout(resolve,20)); } throw new Error('Expected state was not reached.'); }
async function setup(provider: InferenceProvider, image = false) {
  relay = createRelayServer(); const address = await relay.listen(0); if (!address || typeof address === 'string') throw new Error('address');
  const owner = memory(), guest = memory(), profiles = { list: async () => [], assertCompatible: async () => {} };
  const hostService = new ModelAccessService({ repository: owner.repository, secrets: owner.vault, profiles, provider });
  const guestService = new ModelAccessService({ repository: guest.repository, secrets: guest.vault, profiles, provider }); services.push(hostService, guestService);
  const grant = await hostService.create(CreateModelAccessDto.from({ name: 'Test guest', relayUrl: `ws://127.0.0.1:${address.port}`, expiresInMinutes: 10, offerings: [{ providerId: image ? 'codex' : 'claude', profileId: null, models: [image ? 'gpt-6.1-sol' : 'sonnet'], efforts: ['high'], images: image }], concurrency: 1, requestsPerMinute: 10, maxRequests: 5 }));
  await wait(() => hostService.status(), state => state.grants[0].state === 'connected');
  const { invite } = await hostService.invite(grant.id);
  const connection = await guestService.join(JoinModelAccessDto.from({ invite, displayName: 'Guest machine', relayUrl: grant.relayUrl }));
  const pending = (await wait(() => hostService.status(), state => state.grants[0].pending.length === 1)).grants[0].pending[0];
  expect((await guestService.status()).connections[0].status).toBe('pending');
  await hostService.approve(ApproveModelAccessDto.from(grant.id, { revision: grant.revision, guestId: pending.id, fingerprint: pending.fingerprint, approved: true }));
  await wait(() => guestService.status(), state => state.connections[0].state === 'connected');
  const request = { offeringId: grant.policy.offerings[0].id, model: image ? 'gpt-6.1-sol' : 'sonnet', effort: 'high' as const, system: 'Act on the guest only.', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Private guest prompt.' }] }], tools: [{ name: 'local_test', description: 'Guest only.', inputSchema: { type: 'object', properties: {} } }] };
  return { owner, guest, hostService, guestService, grant, connection, request, invite };
}
describe('delegated model access through the real relay', () => {
  it('returns a large Codex edit to guest files and validates/completes the native Canvas image workflow', async () => {
    const directory = await mkdtemp(join(tmpdir(),'orkestrai-model-access-workflow-'));
    try {
      // Incompressible fixture exercises encrypted, multi-frame image transfer in both directions.
      const png = new PNG({width:512,height:512}); let seed = 7;
      for (let i=0;i<png.data.length;i+=4) { for(let c=0;c<3;c++) { seed=(Math.imul(seed,1664525)+1013904223)>>>0; png.data[i+c]=seed>>>24; } png.data[i+3]=255; }
      const bytes = PNG.sync.write(png); expect(bytes.length).toBeGreaterThan(500000);
      await writeFile(join(directory,'reference.png'),bytes);
      let generations = 0, execution: any;
      const context = await setup({async run(input) {
        try {
        const call = delegatedImageTools(input,{CODEX_HOME:'owner-only-private-path'},async (request,profile) => {
          generations++; expect(profile.CODEX_HOME).toBe('owner-only-private-path'); expect(Buffer.from(request.references[0].data,'base64')).toEqual(bytes); return bytes;
        });
        const args = {prompt:execution.tool.prompt,referenced_image_paths:[join(directory,'reference.png')],transparent_background:false,idempotencyKey:randomUUID()};
        const result = await call('imagegen',args); expect(await call('imagegen',args)).toEqual(result);
        await expect(call('imagegen',{...args,prompt:'different'})).rejects.toThrow('IDEMPOTENCY_CONFLICT');
        const stored = JSON.parse((result.content[0] as {text:string}).text);
        expect(await readFile(stored.path)).toEqual(bytes); expect(stored.path.startsWith(await realpath(directory))).toBe(true);
        await call('copy_file',{source:stored.path,destination:execution.outputAbsolutePaths[0]});
        const validation = await call('image_workflow_validate',{nodeId:'workflow',runId:execution.runId,outputPath:execution.outputPaths[0]});
        expect(JSON.parse((validation.content[0] as {text:string}).text).valid).toBe(true);
        await call('image_workflow_complete',{nodeId:'workflow',runId:execution.runId,outputPaths:execution.outputPaths});
        await input.emit('text','Image delivered on the guest Canvas.');
        } catch(error) { console.error('Image pipeline fixture:',error); throw error; }
      }},true);
      vi.spyOn(modelAccessService,'status').mockImplementation(() => context.guestService.status());
      vi.spyOn(autonomyPolicyService,'runWindow').mockResolvedValue({allowed:true} as any);
      vi.spyOn(autonomyPolicyService,'execute').mockImplementation(async (_input,run) => run());
      const workspace = {id:randomUUID(),workingDir:directory,runtimeKind:'native',repositoryRoots:[],instructions:null} as any;
      const model = `${context.connection.id}/${context.request.offeringId}/${context.request.model}`;
      const executor = {id:randomUUID(),workspaceId:workspace.id,type:'terminal',title:'Guest Artist',payload:{provider:'shared',args:['--model',model]}} as any;
      let workflow = {id:'workflow',workspaceId:workspace.id,type:'imageWorkflow',title:'Guest image',x:0,y:0,width:440,height:560,zIndex:0,floorId:null,payload:{...imageWorkflowConfigSchema.parse({prompt:'Blue icon',count:1,transparentBackground:false,outputDirectory:'generated',filePrefix:'result'}),history:[],status:'idle'}} as any;
      const reference = {id:'reference',workspaceId:workspace.id,type:'image',payload:{path:'reference.png'}} as any;
      vi.spyOn(workspaceRepository,'getWorkspace').mockResolvedValue(workspace);
      vi.spyOn(workspaceRepository,'getNode').mockImplementation(async id => id === workflow.id ? workflow : id === executor.id ? executor : reference);
      vi.spyOn(workspaceRepository,'listNodes').mockImplementation(async () => [workflow,executor,reference]);
      vi.spyOn(workspaceRepository,'listEdges').mockResolvedValue([{sourceNodeId:'workflow',targetNodeId:executor.id},{sourceNodeId:'reference',targetNodeId:'workflow'}] as any);
      vi.spyOn(workspaceRepository,'updateNode').mockImplementation(async (_id,patch) => workflow={...workflow,...patch});
      const create = vi.spyOn(workspaceRepository,'createNode').mockImplementation(async input => ({...input,id:randomUUID()} as any));
      vi.spyOn(workspaceRepository,'createEdge').mockResolvedValue({id:randomUUID()} as any);
      vi.spyOn(bridgeService,'listAgents').mockResolvedValue([{nodeId:executor.id,title:'Guest Artist',provider:'shared',sessionId:'guest-session',sessionAlive:true}] as any);
      vi.spyOn(filesystemService,'inspect').mockResolvedValue({path:join(directory,'reference.png'),kind:'image',size:bytes.length,contentType:'image/png'} as any);
      vi.spyOn(filesystemService,'readBinary').mockImplementation(async (_id,path) => ({data:await readFile(join(directory,path)),contentType:'image/png',name:path}));
      const service = new ImageWorkflowService();
      execution = await service.begin(new RunImageWorkflowDto(workspace.id,'workflow',workflow.payload,executor.id));
      expect(execution.executor.provider).toBe('shared'); expect(execution.tool.normalizedName).toBe('mcp__guest__imagegen');
      const tools = new GuestWorkspaceTools({workspaceId:workspace.id,nodeId:executor.id,cwd:directory,workspaceRoot:directory,runtime:{kind:'native'},imagesAllowed:true,signal:AbortSignal.timeout(20000),env:{},bridge:async (_method,path,body:any) => {
        expect(body.from).toBe(executor.id);
        if (path.endsWith('/validate')) return service.validateOutput(workspace.id,'workflow',body.runId,body.outputPath,executor.id);
        if (path.endsWith('/complete')) return service.complete({workspaceId:workspace.id,nodeId:'workflow',runId:body.runId,outputPaths:body.outputPaths,actorNodeId:executor.id});
        throw new Error('unexpected bridge path');
      }});
      await context.guestService.infer(context.connection.id,{...context.request,tools:tools.manifest},{signal:AbortSignal.timeout(20000),emit:async () => {},callTool:(name,args) => tools.call(name,args)});
      expect(generations).toBe(1); expect(context.owner.ledger.size).toBe(2);
      expect(create).toHaveBeenCalledWith(expect.objectContaining({type:'image',payload:expect.objectContaining({path:execution.outputPaths[0]})}));
      expect(workflow.payload.status).toBe('succeeded');
      const manifests = await readdir(join(directory,'.orkestrai/generated-images/manifests')); expect(manifests).toHaveLength(1);
      const serialized = JSON.stringify([...context.owner.grants.values(),...context.owner.audits]);
      expect(serialized).not.toContain('owner-only-private-path'); expect(serialized).not.toContain(execution.tool.prompt);
      const denied = new GuestWorkspaceTools({workspaceId:workspace.id,nodeId:executor.id,cwd:directory,workspaceRoot:directory,runtime:{kind:'native'},imagesAllowed:false,signal:new AbortController().signal,env:{},bridge:async () => {throw new Error('unexpected');}});
      expect(denied.manifest.some(tool => tool.name === 'imagegen')).toBe(false);
      await expect(denied.call('imagegen',{prompt:'no',idempotencyKey:randomUUID()})).rejects.toThrow('IMAGE_DENIED');
    } finally { await rm(directory,{recursive:true,force:true}); }
  },30000);
  it('approves an identity, streams inference and executes only the guest tool', async () => {
    let hostCalls = 0, guestCalls = 0;
    const context = await setup({ async run(input) { hostCalls++; const reply = await input.callTool('local_test', { value: 3 }); expect(reply.content).toEqual([{ type: 'text', text: 'from guest' }]); await input.emit('text', 'streamed answer'); } });
    const text: string[] = [];
    await context.guestService.infer(context.connection.id, context.request, { signal: new AbortController().signal, emit: async (_event, value) => { text.push(value); }, callTool: async () => { guestCalls++; return { callId: randomUUID(), success: true, content: [{ type: 'text', text: 'from guest' }] }; } });
    expect(hostCalls).toBe(1); expect(guestCalls).toBe(1); expect(text.join('')).toBe('streamed answer');
    const persisted = JSON.stringify({ grants: [...context.owner.grants.values()], audits: context.owner.audits });
    expect(persisted).not.toContain('Private guest prompt'); expect(persisted).not.toContain('streamed answer'); expect(persisted).not.toContain(parseInferenceInvite(context.invite).secret);
    const policy = (await context.guestService.status()).connections[0].policy!;
    expect(policy.offerings[0]).not.toHaveProperty('profileId');
  });
  it('rejects a forbidden model and effort before invoking the provider', async () => {
    let calls = 0; const context = await setup({ async run() { calls++; } });
    const options = { signal: new AbortController().signal, emit: async () => {}, callTool: async () => { throw new Error('must not call'); } };
    await expect(context.guestService.infer(context.connection.id, { ...context.request, model: 'opus' }, options)).rejects.toThrow('INFERENCE_POLICY_DENIED');
    await expect(context.guestService.infer(context.connection.id, { ...context.request, effort: 'low' }, options)).rejects.toThrow('INFERENCE_POLICY_DENIED');
    expect(calls).toBe(0); expect(context.owner.ledger.size).toBe(0);
  });
  it('refuses an invitation holder who is not the already approved device',async()=>{
    let calls=0;const context=await setup({async run(){calls++;}});
    const intruder=memory();const service=new ModelAccessService({repository:intruder.repository,secrets:intruder.vault,profiles:{list:async()=>[],assertCompatible:async()=>{}},provider:{async run(){throw new Error('wrong side');}}});services.push(service);
    const joined=await service.join(JoinModelAccessDto.from({invite:context.invite,displayName:'Same display name',relayUrl:context.grant.relayUrl}));
    await wait(()=>service.status(),state=>state.connections[0].state==='denied');
    await expect(service.infer(joined.id,context.request,{signal:new AbortController().signal,emit:async()=>{},callTool:async()=>{throw new Error('denied');}})).rejects.toThrow('OFFLINE');
    expect(calls).toBe(0);
  });
  it('reconnects the approved device after both services restart without replaying completed inference',async()=>{
    let calls=0;const provider={async run(input:any){calls++;await input.emit('text','Reply');}};
    const context=await setup(provider);const options={signal:new AbortController().signal,emit:async()=>{},callTool:async()=>{throw new Error('unused');}};
    await context.guestService.infer(context.connection.id,context.request,options);
    await context.guestService.stop();await context.hostService.stop();
    const profiles={list:async()=>[],assertCompatible:async()=>{}};
    const owner=new ModelAccessService({repository:context.owner.repository,secrets:context.owner.vault,profiles,provider});
    const guest=new ModelAccessService({repository:context.guest.repository,secrets:context.guest.vault,profiles,provider});services.push(owner,guest);
    await owner.start();await wait(()=>owner.status(),state=>state.grants[0].state==='connected');await guest.start();
    await wait(()=>guest.status(),state=>state.connections[0].state==='connected');expect(calls).toBe(1);
    await guest.infer(context.connection.id,context.request,options);expect(calls).toBe(2);expect(context.owner.ledger.size).toBe(2);
  });
  it('revokes an active worker and its queued request without another provider call', async () => {
    let calls = 0, stopped = false;
    const context = await setup({ async run(input) { calls++; await new Promise<void>(resolve => input.signal.addEventListener('abort', () => { stopped = true; resolve(); }, { once: true })); } });
    const options = { signal: new AbortController().signal, emit: async () => {}, callTool: async () => { throw new Error('must not call'); } };
    const first = context.guestService.infer(context.connection.id, context.request, options).catch(error => error);
    await wait(async () => calls, value => value === 1);
    const second = context.guestService.infer(context.connection.id, context.request, options).catch(error => error);
    await wait(() => context.hostService.status(), state => state.grants[0].queued === 1);
    const revision = (await context.hostService.status()).grants[0].revision;
    await context.hostService.revoke(context.grant.id, revision);
    expect(await first).toBeInstanceOf(Error); expect(await second).toBeInstanceOf(Error);
    expect(stopped).toBe(true); expect(calls).toBe(1);
    expect((await context.hostService.status()).grants[0].status).toBe('revoked');
  });
});
