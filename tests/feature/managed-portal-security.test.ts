import { mkdtemp, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { managedPortalService, preparePortalDirectory } from '$lib/modules/agent-room/application/services/ManagedPortalService.js';
import { autonomyPolicyService, AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { managedPortalCommandSchema } from '$lib/modules/agent-room/contracts/schemas/managed-portal.schema.js';

const roots: string[] = [];
const runtime = globalThis as typeof globalThis & { __orkestraiExecutePortal?: (request: any) => Promise<any> };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-portal-security-')); roots.push(root);
  const workspace = await workspaceRepository.createWorkspace({ name:'Portal security', workingDir:root });
  const agent = await workspaceRepository.createNode({ workspaceId:workspace.id, type:'terminal', title:'QA' });
  const portal = await workspaceRepository.createNode({ workspaceId:workspace.id, type:'portal', title:'QA browser',
    payload: { url:'https://example.test/', portalControl:'interact', portalAgentIds:[agent.id] } as never });
  const current = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id, { enabled:true, mode:'bounded', policy:{ ...current.policy,
    network:[{ schemes:['https'], hosts:['example.test'], methods:['GET'], ports:[], operations:[] }] } });
  const execute = vi.fn(async (request) => request.inspect
    ? {ok:true,result:{url:'https://example.test/',element:request.args.ref ? {name:'Send report',tag:'button',protected:false}:null}}
    : {ok:true,result:{action:request.action}});
  runtime.__orkestraiExecutePortal = execute;
  const command = (action:string, args = {}) => managedPortalCommandSchema.parse({nodeId:portal.id,action,args});
  const context = {actorType:'agent' as const,actorId:agent.id};
  return {workspace,portal,agent,execute,command,context};
}

describe('authenticated Portal control', () => {
  useSvelarTest({refreshDatabase:true});
  afterEach(async () => { delete runtime.__orkestraiExecutePortal; for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });

  it('denies ungranted agents before inspecting or mutating the page', async () => {
    const f=await fixture();
    await expect(managedPortalService.execute(f.workspace.id,f.command('snapshot'),{actorType:'agent',actorId:'not-granted'})).rejects.toThrow(/not been granted/);
    expect(f.execute).not.toHaveBeenCalled();
    expect((await autonomyPolicyService.listAudit(f.workspace.id)).some((event)=>event.eventType==='failed')).toBe(true);
  });

  it('preserves read-only and paused grants, and audits rejected arbitrary scripts', async () => {
    const f=await fixture();
    await workspaceRepository.updateNode(f.portal.id,{payload:{...f.portal.payload,portalControl:'read'} as never});
    await expect(managedPortalService.execute(f.workspace.id,f.command('click',{ref:'e1'}),f.context)).rejects.toThrow(/control grant/);
    await expect(managedPortalService.execute(f.workspace.id,f.command('snapshot'),f.context)).resolves.toMatchObject({ok:true});
    await expect(managedPortalService.execute(f.workspace.id,f.command('eval',{js:'document.cookie'}),f.context)).rejects.toThrow(/Arbitrary/);
    await workspaceRepository.updateNode(f.portal.id,{payload:{...f.portal.payload,portalPaused:true} as never});
    await expect(managedPortalService.execute(f.workspace.id,f.command('snapshot'),f.context)).rejects.toThrow(/paused/);
  });

  it('gates sends without performing them and accepts new refs for the same approved semantic action', async () => {
    const f=await fixture();
    await expect(managedPortalService.execute(f.workspace.id,f.command('click',{ref:'e1'}),f.context)).rejects.toBeInstanceOf(AutonomyGatePendingError);
    expect(f.execute.mock.calls.every(([request])=>request.inspect)).toBe(true);
    const [gate] = await autonomyPolicyService.listGates(f.workspace.id);
    await autonomyPolicyService.resolveGate(f.workspace.id,gate.id,'approved','owner');
    runtime.__orkestraiExecutePortal = async (request) => {
      const response = await f.execute(request);
      return request.inspect ? { ...response, result: { ...response.result, webContentsId: 99, visible: true, tabs: [{ id: 'remounted' }] } } : response;
    };
    await expect(managedPortalService.execute(f.workspace.id,f.command('click',{ref:'e42'}),f.context)).resolves.toMatchObject({ok:true});
    expect(f.execute.mock.calls.filter(([request])=>!request.inspect)).toHaveLength(1);
  });

  it('rejects sensitive targets and revocation between inspection and execution', async () => {
    const f=await fixture();
    runtime.__orkestraiExecutePortal = async () => ({ok:true,result:{element:{protected:true}}});
    await expect(managedPortalService.execute(f.workspace.id,f.command('type',{ref:'e1',text:'not-a-secret'}),f.context)).rejects.toThrow(/Protected/);
    runtime.__orkestraiExecutePortal = async () => {
      await workspaceRepository.updateNode(f.portal.id,{payload:{...f.portal.payload,portalAgentIds:[]} as never});
      return {ok:true,result:{url:'https://example.test/'}};
    };
    await expect(managedPortalService.execute(f.workspace.id,f.command('snapshot'),f.context)).rejects.toThrow(/revoked/);
  });

  it('records native execution errors as failures rather than successful audit events', async () => {
    const f=await fixture();
    runtime.__orkestraiExecutePortal=async(request)=>request.inspect?{ok:true,result:{url:'https://example.test/'}}:{ok:false,error:'Portal reference is stale.'};
    await expect(managedPortalService.execute(f.workspace.id,f.command('snapshot'),f.context)).rejects.toThrow(/stale/);
    const events=await autonomyPolicyService.listAudit(f.workspace.id);
    expect(events.filter((event)=>event.capability==='browser' && event.eventType==='completed')).toHaveLength(0);
    expect(events.some((event)=>event.eventType==='failed')).toBe(true);
  });

  it.skipIf(process.platform==='win32')('rejects a download ancestor symlink before creating directories outside the workspace', async () => {
    const f=await fixture();
    const outside=await mkdtemp(join(tmpdir(),'orkestrai-outside-'));roots.push(outside);
    await symlink(outside,join(f.workspace.workingDir,'escape'));
    await expect(preparePortalDirectory(f.workspace.workingDir,'escape/new-directory')).rejects.toThrow(/inside the workspace/);
    await expect(stat(join(outside,'new-directory'))).rejects.toMatchObject({code:'ENOENT'});
  });
});
