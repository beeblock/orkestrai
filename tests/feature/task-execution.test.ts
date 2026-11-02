import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskExecutionRepository as repository, TaskExecutionRepository } from '$lib/modules/agent-room/infrastructure/repositories/TaskExecutionRepository.js';
import { taskExecutionService as service, TaskExecutionService } from '$lib/modules/agent-room/application/services/TaskExecutionService.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { AgentBoardTask } from '$lib/modules/agent-room/domain/models/AgentBoardTask.js';
import { AgentTaskExecution } from '$lib/modules/agent-room/domain/models/AgentTaskExecution.js';
import { AgentMessageEnvelope } from '$lib/modules/agent-room/domain/models/AgentMessageEnvelope.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import * as transcript from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';

async function fixture() {
  const workspace = await workspaceRepository.createWorkspace({name:'execution queue',workingDir:'/tmp'});
  const sessionId=uuidv7();
  const node=await workspaceRepository.createNode({workspaceId:workspace.id,type:'terminal',title:'Specialist',payload:{provider:'codex',sessionId}});
  const leader=await workspaceRepository.createNode({workspaceId:workspace.id,type:'terminal',title:'Coordinator',payload:{provider:'codex',maestro:true}});
  vi.spyOn(agentInboxService,'kick').mockImplementation(()=>{});
  async function task(dependencies:string[]=[]) {
    const id=uuidv7();const at=new Date().toISOString();
    await AgentBoardTask.create({id,workspace_id:workspace.id,title:'Implementation',status:'doing',assignee_node_id:node.id,
      dependencies_json:JSON.stringify(dependencies),created_by:'user',created_at:at,updated_at:at});return id;
  }
  const claim=(id:string)=>repository.claim(workspace.id,id,node.id,sessionId,uuidv7());
  return {workspace,node,leader,sessionId,task,claim};
}
describe('durable task execution custody',()=>{
  useSvelarTest({refreshDatabase:true});
  afterEach(()=>{agentInboxService.stop();vi.restoreAllMocks();});
  it('claims one implementation attempt under simultaneous assignments',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();
    const results=await Promise.all([f.claim(a),f.claim(b)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await AgentTaskExecution.query().whereNotNull('active_node_id').count()).toBe(1);
    expect(await AgentTaskExecution.query().where('state','queued').count()).toBe(1);
  });
  it('retains custody after recreating the service/repository and releases it on completion',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();const first=(await f.claim(a))!;await repository.accepted(first.id);
    expect(await new TaskExecutionRepository().claim(f.workspace.id,b,f.node.id,f.sessionId,uuidv7())).toBeNull();
    await AgentBoardTask.query().where('id',a).update({status:'done'});await new TaskExecutionService().changed(f.workspace.id,a);
    expect(await f.claim(b)).toMatchObject({taskId:b,state:'dispatching'});
    expect((await AgentTaskExecution.find(first.id))?.getAttribute('state')).toBe('completed');
    expect(agentInboxService.kick).toHaveBeenCalledWith(f.workspace.id,f.node.id);
  });
  it('does not serialize independent workers behind each other',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();const other=await workspaceRepository.createNode({workspaceId:f.workspace.id,type:'terminal',payload:{provider:'codex'}});
    await AgentBoardTask.query().where('id',b).update({assignee_node_id:other.id});
    expect(await f.claim(a)).not.toBeNull();
    expect(await repository.claim(f.workspace.id,b,other.id,uuidv7(),uuidv7())).not.toBeNull();
  });
  it('keeps leader coordination independent while honoring prerequisite completion',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task(),dependent=await f.task([a]);
    for(const taskId of [a,b,dependent]) {
      await AgentBoardTask.query().where('id',taskId).update({assignee_node_id:f.leader.id});
      await repository.schedule(f.workspace.id,taskId,f.leader.id);
      await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.leader.id,kind:'task',taskId,content:`Coordinate ${taskId}`});
    }
    const first=await agentInboxService.claim(f.workspace.id,f.leader.id,1);
    expect(first.items).toHaveLength(1);
    const next=await agentInboxService.claim(f.workspace.id,f.leader.id,1);
    expect(next.items).toHaveLength(1);
    expect([...first.items,...next.items].map(item=>item.taskId).sort()).toEqual([a,b].sort());
    expect(await repository.activeForNode(f.workspace.id,f.leader.id)).toBeNull();
    expect((await agentInboxService.claim(f.workspace.id,f.leader.id)).items).toHaveLength(0);
    await AgentBoardTask.query().where('id',a).update({status:'done'});await service.changed(f.workspace.id,a);
    expect((await agentInboxService.claim(f.workspace.id,f.leader.id)).items.map(item=>item.taskId)).toEqual([dependent]);
  });

  it('keeps dependencies queued and starts work when prerequisites complete',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task([a]);
    expect(await f.claim(b)).toBeNull();expect(await repository.current(f.workspace.id,b)).toMatchObject({state:'queued'});
    await AgentBoardTask.query().where('id',a).update({status:'done'});await service.changed(f.workspace.id,a);
    expect(await f.claim(b)).not.toBeNull();
  });
  it('rejects cross-workspace dependencies and cycles including concurrent edits',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();
    await expect(service.validateDependencies(f.workspace.id,a,[uuidv7()])).rejects.toThrow('workspace');
    const results=await Promise.allSettled([taskBoardService.update(f.workspace.id,a,{dependencies:[b]}),taskBoardService.update(f.workspace.id,b,{dependencies:[a]})]);
    expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
  });
  it('a blocked task yields its slot to independent work without becoming completed',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();const execution=(await f.claim(a))!;await repository.accepted(execution.id);
    await service.activity({workspaceId:f.workspace.id,nodeId:f.node.id,taskId:a,state:'blocked',metadata:{}} as never);
    expect(await f.claim(b)).not.toBeNull();expect((await AgentBoardTask.find(a))?.getAttribute('status')).toBe('doing');
    expect(await repository.current(f.workspace.id,a)).toMatchObject({state:'blocked'});
  });
  it('does not acquire task custody for questions, replies or owner messages',async()=>{
    const f=await fixture();const a=await f.task();await f.claim(a);
    for(const kind of ['ask','reply','owner']) expect(await service.admit({id:uuidv7(),kind,workspaceId:f.workspace.id,toNodeId:f.node.id,metadata:{taskId:a}} as never,f.sessionId)).toBe(true);
  });
  it('does not duplicate or retype an already admitted envelope',async()=>{
    const f=await fixture();const a=await f.task();const envelope=uuidv7();const first=await repository.claim(f.workspace.id,a,f.node.id,f.sessionId,envelope);
    expect(await repository.claim(f.workspace.id,a,f.node.id,f.sessionId,envelope)).toMatchObject({id:first!.id});
    expect(await AgentTaskExecution.query().where('task_id',a).count()).toBe(1);
    expect(await repository.claim(f.workspace.id,a,f.node.id,f.sessionId,uuidv7())).toBeNull();
  });
  it('records submission separately from exact acceptance and only releases an unsubmitted attempt',async()=>{
    const f=await fixture();const a=await f.task();const first=(await f.claim(a))!;
    await repository.submitted(first.id);await repository.releaseUnsubmitted(first.id);
    expect(await repository.current(f.workspace.id,a)).toMatchObject({state:'dispatching',acceptedAt:null});
    await repository.accepted(first.id);expect(await repository.current(f.workspace.id,a)).toMatchObject({state:'running'});
  });
  it('keeps a later task queued in the durable inbox while questions still arrive',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();
    for (const taskId of [a,b]) await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.node.id,kind:'task',taskId,content:`Work ${taskId}`});
    await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.node.id,kind:'ask',content:'A real independent question'});
    const first=await agentInboxService.claim(f.workspace.id,f.node.id);
    expect(first.items.filter(item=>item.kind==='task')).toHaveLength(1);
    expect(first.items.some(item=>item.kind==='ask')).toBe(true);expect(first.remaining).toBe(1);
    const taskId=first.items.find(item=>item.kind==='task')!.taskId!;
    await AgentBoardTask.query().where('id',taskId).update({status:'done'});await service.changed(f.workspace.id,taskId);
    expect((await agentInboxService.claim(f.workspace.id,f.node.id)).items.filter(item=>item.kind==='task')).toHaveLength(1);
    expect((await agentInboxService.claim(f.workspace.id,f.node.id)).items).toHaveLength(0);
  });
  it('does not hide owner messages or ready work behind more than fifty dependency-blocked envelopes',async()=>{
    const f=await fixture();const dependency=await f.task();
    for(let index=0;index<55;index++){
      const taskId=await f.task([dependency]);await repository.schedule(f.workspace.id,taskId,f.node.id);
      await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.node.id,kind:'task',taskId,content:`Blocked ${taskId}`});
    }
    const independent=await f.task();await repository.schedule(f.workspace.id,independent,f.node.id);
    await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.node.id,kind:'task',taskId:independent,content:'Independent ready work'});
    await agentInboxService.enqueueDeferred({workspaceId:f.workspace.id,toNodeId:f.node.id,kind:'owner',content:'Owner needs an answer'});
    const page=await agentInboxService.claim(f.workspace.id,f.node.id);
    expect(page.items[0].kind).toBe('owner');
    expect(page.items.some(item=>item.taskId===independent)).toBe(true);
    expect(page.remaining).toBe(55);
  });
  it('recovers custody only after the old process is absent, without resetting the task or conversation',async()=>{
    const f=await fixture();const a=await f.task();const prior=(await f.claim(a))!;await repository.accepted(prior.id);
    const nextSession=uuidv7();const live={id:nextSession,nodeId:f.node.id,workspaceId:f.workspace.id,exited:false};
    vi.spyOn(ptySessionManager,'get').mockImplementation(id=>id===nextSession?live as never:null);
    const envelope={id:uuidv7(),kind:'task_recovery',workspaceId:f.workspace.id,toNodeId:f.node.id,metadata:{taskId:a}};
    expect(await service.admit(envelope as never,nextSession)).toBe(true);
    expect(await repository.current(f.workspace.id,a)).toMatchObject({sessionId:nextSession,state:'dispatching'});
    expect((await AgentTaskExecution.find(prior.id))?.getAttribute('state')).toBe('cancelled');
    expect((await AgentBoardTask.find(a))?.getAttribute('status')).toBe('doing');
  });
  it('cancels old custody on reassignment without accepting a late old receipt',async()=>{
    const f=await fixture();const a=await f.task();const first=(await f.claim(a))!;
    await AgentBoardTask.query().where('id',a).update({assignee_node_id:f.leader.id});await service.changed(f.workspace.id,a);
    await repository.accepted(first.id);
    expect(await repository.current(f.workspace.id,a)).toBeNull();expect(await repository.activeForNode(f.workspace.id,f.node.id)).toBeNull();
  });
});

describe('worker stop reporting',()=>{
  useSvelarTest({refreshDatabase:true});
  afterEach(()=>{agentInboxService.stop();vi.restoreAllMocks();});
  async function running(){
    const f=await fixture();const taskId=await f.task();const execution=(await f.claim(taskId))!;await repository.accepted(execution.id);
    vi.spyOn(ptySessionManager,'get').mockReturnValue({id:f.sessionId,nodeId:f.node.id,workspaceId:f.workspace.id,provider:'codex',waiting:true,exited:false,createdAt:new Date(Date.now()-60000).toISOString(),runtimeKey:'native',cwd:'/tmp'} as never);
    vi.spyOn(ptySessionManager,'transcriptStorageRoots').mockReturnValue({});
    vi.spyOn(transcript,'latestTurnBoundary').mockResolvedValue({ready:true,startedAt:Date.now(),finishedAt:Date.now()+100});
    vi.spyOn(autonomyPolicyService,'runWindow').mockResolvedValue({allowed:true} as never);
    return {...f,taskId,execution};
  }
  it('durably notifies the leader once for a proven stop without a result',async()=>{
    const f=await running();await service.observeStop(f.workspace.id,f.node.id);await service.observeStop(f.workspace.id,f.node.id);
    expect(await AgentMessageEnvelope.query().where('kind','task_stopped').count()).toBe(1);
    expect(await repository.current(f.workspace.id,f.taskId)).toMatchObject({state:'stopped'});
    expect((await AgentBoardTask.find(f.taskId))?.getAttribute('status')).toBe('doing');
  });
  it('never interprets silence or unknown transcript completion as a stopped task',async()=>{
    const f=await running();vi.mocked(transcript.latestTurnBoundary).mockResolvedValue({ready:null,startedAt:null,finishedAt:null});
    await service.observeStop(f.workspace.id,f.node.id);expect(await AgentMessageEnvelope.query().where('kind','task_stopped').count()).toBe(0);
  });
  it('leaves a deliberate question wait and a paused workspace quiet',async()=>{
    const f=await running();vi.spyOn(controlCenterRepository,'openAsksFrom').mockResolvedValue(1);
    await service.observeStop(f.workspace.id,f.node.id);expect(await AgentMessageEnvelope.query().where('kind','task_stopped').count()).toBe(0);
    vi.mocked(controlCenterRepository.openAsksFrom).mockResolvedValue(0);vi.mocked(autonomyPolicyService.runWindow).mockResolvedValue({allowed:false} as never);
    await service.observeStop(f.workspace.id,f.node.id);expect(await AgentMessageEnvelope.query().where('kind','task_stopped').count()).toBe(0);
  });
  it('does not report an old attempt reassigned while reading its transcript',async()=>{
    const f=await running();vi.mocked(transcript.latestTurnBoundary).mockImplementation(async()=>{
      await AgentBoardTask.query().where('id',f.taskId).update({status:'done'});await service.changed(f.workspace.id,f.taskId);
      return {ready:true,startedAt:Date.now(),finishedAt:Date.now()+100};
    });
    await service.observeStop(f.workspace.id,f.node.id);expect(await AgentMessageEnvelope.query().where('kind','task_stopped').count()).toBe(0);
  });
});

describe('pre-upgrade session resume uses custody',()=>{
  useSvelarTest({refreshDatabase:true});
  afterEach(()=>{agentInboxService.stop();vi.restoreAllMocks();});
  it('adopts existing cards into the queue and never puts two implementation briefs in one claimed batch',async()=>{
    const f=await fixture();const a=await f.task(),b=await f.task();
    const session={id:f.sessionId,nodeId:f.node.id,workspaceId:f.workspace.id,provider:'codex',exited:false,waiting:true};
    vi.spyOn(ptySessionManager,'get').mockReturnValue(session as never);
    vi.spyOn(ptySessionManager,'waitUntilIdle').mockResolvedValue(true);
    const {roleService}=await import('$lib/modules/agent-room/application/services/RoleService.js');
    const result=await roleService.applyToTerminal(f.workspace.id,f.node.id,'resume');
    expect(result.tasksDelivered).toBe(2);
    const items=(await agentInboxService.claim(f.workspace.id,f.node.id)).items;
    expect(items.filter(item=>item.kind==='task_recovery')).toHaveLength(1);
    expect(await AgentTaskExecution.query().where('node_id',f.node.id).where('state','running').count()).toBe(1);
    expect(await AgentTaskExecution.query().where('node_id',f.node.id).where('state','queued').count()).toBe(1);
    // A viewer readiness callback for the same session cannot add another bootstrap.
    await roleService.applyToTerminal(f.workspace.id,f.node.id,'fresh');
    expect(await AgentMessageEnvelope.query().whereIn('kind',['task','task_recovery']).count()).toBe(2);
  });
  it('also wakes the coordinator when every open card is assigned to specialists',async()=>{
    const f=await fixture();await f.task();
    const sessionId=uuidv7();await workspaceRepository.updateNode(f.leader.id,{payload:{...f.leader.payload,sessionId}});
    vi.spyOn(ptySessionManager,'get').mockReturnValue({id:sessionId,provider:'codex',nodeId:f.leader.id,workspaceId:f.workspace.id,exited:false,waiting:true} as never);
    vi.spyOn(ptySessionManager,'waitUntilIdle').mockResolvedValue(true);
    const {agentTerminalDeliveryService}=await import('$lib/modules/agent-room/application/services/AgentTerminalDeliveryService.js');
    const deliver=vi.spyOn(agentTerminalDeliveryService,'deliver').mockResolvedValue();
    const {roleService}=await import('$lib/modules/agent-room/application/services/RoleService.js');
    await roleService.applyToTerminal(f.workspace.id,f.leader.id,'resume');
    expect(deliver).toHaveBeenCalledOnce();expect(deliver.mock.calls[0][0].message).toContain('workspace leader');
    expect(deliver.mock.calls[0][0].message).toContain('Implementation');
  });
});
