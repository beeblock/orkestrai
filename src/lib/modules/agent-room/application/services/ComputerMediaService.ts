import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { uuidv7 } from '@beeblock/svelar/support';
import type { ComputerAdapter } from '../adapters/computers/types.js';
import type { ComputerAccessibility } from '../../contracts/schemas/computer.schema.js';
import { attachmentPreview, incomingAttachment, mediaControl, mediaRoute, verifiedPhotoSelection } from '../adapters/computers/media-scope.js';
import { replyControl, replyMessage, scopedConversation } from '../adapters/computers/reply-scope.js';
import type { ComputerReplyGrant } from '../../contracts/schemas/computer-reply.schema.js';
import { computerMediaResultSchema, type ComputerMediaSend, type ComputerMediaReceive, type ComputerMediaResult } from '../../contracts/schemas/computer-media.schema.js';
import { AgentBoardTask } from '../../domain/models/AgentBoardTask.js';
import { AgentComputerAction } from '../../domain/models/AgentComputerAction.js';
import { AgentAutonomyAuditEvent } from '../../domain/models/AgentAutonomyAuditEvent.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { artifactContentType, assistantArtifactService } from './AssistantArtifactService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { computerInboxService } from './ComputerInboxService.js';
import { conversationMemoryService } from './ConversationMemoryService.js';
import type { ComputerExecutionContext } from './ComputerService.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const MiB = 1024 * 1024;
const STAGING_TTL = 15 * 60_000;

/** Called only while ComputerService owns the host-wide desktop mutex. */
export class ComputerMediaService {
  constructor(private readonly artifacts = assistantArtifactService, private readonly stagingRoot = join(tmpdir(), 'orkestrai-native-media')) {}

  async recover(workspaceId: string, input: { grantId: string; targetId: string; actionId?: string; expectedRequestDigest?: string }, context: ComputerExecutionContext, adapter: ComputerAdapter, assertWindow: (grant: ComputerReplyGrant) => Promise<void>) {
    if (context.actorType !== 'user') throw new Error('Only the owner may authorize recovery of an interrupted attachment.');
    const policy = await autonomyPolicyService.get(workspaceId);
    const grant = policy.policy.computerReplyGrants.find(g => g.id === input.grantId && g.enabled && g.media?.enabled);
    if (!grant || !policy.enabled || policy.mode !== 'bounded' || policy.policy.halted || !adapter.read) throw new Error('An active native media authorization is required.');
    const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', grant.taskId).first();
    if (!task || task.getAttribute('assignee_node_id') !== grant.agentId || task.getAttribute('archived_at') || task.getAttribute('status') === 'done') throw new Error('Recovery requires the active assigned conversation task.');
    await assertWindow(grant);
    const tree = await adapter.read(input.targetId, grant.applicationId);
    if (tree.elements.some(e => /AXSheet|AXPopover/.test(e.role)) || replyControl(tree, grant, 'composer').value !== '') throw new Error('Close the native attachment dialog or preview and preserve any draft before recovery.');
    const rows = await AgentComputerAction.query().where('workspace_id', workspaceId).where('node_id', grant.nodeId).where('actor_id', grant.agentId).where('command', 'media_send').where('status', 'failed').orderBy('created_at', 'desc').limit(100).get();
    const action = rows.find(a => String(a.getAttribute('idempotency_key')).startsWith(`media:${grant.id}:`) && (!input.actionId || a.getAttribute('id') === input.actionId));
    const actionId = action ? String(action.getAttribute('id')) : null;
    const requestDigest = action ? String(action.getAttribute('request_digest')) : null;
    const result = { kind: 'media_recovery' as const, grantId: grant.id, targetId: input.targetId, actionId, requestDigest };
    if (!action || !actionId) return { ...result, state: 'none' as const };
    // The durable submit marker is written before native Send, including in
    // older installations. Never infer "not sent" from a generic failure.
    const audit = await AgentAutonomyAuditEvent.query().where('workspace_id', workspaceId).where('created_at', '>=', action.getAttribute('created_at')).orderBy('created_at', 'asc').limit(2000).get();
    const submitAttempted = audit.some(row => {
      const metadata = JSON.parse(String(row.getAttribute('metadata_json')));
      return metadata.operation === 'computer.media_submit_requested' && metadata.actionId === actionId;
    });
    if (audit.length >= 2000 || submitAttempted || !(await autonomyPolicyService.verifyAudit(workspaceId)).valid) return { ...result, state: 'uncertain' as const };
    if (!input.actionId) return { ...result, state: 'available' as const };
    if (input.expectedRequestDigest !== requestDigest) throw new Error('Attachment attempt changed since inspection.');
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'computer', operation: 'computer.media_recovery', actorType: 'user', actorId: context.actorId, mutation: true }, { grantId: grant.id, actionId, requestDigest, outcome: 'owner_authorized_pre_send_recovery' });
    const changed = await AgentComputerAction.query().where('id', actionId).where('status', 'failed').update({ status: 'gated', result_json: JSON.stringify({ ownerPreSendRecovery: true }), updated_at: new Date() });
    if (!changed) throw new Error('Attachment state changed; inspect again.');
    return { ...result, state: 'repaired' as const };
  }

  private async readDownload(path: string, maxBytes: number, validate: () => Promise<void>) {
    const deadline = Date.now() + 5000;
    let stable = 0, previous = '';
    while (Date.now() < deadline) {
      await validate();
      const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (handle) {
        try {
          const info = await handle.stat();
          if (!info.isFile() || info.size > maxBytes) throw new Error('Downloaded file exceeds the media grant.');
          const fingerprint = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
          stable = info.size > 0 && fingerprint === previous ? stable + 1 : 0;
          previous = fingerprint;
          if (stable >= 2) {
            const bytes = await handle.readFile(), after = await handle.stat();
            if (bytes.length === info.size && after.size === info.size && after.mtimeMs === info.mtimeMs) return bytes;
            stable = 0;
          }
        } finally { await handle.close(); }
      } else { stable = 0; previous = ''; }
      await delay(100);
    }
    throw new Error('Native download did not settle within the bounded wait. Inspect before recovery.');
  }

  private async stage(bytes: Buffer, filename: string) {
    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    const total = await this.sweep();
    const free = await statfs(this.stagingRoot);
    if (total + bytes.length > 100 * MiB || free.bavail * free.bsize < bytes.length + 1024 * MiB) throw new Error('Native media staging quota or free disk space is insufficient.');
    const directory = await mkdtemp(join(this.stagingRoot, 'send-'));
    const file = join(directory, filename);
    try { await writeFile(file, bytes, { flag: 'wx', mode: 0o400 }); }
    catch (error) { await rm(directory, { recursive: true }); throw error; }
    // Keep the copy briefly while the app uploads; sweep after a crash on next use.
    const timer = setTimeout(() => { void rm(directory, { recursive: true, force: true }).catch(() => undefined); }, STAGING_TTL);
    timer.unref();
    return file;
  }

  async sweep(): Promise<number> {
    const present = await lstat(this.stagingRoot).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!present) return 0;
    const root = await lstat(this.stagingRoot);
    if (root.isSymbolicLink() || !root.isDirectory() || (process.platform !== 'win32' && (root.mode & 0o077) !== 0)) throw new Error('Native media staging must be a private directory.');
    let total = 0;
    for (const item of await readdir(this.stagingRoot, { withFileTypes: true })) {
      if (!item.isDirectory() || !/^send-[A-Za-z0-9]{6}$/.test(item.name)) continue;
      const directory = join(this.stagingRoot, item.name), info = await lstat(directory);
      if (info.mtimeMs < Date.now() - STAGING_TTL) { await rm(directory, { recursive: true }); continue; }
      for (const file of await readdir(directory)) total += (await lstat(join(directory, file))).size;
    }
    return total;
  }

  async receive(workspaceId: string, input: ComputerMediaReceive, context: ComputerExecutionContext, adapter: ComputerAdapter, assertWindow: (grant: ComputerReplyGrant) => Promise<void>): Promise<ComputerMediaResult> {
    if (!adapter.receiveFile || !adapter.read) throw new Error('This platform does not support recipient-bound native downloads yet.');
    const policy = await autonomyPolicyService.get(workspaceId);
    const grant = policy.policy.computerReplyGrants.find(g => g.id === input.grantId && g.enabled);
    if (context.actorType !== 'agent' || !grant?.media?.enabled || !grant.media.receive?.enabled || grant.agentId !== context.actorId || grant.taskId !== context.taskId) throw new Error('An owner-approved incoming media grant for this agent and task is required.');
    const grantDigest = hash(JSON.stringify(grant));
    const withTranscription = async (result: ComputerMediaResult): Promise<ComputerMediaResult> => {
      if (input.transcribeAudio === false || !result.contentType.startsWith('audio/')) return result;
      try {
        const audio = await this.artifacts.execute(workspaceId, { command: 'artifact_transcribe', path: result.path, expectedHash: result.sha256 }, context);
        return { ...result, transcription: { state: 'ready', trust: 'external', text: audio.transcript ?? '' } };
      } catch {
        // Download succeeded. Return its immutable reference for an explicit
        // transcription retry; never redownload or pretend it was understood.
        return { ...result, transcription: { state: 'unavailable', trust: 'external' } };
      }
    };
    const validate = async () => {
      await context.assertRelevant?.();
      const current = await autonomyPolicyService.get(workspaceId), live = current.policy.computerReplyGrants.find(g => g.id === grant.id && g.enabled);
      if (!current.enabled || current.mode !== 'bounded' || current.policy.halted || !live || hash(JSON.stringify(live)) !== grantDigest) throw new Error('Incoming media authorization changed.');
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', grant.taskId).first();
      if (!task || task.getAttribute('assignee_node_id') !== context.actorId || task.getAttribute('archived_at') || task.getAttribute('status') === 'done') throw new Error('Receiving media requires an active assigned task.');
      await assertWindow(grant);
    };
    await validate();
    const key = `receive:${grant.id}:${input.inReplyToDigest}`, digest = hash(JSON.stringify(input));
    const previous = await AgentComputerAction.query().where('workspace_id', workspaceId).where('idempotency_key', key).first();
    if (previous) {
      if (previous.getAttribute('request_digest') !== digest || previous.getAttribute('actor_id') !== context.actorId || previous.getAttribute('status') !== 'succeeded') throw new Error('Incoming media has a pending, different or uncertain download. Inspect before recovery.');
      const result = computerMediaResultSchema.parse(JSON.parse(String(previous.getAttribute('result_json'))));
      await this.artifacts.read(workspaceId, result.path, result.sha256, context);
      return withTranscription(result);
    }
    const actionId = uuidv7();
    const operation = { workspaceId, capability: 'computer' as const, operation: 'computer.media_receive', mutation: true, actorType: 'agent' as const, actorId: context.actorId, application: { id: grant.applicationId }, input: { grantId: grant.id, digest: input.inReplyToDigest, path: input.path } };
    const received = await autonomyPolicyService.execute({ ...operation, auditOutput: result => result }, async () => {
      const artifact = await this.artifacts.receive(workspaceId, input.path, context, async () => {
        await validate();
        const tree = await adapter.read!(input.targetId, grant.applicationId);
        const selected = incomingAttachment(tree, grant, input.inReplyToDigest, input.downloadId);
        const marker = await this.stage(Buffer.alloc(0), '.pending');
        const path = join(dirname(marker), 'received' + extname(input.path).toLowerCase());
        await AgentComputerAction.create({ id: actionId, workspace_id: workspaceId, node_id: grant.nodeId, actor_type: 'agent', actor_id: context.actorId, command: 'media_receive', idempotency_key: key, request_digest: digest, status: 'running', created_at: new Date(), updated_at: new Date() });
        try {
          const treeAfter = await adapter.receiveFile!({ targetId: input.targetId, appId: grant.applicationId, path, open: selected.download, menu: grant.media!.receive!.menu, guards: [grant.recipient, selected.message] });
          scopedConversation(treeAfter, grant);
          await validate();
          const bytes = await this.readDownload(path, grant.media!.maxMiB * MiB, validate);
          const type = artifactContentType(bytes, extname(input.path).toLowerCase());
          if (!grant.media!.contentTypes.includes(type as typeof grant.media.contentTypes[number])) throw new Error('Downloaded format is outside the media grant.');
          return bytes;
        } catch (error) {
          await AgentComputerAction.query().where('id', actionId).update({ status: 'failed', error: 'Native media download was interrupted; inspect before recovery.', updated_at: new Date() });
          throw error;
        } finally { await rm(dirname(marker), { recursive: true, force: true }); }
      }).catch(async error => {
        await AgentComputerAction.query().where('id', actionId).where('status', 'running').update({ status: 'failed', error: 'Received media could not be persisted; inspect the destination before retrying.', updated_at: new Date() });
        throw error;
      });
      const result: ComputerMediaResult = { kind: 'media', actionId, grantId: grant.id, path: artifact.path, sha256: artifact.sha256, size: artifact.size, contentType: artifact.contentType, status: 'received', delivery: 'not_applicable' };
      await AgentComputerAction.query().where('id', actionId).update({ status: 'succeeded', result_json: JSON.stringify(result), updated_at: new Date() });
      return result;
    });
    // Transcripts remain transient tool content, outside action rows and audit.
    return withTranscription(received);
  }

  async execute(workspaceId: string, input: ComputerMediaSend, context: ComputerExecutionContext, adapter: ComputerAdapter, assertWindow: (grant: ComputerReplyGrant) => Promise<void>): Promise<ComputerMediaResult> {
    if (!adapter.attachFile || !adapter.read || !adapter.interact) throw new Error('This platform does not support recipient-bound native attachments yet.');
    const policy = await autonomyPolicyService.get(workspaceId);
    const grant = policy.policy.computerReplyGrants.find(g => g.id === input.grantId && g.enabled);
    if (context.actorType !== 'agent' || !grant?.media?.enabled || grant.agentId !== context.actorId || grant.taskId !== context.taskId) throw new Error('An owner-approved media grant for this agent and task is required.');
    const grantDigest = hash(JSON.stringify(grant));
    const validate = async () => {
      await context.assertRelevant?.();
      const current = await autonomyPolicyService.get(workspaceId);
      const live = current.policy.computerReplyGrants.find(g => g.id === grant.id && g.enabled);
      if (!current.enabled || current.mode !== 'bounded' || current.policy.halted || !live || hash(JSON.stringify(live)) !== grantDigest) throw new Error('Conversation authorization changed.');
      const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', grant.taskId).first();
      if (!task || task.getAttribute('assignee_node_id') !== context.actorId || task.getAttribute('archived_at') || task.getAttribute('status') === 'done') throw new Error('Native media requires an active assigned task.');
      await assertWindow(grant);
    };
    await validate();
    const source = input.source;
    if (source.kind === 'incoming') {
      if (source.batchId) await computerInboxService.validateBatch(workspaceId, grant, source.batchId, source.digest);
      else await computerInboxService.validateUnbatched(workspaceId, grant, source.digest);
    } else {
      if (!grant.allowProactive) throw new Error('Proactive attachments need explicit owner authorization.');
      if (source.kind === 'task') {
        const task = await AgentBoardTask.query().where('workspace_id', workspaceId).where('id', source.id).first();
        if (!task || task.getAttribute('assignee_node_id') !== context.actorId || task.getAttribute('archived_at')) throw new Error('Attachment source is not an assigned task.');
      } else {
        const run = await AgentRoutineRun.find(source.id);
        const routine = run ? await AgentRoutine.find(run.getAttribute('routine_id')) : null;
        if (!run || !['running', 'succeeded'].includes(String(run.getAttribute('status'))) || !routine || routine.getAttribute('workspace_id') !== workspaceId || routine.getAttribute('target_node_id') !== context.actorId || routine.getAttribute('author_task_id') !== grant.taskId) throw new Error('Attachment source is not an authorized automation run.');
      }
    }
    const key = `media:${grant.id}:${source.kind}:${source.kind === 'incoming' ? source.digest : source.id}:${input.expectedHash}`;
    const digest = hash(JSON.stringify(input));
    const previous = await AgentComputerAction.query().where('workspace_id', workspaceId).where('idempotency_key', key).first();
    if (previous) {
      if (previous.getAttribute('request_digest') !== digest || previous.getAttribute('actor_id') !== context.actorId) throw new Error('This attachment source already has a different attempt.');
      if (previous.getAttribute('status') === 'succeeded') return computerMediaResultSchema.parse(JSON.parse(String(previous.getAttribute('result_json'))));
      if (previous.getAttribute('status') !== 'gated' || JSON.parse(String(previous.getAttribute('result_json') || '{}')).ownerPreSendRecovery !== true) throw new Error('Attachment submission is pending or uncertain. Inspect before recovery; automatic replay is blocked.');
    }
    const artifact = await this.artifacts.read(workspaceId, input.path, input.expectedHash, context);
    if (!grant.media.contentTypes.includes(artifact.result.contentType as typeof grant.media.contentTypes[number]) || artifact.bytes.length > grant.media.maxMiB * MiB) throw new Error('Attachment type or size exceeds the recipient grant.');
    const route = mediaRoute(grant, artifact.result.contentType, input.presentation);
    if (['text/plain', 'application/json'].includes(artifact.result.contentType)) {
      const { companionPolicyService } = await import('./CompanionPolicyService.js');
      await companionPolicyService.publication(workspaceId, grant, artifact.bytes.toString('utf8'), context.actorId);
    }
    const filename = basename(artifact.file);
    if (filename.length > 200 || /[\x00-\x1f\x7f\\/]/.test(filename)) throw new Error('Unsupported attachment filename.');
    const actionId = previous ? String(previous.getAttribute('id')) : uuidv7();
    const operation = { workspaceId, capability: 'computer' as const, operation: 'computer.media_send', mutation: true, actorType: 'agent' as const, actorId: context.actorId, runId: context.runId, risk: 'external_publication' as const, application: { id: grant.applicationId }, computerReplyAuthorization: { grantId: grant.id, grantDigest, taskId: grant.taskId, nodeId: grant.nodeId }, input: { grantId: grant.id, source, path: input.path, sha256: input.expectedHash, size: artifact.bytes.length } };
    return autonomyPolicyService.execute({ ...operation, auditOutput: result => result }, async () => {
      const recent = await AgentComputerAction.query().where('workspace_id', workspaceId).where('node_id', grant.nodeId).where('actor_id', context.actorId!).where('created_at', '>=', new Date(Date.now() - 3600_000)).get();
      if (recent.filter(a => ['media_send', 'reply', 'send'].includes(String(a.getAttribute('command'))) && a.getAttribute('status') !== 'gated').length >= grant.maxPerHour) throw new Error('Conversation publication rate exceeded.');
      await validate();
      const tree = await adapter.read!(input.targetId, grant.applicationId);
      if (source.kind === 'incoming') replyMessage(tree, grant, source.digest, Boolean(source.batchId));
      if (replyControl(tree, grant, 'composer').value !== '') throw new Error('An existing draft must not be overwritten by an attachment.');
      const open = mediaControl(tree, route.grant, 'open');
      const staged = await this.stage(artifact.bytes, filename);
      if (previous) await AgentComputerAction.query().where('id', actionId).update({ status: 'running', result_json: null, error: null, updated_at: new Date() });
      else await AgentComputerAction.create({ id: actionId, workspace_id: workspaceId, node_id: grant.nodeId, actor_type: 'agent', actor_id: context.actorId, command: 'media_send', idempotency_key: key, request_digest: digest, status: 'running', created_at: new Date(), updated_at: new Date() });
      try {
        await validate();
        const selection = await adapter.attachFile!({ targetId: input.targetId, appId: grant.applicationId, path: staged, open, menu: route.grant.media!.menu, guards: [grant.recipient, replyControl(tree, grant, 'composer')] });
        let preview: ComputerAccessibility = selection;
        const selectedPhoto = route.presentation === 'photo' && verifiedPhotoSelection(selection.selectedFile, { path: staged, targetId: input.targetId, applicationId: grant.applicationId });
        await autonomyPolicyService.recordSemanticEffect({ ...operation, operation: 'computer.media_staged' }, { actionId, sha256: input.expectedHash, size: artifact.bytes.length });
        let selected: ReturnType<typeof attachmentPreview>;
        const previewDeadline = Date.now() + 2500;
        while (true) {
          try { selected = attachmentPreview(preview, route.grant, filename, selectedPhoto); break; }
          catch (error) { if (Date.now() >= previewDeadline) throw error; }
          await delay(100); await validate();
          preview = await adapter.read!(input.targetId, grant.applicationId);
        }
        await validate();
        if (hash(await readFile(staged)) !== input.expectedHash) throw new Error('The staged attachment changed. Nothing was sent.');
        await conversationMemoryService.prepareReply(workspaceId, grant, actionId, `Attachment submitted (delivery unconfirmed): ${input.path}; ${artifact.result.contentType}; SHA-256 ${input.expectedHash}`);
        await autonomyPolicyService.recordSemanticEffect({ ...operation, operation: 'computer.media_submit_requested' }, { actionId, sha256: input.expectedHash });
        let after = await adapter.interact!({ command: 'interact', targetId: input.targetId, action: 'press', element: selected.send, guards: [selected.recipient, selected.file, selected.composer, ...selected.additionalGuards] }, grant.applicationId);
        const deadline = Date.now() + 2500;
        while (true) {
          let remaining: ComputerAccessibility['elements'] | null = null;
          try { remaining = scopedConversation(after, grant).elements; } catch { /* Native preview dismissal may still be rendering. */ }
          if (remaining) {
            if (replyControl(after, grant, 'composer').value !== '') throw new Error('Draft changed after attachment submission. Inspect before recovery.');
            if (!remaining.some(e => e.id === selected.file.id && e.role === selected.file.role && e.name === selected.file.name && e.value === selected.file.value)) break;
          }
          if (Date.now() >= deadline) throw new Error('Attachment preview did not close after Send. Submission is uncertain; do not retry.');
          await delay(100);
          await validate();
          after = await adapter.read!(input.targetId, grant.applicationId);
        }
        const result: ComputerMediaResult = { kind: 'media', actionId, grantId: grant.id, path: input.path, sha256: input.expectedHash, contentType: artifact.result.contentType, size: artifact.bytes.length, status: 'submitted', delivery: 'unconfirmed', presentation: route.presentation };
        await AgentComputerAction.query().where('id', actionId).update({ status: 'succeeded', result_json: JSON.stringify(result), updated_at: new Date() });
        return result;
      } catch (error) {
        await AgentComputerAction.query().where('id', actionId).update({ status: 'failed', error: 'Native attachment was interrupted. Inspect its preview and receipt; automatic replay is blocked.', updated_at: new Date() });
        throw error;
      }
    });
  }
}

export const computerMediaService = new ComputerMediaService();
