import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { AgentWorkspaceToolService, redactResolvedSecrets, ToolExecutionService } from '$lib/modules/agent-room/application/services/AgentWorkspaceToolService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { secretRefService } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { workspaceToolManifestSchema } from '$lib/modules/agent-room/contracts/schemas/agent-workspace-tool.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { ToolRunsQueryRequest } from '$lib/modules/agent-room/interface/http/requests/AgentWorkspaceToolRequests.js';
import { managedPortalService } from '$lib/modules/agent-room/application/services/ManagedPortalService.js';
import { AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';

function manifest(version: number) {
  return workspaceToolManifestSchema.parse({
    schemaVersion: 1,
    executor: { kind: 'transform', operations: [{ kind: 'set', path: 'version', value: version }] },
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
    outputSchema: { type: 'object', properties: { version: { type: 'integer' } }, additionalProperties: true },
    capabilities: ['tool'], secretRefs: [], timeoutMs: 5_000, maxOutputBytes: 65_536,
    fixtures: [{ name: 'basic', input: { value: 'hello' } }],
  });
}

describe('Tool Workshop', () => {
  useSvelarTest({ refreshDatabase: true });

  it('auto-publishes only bounded tools for named agents with valid fixtures and limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-tool-publication-'));
    const workspace = await workspaceRepository.createWorkspace({name:'Tool grants',workingDir:root});
    const agent = await workspaceRepository.createNode({workspaceId:workspace.id,type:'terminal',title:'Author'});
    const current = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id,{enabled:true,mode:'bounded',policy:{...current.policy,
      capabilities:[...current.policy.capabilities,'tool'],
      toolPublication:{enabled:true,agentIds:[agent.id],kinds:['transform'],maxTimeoutMs:5000,maxOutputBytes:65536},
    }});
    const service=new AgentWorkspaceToolService();
    const create=(slug:string,changes={},actorId=agent.id)=>service.create(workspace.id,{name:slug,slug,description:'',manifest:workspaceToolManifestSchema.parse({...manifest(1),...changes}),actor:{type:'agent',id:actorId}});
    expect((await create('accepted')).publishedRevision).toBe(1);
    expect((await create('unknown-agent',{},'00000000-0000-4000-8000-000000000001')).publishedRevision).toBeNull();
    expect((await create('missing-fixture',{fixtures:[]})).publishedRevision).toBeNull();
    expect((await create('over-budget',{maxOutputBytes:65537})).publishedRevision).toBeNull();
    expect((await create('owner-command',{executor:{kind:'workspace_command',executable:'echo',args:['ok']},capabilities:['tool','filesystem']})).publishedRevision).toBeNull();
    const updated=await service.update(workspace.id,(await create('versioned')).id,{manifest:manifest(2),actor:{type:'agent',id:agent.id},changeSummary:'v2'});
    expect(updated.publishedRevision).toBe(2);
    const audit=await autonomyPolicyService.listAudit(workspace.id);
    expect(audit.some((event)=>event.metadata.operation==='tool:auto_publish'&&event.eventType==='completed')).toBe(true);
    expect(audit.some((event)=>event.metadata.operation==='tool:auto_publish'&&event.eventType==='failed')).toBe(true);
  });

  it('resumes browser sequences after a gate without replaying completed steps or changing the published revision', async () => {
    const root=await mkdtemp(join(tmpdir(),'orkestrai-tool-checkpoint-'));
    const workspace=await workspaceRepository.createWorkspace({name:'Browser checkpoint',workingDir:root});
    const portal=await workspaceRepository.createNode({workspaceId:workspace.id,type:'portal',title:'Fixture'});
    const current=await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id,{enabled:true,mode:'bounded',policy:{...current.policy,capabilities:[...current.policy.capabilities,'tool']}});
    const service=new AgentWorkspaceToolService();
    const browser=workspaceToolManifestSchema.parse({...manifest(1),executor:{kind:'browser',nodeId:portal.id,steps:[
      {action:'extract',args:{kind:'text'}}, {action:'click',target:{role:'button',name:'Send report'},args:{}},
    ]},capabilities:['tool','browser'],outputSchema:{type:'object',additionalProperties:true}});
    const tool=await service.create(workspace.id,{name:'Browser sequence',slug:'browser-sequence',description:'',manifest:browser,actor:{type:'user',id:'owner'}});
    await service.publish(workspace.id,tool.id,{type:'user',id:'owner'});
    let effects=0;
    const mock=vi.spyOn(managedPortalService,'execute').mockImplementation(async (_workspace,command,context)=>{
      if(command.action==='snapshot')return {id:'snapshot',ok:true,result:{elements:[{ref:'e42',role:'button',name:'Send report'}]}};
      if(command.action==='extract')return {id:'read',ok:true,result:'first-step'};
      return autonomyPolicyService.execute({workspaceId:workspace.id,capability:'browser',operation:'portal:click',actorType:'user',actorId:'owner',stepId:context?.stepId,mutation:true,risk:'external_publication'},async()=>{
        effects++;return {id:'send',ok:true,result:'sent'};
      });
    });
    try {
      const execution=new ToolExecutionService();
      const request={input:{},idempotencyKey:'browser-run-1',dryRun:false,actor:{type:'user' as const,id:'owner'},automationRunId:null};
      await expect(execution.execute(workspace.id,tool.id,request)).rejects.toBeInstanceOf(AutonomyGatePendingError);
      const [pending]=await execution.listRuns(workspace.id,tool.id);
      expect(pending.status).toBe('waiting_approval');expect(pending.checkpoint?.steps).toEqual(['first-step']);expect(effects).toBe(0);
      const [gate]=await autonomyPolicyService.listGates(workspace.id);
      await autonomyPolicyService.resolveGate(workspace.id,gate.id,'approved','owner');
      await service.update(workspace.id,tool.id,{manifest:manifest(2),actor:{type:'user',id:'owner'}});
      await service.publish(workspace.id,tool.id,{type:'user',id:'owner'});
      const completed=await execution.execute(workspace.id,tool.id,request);
      expect(completed.revision).toBe(1);expect(completed.output).toEqual({steps:['first-step','sent']});expect(effects).toBe(1);
      expect(mock.mock.calls.filter(([,command])=>command.action==='extract')).toHaveLength(1);
      expect((await execution.execute(workspace.id,tool.id,request)).id).toBe(completed.id);expect(effects).toBe(1);
    }finally{mock.mockRestore();}
  });

  it('reads run filters from a GET query without parsing an empty JSON body', async () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const toolId = '00000000-0000-4000-8000-000000000002';
    const url = new URL(`http://localhost/tools/runs?toolId=${toolId}`);
    const query = await ToolRunsQueryRequest.validate({
      request: new Request(url), url, params: { id: workspaceId }, locals: {},
    } as never);

    expect(query).toEqual({ id: workspaceId, toolId });
  });

  it('rejects embedded credentials and shell syntax at the manifest boundary', () => {
    expect(() => workspaceToolManifestSchema.parse({
      ...manifest(1),
      executor: { kind: 'http', method: 'POST', urlTemplate: 'https://example.com/report', headers: [{ name: 'Authorization', value: 'Bearer exposed' }] },
      capabilities: ['tool', 'network'],
    })).toThrow(/SecretRef/);
    expect(() => workspaceToolManifestSchema.parse({
      ...manifest(1),
      executor: { kind: 'workspace_command', executable: 'npm && curl example.com', args: [], cwd: '.' },
      capabilities: ['tool', 'filesystem'],
    })).toThrow(/Shell syntax/);
  });

  it('redacts resolved credential values from nested trusted-executor output', () => {
    const output = redactResolvedSecrets({
      echoed: 'Bearer raw-secret-value',
      nested: ['prefix raw-secret-value suffix', { safe: true }],
    }, ['raw-secret-value']);

    expect(output).toEqual({
      echoed: 'Bearer [redacted-secret]',
      nested: ['prefix [redacted-secret] suffix', { safe: true }],
    });
    expect(JSON.stringify(output)).not.toContain('raw-secret-value');
  });

  it('keeps the published revision live while an agent proposes a newer draft', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-tool-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Tool Workshop', workingDir: root });
    const service = new AgentWorkspaceToolService();
    const execution = new ToolExecutionService();
    const currentPolicy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, {
      enabled: true, mode: 'bounded', policy: { ...currentPolicy.policy, capabilities: [...new Set([...currentPolicy.policy.capabilities, 'tool' as const])] },
    });
    const tool = await service.create(workspace.id, {
      name: 'Prepare report', slug: 'prepare-report', description: 'Build a bounded report payload.',
      manifest: manifest(1), actor: { type: 'user', id: 'workspace-owner' },
    });
    await service.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' });
    await service.update(workspace.id, tool.id, {
      manifest: manifest(2), actor: { type: 'agent', id: 'agent-1' }, changeSummary: 'Propose v2',
    });

    const actual = await execution.execute(workspace.id, tool.id, {
      input: {}, idempotencyKey: 'task:report:published', dryRun: false,
      actor: { type: 'automation', id: 'daily-report' }, automationRunId: null,
    });
    expect(actual.revision).toBe(1);
    expect(actual.output).toMatchObject({ version: 1 });

    const draft = await execution.execute(workspace.id, tool.id, {
      input: {}, idempotencyKey: 'task:report:draft-preview', dryRun: true,
      actor: { type: 'user', id: 'workspace-owner' }, automationRunId: null,
    });
    expect(draft.revision).toBe(2);
    expect(draft.output).toMatchObject({ valid: true, revision: 2 });
  });

  it('deduplicates a published effect and rejects idempotency-key reuse with different input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-tool-idempotency-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Tool idempotency', workingDir: root });
    const service = new AgentWorkspaceToolService();
    const execution = new ToolExecutionService();
    const currentPolicy = await autonomyPolicyService.get(workspace.id);
    await autonomyPolicyService.update(workspace.id, {
      enabled: true, mode: 'bounded', policy: { ...currentPolicy.policy, capabilities: [...new Set([...currentPolicy.policy.capabilities, 'tool' as const])] },
    });
    const tool = await service.create(workspace.id, {
      name: 'Stable transform', slug: 'stable-transform', description: '', manifest: manifest(1),
      actor: { type: 'user', id: 'workspace-owner' },
    });
    await service.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' });
    const request = {
      input: { key: 'same' }, idempotencyKey: 'task:stable:1', dryRun: false,
      actor: { type: 'agent' as const, id: 'agent-1' }, automationRunId: null,
    };
    const first = await execution.execute(workspace.id, tool.id, request);
    const duplicate = await execution.execute(workspace.id, tool.id, request);
    expect(duplicate.id).toBe(first.id);
    await expect(execution.execute(workspace.id, tool.id, { ...request, input: { key: 'different' } })).rejects.toThrow(/different input/);
  });

  it('requires explicit tool, operation, and destination bindings before publishing a SecretRef', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-tool-secret-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Tool secrets', workingDir: root });
    const service = new AgentWorkspaceToolService();
    const unbound = await secretRefService.create(workspace.id, {
      name: 'Unbound API key', provider: 'desktop', bindings: { integrations: [], operations: [], destinations: [] },
    });
    const httpManifest = (secretRef: string) => workspaceToolManifestSchema.parse({
      schemaVersion: 1,
      executor: {
        kind: 'http', method: 'POST', urlTemplate: 'https://api.example.com/reports',
        headers: [{ name: 'Authorization', secretRef }], bodyTemplate: '{"title":"{{title}}"}',
      },
      inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false },
      outputSchema: { type: 'object', properties: {}, additionalProperties: true },
      capabilities: ['tool', 'network'], secretRefs: [secretRef], timeoutMs: 5_000, maxOutputBytes: 65_536, fixtures: [],
    });
    const tool = await service.create(workspace.id, {
      name: 'Send report', slug: 'send-report', description: '', manifest: httpManifest(unbound.ref),
      actor: { type: 'user', id: 'workspace-owner' },
    });
    await expect(service.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' })).rejects.toThrow(/not bound to Tool Workshop/);

    const bound = await secretRefService.create(workspace.id, {
      name: 'Report API key', provider: 'desktop',
      bindings: { integrations: ['tool'], operations: ['tool:send-report'], destinations: ['api.example.com'] },
    });
    await service.update(workspace.id, tool.id, {
      manifest: httpManifest(bound.ref), actor: { type: 'user', id: 'workspace-owner' }, changeSummary: 'Bind the approved credential',
    });
    const published = await service.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' });
    expect(published.publishedRevision).toBe(2);

    await expect(new ToolExecutionService().execute(workspace.id, tool.id, {
      input: { title: 'Daily report', accessToken: 'must-not-enter-a-tool-run' },
      idempotencyKey: 'tool-secret-input:1', dryRun: true, actor: { type: 'user', id: 'workspace-owner' }, automationRunId: null,
    })).rejects.toThrow(/SecretRef/);
  });

  it('never persists or returns a credential echoed by an HTTP tool endpoint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-tool-secret-output-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'Tool output redaction', workingDir: root });
    const service = new AgentWorkspaceToolService();
    const ref = await secretRefService.create(workspace.id, {
      name: 'Echoed API key', provider: 'host_vault',
      bindings: { integrations: ['tool'], operations: ['tool:echo-report'], destinations: ['api.example.com'] },
    });
    const tool = await service.create(workspace.id, {
      name: 'Echo report', slug: 'echo-report', description: '',
      manifest: workspaceToolManifestSchema.parse({
        schemaVersion: 1,
        executor: {
          kind: 'http', method: 'POST', urlTemplate: 'https://api.example.com/reports',
          headers: [{ name: 'Authorization', secretRef: ref.ref }], bodyTemplate: null,
        },
        inputSchema: { type: 'object', properties: {}, additionalProperties: true },
        outputSchema: { type: 'object', properties: {}, additionalProperties: true },
        capabilities: ['tool', 'network'], secretRefs: [ref.ref], timeoutMs: 5_000,
        maxOutputBytes: 65_536, fixtures: [],
      }),
      actor: { type: 'user', id: 'workspace-owner' },
    });
    await service.publish(workspace.id, tool.id, { type: 'user', id: 'workspace-owner' });
    const state = globalThis as typeof globalThis & { __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null> };
    state.__orkestraiHostVaultResolve = async (reference) => reference === ref.ref ? 'raw-http-secret' : null;
    const execution = new ToolExecutionService({
      request: async () => ({
        status: 200, ok: true,
        json: { echoed: 'Bearer raw-http-secret', nested: { value: 'raw-http-secret' } },
      }),
    } as never);

    try {
      const run = await execution.execute(workspace.id, tool.id, {
        input: {}, idempotencyKey: 'http-secret-redaction:1', dryRun: false,
        actor: { type: 'agent', id: 'agent-1' }, automationRunId: null,
      });
      expect(run.output).toEqual({
        echoed: 'Bearer [redacted-secret]', nested: { value: '[redacted-secret]' },
      });
      expect(JSON.stringify(await execution.listRuns(workspace.id, tool.id))).not.toContain('raw-http-secret');
      expect(JSON.stringify(await autonomyPolicyService.exportAudit(workspace.id))).not.toContain('raw-http-secret');
    } finally {
      delete state.__orkestraiHostVaultResolve;
    }
  });
});
