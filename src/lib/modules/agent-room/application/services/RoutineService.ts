import { readdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';
import { Queue } from '@beeblock/svelar/queue';
import { uuidv7 } from '@beeblock/svelar/support';
import type {
  AutomationActionType,
  AutomationRun,
  AutomationRunStatus,
  AutomationTriggerType,
  Routine,
} from '../../domain/types.js';
import type { AutomationFormInput } from '../../contracts/schemas/automation.schema.js';
import type { AutomationTriggerReceived } from '../../domain/events/AutomationTriggerReceived.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { githubAutomationAdapter } from '../../infrastructure/integrations/GitHubAutomationAdapter.js';
import { taskBoardService } from './TaskBoardService.js';
import { nativeNotificationService } from './NativeNotificationService.js';
import { usageService } from './UsageService.js';
import { gitService } from './GitService.js';
import { automationIntegrationService } from './AutomationIntegrationService.js';
import { RunAutomationJob } from '../jobs/RunAutomationJob.js';
import { agentTerminalDeliveryService } from './AgentTerminalDeliveryService.js';
import { agentSessionService } from './AgentSessionService.js';

const TICK_MS = 15_000;
const RUN_LEASE_MS = 2 * 60_000;
const RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 20_000;
const QUEUED_RUN_BATCH = 10;
const POLL_INTERVALS: Partial<Record<AutomationTriggerType, number>> = {
  file_change: 30_000,
  git_commit: 30_000,
  github_pull_request: 5 * 60_000,
  usage_threshold: 5 * 60_000,
};

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function jsonValue(value: unknown): unknown {
  if (!value) return null;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }
}

function mapRoutine(model: AgentRoutine): Routine {
  const prompt = String(model.getAttribute('prompt') ?? '');
  const intervalMinutes = model.getAttribute('interval_minutes') as number | null;
  const triggerType = (model.getAttribute('trigger_type') ?? 'schedule') as AutomationTriggerType;
  const targetNodeId = String(model.getAttribute('target_node_id') ?? '') || null;
  const createdAt = toIso(model.getAttribute('created_at'));
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    name: String(model.getAttribute('name') ?? prompt.split('\n')[0]?.replace(/^&&\s*/, '').slice(0, 80) ?? 'Automation'),
    targetNodeId,
    prompt,
    intervalMinutes,
    enabled: Boolean(model.getAttribute('enabled')),
    lastRunAt: model.getAttribute('last_run_at') ? toIso(model.getAttribute('last_run_at')) : null,
    runCount: Number(model.getAttribute('run_count') ?? 0),
    triggerType,
    triggerConfig: Object.keys(jsonObject(model.getAttribute('trigger_config_json'))).length
      ? jsonObject(model.getAttribute('trigger_config_json'))
      : { intervalMinutes, once: intervalMinutes === null },
    actionType: (model.getAttribute('action_type') ?? 'prompt_agent') as AutomationActionType,
    actionConfig: Object.keys(jsonObject(model.getAttribute('action_config_json'))).length
      ? jsonObject(model.getAttribute('action_config_json'))
      : { targetNodeId, prompt },
    recipeId: model.getAttribute('recipe_id') ? String(model.getAttribute('recipe_id')) : null,
    createdAt,
    updatedAt: model.getAttribute('updated_at') ? toIso(model.getAttribute('updated_at')) : createdAt,
  };
}

function mapRun(model: AgentRoutineRun): AutomationRun {
  const ok = Boolean(model.getAttribute('ok'));
  const status = (model.getAttribute('status') ?? (ok ? 'succeeded' : 'failed')) as AutomationRunStatus;
  return {
    id: String(model.getAttribute('id')),
    routineId: String(model.getAttribute('routine_id')),
    ranAt: toIso(model.getAttribute('ran_at')),
    status,
    ok: status === 'succeeded',
    triggerType: (model.getAttribute('trigger_type') ?? 'manual') as AutomationTriggerType,
    triggerKey: model.getAttribute('trigger_key') ? String(model.getAttribute('trigger_key')) : null,
    detail: model.getAttribute('detail') ? String(model.getAttribute('detail')) : null,
    input: jsonObject(model.getAttribute('input_json')),
    output: jsonObject(model.getAttribute('output_json')),
    error: model.getAttribute('error') ? String(model.getAttribute('error')) : null,
    agentNodeId: model.getAttribute('agent_node_id') ? String(model.getAttribute('agent_node_id')) : null,
    provider: model.getAttribute('provider') ? String(model.getAttribute('provider')) : null,
    usageBefore: jsonValue(model.getAttribute('usage_before_json')),
    usageAfter: jsonValue(model.getAttribute('usage_after_json')),
    startedAt: model.getAttribute('started_at') ? toIso(model.getAttribute('started_at')) : null,
    finishedAt: model.getAttribute('finished_at') ? toIso(model.getAttribute('finished_at')) : null,
    durationMs: model.getAttribute('duration_ms') === null ? null : Number(model.getAttribute('duration_ms')),
    attempt: Number(model.getAttribute('attempt') ?? 1),
    retryOfId: model.getAttribute('retry_of_id') ? String(model.getAttribute('retry_of_id')) : null,
    recoverable: status === 'failed' || status === 'dead_letter',
    checkpoint: jsonObject(model.getAttribute('checkpoint_json')),
    cancelRequestedAt: model.getAttribute('cancel_requested_at') ? toIso(model.getAttribute('cancel_requested_at')) : null,
    nextAttemptAt: model.getAttribute('next_attempt_at') ? toIso(model.getAttribute('next_attempt_at')) : null,
    maxAttempts: Number(model.getAttribute('max_attempts') ?? MAX_ATTEMPTS),
    deadLetteredAt: model.getAttribute('dead_lettered_at') ? toIso(model.getAttribute('dead_lettered_at')) : null,
  };
}

function triggerConfig(input: AutomationFormInput, existing: Record<string, unknown> = {}): Record<string, unknown> {
  if (input.triggerType === 'schedule') return { intervalMinutes: input.intervalMinutes, once: !input.intervalMinutes };
  if (input.triggerType === 'task') return { event: input.taskEvent, status: input.taskStatus || null };
  if (input.triggerType === 'message') return { contains: input.messageContains || null };
  if (input.triggerType === 'git_commit') return { branch: input.gitBranch || null };
  if (input.triggerType === 'github_pull_request') return { event: input.githubEvent };
  if (input.triggerType === 'webhook') {
    const secret = String(input.webhookSecret ?? '');
    if (/^\*{16,}$/.test(secret) && existing.secretHash) return { secretHash: existing.secretHash };
    return { secretHash: createHash('sha256').update(secret).digest('hex') };
  }
  if (input.triggerType === 'file_change') return { path: input.filePath };
  if (input.triggerType === 'usage_threshold') {
    return { provider: input.usageProvider, window: input.usageWindow, percent: input.usagePercent };
  }
  return {};
}

function actionConfig(input: AutomationFormInput): Record<string, unknown> {
  if (input.actionType === 'prompt_agent') return { targetNodeId: input.targetNodeId, prompt: input.prompt };
  if (input.actionType === 'create_task') return { title: input.taskTitle, description: input.taskDescription || null };
  return { title: input.notificationTitle || null, message: input.notificationMessage };
}

export class RoutineService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly lastPolledAt = new Map<string, number>();
  private readonly workerId = `core:${process.pid}:${randomUUID()}`;
  private readonly activeRuns = new Map<string, AbortController>();
  private schedulerTickRunning = false;

  async list(workspaceId: string): Promise<Routine[]> {
    const rows = await AgentRoutine.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get();
    return rows.map(mapRoutine);
  }

  async createAutomation(workspaceId: string, input: AutomationFormInput): Promise<Routine> {
    const trigger = triggerConfig(input);
    const action = actionConfig(input);
    await this.validateAction(workspaceId, input.actionType, action);
    const now = new Date();
    const targetNodeId = input.actionType === 'prompt_agent' ? String(input.targetNodeId ?? '') : '';
    const prompt = input.actionType === 'prompt_agent' ? String(input.prompt ?? '') : '';
    const intervalMinutes = input.triggerType === 'schedule' ? input.intervalMinutes ?? null : null;
    const model = await AgentRoutine.create({
      id: uuidv7(), workspace_id: workspaceId, target_node_id: targetNodeId, prompt,
      interval_minutes: intervalMinutes, enabled: input.enabled, last_run_at: null, run_count: 0,
      name: input.name, trigger_type: input.triggerType, trigger_config_json: JSON.stringify(trigger),
      action_type: input.actionType, action_config_json: JSON.stringify(action), recipe_id: input.recipeId ?? null,
      last_trigger_key: null, created_at: now, updated_at: now,
    });
    return mapRoutine(model);
  }

  async create(input: { workspaceId: string; targetNodeId: string; prompt: string; intervalMinutes?: number | null }): Promise<Routine> {
    if (!input.prompt.trim()) throw new Error('Informe o prompt da rotina.');
    return this.createAutomation(input.workspaceId, {
      name: input.prompt.trim().split('\n')[0].replace(/^&&\s*/, '').slice(0, 120),
      triggerType: 'schedule', intervalMinutes: input.intervalMinutes ?? null,
      actionType: 'prompt_agent', targetNodeId: input.targetNodeId, prompt: input.prompt,
      enabled: true, recipeId: null,
      taskEvent: null, taskStatus: null, messageContains: null, gitBranch: null,
      githubEvent: null, filePath: null, usageProvider: null, usageWindow: null,
      webhookSecret: null,
      usagePercent: null, taskTitle: null, taskDescription: null,
      notificationTitle: null, notificationMessage: null,
    });
  }

  async updateAutomation(id: string, input: AutomationFormInput): Promise<Routine | null> {
    const existing = await AgentRoutine.find(id);
    if (!existing) return null;
    const workspaceId = String(existing.getAttribute('workspace_id'));
    const trigger = triggerConfig(input, jsonObject(existing.getAttribute('trigger_config_json')));
    const action = actionConfig(input);
    await this.validateAction(workspaceId, input.actionType, action);
    const now = new Date();
    await AgentRoutine.query().where('id', id).update({
      name: input.name,
      target_node_id: input.actionType === 'prompt_agent' ? String(input.targetNodeId ?? '') : '',
      prompt: input.actionType === 'prompt_agent' ? String(input.prompt ?? '') : '',
      interval_minutes: input.triggerType === 'schedule' ? input.intervalMinutes ?? null : null,
      enabled: input.enabled,
      trigger_type: input.triggerType,
      trigger_config_json: JSON.stringify(trigger),
      action_type: input.actionType,
      action_config_json: JSON.stringify(action),
      recipe_id: input.recipeId ?? null,
      last_trigger_key: null,
      updated_at: now,
    });
    const model = await AgentRoutine.find(id);
    return model ? mapRoutine(model) : null;
  }

  async setEnabled(id: string, enabled: boolean): Promise<Routine | null> {
    await AgentRoutine.query().where('id', id).update({ enabled, updated_at: new Date() });
    const model = await AgentRoutine.find(id);
    return model ? mapRoutine(model) : null;
  }

  async get(id: string): Promise<Routine | null> {
    const model = await AgentRoutine.find(id);
    return model ? mapRoutine(model) : null;
  }

  async update(id: string, input: { targetNodeId?: string; prompt?: string; intervalMinutes?: number | null }): Promise<Routine | null> {
    const existing = await AgentRoutine.find(id);
    if (!existing) return null;
    const routine = mapRoutine(existing);
    const prompt = input.prompt ?? routine.prompt;
    if (!prompt.trim()) throw new Error('Informe o prompt da rotina.');
    const targetNodeId = input.targetNodeId ?? routine.targetNodeId ?? '';
    await this.validateAction(routine.workspaceId, 'prompt_agent', { targetNodeId, prompt });
    await AgentRoutine.query().where('id', id).update({
      target_node_id: targetNodeId, prompt: prompt.trim(), interval_minutes: input.intervalMinutes ?? routine.intervalMinutes,
      name: routine.name, trigger_type: 'schedule',
      trigger_config_json: JSON.stringify({ intervalMinutes: input.intervalMinutes ?? routine.intervalMinutes, once: (input.intervalMinutes ?? routine.intervalMinutes) === null }),
      action_type: 'prompt_agent', action_config_json: JSON.stringify({ targetNodeId, prompt: prompt.trim() }), updated_at: new Date(),
    });
    const model = await AgentRoutine.find(id);
    return model ? mapRoutine(model) : null;
  }

  async remove(id: string): Promise<boolean> {
    await AgentRoutineRun.query().where('routine_id', id).delete();
    return (await AgentRoutine.query().where('id', id).delete()) > 0;
  }

  async history(id: string, limit = 50): Promise<AutomationRun[]> {
    const rows = await AgentRoutineRun.query().where('routine_id', id).orderBy('ran_at', 'desc').limit(limit).get();
    return rows.map(mapRun);
  }

  async getRun(id: string): Promise<AutomationRun | null> {
    const model = await AgentRoutineRun.find(id);
    return model ? mapRun(model) : null;
  }

  async workspaceHistory(workspaceId: string, limit = 100): Promise<AutomationRun[]> {
    const routines = await AgentRoutine.query().where('workspace_id', workspaceId).get();
    const runs = (await Promise.all(routines.map((routine) => AgentRoutineRun.query()
      .where('routine_id', routine.getAttribute('id')).orderBy('ran_at', 'desc').limit(limit).get()))).flat();
    return runs.sort((a, b) => toIso(b.getAttribute('ran_at')).localeCompare(toIso(a.getAttribute('ran_at')))).slice(0, limit).map(mapRun);
  }

  async runNow(id: string): Promise<{ ok: boolean; detail: string; run: AutomationRun }> {
    const routine = await AgentRoutine.find(id);
    if (!routine) throw new Error('Rotina não encontrada.');
    const run = await this.createRun(mapRoutine(routine), 'manual', `manual:${uuidv7()}`, {});
    await this.executeRun(run.id, false);
    const completed = await AgentRoutineRun.find(run.id);
    if (!completed) throw new Error('Execution record was not found.');
    const mapped = mapRun(completed);
    return { ok: mapped.status === 'succeeded', detail: mapped.detail ?? mapped.error ?? '', run: mapped };
  }

  async retry(runId: string): Promise<AutomationRun> {
    const original = await AgentRoutineRun.find(runId);
    if (!original) throw new Error('Execution not found.');
    if (!['failed', 'dead_letter'].includes(String(original.getAttribute('status') ?? ''))) {
      throw new Error('Only a final failed execution can be replayed.');
    }
    const routine = await AgentRoutine.find(original.getAttribute('routine_id'));
    if (!routine) throw new Error('Automation not found.');
    const run = await this.createRun(
      mapRoutine(routine), 'manual', `retry:${runId}:${uuidv7()}`, jsonObject(original.getAttribute('input_json')), runId, 0,
    );
    await this.dispatchRun(run.id);
    const updated = await AgentRoutineRun.find(run.id);
    return updated ? mapRun(updated) : run;
  }

  async cancel(runId: string): Promise<AutomationRun | null> {
    const run = await AgentRoutineRun.find(runId);
    if (!run) return null;
    const status = String(run.getAttribute('status') ?? 'queued') as AutomationRunStatus;
    if (['succeeded', 'failed', 'cancelled', 'dead_letter'].includes(status)) return mapRun(run);
    const now = new Date();
    if (status === 'queued') {
      await AgentRoutineRun.query().where('id', runId).where('status', 'queued').update({
        status: 'cancelled', ok: false, detail: 'Execution cancelled.', error: null,
        cancel_requested_at: now, finished_at: now, next_attempt_at: null,
      });
    } else {
      await AgentRoutineRun.query().where('id', runId).where('status', 'running').update({ cancel_requested_at: now });
      this.activeRuns.get(runId)?.abort(new Error('Execution cancelled.'));
    }
    const updated = await AgentRoutineRun.find(runId);
    return updated ? mapRun(updated) : null;
  }

  async dispatchEvent(event: AutomationTriggerReceived): Promise<number> {
    const rows = await AgentRoutine.query().where('workspace_id', event.workspaceId).where('enabled', true).get();
    let dispatched = 0;
    for (const model of rows) {
      const routine = mapRoutine(model);
      if (routine.triggerType !== event.triggerType || !this.matchesEvent(routine, event)) continue;
      if (await this.enqueue(routine, event.triggerType, event.key, event.data)) dispatched += 1;
    }
    return dispatched;
  }

  async dueRoutines(): Promise<Routine[]> {
    const rows = await AgentRoutine.query().where('enabled', true).get();
    const now = Date.now();
    return rows.map(mapRoutine).filter((routine) => {
      if (routine.triggerType !== 'schedule') return false;
      const interval = Number(routine.triggerConfig.intervalMinutes ?? routine.intervalMinutes ?? 0);
      const once = routine.triggerConfig.once === true || (!interval && !routine.lastRunAt);
      if (once) return !routine.lastRunAt && now - new Date(routine.createdAt).getTime() > 60_000;
      if (!interval) return false;
      if (!routine.lastRunAt) return true;
      return now - new Date(routine.lastRunAt).getTime() >= interval * 60_000;
    });
  }

  async tick(): Promise<number> {
    let count = 0;
    count += await this.recoverInterruptedRuns();
    const due = await this.dueRoutines();
    for (const routine of due) {
      const interval = Number(routine.triggerConfig.intervalMinutes ?? routine.intervalMinutes ?? 1);
      const key = `schedule:${Math.floor(Date.now() / Math.max(60_000, interval * 60_000))}`;
      if (await this.enqueue(routine, 'schedule', key, { scheduledAt: new Date().toISOString() })) count += 1;
    }
    const polled = await AgentRoutine.query().where('enabled', true).get();
    for (const model of polled) {
      const routine = mapRoutine(model);
      if (!POLL_INTERVALS[routine.triggerType] || !this.pollDue(routine)) continue;
      if (await this.poll(routine).catch(() => false)) count += 1;
    }
    count += await this.processQueuedRuns();
    return count;
  }

  async executeRun(runId: string, rethrow = true): Promise<void> {
    const run = await this.claimRun(runId);
    if (!run) return;
    const routineModel = await AgentRoutine.find(run.getAttribute('routine_id'));
    if (!routineModel) {
      await AgentRoutineRun.query().where('id', runId).update({
        status: 'dead_letter', ok: false, detail: 'Automation no longer exists.',
        error: 'Automation no longer exists.', dead_lettered_at: new Date(),
        finished_at: new Date(), lease_owner: null, lease_expires_at: null,
      });
      return;
    }
    const routine = mapRoutine(routineModel);
    const started = Date.now();
    const input = jsonObject(run.getAttribute('input_json'));
    const attempt = Number(run.getAttribute('attempt') ?? 1);
    const workspace = await workspaceRepository.getWorkspace(routine.workspaceId);
    if (!workspace) {
      await AgentRoutineRun.query().where('id', runId).where('status', 'running').update({
        status: 'dead_letter', detail: 'Workspace no longer exists.', error: 'Workspace no longer exists.',
        dead_lettered_at: new Date(), finished_at: new Date(), lease_owner: null, lease_expires_at: null,
      });
      return;
    }
    if (workspace.suspendedAt) {
      await AgentRoutineRun.query().where('id', runId).where('status', 'running').update({
        status: 'queued', detail: 'Waiting for the workspace to resume.',
        attempt: Math.max(0, attempt - 1), lease_owner: null, lease_expires_at: null,
        next_attempt_at: new Date(Date.now() + 60_000),
      });
      return;
    }
    const agentNodeId = routine.actionType === 'prompt_agent' ? String(routine.actionConfig.targetNodeId ?? '') : null;
    const agent = agentNodeId ? await workspaceRepository.getNode(agentNodeId) : null;
    const provider = agent ? String((agent.payload as Record<string, unknown>).provider ?? '') || null : null;
    const usageBefore = provider && ['claude', 'codex', 'kimi'].includes(provider)
      ? await usageService.getUsage(provider, false).catch(() => null)
      : null;
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Execution timed out.'));
    }, RUN_TIMEOUT_MS);
    timeout.unref?.();
    const leasePulse = setInterval(() => {
      void this.heartbeat(runId, { stage: 'running', attempt }).catch(() => undefined);
    }, Math.floor(RUN_LEASE_MS / 3));
    leasePulse.unref?.();
    await AgentRoutineRun.query().where('id', runId).update({
      agent_node_id: agentNodeId,
      provider,
      usage_before_json: usageBefore ? JSON.stringify(usageBefore) : null,
      timeout_at: new Date(started + RUN_TIMEOUT_MS),
    });
    try {
      await this.heartbeat(runId, { stage: 'action', attempt });
      const result = await this.executeAction(routine, input, runId, controller.signal);
      if (controller.signal.aborted || await this.isCancellationRequested(runId)) throw controller.signal.reason ?? new Error('Execution cancelled.');
      const usageAfter = provider && ['claude', 'codex', 'kimi'].includes(provider)
        ? await usageService.getUsage(provider, false).catch(() => null)
        : null;
      const finished = Date.now();
      const detail = String(result.detail ?? 'Automation completed.');
      await AgentRoutineRun.query().where('id', runId).update({
        status: 'succeeded', ok: true, detail, output_json: JSON.stringify(result), error: null,
        usage_after_json: usageAfter ? JSON.stringify(usageAfter) : null,
        finished_at: new Date(finished), duration_ms: finished - started,
        lease_owner: null, lease_expires_at: null, heartbeat_at: new Date(finished),
        checkpoint_json: JSON.stringify({ stage: 'complete', attempt }), next_attempt_at: null,
      });
      await this.finishRoutine(routine, finished);
    } catch (error) {
      const finished = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = !timedOut && (controller.signal.aborted || await this.isCancellationRequested(runId));
      const maxAttempts = Number(run.getAttribute('max_attempts') ?? MAX_ATTEMPTS);
      if (cancelled) {
        await AgentRoutineRun.query().where('id', runId).update({
          status: 'cancelled', ok: false, detail: 'Execution cancelled.', error: null,
          finished_at: new Date(finished), duration_ms: finished - started,
          lease_owner: null, lease_expires_at: null, next_attempt_at: null,
          checkpoint_json: JSON.stringify({ stage: 'cancelled', attempt }),
        });
      } else if (attempt < maxAttempts) {
        const delay = RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1);
        await AgentRoutineRun.query().where('id', runId).update({
          status: 'queued', ok: false, detail: `Retry ${attempt + 1} scheduled.`, error: message,
          finished_at: null, duration_ms: null, lease_owner: null, lease_expires_at: null,
          next_attempt_at: new Date(finished + delay),
          checkpoint_json: JSON.stringify({ stage: 'retry_wait', attempt, previousError: message }),
        });
      } else {
        await AgentRoutineRun.query().where('id', runId).update({
          status: 'dead_letter', ok: false, detail: message, error: message,
          finished_at: new Date(finished), duration_ms: finished - started,
          lease_owner: null, lease_expires_at: null, next_attempt_at: null,
          dead_lettered_at: new Date(finished), checkpoint_json: JSON.stringify({ stage: 'dead_letter', attempt }),
        });
        await this.finishRoutine(routine, finished);
      }
      if (rethrow && !cancelled) throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(leasePulse);
      this.activeRuns.delete(runId);
    }
  }

  async markJobFailure(runId: string, error: Error): Promise<void> {
    const run = await AgentRoutineRun.find(runId);
    if (!run || String(run.getAttribute('status')) !== 'running') return;
    await AgentRoutineRun.query().where('id', runId).update({
      status: 'queued', ok: false, error: error.message, detail: 'Execution returned to the durable queue.',
      lease_owner: null, lease_expires_at: null, next_attempt_at: new Date(Date.now() + RETRY_BASE_MS),
    });
  }

  startScheduler(): void {
    if (this.timer) return;
    void this.runSchedulerTick();
    this.timer = setInterval(() => void this.runSchedulerTick(), TICK_MS);
    this.timer.unref?.();
  }

  stopScheduler(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async recoverInterruptedRuns(): Promise<number> {
    const rows = await AgentRoutineRun.query().where('status', 'running').get();
    const now = Date.now();
    let recovered = 0;
    for (const run of rows) {
      const leaseExpiresAt = run.getAttribute('lease_expires_at');
      if (leaseExpiresAt && new Date(leaseExpiresAt as Date).getTime() > now) continue;
      const attempt = Number(run.getAttribute('attempt') ?? 0);
      const maxAttempts = Number(run.getAttribute('max_attempts') ?? MAX_ATTEMPTS);
      if (attempt >= maxAttempts) {
        await AgentRoutineRun.query().where('id', run.getAttribute('id')).where('status', 'running').update({
          status: 'dead_letter', ok: false,
          detail: 'Execution stopped after its worker disappeared and no retries remained.',
          error: String(run.getAttribute('error') ?? 'Worker lease expired.'),
          dead_lettered_at: new Date(now), finished_at: new Date(now),
          lease_owner: null, lease_expires_at: null,
          checkpoint_json: JSON.stringify({ stage: 'dead_letter', attempt, reason: 'lease_expired' }),
        });
      } else {
        await AgentRoutineRun.query().where('id', run.getAttribute('id')).where('status', 'running').update({
          status: 'queued', detail: 'Recovered after the previous worker stopped.',
          lease_owner: null, lease_expires_at: null, next_attempt_at: new Date(now),
          checkpoint_json: JSON.stringify({ stage: 'recovered', attempt, reason: 'lease_expired' }),
        });
      }
      recovered += 1;
    }
    return recovered;
  }

  async processQueuedRuns(limit = QUEUED_RUN_BATCH): Promise<number> {
    const rows = await AgentRoutineRun.query().where('status', 'queued').orderBy('ran_at', 'asc').limit(limit).get();
    const now = Date.now();
    let processed = 0;
    for (const run of rows) {
      const nextAttemptAt = run.getAttribute('next_attempt_at');
      if (nextAttemptAt && new Date(nextAttemptAt as Date).getTime() > now) continue;
      await this.executeRun(String(run.getAttribute('id')), false);
      processed += 1;
    }
    return processed;
  }

  private async claimRun(runId: string): Promise<AgentRoutineRun | null> {
    const run = await AgentRoutineRun.find(runId);
    if (!run || String(run.getAttribute('status') ?? 'queued') !== 'queued') return null;
    const nextAttemptAt = run.getAttribute('next_attempt_at');
    if (nextAttemptAt && new Date(nextAttemptAt as Date).getTime() > Date.now()) return null;
    if (run.getAttribute('cancel_requested_at')) {
      await this.cancel(runId);
      return null;
    }
    const now = new Date();
    const attempt = Number(run.getAttribute('attempt') ?? 0) + 1;
    const claimed = await AgentRoutineRun.query().where('id', runId).where('status', 'queued').update({
      status: 'running', started_at: now, finished_at: null, attempt,
      lease_owner: this.workerId, lease_expires_at: new Date(now.getTime() + RUN_LEASE_MS),
      heartbeat_at: now, next_attempt_at: null,
      checkpoint_json: JSON.stringify({ stage: 'claimed', attempt }),
    });
    return claimed > 0 ? AgentRoutineRun.find(runId) : null;
  }

  private async heartbeat(runId: string, checkpoint: Record<string, unknown>): Promise<void> {
    const now = new Date();
    await AgentRoutineRun.query().where('id', runId).where('status', 'running').where('lease_owner', this.workerId).update({
      heartbeat_at: now,
      lease_expires_at: new Date(now.getTime() + RUN_LEASE_MS),
      checkpoint_json: JSON.stringify(checkpoint),
    });
  }

  private async isCancellationRequested(runId: string): Promise<boolean> {
    const run = await AgentRoutineRun.find(runId);
    return Boolean(run?.getAttribute('cancel_requested_at'));
  }

  private async finishRoutine(routine: Routine, finished: number): Promise<void> {
    const model = await AgentRoutine.find(routine.id);
    if (!model) return;
    await AgentRoutine.query().where('id', routine.id).update({
      last_run_at: new Date(finished),
      run_count: Number(model.getAttribute('run_count') ?? 0) + 1,
      updated_at: new Date(finished),
      ...(routine.triggerConfig.once === true ? { enabled: false } : {}),
    });
  }

  private async runSchedulerTick(): Promise<void> {
    if (this.schedulerTickRunning) return;
    this.schedulerTickRunning = true;
    try {
      await this.tick();
    } finally {
      this.schedulerTickRunning = false;
    }
  }

  private async dispatchRun(runId: string): Promise<void> {
    try {
      await Queue.dispatch(new RunAutomationJob(runId));
    } catch {
      await AgentRoutineRun.query().where('id', runId).where('status', 'queued').update({
        detail: 'Queued durably; the Core will retry delivery.',
      });
    }
  }

  private async validateAction(workspaceId: string, type: AutomationActionType, config: Record<string, unknown>): Promise<void> {
    if (type !== 'prompt_agent') return;
    const targetNodeId = String(config.targetNodeId ?? '');
    const prompt = String(config.prompt ?? '').trim();
    if (!prompt) throw new Error('Informe o prompt da rotina.');
    const node = await workspaceRepository.getNode(targetNodeId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal') {
      throw new Error('Alvo da rotina precisa ser um terminal deste workspace.');
    }
  }

  private async createRun(
    routine: Routine,
    triggerType: AutomationTriggerType,
    triggerKey: string,
    input: Record<string, unknown>,
    retryOfId: string | null = null,
    attempt = 0,
  ): Promise<AutomationRun> {
    const idempotencyKey = `${routine.id}:${triggerKey}`;
    const existing = await AgentRoutineRun.query().where('idempotency_key', idempotencyKey).first();
    if (existing) return mapRun(existing);
    try {
      const model = await AgentRoutineRun.create({
        id: uuidv7(), routine_id: routine.id, ran_at: new Date(), ok: false, detail: null,
        status: 'queued', trigger_type: triggerType, trigger_key: triggerKey,
        idempotency_key: idempotencyKey, input_json: JSON.stringify(input), output_json: null,
        error: null, agent_node_id: null, provider: null, usage_before_json: null,
        usage_after_json: null, started_at: null, finished_at: null, duration_ms: null,
        attempt, retry_of_id: retryOfId, lease_owner: null, lease_expires_at: null,
        heartbeat_at: null, checkpoint_json: JSON.stringify({ stage: 'queued', attempt }),
        cancel_requested_at: null, timeout_at: null, max_attempts: MAX_ATTEMPTS,
        next_attempt_at: null, dead_lettered_at: null,
      });
      return mapRun(model);
    } catch (error) {
      const raced = await AgentRoutineRun.query().where('idempotency_key', idempotencyKey).first();
      if (raced) return mapRun(raced);
      throw error;
    }
  }

  private async enqueue(routine: Routine, triggerType: AutomationTriggerType, triggerKey: string, input: Record<string, unknown>): Promise<boolean> {
    const workspace = await workspaceRepository.getWorkspace(routine.workspaceId);
    if (!workspace || workspace.suspendedAt) return false;
    const idempotencyKey = `${routine.id}:${triggerKey}`;
    if (await AgentRoutineRun.query().where('idempotency_key', idempotencyKey).first()) return false;
    const run = await this.createRun(routine, triggerType, triggerKey, input);
    await this.dispatchRun(run.id);
    return true;
  }

  private matchesEvent(routine: Routine, event: AutomationTriggerReceived): boolean {
    if (event.triggerType === 'task') {
      const configuredEvent = String(routine.triggerConfig.event ?? 'updated');
      const configuredStatus = String(routine.triggerConfig.status ?? '');
      return configuredEvent === event.event && (!configuredStatus || configuredStatus === String(event.data.status ?? ''));
    }
    if (event.triggerType === 'message') {
      const contains = String(routine.triggerConfig.contains ?? '').toLocaleLowerCase();
      return !contains || String(event.data.message ?? '').toLocaleLowerCase().includes(contains);
    }
    if (event.triggerType === 'github_pull_request') {
      return String(routine.triggerConfig.event ?? 'updated') === event.event;
    }
    if (event.triggerType === 'webhook') return String(event.data.automationId ?? '') === routine.id;
    return true;
  }

  private pollDue(routine: Routine): boolean {
    const interval = POLL_INTERVALS[routine.triggerType] ?? 60_000;
    const last = this.lastPolledAt.get(routine.id) ?? 0;
    if (Date.now() - last < interval) return false;
    this.lastPolledAt.set(routine.id, Date.now());
    return true;
  }

  private async poll(routine: Routine): Promise<boolean> {
    if (routine.triggerType === 'git_commit') {
      const status = await gitService.status(routine.workspaceId);
      const branch = String(routine.triggerConfig.branch ?? '');
      if (branch && branch !== status.branch) return false;
      const key = status.head ? `commit:${status.head}` : '';
      return this.pollState(routine, key, { branch: status.branch, revision: status.revision, head: status.head });
    }
    if (routine.triggerType === 'file_change') {
      const workspace = await workspaceRepository.getWorkspace(routine.workspaceId);
      if (!workspace) return false;
      const key = await this.fileFingerprint(workspace.workingDir, String(routine.triggerConfig.path ?? ''));
      return this.pollState(routine, key, { path: routine.triggerConfig.path, fingerprint: key });
    }
    if (routine.triggerType === 'usage_threshold') {
      const provider = String(routine.triggerConfig.provider ?? '');
      const windowKind = String(routine.triggerConfig.window ?? '');
      const percent = Number(routine.triggerConfig.percent ?? 100);
      const usage = await usageService.getUsage(provider, false);
      const window = usage.windows.find((candidate) => candidate.kind === windowKind);
      if (!window || window.usedPercent < percent) {
        await AgentRoutine.query().where('id', routine.id).update({ last_trigger_key: null });
        return false;
      }
      const key = `usage:${provider}:${windowKind}:${window.resetsAt ?? usage.fetchedAt}`;
      if (String((await AgentRoutine.find(routine.id))?.getAttribute('last_trigger_key') ?? '') === key) return false;
      await AgentRoutine.query().where('id', routine.id).update({ last_trigger_key: key });
      return this.enqueue(routine, 'usage_threshold', key, { usage, window, threshold: percent });
    }
    if (routine.triggerType === 'github_pull_request') {
      const integration = await automationIntegrationService.github(routine.workspaceId);
      if (!integration?.secretKey || integration.status !== 'connected') return false;
      const latest = await githubAutomationAdapter.latestPullRequest({ ...integration.config, secretKey: integration.secretKey });
      if (!latest || String(routine.triggerConfig.event ?? 'updated') !== latest.event) return false;
      return this.pollState(routine, `github:${latest.key}`, latest.data, 'github_pull_request');
    }
    return false;
  }

  private async pollState(
    routine: Routine,
    key: string,
    data: Record<string, unknown>,
    triggerType: AutomationTriggerType = routine.triggerType,
  ): Promise<boolean> {
    if (!key) return false;
    const model = await AgentRoutine.find(routine.id);
    const previous = String(model?.getAttribute('last_trigger_key') ?? '');
    await AgentRoutine.query().where('id', routine.id).update({ last_trigger_key: key });
    if (!previous || previous === key) return false;
    return this.enqueue(routine, triggerType, key, data);
  }

  private async fileFingerprint(root: string, candidate: string): Promise<string> {
    const absolute = resolve(root, candidate);
    const inside = relative(root, absolute);
    if (!candidate || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
      throw new Error('File trigger path is outside the workspace.');
    }
    let newest = 0;
    let size = 0;
    let count = 0;
    const visit = async (path: string): Promise<void> => {
      if (count >= 1_000) return;
      const info = await stat(path);
      count += 1;
      newest = Math.max(newest, info.mtimeMs);
      size += info.size;
      if (!info.isDirectory()) return;
      for (const entry of await readdir(path)) await visit(resolve(path, entry));
    };
    try {
      await visit(absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'file:missing';
      throw error;
    }
    return `file:${newest}:${size}:${count}`;
  }

  private async executeAction(
    routine: Routine,
    input: Record<string, unknown>,
    runId: string,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (routine.actionType === 'prompt_agent') {
      const targetNodeId = String(routine.actionConfig.targetNodeId ?? routine.targetNodeId ?? '');
      const prompt = this.interpolate(String(routine.actionConfig.prompt ?? routine.prompt), input);
      const ensured = await agentSessionService.ensure(routine.workspaceId, targetNodeId);
      const node = await workspaceRepository.getNode(targetNodeId);
      const steps = prompt.split('\n').map((line) => line.replace(/^&&\s*/, '').trim()).filter(Boolean);
      for (const [index, step] of steps.entries()) {
        if (signal.aborted || await this.isCancellationRequested(runId)) throw signal.reason ?? new Error('Execution cancelled.');
        await this.heartbeat(runId, { stage: 'delivering', attempt: Number((await AgentRoutineRun.find(runId))?.getAttribute('attempt') ?? 1), step: index + 1, totalSteps: steps.length });
        await agentTerminalDeliveryService.deliver({
          workspaceId: routine.workspaceId,
          nodeId: targetNodeId,
          sessionId: ensured.sessionId,
          message: step,
          submitDelayMs: 120,
          signal,
        });
      }
      return { detail: `${steps.length} step(s) delivered to ${node?.title ?? 'terminal'}.`, steps: steps.length, target: node?.title, sessionState: ensured.state };
    }
    if (routine.actionType === 'create_task') {
      const task = await taskBoardService.create(routine.workspaceId, {
        title: this.interpolate(String(routine.actionConfig.title ?? routine.name), input),
        description: this.interpolate(String(routine.actionConfig.description ?? ''), input) || null,
        createdBy: 'automation',
      });
      return { detail: `Task created: ${task.title}`, taskId: task.id, title: task.title };
    }
    const workspace = await workspaceRepository.getWorkspace(routine.workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const title = this.interpolate(String(routine.actionConfig.title ?? routine.name), input);
    const message = this.interpolate(String(routine.actionConfig.message ?? ''), input);
    await nativeNotificationService.send(workspace, { kind: 'attention', title, message });
    return { detail: `Notification sent: ${title}`, title, message };
  }

  private interpolate(template: string, input: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
      let value: unknown = input;
      for (const segment of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[segment] : undefined;
      return value === undefined || value === null ? '' : String(value);
    });
  }
}

export const routineService = new RoutineService();
