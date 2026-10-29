import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, appendFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InferenceRequest } from '$lib/modules/model-access/contracts/schemas/model-access.schema.js';
import { GuestAgentService } from '$lib/modules/model-access/application/services/GuestAgentService.js';
import { GuestAgentDto } from '$lib/modules/model-access/application/dto/ModelAccessDto.js';
import { modelAccessService } from '$lib/modules/model-access/application/services/ModelAccessService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { filesystemService } from '$lib/modules/agent-room/application/services/FilesystemService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { managedTranscriptPath } from '$lib/modules/agent-room/infrastructure/pty/ManagedAgentTranscript.js';
import { parseLatestTurnComplete, parseLatestTurnBoundary, lastReplyText } from '$lib/modules/agent-room/infrastructure/transcript/AgentTranscript.js';
import { AgentSessionTracker } from '$lib/modules/agent-room/infrastructure/pty/AgentSessionTracker.js';

let directory:string;
beforeEach(async () => { directory=await realpath(await mkdtemp(join(tmpdir(),'orkestrai-managed-history-'))); vi.stubEnv('ORKESTRAI_DATA_DIR',directory); });
afterEach(async () => {vi.restoreAllMocks();vi.unstubAllEnvs();await rm(directory,{recursive:true,force:true});});
function setup(cwd=directory) {
  const workspaceId=randomUUID(),nodeId=randomUUID(),sessionId=randomUUID(),connectionId=randomUUID(),offeringId=randomUUID();
  const model=`${connectionId}/${offeringId}/model`;
  const workspace={id:workspaceId,workingDir:directory,runtimeKind:'native',repositoryRoots:[],instructions:'Guest rules'} as any;
  const node={id:nodeId,workspaceId,type:'terminal',payload:{provider:'shared',args:['model-access-agent','--model',model,'--effort','high']}} as any;
  vi.spyOn(workspaceRepository,'getWorkspace').mockResolvedValue(workspace); vi.spyOn(workspaceRepository,'getNode').mockResolvedValue(node);
  vi.spyOn(workspaceRepository,'listNodes').mockResolvedValue([node]); vi.spyOn(workspaceRepository,'updateNode').mockResolvedValue(node);
  vi.spyOn(ptySessionManager,'beginManagedTurn').mockReturnValue(vi.fn());
  vi.spyOn(ptySessionManager,'listLiveForNode').mockReturnValue([{agentSessionId:sessionId,cwd}] as any);
  vi.spyOn(filesystemService,'read').mockRejectedValue(new Error('not present'));
  vi.spyOn(modelAccessService,'status').mockResolvedValue({grants:[],connections:[{id:connectionId,status:'active',state:'connected',name:'Lent account',policy:{offerings:[{id:offeringId,providerId:'codex',models:['model'],efforts:['high'],images:false,availableModels:[{value:'model',efforts:['high']}]}]}}]} as any);
  const infer=vi.spyOn(modelAccessService,'infer').mockImplementation(async (_id,_request,context) => {await context.emit('text','New answer');});
  const service=new GuestAgentService(), context={signal:new AbortController().signal,emit:async () => {},bridge:async () => {},env:{}};
  const dto=(operation:'open'|'turn',prompt='',instructions='') => GuestAgentDto.from(workspaceId,nodeId,{sessionId,model,effort:'high',operation,prompt,instructions});
  return {service,context,dto,infer,path:managedTranscriptPath(directory,sessionId)};
}
describe('managed guest conversation', () => {
  it('releases authoritative working state when inference fails',async()=>{
    const state=setup(), release=vi.fn();
    vi.mocked(ptySessionManager.beginManagedTurn).mockReturnValue(release);
    state.infer.mockRejectedValueOnce(new Error('INFERENCE_OFFLINE'));
    await expect(state.service.run(state.dto('turn','Try the received model'),state.context)).rejects.toThrow('INFERENCE_OFFLINE');
    expect(release).toHaveBeenCalledTimes(1);
    expect(parseLatestTurnBoundary('orkestrai-jsonl',await readFile(state.path,'utf8')).ready).toBe(true);
  });
  it('hands mid-turn inbox messages to the model and retains them for exact resume',async()=>{
    const state=setup();
    const inbox={items:[{messageId:randomUUID(),kind:'owner',content:'New owner instruction during work'}],remaining:0};
    let toolResult:any;
    state.infer.mockImplementationOnce(async (_id,_request,context)=>{
      toolResult=await context.callTool('read_file',{path:'missing.txt'});
      await context.emit('text','Handled the new instruction');
    });
    await state.service.run(state.dto('turn','First work'),{...state.context,readInbox:async()=>inbox});
    expect(JSON.stringify(toolResult.content)).toContain('New owner instruction during work');
    await state.service.run(state.dto('turn','Continue after restart'),state.context);
    expect(JSON.stringify((state.infer.mock.calls[1][1] as InferenceRequest).messages)).toContain('New owner instruction during work');
    expect((await readFile(state.path,'utf8')).split('"type":"guest-inbox"')).toHaveLength(2);
  });
  it('accepts the first inbox message on a fresh managed conversation without inventing an assistant reply',async()=>{
    const state=setup();await state.service.run(state.dto('open'),state.context);
    const transcript=await readFile(state.path,'utf8');expect(parseLatestTurnBoundary('orkestrai-jsonl',transcript).ready).toBe(true);
    expect(await lastReplyText('shared',directory,state.dto('open').input.sessionId)).toBeNull();
    expect(parseLatestTurnComplete('claude-project-jsonl',transcript)).toBe(false);
    const busy=transcript+JSON.stringify({type:'user',message:{content:[{type:'text',text:'Now working'}]}})+'\n';
    expect(parseLatestTurnBoundary('orkestrai-jsonl',busy).ready).toBe(false);
  });
  it('finds the same transcript through a symlink for resume, replies and inbox turn completion',async()=>{
    const alias=directory+'-alias';await symlink(directory,alias,'dir');
    try{const state=setup(alias);await state.service.run(state.dto('turn','Symlinked work'),state.context);
      const sessionId=state.dto('open').input.sessionId;
      expect(new AgentSessionTracker().isAgentSessionResumable('orkestrai-jsonl',alias,sessionId)).toBe(true);
      expect(await lastReplyText('shared',alias,sessionId)).toBe('New answer');
    }finally{await rm(alias);}
  });
  it('resumes the exact guest history and role after a new service instance', async () => {
    const state=setup(); await state.service.run(state.dto('open','','Guest architect'),state.context);
    await state.service.run(state.dto('turn','First prompt'),state.context);
    await new GuestAgentService().run(state.dto('turn','Second prompt'),state.context);
    const request=state.infer.mock.calls[1][1] as InferenceRequest; expect(request.system).toContain('Guest architect');
    expect(JSON.stringify(request.messages)).toContain('First prompt');expect(JSON.stringify(request.messages)).toContain('New answer');
    expect(request.messages.at(-1)?.content).toEqual([{type:'text',text:'Second prompt'}]);
    expect(parseLatestTurnComplete('orkestrai-jsonl',await readFile(state.path,'utf8'))).toBe(true);
  });
  it('compacts large context and closes the turn when compaction fails', async () => {
    const state=setup(); await state.service.run(state.dto('open','','Preserved role'),state.context);
    await appendFile(state.path,JSON.stringify({type:'user',message:{content:[{type:'text',text:'x'.repeat(260000)}]}})+'\n');
    state.infer.mockRejectedValueOnce(new Error('INFERENCE_OFFLINE'));
    await expect(state.service.run(state.dto('turn','Current task'),state.context)).rejects.toThrow('INFERENCE_OFFLINE');
    expect(parseLatestTurnComplete('orkestrai-jsonl',await readFile(state.path,'utf8'))).toBe(true);
    state.infer.mockImplementation(async (_id,request,context) => {await context.emit('text',(request as InferenceRequest).tools.length ? 'Delivered' : 'Checkpoint of previous work');});
    await state.service.run(state.dto('turn','Continue'),state.context);
    expect((state.infer.mock.calls.at(-1)![1] as InferenceRequest).system).toContain('Preserved role');
    const transcript=await readFile(state.path,'utf8');expect(transcript).toContain('Checkpoint of previous work');expect(transcript).not.toContain('x'.repeat(100000));
  });
  it('rejects concurrent turns before asynchronous identity checks and releases failed reservations', async () => {
    const state=setup(); let unblock!:(value:any) => void;
    vi.mocked(workspaceRepository.getNode).mockImplementationOnce(() => new Promise(resolve => unblock=resolve));
    const first=state.service.run(state.dto('open'),state.context);
    await expect(state.service.run(state.dto('open'),state.context)).rejects.toThrow('AGENT_BUSY');
    unblock(null);await expect(first).rejects.toThrow('AGENT_IDENTITY');
    await state.service.run(state.dto('open'),state.context);
  });
});
