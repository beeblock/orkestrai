import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { uuidv7 } from '@beeblock/svelar/support';
import { computerNodeConfigSchema, computerWatchSchema, type ComputerAccessibility, type ComputerNodeConfig, type ComputerWatch } from '../../contracts/schemas/computer.schema.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { ptySessionManager } from '../../infrastructure/pty/PtySessionManager.js';
import { taskBoardService } from './TaskBoardService.js';
import { routineService } from './RoutineService.js';
import { computerService, type ComputerExecutionContext } from './ComputerService.js';
import { computerEvidenceService } from './ComputerEvidenceService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { computerInboxService } from './ComputerInboxService.js';
import { isInboxHandled } from '../../infrastructure/repositories/ComputerInboxRepository.js';

export type ObservationState = 'paused' | 'baseline' | 'unchanged' | 'settling' | 'changed' | 'navigating' | 'waiting_focus' | 'waiting_agent' | 'blocked' | 'error';
export type ObservationStatus = { state: ObservationState; checkedAt: string | null; changedAt: string | null; checks: number; notifications: number; error: string | null; source?: 'accessibility' | 'visual'; checkMs?: number; pendingMessages?: number };
type SemanticFrame = Map<string, string>;
type Runtime = { signature: string; windowId: string; replyScoped: boolean; nextAt: number; lastNotified: number; baseline?: Uint8Array; candidate?: Uint8Array; dimensions?: string; semantic?: SemanticFrame; semanticCandidate?: string; semanticRetryAt?: number; event?: { id: string; expiresAt: number; content: string }; status: ObservationStatus };
export const watchSignature = (watch: ComputerWatch) => createHash('sha256').update(JSON.stringify(watch)).digest('hex');

export function semanticObservation(tree: ComputerAccessibility): SemanticFrame {
  return new Map(tree.elements.filter((element) => !element.protected && (element.name || element.value)).map(({ id, role, name, value }) => [id, JSON.stringify({ id, role, name, value })]));
}

export function semanticChanges(previous: SemanticFrame, current: SemanticFrame): string[] {
  return [...current].filter(([id, value]) => previous.get(id) !== value).map(([, value]) => value);
}

export function summarizeSemanticChanges(changes: string[]): string {
  const result: unknown[] = [];
  let characters = 0;
  for (const entry of changes.slice(0, 30)) {
    const value = JSON.parse(entry);
    const bounded = { ...value, value: value.value.slice(0, 4000) };
    characters += JSON.stringify(bounded).length;
    if (characters > 11_000) break;
    result.push(bounded);
  }
  return JSON.stringify({ elements: result, truncated: result.length < changes.length || changes.some((entry) => JSON.parse(entry).value.length > 4000) });
}

// Compare a bounded sample grid, not PNG metadata or an unbounded pixel buffer.
export function sampleObservation(bytes: Buffer, region: ComputerWatch['region']): { sample: Uint8Array; dimensions: string } {
  if (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 32_000_000) throw new Error('Computer observation dimensions exceed the limit.');
  const image = PNG.sync.read(bytes, { checkCRC: true });
  const sample = new Uint8Array(64 * 64 * 3);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const px = Math.min(image.width - 1, Math.floor((region.x + (x + 0.5) / 64 * region.width) * image.width));
    const py = Math.min(image.height - 1, Math.floor((region.y + (y + 0.5) / 64 * region.height) * image.height));
    const source = (py * image.width + px) * 4;
    sample.set(image.data.subarray(source, source + 3), (y * 64 + x) * 3);
  }
  return { sample, dimensions: `${image.width}x${image.height}` };
}

export function observationDifference(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 24) changed++;
  return changed / (a.length / 3) * 100;
}

export class ComputerObservationService {
  private states = new Map<string, Runtime>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private cleanedAt = 0;

  status(workspaceId: string): ObservationStatus {
    return this.states.get(workspaceId)?.status ?? { state: 'paused', checkedAt: null, changedAt: null, checks: 0, notifications: 0, error: null };
  }

  eventContent(workspaceId: string, eventId: string): string | null {
    const state = this.states.get(workspaceId);
    if (state?.event && state.event.expiresAt <= Date.now()) state.event = undefined;
    const event = state?.event;
    return event?.id === eventId && event.expiresAt > Date.now() ? event.content : null;
  }

  acknowledgeAction(workspaceId: string, windowId: string, tree: ComputerAccessibility) {
    const state = this.states.get(workspaceId);
    if (state?.windowId === windowId && !state.replyScoped && state.status.source === 'accessibility' && tree.available && !tree.truncated) {
      state.semantic = semanticObservation(tree); state.semanticCandidate = undefined;
    }
  }

  async validate(workspaceId: string, watch: ComputerWatch, config: ComputerNodeConfig, actorId?: string | null) {
    if (!watch.enabled) return null;
    if (!config.enabled || !config.allowedApplications.some((app) => app.toLowerCase() === watch.applicationId.toLowerCase())) throw new Error('Enable the target application on the Computer node first.');
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace || workspace.suspendedAt) throw new Error('The workspace is unloaded.');
    const routine = (await routineService.list(workspaceId)).find((candidate) => candidate.id === watch.routineId);
    if (!routine?.enabled || routine.triggerType !== 'manual' || routine.actionType !== 'prompt_agent') throw new Error('Select an enabled manual automation that prompts an agent. Scheduled automations would wake the agent twice.');
    const target = String(routine.actionConfig.targetNodeId ?? routine.targetNodeId ?? '');
    if (actorId && target !== actorId) throw new Error('Agents may observe only for their own automation.');
    const task = (await taskBoardService.list(workspaceId)).find((candidate) => candidate.id === watch.taskId);
    if (!task || task.status === 'done' || task.assigneeNodeId !== target) throw new Error('The observation requires an active task assigned to the automation agent.');
    const policy = await autonomyPolicyService.get(workspaceId);
    if (!policy.enabled || policy.mode !== 'bounded' || policy.policy.halted || !policy.policy.capabilities.includes('computer') || !policy.policy.allowedApps.some((app) => app.toLowerCase() === watch.applicationId.toLowerCase())) throw new Error('An active bounded Computer policy is required for observation.');
    if (watch.replyGrantId) {
      const grant = policy.policy.computerReplyGrants.find(g => g.id === watch.replyGrantId && g.enabled && g.agentId === target && g.taskId === watch.taskId && g.applicationId === watch.applicationId);
      if (!grant || watch.mode !== 'auto') throw new Error('Conversation observation requires its active authorization and native reading mode.');
    }
    return routine;
  }

  async configure(workspaceId: string, rawWatch: ComputerWatch, context: ComputerExecutionContext): Promise<void> {
    const watch = computerWatchSchema.parse(rawWatch);
    const node = (await workspaceRepository.listNodes(workspaceId)).find((candidate) => candidate.type === 'computer');
    if (!node) throw new Error('Prepare a Computer node first.');
    const payload = node.payload as Record<string, unknown>;
    const config = computerNodeConfigSchema.parse(payload.computerConfig ?? {});
    if (context.actorType !== 'user') {
      if (!config.allowAgentWatch) throw new Error('The owner has not enabled agent observation configuration.');
      if (watch.taskId !== context.taskId) throw new Error('The watch must belong to the current task.');
      if (!watch.enabled && config.watch.routineId) await this.validate(workspaceId, { ...config.watch, enabled: true }, config, context.actorId);
    }
    await this.validate(workspaceId, watch, config, context.actorType === 'user' ? undefined : context.actorId);
    if (watchSignature(watch) === watchSignature(config.watch)) return;
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'computer', operation: 'computer.watch', actorType: context.actorType, actorId: context.actorId, mutation: true }, { ...watch });
    await workspaceRepository.updateNode(node.id, { payload: { ...payload, computerConfig: { ...config, watch } } });
    this.states.delete(workspaceId);
  }

  async assertCurrent(workspaceId: string, signature: string): Promise<void> {
    const node = (await workspaceRepository.listNodes(workspaceId)).find((candidate) => candidate.type === 'computer');
    const config = computerNodeConfigSchema.parse((node?.payload as Record<string, unknown>)?.computerConfig ?? {});
    if (!config.watch.enabled || watchSignature(config.watch) !== signature) throw new Error('The observation was paused or changed.');
    await this.validate(workspaceId, config.watch, config);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    this.timer.unref?.();
    void this.tick();
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; this.states.clear(); }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      if (Date.now() - this.cleanedAt >= 300_000) {
        this.cleanedAt = Date.now();
        await computerEvidenceService.sweep().catch(() => console.error('[computer-storage] Cleanup failed; inspect Computer storage status.'));
        const { conversationMemoryService } = await import('./ConversationMemoryService.js');
        await conversationMemoryService.sweep().catch(() => console.error('[conversation-memory] Retention cleanup failed.'));
        const { computerMediaService } = await import('./ComputerMediaService.js');
        await computerMediaService.sweep().catch(() => console.error('[computer-media] Temporary attachment cleanup failed.'));
      }
      const workspaces = await workspaceRepository.listWorkspaces();
      for (const workspace of workspaces) {
        const node = (await workspaceRepository.listNodes(workspace.id)).find((candidate) => candidate.type === 'computer');
        const parsed = computerNodeConfigSchema.safeParse((node?.payload as Record<string, unknown>)?.computerConfig ?? {});
        if (!parsed.success || !parsed.data.watch.enabled || !parsed.data.enabled || workspace.suspendedAt) { this.states.delete(workspace.id); continue; }
        const config = parsed.data;
        const watch = config.watch;
        const signature = watchSignature(watch);
        let runtime = this.states.get(workspace.id);
        if (!runtime || runtime.signature !== signature) {
          runtime = { signature, windowId: watch.windowId, replyScoped: Boolean(watch.replyGrantId), nextAt: 0, lastNotified: 0, status: { state: 'baseline', checkedAt: null, changedAt: null, checks: 0, notifications: 0, error: null } };
          this.states.set(workspace.id, runtime);
        }
        if (runtime.event && runtime.event.expiresAt <= Date.now()) runtime.event = undefined;
        if (Date.now() < runtime.nextAt) continue;
        runtime.nextAt = Date.now() + watch.intervalSeconds * 1000;
        try {
          const routine = await this.validate(workspace.id, watch, config);
          const targetId = String(routine!.actionConfig.targetNodeId ?? routine!.targetNodeId);
          const session = ptySessionManager.listLiveForNode(workspace.id, targetId)[0];
          const agentBusy = Boolean(session && !session.waiting);
          if (agentBusy && !watch.replyGrantId) { runtime.status.state = 'waiting_agent'; continue; }
          const state = runtime;
          const startedAt = Date.now();
          if (watch.mode === 'auto' && Date.now() >= (state.semanticRetryAt ?? 0)) {
            const result = await computerService.observeAccessibility(workspace.id, watch.windowId, watch.applicationId, () => this.assertCurrent(workspace.id, signature));
            state.status.checkMs = Date.now() - startedAt;
            if (result.state === 'waiting_agent') { state.status.state = result.state; state.semanticCandidate = undefined; continue; }
            if (result.state === 'navigation_required') {
              state.status.state = 'navigating';
              await computerService.execute(workspace.id, { command: 'open_conversation', targetId: watch.windowId, grantId: result.grantId },
                { actorType: 'automation', actorId: watch.routineId, taskId: watch.taskId!, assertRelevant: () => this.assertCurrent(workspace.id, signature) });
              state.status.error = null;
              state.nextAt = Date.now();
              continue;
            }
            if (result.state === 'read' && result.tree) {
              state.status.source = 'accessibility'; state.status.checks++; state.status.checkedAt = new Date().toISOString(); state.status.error = null;
              if (watch.replyGrantId) {
                const grant = (await autonomyPolicyService.get(workspace.id)).policy.computerReplyGrants.find(g => g.id === watch.replyGrantId && g.enabled)!;
                const inbox = await computerInboxService.ingest(workspace.id, grant, result.tree);
                state.status.pendingMessages = inbox.messages.filter(m => !isInboxHandled(m)).length;
                if (agentBusy) { state.status.state = 'waiting_agent'; continue; }
                const batch = await computerInboxService.claim(workspace.id, grant, watch.cooldownSeconds * 1000);
                if (!batch) { state.status.state = state.status.pendingMessages ? 'settling' : 'unchanged'; continue; }
                const eventId = uuidv7();
                const { conversationMemoryService } = await import('./ConversationMemoryService.js');
                const memory = await conversationMemoryService.context(workspace.id, grant, batch.messages.map(m => m.text).join('\n'));
                state.event = { id: eventId, expiresAt: Date.now() + 120_000, content: JSON.stringify({ reply: batch, memory }) };
                await this.assertCurrent(workspace.id, signature);
                const queued = await routineService.enqueueComputerObservation(routine!.id, workspace.id, { signature, taskId: watch.taskId!, windowId: watch.windowId, applicationId: watch.applicationId, eventId, source: 'accessibility' });
                if (queued) { state.lastNotified = Date.now(); state.status.state = 'changed'; state.status.changedAt = new Date().toISOString(); state.status.notifications++; }
                else {
                  await computerInboxService.releaseUndispatched(workspace.id, grant, batch.batchId);
                  state.event = undefined;
                  state.status.state = 'waiting_agent';
                }
                continue;
              }
              const frame = semanticObservation(result.tree);
              if (!state.semantic) { state.semantic = frame; state.status.state = 'baseline'; continue; }
              const changes = semanticChanges(state.semantic, frame);
              if (!changes.length) { state.semantic = frame; state.semanticCandidate = undefined; state.status.state = 'unchanged'; continue; }
              const digest = createHash('sha256').update(JSON.stringify([...frame])).digest('hex');
              if (state.semanticCandidate !== digest) { state.semanticCandidate = digest; state.status.state = 'settling'; continue; }
              if (Date.now() - state.lastNotified < watch.cooldownSeconds * 1000) continue;
              const eventId = uuidv7();
              state.event = { id: eventId, expiresAt: Date.now() + 120_000, content: summarizeSemanticChanges(changes) };
              await this.assertCurrent(workspace.id, signature);
              const queued = await routineService.enqueueComputerObservation(routine!.id, workspace.id, { signature, taskId: watch.taskId!, windowId: watch.windowId, applicationId: watch.applicationId, eventId, source: 'accessibility' });
              if (queued) { state.semantic = frame; state.semanticCandidate = undefined; state.lastNotified = Date.now(); state.status.state = 'changed'; state.status.changedAt = new Date().toISOString(); state.status.notifications++; }
              else state.status.state = 'waiting_agent';
              continue;
            }
            if (watch.replyGrantId) throw new Error('Native conversation reading is unavailable. Automatic replies remain paused; no visual fallback is authorized.');
            // An inaccessible/custom UI gets the existing bounded visual fallback,
            // not an AX probe plus a screenshot on every polling interval.
            state.semanticRetryAt = Date.now() + 60_000;
            state.semantic = undefined; state.semanticCandidate = undefined;
          }
          state.status.source = 'visual';
          state.nextAt = Math.max(state.nextAt, Date.now() + 3000);
          let accepted: Uint8Array | undefined;
          const result = await computerService.observeWindow(workspace.id, watch.windowId, watch.applicationId, async (path) => {
            const frame = sampleObservation(await readFile(path), watch.region);
            state.status.checks++;
            state.status.checkedAt = new Date().toISOString();
            state.status.error = null;
            if (!state.baseline || frame.dimensions !== state.dimensions) {
              state.baseline = frame.sample; state.dimensions = frame.dimensions; state.candidate = undefined; state.status.state = 'baseline'; return false;
            }
            if (observationDifference(state.baseline, frame.sample) < watch.minChangePercent) { state.candidate = undefined; state.status.state = 'unchanged'; return false; }
            if (!state.candidate || observationDifference(state.candidate, frame.sample) >= watch.minChangePercent) { state.candidate = frame.sample; state.status.state = 'settling'; return false; }
            if (Date.now() - state.lastNotified < watch.cooldownSeconds * 1000) return false;
            accepted = frame.sample;
            return true;
          }, () => this.assertCurrent(workspace.id, signature));
          state.status.checkMs = Date.now() - startedAt;
          if (result.state === 'waiting_focus' || result.state === 'waiting_agent') { runtime.status.state = result.state; runtime.candidate = undefined; }
          if (result.capture) {
            await this.assertCurrent(workspace.id, signature);
            const queued = await routineService.enqueueComputerObservation(routine!.id, workspace.id, {
              signature, taskId: watch.taskId!, windowId: watch.windowId, applicationId: watch.applicationId,
              evidencePath: result.capture.path, eventId: uuidv7(), source: 'visual',
            });
            if (queued) {
              runtime.baseline = accepted; runtime.candidate = undefined; runtime.lastNotified = Date.now();
              runtime.status.state = 'changed'; runtime.status.changedAt = new Date().toISOString(); runtime.status.notifications++;
            } else runtime.status.state = 'waiting_agent';
          }
        } catch (error) {
          runtime.status.state = 'blocked';
          runtime.status.error = error instanceof Error ? error.message.slice(0, 500) : 'Observation failed.';
          runtime.nextAt = Date.now() + 30_000;
        }
      }
      for (const id of this.states.keys()) if (!workspaces.some((workspace) => workspace.id === id)) this.states.delete(id);
    } catch { console.error('[computer-observation] Local observer tick failed.'); }
    finally { this.ticking = false; }
  }
}

export const computerObservationService = new ComputerObservationService();
