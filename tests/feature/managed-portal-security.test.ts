import { mkdtemp, rm, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { managedPortalService, preparePortalDirectory } from '$lib/modules/agent-room/application/services/ManagedPortalService.js';
import { autonomyPolicyService, AutonomyGatePendingError } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { managedPortalCommandSchema } from '$lib/modules/agent-room/contracts/schemas/managed-portal.schema.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

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
  afterEach(async () => { vi.restoreAllMocks(); delete runtime.__orkestraiExecutePortal; for (const root of roots.splice(0)) await rm(root,{recursive:true,force:true}); });

  it.each(['disabled', 'observe'] as const)('lets the leader and new teammates use a default Portal with a %s policy', async (mode) => {
    const f = await fixture();
    const current = await autonomyPolicyService.get(f.workspace.id);
    await autonomyPolicyService.update(f.workspace.id, { enabled: mode !== 'disabled', mode: 'observe', policy: current.policy });
    await workspaceRepository.updateNode(f.portal.id, { payload: { url: 'https://example.test/' } });
    const teammate = await workspaceRepository.createNode({ workspaceId: f.workspace.id, type: 'terminal', title: 'New teammate' });
    for (const agentId of [f.agent.id, teammate.id]) {
      const context = { actorType: 'agent' as const, actorId: agentId };
      for (const [action, args] of [
        ['navigate', { url: 'https://example.test/app' }], ['snapshot', {}],
        ['type', { ref: 'e1', text: 'QA input' }], ['click', { ref: 'e2' }],
      ] as const) {
        await expect(managedPortalService.execute(f.workspace.id, f.command(action, args), context)).resolves.toMatchObject({ ok: true });
      }
      expect(await bridgeService.listPortals(f.workspace.id, agentId)).toContainEqual(expect.objectContaining({ id: f.portal.id, access: expect.objectContaining({ control: 'interact', granted: true }) }));
    }
    expect(await autonomyPolicyService.listGates(f.workspace.id)).toHaveLength(0);
    expect((await autonomyPolicyService.listAudit(f.workspace.id)).filter((event) => event.eventType === 'completed').length).toBeGreaterThanOrEqual(8);
  });

  it('does not grant team access to another workspace, missing identities or non-agent nodes', async () => {
    const f = await fixture();
    await workspaceRepository.updateNode(f.portal.id, { payload: { url: 'https://example.test/' } });
    const other = await workspaceRepository.createWorkspace({ name: 'Other', workingDir: f.workspace.workingDir });
    const stranger = await workspaceRepository.createNode({ workspaceId: other.id, type: 'terminal', title: 'Stranger' });
    for (const actorId of [stranger.id, f.portal.id, null]) {
      await expect(managedPortalService.execute(f.workspace.id, f.command('snapshot'), { actorType: 'agent', actorId })).rejects.toThrow(/not been granted/);
    }
    expect(f.execute).not.toHaveBeenCalled();
    expect(await bridgeService.listPortals(f.workspace.id, stranger.id)).toContainEqual(expect.objectContaining({ access: expect.objectContaining({ granted: false }) }));
  });

  it('keeps explicit manual-only settings and emergency halt even without an enforcing policy', async () => {
    const f = await fixture();
    const current = await autonomyPolicyService.get(f.workspace.id);
    await autonomyPolicyService.update(f.workspace.id, { enabled: false, mode: 'observe', policy: current.policy });
    await workspaceRepository.updateNode(f.portal.id, { payload: { url: 'https://example.test/', portalControl: 'disabled' } as never });
    await expect(managedPortalService.execute(f.workspace.id, f.command('click', { ref: 'e1' }), f.context)).rejects.toThrow(/control grant/);
    await workspaceRepository.updateNode(f.portal.id, { payload: { url: 'https://example.test/' } });
    await autonomyPolicyService.update(f.workspace.id, { enabled: false, mode: 'observe', policy: { ...current.policy, halted: true } });
    await expect(managedPortalService.execute(f.workspace.id, f.command('snapshot'), f.context)).rejects.toThrow(/halted/);
    expect(f.execute).not.toHaveBeenCalled();
  });

  it('authenticates bridge mutations without requiring a task and validates optional task attribution', async () => {
    const f = await fixture();
    const current = await autonomyPolicyService.get(f.workspace.id);
    await autonomyPolicyService.update(f.workspace.id, { enabled: false, mode: 'observe', policy: current.policy });
    await workspaceRepository.updateNode(f.portal.id, { payload: { url: 'https://example.test/' } });
    const token = await bridgeService.getOrCreateToken(f.workspace.id);
    vi.spyOn(ptySessionManager, 'resolveBridgeAgent').mockImplementation((workspaceId, credential) => workspaceId === f.workspace.id && credential === 'live-agent' ? f.agent.id : null);
    const controller = new BridgeController();
    const send = (credential: string, taskId?: string) => controller.portal({ request: new Request('http://localhost/api/agent-room/bridge/portal', {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-orkestrai-agent-token': credential },
      body: JSON.stringify({ nodeId: f.portal.id, action: 'click', args: { ref: 'e1' }, taskId }),
    }) });
    const denied = await send('');
    expect(denied.status).toBe(400);
    expect((await denied.json()).error).toMatch(/authenticated active agent/);
    const accepted = await send('live-agent');
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    const task = await taskBoardService.create(f.workspace.id, { title: 'Unassigned task', dispatch: false });
    const invalid = await send('live-agent', task.id);
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatch(/supplied Portal task/);
    expect(f.execute.mock.calls.filter(([request]) => !request.inspect)).toHaveLength(1);
  });

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
