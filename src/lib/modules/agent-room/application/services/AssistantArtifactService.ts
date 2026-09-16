import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, statfs } from 'node:fs/promises';
import { dirname, extname, join, relative, isAbsolute, sep } from 'node:path';
import { PDF } from '@beeblock/svelar/pdf';
import { uuidv7 } from '@beeblock/svelar/support';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentComputerAction } from '../../domain/models/AgentComputerAction.js';
import { assistantArtifactResultSchema, type AssistantArtifactInput, type AssistantArtifactResult } from '../../contracts/schemas/assistant-artifact.schema.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { workspacePathService } from './WorkspacePathService.js';
import { voiceService } from './VoiceService.js';
import type { ComputerExecutionContext } from './ComputerService.js';
import type { Workspace } from '../../domain/types.js';

const MAX_BYTES = 50 * 1024 * 1024;
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function canonicalPcmWav(bytes: Buffer): Buffer {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 > bytes.length) throw new Error('Invalid WAV container.');
  let format: Buffer | undefined, data: Buffer | undefined;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4), end = offset + 8 + size;
    if (end > bytes.length) throw new Error('Truncated WAV chunk.');
    const id = bytes.toString('ascii', offset, offset + 4);
    if (id === 'fmt ') { if (format) throw new Error('Ambiguous WAV format.'); format = bytes.subarray(offset + 8, end); }
    if (id === 'data') { if (data) throw new Error('Ambiguous WAV samples.'); data = bytes.subarray(offset + 8, end); }
    offset = end + (size % 2);
  }
  if (!format || format.length < 16 || !data?.length || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) throw new Error('Transcription requires uncompressed PCM16 WAV.');
  const channels = format.readUInt16LE(2), rate = format.readUInt32LE(4), block = channels * 2;
  if (channels < 1 || channels > 8 || rate < 8000 || rate > 192000 || format.readUInt16LE(12) !== block || format.readUInt32LE(8) !== rate * block || data.length % block || data.length / block / rate > 1800) throw new Error('Unsupported WAV sample layout or duration.');
  // Canonicalize only the container for the existing PCM reader; keep samples unchanged.
  const header = Buffer.alloc(44);
  header.write('RIFF',0); header.writeUInt32LE(36 + data.length,4); header.write('WAVEfmt ',8); header.writeUInt32LE(16,16); format.copy(header,20,0,16); header.write('data',36); header.writeUInt32LE(data.length,40);
  return Buffer.concat([header,data]);
}

export function artifactContentType(bytes: Buffer, extension: string): string {
  if (extension === '.wav' && bytes.length >= 44 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WAVE') return 'audio/wav';
  if (['.ogg', '.opus'].includes(extension) && bytes.toString('ascii', 0, 4) === 'OggS' && (bytes.subarray(0, 512).includes(Buffer.from('OpusHead')) || bytes.subarray(0, 512).includes(Buffer.from('\x01vorbis')))) return 'audio/ogg';
  if (extension === '.mp3' && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (extension === '.m4a' && bytes.toString('ascii', 4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(bytes.toString('ascii', 8, 12))) return 'audio/mp4';
  if (extension === '.pdf' && bytes.subarray(0,5).toString() === '%PDF-') return 'application/pdf';
  if (extension === '.png' && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (['.jpg','.jpeg'].includes(extension) && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (extension === '.webp' && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  if (['.txt','.md','.csv','.json'].includes(extension) && !bytes.includes(0)) return extension === '.json' ? 'application/json' : 'text/plain';
  throw new Error('This artifact format is unsupported or its contents do not match its extension.');
}

/** Uses the existing voice/PDF engines and filesystem policy, not a chat-specific generator. */
export class AssistantArtifactService {
  constructor(private readonly speech = voiceService) {}

  private async authorize(workspaceId: string, context: ComputerExecutionContext) {
    await context.assertRelevant?.();
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace || workspace.suspendedAt) throw new Error('Workspace is unavailable or unloaded.');
    if (context.actorType !== 'user') {
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', context.taskId ?? '').first();
      if (context.actorType !== 'agent' || !context.actorId || !task || task.getAttribute('assignee_node_id') !== context.actorId || task.getAttribute('status') === 'done' || task.getAttribute('archived_at')) throw new Error('Artifacts require an active task assigned to this agent.');
    }
    return workspace;
  }

  private async safePath(workspace: Workspace, requested: string) {
    if (requested.includes('\\') || requested.toLowerCase().split('/').some(p => p === '..' || p === '.env' || p.startsWith('.env.') || ['.git','.ssh','.aws'].includes(p)) || /(?:^|\/)\.orkestrai\/(?:workspace|runtime)\.json$/i.test(requested)) throw new Error('Secret files and traversal are not artifacts.');
    const file = await workspacePathService.resolveWritable(workspace, requested);
    const root = await workspacePathService.resolveExisting(workspace, requested.startsWith('@') ? requested.split('/')[0] : '.');
    const rel = relative(root, file);
    if (!rel || isAbsolute(rel) || rel.startsWith('..'+sep)) throw new Error('Invalid artifact path.');
    let current = root;
    for (const component of rel.split(sep)) {
      current = join(current,component);
      const info = await lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (info?.isSymbolicLink() || info && current !== file && !info.isDirectory()) throw new Error('Artifact paths must not contain symbolic links or non-directory parents.');
    }
    return file;
  }

  async read(workspaceId: string, path: string, expectedHash: string | undefined, context: ComputerExecutionContext) {
    const workspace = await this.authorize(workspaceId,context), file = await this.safePath(workspace,path);
    return autonomyPolicyService.execute({ workspaceId, capability: 'filesystem', operation: 'artifact.read', target: path, mutation: false, actorType: context.actorType, actorId: context.actorId, filesystem: { path: file, permission: 'read', size: (await lstat(file)).size }, input: { path, expectedHash }, auditOutput: result => ({ path, sha256: (result as { result: AssistantArtifactResult }).result.sha256 }) }, async () => {
      await this.authorize(workspaceId,context);
      await this.safePath(workspace,path);
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size <= 0 || before.size > MAX_BYTES) throw new Error('Artifact must be a regular nonempty file of at most 50 MiB.');
        const bytes = await handle.readFile(), after = await handle.stat();
        if (bytes.length !== before.size || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('Artifact changed while reading.');
        const sha256 = hash(bytes);
        if (expectedHash && expectedHash !== sha256) throw new Error('Artifact changed after preparation. Inspect it before sending.');
        const result: AssistantArtifactResult = { kind: 'artifact', path, contentType: artifactContentType(bytes,extname(path).toLowerCase()), size: bytes.length, sha256, status: 'prepared' };
        return { bytes, file, result };
      } finally { await handle.close(); }
    });
  }

  async receive(workspaceId: string, path: string, context: ComputerExecutionContext, download: () => Promise<Buffer>): Promise<AssistantArtifactResult> {
    const workspace = await this.authorize(workspaceId, context), file = await this.safePath(workspace, path);
    const present = await lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (present) throw new Error('Receiving an attachment must not overwrite an existing file.');
    return autonomyPolicyService.execute({ workspaceId, capability: 'filesystem', operation: 'artifact.receive', target: path, mutation: true, actorType: context.actorType, actorId: context.actorId, filesystem: { path: file, permission: 'create' }, input: { path }, auditOutput: result => result }, async () => {
      const revision = (await autonomyPolicyService.get(workspaceId)).revision;
      const bytes = await download();
      if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('Received artifact exceeds its size limit.');
      const contentType = artifactContentType(bytes, extname(path).toLowerCase());
      await this.authorize(workspaceId, context);
      const decision = await autonomyPolicyService.decide({ workspaceId, capability: 'filesystem', operation: 'artifact.receive', mutation: true, actorType: context.actorType, actorId: context.actorId, filesystem: { path: file, permission: 'create', size: bytes.length } });
      if (decision.status !== 'allowed' || decision.policy.revision !== revision) throw new Error('Artifact authorization changed during download. No workspace file was written.');
      await this.safePath(workspace, path);
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await this.safePath(workspace, path);
      const free = await statfs(dirname(file));
      if (free.bavail * free.bsize < bytes.length + 1024 * 1024 * 1024) throw new Error('Less than 1 GiB free disk space; received artifact was not written.');
      const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      return { kind: 'artifact', path, contentType, size: bytes.length, sha256: hash(bytes), status: 'prepared' };
    });
  }

  async execute(workspaceId: string, input: AssistantArtifactInput, context: ComputerExecutionContext): Promise<AssistantArtifactResult> {
    if (input.command === 'artifact_inspect' || input.command === 'artifact_transcribe') {
      const found = await this.read(workspaceId,input.path,input.expectedHash,context);
      if (input.command === 'artifact_inspect') return found.result;
      if (!found.result.contentType.startsWith('audio/')) throw new Error('Transcription requires an audio artifact.');
      const bytes = found.result.contentType === 'audio/wav' ? found.bytes : await (await import('../../infrastructure/voice/DesktopAudioDecoder.js')).decodeDesktopAudio(found.bytes);
      const transcript = await this.speech.transcribe(canonicalPcmWav(bytes), input.path);
      await this.authorize(workspaceId,context);
      return { ...found.result, transcript };
    }
    const workspace = await this.authorize(workspaceId,context), file = await this.safePath(workspace,input.path);
    const extension = input.command === 'artifact_speech' ? '.wav' : '.pdf';
    if (extname(file).toLowerCase() !== extension) throw new Error(`Output must use the ${extension} extension.`);
    const digest = hash(JSON.stringify(input)), key = `artifact:${context.actorId ?? 'owner'}:${context.idempotencyKey ?? uuidv7()}`;
    const previous = await AgentComputerAction.query().where('workspace_id',workspaceId).where('idempotency_key',key).first();
    if (previous) {
      if (previous.getAttribute('request_digest') !== digest) throw new Error('Artifact key belongs to a different request.');
      if (previous.getAttribute('status') !== 'succeeded') throw new Error('Artifact preparation is pending or failed. Inspect its output before issuing a new request.');
      const stored = assistantArtifactResultSchema.parse(JSON.parse(String(previous.getAttribute('result_json'))));
      return (await this.read(workspaceId, stored.path, stored.sha256, context)).result;
    }
    return autonomyPolicyService.execute({ workspaceId, capability: 'filesystem', operation: input.command, target: input.path, mutation: true, actorType: context.actorType, actorId: context.actorId, filesystem: { path: file, permission: 'create' }, input: { path: input.path, requestDigest: digest }, auditOutput: result => result }, async () => {
      await this.authorize(workspaceId,context);
      const approvedRevision = (await autonomyPolicyService.get(workspaceId)).revision;
      const id = uuidv7();
      await AgentComputerAction.create({ id, workspace_id: workspaceId, node_id: null, actor_type: context.actorType, actor_id: context.actorId ?? null, command: input.command, idempotency_key: key, request_digest: digest, status: 'running', created_at: new Date(), updated_at: new Date() });
      try {
        let bytes: Buffer;
        if (input.command === 'artifact_speech') {
          const { companionPolicyService } = await import('./CompanionPolicyService.js');
          const grant = await companionPolicyService.forAgent(workspaceId, context.actorId, context.taskId);
          const text = await companionPolicyService.publication(workspaceId, grant, input.text, context.actorId);
          bytes = await this.speech.speak(text, input.voice ?? grant?.companion?.voice, input.speed ?? grant?.companion?.speed);
        }
        else {
          const { companionPolicyService } = await import('./CompanionPolicyService.js');
          const grant = await companionPolicyService.forAgent(workspaceId, context.actorId, context.taskId);
          await companionPolicyService.publication(workspaceId, grant, [input.title, ...input.sections.flatMap(section => [section.heading, section.text])].join('\n'), context.actorId);
          bytes = await PDF.create().margins({ top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' }).build(doc => {
          doc.fontSize(22).text(input.title); doc.moveDown();
          for (const section of input.sections) { if (section.heading) { doc.fontSize(14).text(section.heading); doc.moveDown(0.5); } doc.fontSize(11).text(section.text); doc.moveDown(); }
          });
        }
        if (bytes.length > MAX_BYTES) throw new Error('Generated artifact exceeds 50 MiB.');
        const contentType = artifactContentType(bytes,extension);
        await this.authorize(workspaceId,context);
        const decision = await autonomyPolicyService.decide({ workspaceId, capability: 'filesystem', operation: input.command, mutation: true, actorType: context.actorType, actorId: context.actorId, filesystem: { path: file, permission: 'create', size: bytes.length } });
        if (decision.status !== 'allowed' || decision.policy.revision !== approvedRevision) throw new Error('Artifact authorization changed during generation. No file was written.');
        await this.safePath(workspace,input.path);
        await mkdir(dirname(file),{ recursive:true,mode:0o700 });
        await this.safePath(workspace,input.path);
        const free = await statfs(dirname(file));
        if (free.bavail * free.bsize < bytes.length + 1024*1024*1024) throw new Error('Less than 1 GiB free disk space; artifact was not written.');
        const handle = await open(file,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),0o600);
        try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        const result: AssistantArtifactResult = { kind:'artifact',path:input.path,contentType,size:bytes.length,sha256:hash(bytes),status:'prepared' };
        await AgentComputerAction.query().where('id',id).update({ status:'succeeded',result_json:JSON.stringify(result),updated_at:new Date() });
        return result;
      } catch (error) {
        await AgentComputerAction.query().where('id',id).update({ status:'failed',error:'Artifact preparation failed. Inspect the requested path before retrying.',updated_at:new Date() });
        throw error;
      }
    });
  }
}
export const assistantArtifactService = new AssistantArtifactService();
