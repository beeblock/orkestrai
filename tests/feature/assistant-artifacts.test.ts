import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AssistantArtifactService } from '$lib/modules/agent-room/application/services/AssistantArtifactService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { pcm16ToWav } from '$lib/modules/agent-room/infrastructure/voice/EmbeddedVoice.js';
import { voiceService } from '$lib/modules/agent-room/application/services/VoiceService.js';
const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for(const folder of folders.splice(0)) await rm(folder,{ recursive:true,force:true }); });
async function setup() {
  const folder = await mkdtemp(join(tmpdir(),'ork-artifact-')); folders.push(folder);
  const workspace = await workspaceRepository.createWorkspace({ name:'Assistant artifacts',workingDir:folder });
  const agent = await workspaceRepository.createNode({ workspaceId:workspace.id,type:'terminal' });
  const task = await taskBoardService.create(workspace.id,{ title:'Prepare files',assigneeNodeId:agent.id,dispatch:false });
  const prior = await autonomyPolicyService.get(workspace.id);
  await autonomyPolicyService.update(workspace.id,{ enabled:true,mode:'bounded',policy:{ ...prior.policy,capabilities:['filesystem'],filesystem:[{root:folder,permissions:['create','read'],excludeGlobs:[],followSymlinks:false,maxFileSize:50*1024*1024}] } });
  const actor = { actorType:'agent' as const,actorId:agent.id,taskId:task.id,idempotencyKey:'artifact-test' };
  return { folder,workspace,actor,service:new AssistantArtifactService() };
}
describe('Existing voice and PDF engines as workspace artifacts', () => {
  useSvelarTest({ refreshDatabase:true });
  it('does not synthesize credentials or put them in a PDF or audit event', async () => {
    const s = await setup(), secret = 'password=private-never-persist';
    const speak = vi.spyOn(voiceService, 'speak');
    await expect(s.service.execute(s.workspace.id, { command: 'artifact_speech', path: 'denied.wav', text: secret }, s.actor)).rejects.toThrow('credential_material');
    await expect(s.service.execute(s.workspace.id, { command: 'artifact_report', path: 'denied.pdf', title: 'Report', sections: [{ heading: 'Private', text: secret }] }, { ...s.actor, idempotencyKey: 'pdf-denied' })).rejects.toThrow('credential_material');
    expect(speak).not.toHaveBeenCalled();
    await expect(readFile(join(s.folder, 'denied.wav'))).rejects.toThrow();
    await expect(readFile(join(s.folder, 'denied.pdf'))).rejects.toThrow();
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id))).not.toContain(secret);
  });
  it('creates a real WAV and returns the same verified artifact on an exact retry', async () => {
    const s = await setup(), bytes = pcm16ToWav(Buffer.alloc(16000),16000);
    const speak = vi.spyOn(voiceService,'speak').mockResolvedValue(bytes);
    const input = { command:'artifact_speech' as const,path:'generated/greeting.wav',text:'Olá, this is a private fixture.' };
    const result = await s.service.execute(s.workspace.id,input,s.actor);
    expect(result).toMatchObject({status:'prepared',contentType:'audio/wav',path:input.path,size:bytes.length});
    expect(await readFile(join(s.folder,input.path))).toEqual(bytes);
    expect(await s.service.execute(s.workspace.id,input,s.actor)).toEqual(result); expect(speak).toHaveBeenCalledTimes(1);
    const audit = JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id));
    expect(audit).not.toContain(input.text);
    await writeFile(join(s.folder,input.path),Buffer.concat([bytes,Buffer.from('changed')]));
    await expect(s.service.execute(s.workspace.id,input,s.actor)).rejects.toThrow('changed after');
  });
  it('creates a PDF report without evaluating HTML or fetching resources', async () => {
    const s = await setup();
    const result = await s.service.execute(s.workspace.id,{command:'artifact_report',path:'reports/closing.pdf',title:'Weekly close',sections:[{heading:'Totals',text:'Revenue: 100\nExpenses: 25\nProfit: 75'}]},s.actor);
    expect(result.contentType).toBe('application/pdf'); expect((await readFile(join(s.folder,result.path))).subarray(0,5).toString()).toBe('%PDF-');
  });

  it('rechecks revocation after TTS and rejects malformed WAV before STT', async () => {
    const s = await setup();
    vi.spyOn(voiceService,'speak').mockImplementation(async () => {
      const policy = await autonomyPolicyService.get(s.workspace.id);
      await autonomyPolicyService.update(s.workspace.id,{enabled:true,mode:'bounded',policy:{...policy.policy,halted:true}});
      return pcm16ToWav(Buffer.alloc(16000),16000);
    });
    await expect(s.service.execute(s.workspace.id,{command:'artifact_speech',path:'revoked.wav',text:'Not authorized anymore'},s.actor)).rejects.toThrow('authorization changed');
    await expect(readFile(join(s.folder,'revoked.wav'))).rejects.toThrow();
    const policy = await autonomyPolicyService.get(s.workspace.id);
    await autonomyPolicyService.update(s.workspace.id,{enabled:true,mode:'bounded',policy:{...policy.policy,halted:false}});
    const malformed = pcm16ToWav(Buffer.alloc(16000),16000); malformed.writeUInt16LE(0,22);
    await writeFile(join(s.folder,'malformed.wav'),malformed);
    const artifact = await s.service.execute(s.workspace.id,{command:'artifact_inspect',path:'malformed.wav'},s.actor);
    const transcribe = vi.spyOn(voiceService,'transcribe');
    await expect(s.service.execute(s.workspace.id,{command:'artifact_transcribe',path:artifact.path,expectedHash:artifact.sha256},s.actor)).rejects.toThrow('sample layout');
    expect(transcribe).not.toHaveBeenCalled();
  });
  it('refuses symlinks, traversal, secret files, overwritten files and forged formats', async () => {
    const s = await setup();
    const speak = vi.spyOn(voiceService,'speak').mockResolvedValue(pcm16ToWav(Buffer.alloc(16000),16000));
    for (const path of ['../escape.wav','.env','.ENV.local','.orkestrai/workspace.json','nested/../../bad.wav']) await expect(s.service.execute(s.workspace.id,{command:'artifact_speech',path,text:'Hi'},s.actor)).rejects.toThrow();
    expect(speak).not.toHaveBeenCalled();
    await mkdir(join(s.folder,'real')); await symlink(join(s.folder,'real'),join(s.folder,'linked'),process.platform==='win32'?'junction':'dir');
    await expect(s.service.execute(s.workspace.id,{command:'artifact_speech',path:'linked/out.wav',text:'Hi'},s.actor)).rejects.toThrow('symbolic');
    await writeFile(join(s.folder,'existing.wav'),'human file');
    await expect(s.service.execute(s.workspace.id,{command:'artifact_speech',path:'existing.wav',text:'Hi'},s.actor)).rejects.toThrow();
    expect(await readFile(join(s.folder,'existing.wav'),'utf8')).toBe('human file');
    await expect(s.service.execute(s.workspace.id,{command:'artifact_inspect',path:'existing.wav'},s.actor)).rejects.toThrow('format');
  });
});
