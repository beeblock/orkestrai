import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { uuidv7 } from '@beeblock/svelar/support';
import {
  autonomyPolicyDocumentSchema,
  autonomyPolicyInputSchema,
  type AutonomyCapability,
  type AutonomyPolicyDocument,
  type AutonomyPolicyInput,
  type AutonomyRisk,
  type GateRequirement,
} from '../../contracts/schemas/autonomy-policy.schema.js';
import { AgentApprovalGate } from '../../domain/models/AgentApprovalGate.js';
import { AgentAutonomyAuditEvent } from '../../domain/models/AgentAutonomyAuditEvent.js';
import { AgentAutonomyPolicy } from '../../domain/models/AgentAutonomyPolicy.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

export type AutonomyPolicyRecord = AutonomyPolicyInput & {
  id: string;
  workspaceId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type AutonomyOperation = {
  workspaceId: string;
  capability: AutonomyCapability;
  operation: string;
  target?: string | null;
  mutation?: boolean;
  risk?: AutonomyRisk | null;
  actorType: 'agent' | 'automation' | 'user' | 'integration' | 'system';
  actorId?: string | null;
  runId?: string | null;
  stepId?: string | null;
  correlationId?: string;
  input?: unknown;
  /** Optional persisted projection; the full result is still returned and only contributes to the output digest. */
  auditOutput?: (result: unknown) => unknown;
  certainty?: 'semantic' | 'inferred';
  network?: { url: string; method?: string };
  filesystem?: { path: string; permission: 'read' | 'write' | 'create' | 'delete'; size?: number };
  application?: { id: string };
};

export type AutonomyDecision = {
  status: 'allowed' | 'denied' | 'gated';
  reason: string;
  policy: AutonomyPolicyRecord;
  gate?: ApprovalGateRecord;
};

export type ApprovalGateRecord = {
  id: string;
  workspaceId: string;
  runId: string | null;
  stepId: string | null;
  risk: AutonomyRisk;
  capability: AutonomyCapability;
  target: string | null;
  summary: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'cancelled';
  requirement: GateRequirement;
  requestedBy: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  requestDigest: string;
  expiresAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type AutonomyAuditRecord = {
  id: string;
  workspaceId: string;
  runId: string | null;
  correlationId: string;
  actorType: string;
  actorId: string | null;
  eventType: string;
  capability: string;
  target: string | null;
  certainty: 'semantic' | 'inferred';
  policyRevision: number;
  metadata: Record<string, unknown>;
  previousHash: string | null;
  eventHash: string;
  createdAt: string;
};

const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key|credential)/i;
const DEFAULT_RISKS: AutonomyRisk[] = [
  'outside_boundary', 'secret_export', 'bulk_destructive', 'force_push', 'production_deploy',
  'purchase', 'external_publication', 'account_permission', 'irreversible',
];

const runtime = globalThis as typeof globalThis & {
  __orkestraiAbortWorkspaceRuns?: (workspaceId: string, reason: string) => Promise<number>;
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function object(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function redactAutonomyValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[truncated]';
  if (typeof value === 'string') {
    if (/^secretref:[0-9a-f-]{16,}$/i.test(value)) return value;
    return value
      .replace(/(bearer\s+)[a-z0-9._~+\/-]+/gi, '$1[redacted]')
      .replace(/([?&](?:token|key|secret|password)=)[^&#\s]+/gi, '$1[redacted]')
      .slice(0, 20_000);
  }
  if (Array.isArray(value)) return value.slice(0, 1_000).map((item) => redactAutonomyValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  if ((value as { sensitive?: unknown }).sensitive === true) return '[redacted-secret]';
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 1_000).map(([key, entry]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[redacted]' : redactAutonomyValue(entry, depth + 1),
  ]));
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return createHash('sha256').update(stable(redactAutonomyValue(value))).digest('hex');
}

function mapPolicy(model: AgentAutonomyPolicy): AutonomyPolicyRecord {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    enabled: Boolean(model.getAttribute('enabled')),
    mode: String(model.getAttribute('mode')) as AutonomyPolicyInput['mode'],
    policy: autonomyPolicyDocumentSchema.parse(object(model.getAttribute('policy_json'))),
    revision: Number(model.getAttribute('revision') ?? 1),
    createdAt: iso(model.getAttribute('created_at')),
    updatedAt: iso(model.getAttribute('updated_at')),
  };
}

function mapGate(model: AgentApprovalGate): ApprovalGateRecord {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    runId: model.getAttribute('run_id') ? String(model.getAttribute('run_id')) : null,
    stepId: model.getAttribute('step_id') ? String(model.getAttribute('step_id')) : null,
    risk: String(model.getAttribute('risk')) as AutonomyRisk,
    capability: String(model.getAttribute('capability')) as AutonomyCapability,
    target: model.getAttribute('target') ? String(model.getAttribute('target')) : null,
    summary: String(model.getAttribute('summary')),
    status: String(model.getAttribute('status')) as ApprovalGateRecord['status'],
    requirement: String(model.getAttribute('requirement')) as GateRequirement,
    requestedBy: model.getAttribute('requested_by') ? String(model.getAttribute('requested_by')) : null,
    resolvedBy: model.getAttribute('resolved_by') ? String(model.getAttribute('resolved_by')) : null,
    resolutionNote: model.getAttribute('resolution_note') ? String(model.getAttribute('resolution_note')) : null,
    requestDigest: String(model.getAttribute('request_digest')),
    expiresAt: model.getAttribute('expires_at') ? iso(model.getAttribute('expires_at')) : null,
    resolvedAt: model.getAttribute('resolved_at') ? iso(model.getAttribute('resolved_at')) : null,
    createdAt: iso(model.getAttribute('created_at')),
  };
}

function mapAudit(model: AgentAutonomyAuditEvent): AutonomyAuditRecord {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    runId: model.getAttribute('run_id') ? String(model.getAttribute('run_id')) : null,
    correlationId: String(model.getAttribute('correlation_id')),
    actorType: String(model.getAttribute('actor_type')),
    actorId: model.getAttribute('actor_id') ? String(model.getAttribute('actor_id')) : null,
    eventType: String(model.getAttribute('event_type')),
    capability: String(model.getAttribute('capability')),
    target: model.getAttribute('target') ? String(model.getAttribute('target')) : null,
    certainty: String(model.getAttribute('certainty')) as 'semantic' | 'inferred',
    policyRevision: Number(model.getAttribute('policy_revision') ?? 1),
    metadata: object(model.getAttribute('metadata_json')),
    previousHash: model.getAttribute('previous_hash') ? String(model.getAttribute('previous_hash')) : null,
    eventHash: String(model.getAttribute('event_hash')),
    createdAt: iso(model.getAttribute('created_at')),
  };
}

function normalizeCase(value: string): string {
  const normalized = resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function existingRealpath(candidate: string, permission: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    if (permission === 'create') return resolve(await realpath(dirname(candidate)), candidate.split(/[\\/]/).at(-1) ?? '');
    throw new Error('The requested filesystem target does not exist.');
  }
}

function within(root: string, candidate: string): boolean {
  const rel = relative(normalizeCase(root), normalizeCase(candidate));
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

function globExpression(glob: string): RegExp {
  const escaped = glob.replace(/[.+^$()|[\]{}\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/\\\\]*').replace(/\u0000/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + escaped.replace(/\\/g, '/') + '$', process.platform === 'win32' ? 'i' : '');
}

export class AutonomyGatePendingError extends Error {
  constructor(public readonly gate: ApprovalGateRecord) {
    super('This action is waiting for its configured approval gate.');
    this.name = 'AutonomyGatePendingError';
  }
}

export class AutonomyPolicyService {
  private auditWrites = new Map<string, Promise<AutonomyAuditRecord>>();

  async get(workspaceId: string): Promise<AutonomyPolicyRecord> {
    const existing = await AgentAutonomyPolicy.query().where('workspace_id', workspaceId).first();
    if (existing) return mapPolicy(existing);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const now = new Date();
    const policy: AutonomyPolicyDocument = autonomyPolicyDocumentSchema.parse({
      filesystem: [{ root: workspace.workingDir, permissions: ['read', 'write', 'create', 'delete'] }],
      gates: Object.fromEntries(DEFAULT_RISKS.map((risk) => [risk, 'user'])),
    });
    try {
      const created = await AgentAutonomyPolicy.create({
        id: uuidv7(), workspace_id: workspaceId, mode: 'observe', enabled: false,
        policy_json: JSON.stringify(policy), revision: 1, created_at: now, updated_at: now,
      });
      return mapPolicy(created);
    } catch {
      const raced = await AgentAutonomyPolicy.query().where('workspace_id', workspaceId).first();
      if (!raced) throw new Error('Could not initialize the autonomy policy.');
      return mapPolicy(raced);
    }
  }

  async update(workspaceId: string, input: AutonomyPolicyInput): Promise<AutonomyPolicyRecord> {
    const validated = autonomyPolicyInputSchema.parse(input);
    const existing = await this.get(workspaceId);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const filesystem = await Promise.all(validated.policy.filesystem.map(async (grant) => {
      const requestedRoot = isAbsolute(grant.root) ? grant.root : resolve(workspace.workingDir, grant.root);
      const canonical = await realpath(requestedRoot);
      if (!within(workspace.workingDir, canonical) && !isAbsolute(grant.root)) {
        throw new Error('Approved roots must be explicit absolute paths.');
      }
      return { ...grant, root: canonical };
    }));
    const now = new Date();
    await AgentAutonomyPolicy.query().where('id', existing.id).update({
      enabled: validated.enabled,
      mode: validated.mode,
      policy_json: JSON.stringify({ ...validated.policy, filesystem }),
      revision: existing.revision + 1,
      updated_at: now,
    });
    await this.appendAudit({
      workspaceId,
      capability: 'tool',
      operation: 'policy:update',
      actorType: 'user',
      actorId: 'workspace-owner',
      input: { enabled: validated.enabled, mode: validated.mode, policy: { ...validated.policy, filesystem } },
    }, 'completed', existing.revision + 1, { policyChanged: true });
    const updated = await AgentAutonomyPolicy.find(existing.id);
    if (!updated) throw new Error('Autonomy policy disappeared while updating.');
    return mapPolicy(updated);
  }

  async decide(request: AutonomyOperation): Promise<AutonomyDecision> {
    const policy = await this.get(request.workspaceId);
    if (policy.policy.halted) return { status: 'denied', reason: 'Workspace automation is halted by the user.', policy };
    if (!policy.enabled) {
      return { status: 'allowed', reason: 'Autonomy policy is disabled; existing interactive behavior is preserved.', policy };
    }

    const boundaryReason = await this.boundaryViolation(policy.policy, request);
    const risk = request.risk ?? (boundaryReason ? 'outside_boundary' : null);
    if (policy.mode === 'observe') {
      return {
        status: 'allowed',
        reason: boundaryReason ? 'Observe only: ' + boundaryReason : 'Allowed while policy is in observe mode.',
        policy,
      };
    }
    if (!policy.policy.capabilities.includes(request.capability)) {
      return { status: 'denied', reason: 'Capability ' + request.capability + ' is outside the standing grant.', policy };
    }

    if (policy.mode === 'prepare' && request.mutation) {
      return this.gate(policy, request, risk ?? 'irreversible', 'user', 'Prepare mode requires review before a mutation.');
    }
    if (policy.mode === 'ask_mutations' && request.mutation) {
      return this.gate(policy, request, risk ?? 'irreversible', 'user', 'This policy asks before mutations.');
    }
    if (boundaryReason) {
      return this.gate(policy, request, 'outside_boundary', policy.policy.gates.outside_boundary ?? 'user', boundaryReason);
    }
    if (risk) {
      const requirement = policy.policy.gates[risk] ?? 'user';
      if (requirement !== 'preapproved') {
        return this.gate(policy, request, risk, requirement, 'Risk gate required: ' + risk + '.');
      }
    }
    return { status: 'allowed', reason: 'Action is inside the standing workspace grant.', policy };
  }

  async execute<T>(request: AutonomyOperation, callback: () => Promise<T>): Promise<T> {
    const correlationId = request.correlationId ?? uuidv7();
    const operation = { ...request, correlationId };
    const policy = await this.get(request.workspaceId);
    await this.appendAudit(operation, 'requested', policy.revision);
    const decision = await this.decide(operation);
    if (decision.status === 'denied') {
      await this.appendAudit(operation, 'denied', decision.policy.revision, { reason: decision.reason });
      throw new Error(decision.reason);
    }
    if (decision.status === 'gated' && decision.gate) {
      await this.appendAudit(operation, 'gated', decision.policy.revision, { gateId: decision.gate.id, reason: decision.reason });
      throw new AutonomyGatePendingError(decision.gate);
    }
    await this.appendAudit(operation, 'allowed', decision.policy.revision, { reason: decision.reason });
    await this.appendAudit(operation, 'started', decision.policy.revision);
    try {
      const result = await callback();
      const auditOutput = operation.auditOutput ? operation.auditOutput(result) : redactAutonomyValue(result);
      await this.appendAudit(operation, 'completed', decision.policy.revision, { output: redactAutonomyValue(auditOutput) }, result);
      return result;
    } catch (error) {
      await this.appendAudit(operation, 'failed', decision.policy.revision, {
        error: String(error instanceof Error ? error.message : error).slice(0, 2_000),
      });
      throw error;
    }
  }

  async listGates(workspaceId: string): Promise<ApprovalGateRecord[]> {
    await this.expireGates(workspaceId);
    const rows = await AgentApprovalGate.query()
      .where('workspace_id', workspaceId)
      .orderBy('created_at', 'desc')
      .limit(200)
      .get();
    return rows.map(mapGate);
  }

  async resolveGate(
    workspaceId: string,
    gateId: string,
    decision: 'approved' | 'denied',
    actorId: string,
    note?: string | null,
  ): Promise<ApprovalGateRecord> {
    const gate = await AgentApprovalGate.query().where('workspace_id', workspaceId).where('id', gateId).first();
    if (!gate) throw new Error('Approval gate not found.');
    if (String(gate.getAttribute('status')) !== 'pending') throw new Error('Approval gate has already been resolved.');
    const requirement = String(gate.getAttribute('requirement')) as GateRequirement;
    if (decision === 'approved' && requirement === 'reviewer' && !actorId.startsWith('reviewer:')) {
      throw new Error('This gate requires its named reviewer.');
    }
    if (decision === 'approved' && requirement === 'council' && !actorId.startsWith('council:')) {
      throw new Error('This gate requires a Council consensus decision.');
    }
    const now = new Date();
    await AgentApprovalGate.query().where('id', gateId).where('status', 'pending').update({
      status: decision,
      resolved_by: actorId,
      resolution_note: note ?? null,
      resolved_at: now,
      updated_at: now,
    });
    const updated = await AgentApprovalGate.find(gateId);
    if (!updated) throw new Error('Approval gate disappeared while resolving.');
    const mapped = mapGate(updated);
    if (mapped.runId) {
      if (decision === 'approved') {
        await AgentRoutineRun.query().where('id', mapped.runId).where('status', 'waiting_approval').update({
          status: 'queued',
          detail: 'Approval received; queued to resume.',
          next_attempt_at: new Date(),
          checkpoint_json: JSON.stringify({ stage: 'approval_received', gateId }),
        });
      } else {
        const finished = new Date();
        await AgentRoutineRun.query().where('id', mapped.runId).where('status', 'waiting_approval').update({
          status: 'cancelled',
          detail: 'Approval denied.',
          error: null,
          cancel_requested_at: finished,
          finished_at: finished,
          checkpoint_json: JSON.stringify({ stage: 'approval_denied', gateId }),
        });
      }
    }
    await this.appendAudit({
      workspaceId,
      runId: mapped.runId,
      stepId: mapped.stepId,
      capability: mapped.capability,
      operation: 'gate:' + decision,
      target: mapped.target,
      actorType: 'user',
      actorId,
      input: { gateId, note },
      correlationId: 'gate:' + gateId,
    }, decision, (await this.get(workspaceId)).revision, { gateId });
    return mapped;
  }

  async listAudit(workspaceId: string, limit = 200, runId?: string): Promise<AutonomyAuditRecord[]> {
    let query = AgentAutonomyAuditEvent.query().where('workspace_id', workspaceId);
    if (runId) query = query.where('run_id', runId);
    const rows = await query.orderBy('created_at', 'desc').limit(Math.max(1, Math.min(limit, 1_000))).get();
    return rows.map(mapAudit);
  }

  async exportAudit(workspaceId: string): Promise<{
    exportedAt: string;
    workspaceId: string;
    integrity: { valid: boolean; checked: number; brokenAt: string | null };
    events: AutonomyAuditRecord[];
  }> {
    const [rows, integrity] = await Promise.all([
      AgentAutonomyAuditEvent.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get(),
      this.verifyAudit(workspaceId),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      workspaceId,
      integrity,
      events: rows.map(mapAudit),
    };
  }

  async runWindow(workspaceId: string, triggerType: string): Promise<{
    allowed: boolean;
    reason: 'disabled' | 'manual' | 'quiet_hours' | 'concurrency' | 'allowed';
    retryAt: Date | null;
  }> {
    const policy = await this.get(workspaceId);
    if (policy.policy.halted) return { allowed: false, reason: 'disabled', retryAt: null };
    if (!policy.enabled) return { allowed: true, reason: 'disabled', retryAt: null };
    if (triggerType === 'manual') return { allowed: true, reason: 'manual', retryAt: null };

    const quietRetry = this.quietHoursRetry(policy.policy, new Date());
    if (quietRetry) return { allowed: false, reason: 'quiet_hours', retryAt: quietRetry };

    const routines = await AgentRoutine.query().where('workspace_id', workspaceId).get();
    let running = 0;
    for (const routine of routines) {
      const active = await AgentRoutineRun.query().where('routine_id', routine.getAttribute('id')).where('status', 'running').get();
      running += active.length;
      if (running >= policy.policy.maxConcurrentRuns) {
        return { allowed: false, reason: 'concurrency', retryAt: new Date(Date.now() + 15_000) };
      }
    }
    return { allowed: true, reason: 'allowed', retryAt: null };
  }

  async recordObservedEffect(
    request: Omit<AutonomyOperation, 'certainty'>,
    eventType: 'started' | 'completed' | 'failed' | 'cancelled',
    metadata: Record<string, unknown> = {},
  ): Promise<AutonomyAuditRecord> {
    const policy = await this.get(request.workspaceId);
    return this.appendAudit({ ...request, certainty: 'inferred' }, eventType, policy.revision, metadata);
  }

  async recordSemanticEffect(
    request: Omit<AutonomyOperation, 'certainty'>,
    metadata: Record<string, unknown> = {},
  ): Promise<AutonomyAuditRecord> {
    const policy = await this.get(request.workspaceId);
    return this.appendAudit({ ...request, certainty: 'semantic' }, 'completed', policy.revision, metadata);
  }

  async verifyAudit(workspaceId: string): Promise<{ valid: boolean; checked: number; brokenAt: string | null }> {
    const rows = await AgentAutonomyAuditEvent.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get();
    let previousHash: string | null = null;
    let checked = 0;
    for (const row of rows) {
      const mapped = mapAudit(row);
      const payload = this.auditHashPayload(row, previousHash);
      if (mapped.previousHash !== previousHash || digest(payload) !== mapped.eventHash) {
        return { valid: false, checked, brokenAt: mapped.id };
      }
      checked += 1;
      previousHash = mapped.eventHash;
    }
    return { valid: true, checked, brokenAt: null };
  }

  async emergencyStop(workspaceId: string, actorId = 'workspace-owner'): Promise<{ cancelled: number }> {
    const policy = await this.get(workspaceId);
    await AgentAutonomyPolicy.query().where('id', policy.id).update({
      enabled: true,
      policy_json: JSON.stringify({ ...policy.policy, halted: true }),
      revision: policy.revision + 1,
      updated_at: new Date(),
    });
    await runtime.__orkestraiAbortWorkspaceRuns?.(workspaceId, 'Workspace emergency stop requested.');
    const routines = await AgentRoutine.query().where('workspace_id', workspaceId).get();
    let cancelled = 0;
    for (const routine of routines) {
      await AgentRoutine.query().where('id', routine.getAttribute('id')).update({ enabled: false, updated_at: new Date() });
      const active = await AgentRoutineRun.query().where('routine_id', routine.getAttribute('id')).get();
      for (const run of active.filter((item) => ['queued', 'running', 'waiting_approval'].includes(String(item.getAttribute('status'))))) {
        const now = new Date();
        await AgentRoutineRun.query().where('id', run.getAttribute('id')).update({
          status: 'cancelled',
          cancel_requested_at: now,
          finished_at: now,
          error: 'Emergency stop requested.',
        });
        cancelled += 1;
      }
    }
    await this.appendAudit({
      workspaceId,
      capability: 'tool',
      operation: 'emergency_stop',
      actorType: 'user',
      actorId,
      mutation: true,
    }, 'cancelled', policy.revision + 1, { cancelled });
    return { cancelled };
  }

  envelope(policy: AutonomyPolicyRecord): string {
    return JSON.stringify({
      enabled: policy.enabled,
      mode: policy.mode,
      revision: policy.revision,
      capabilities: policy.policy.capabilities,
      filesystem: policy.policy.filesystem,
      network: policy.policy.network,
      allowedApps: policy.policy.allowedApps,
    });
  }

  private async boundaryViolation(policy: AutonomyPolicyDocument, request: AutonomyOperation): Promise<string | null> {
    if (request.application) {
      const app = request.application.id.toLowerCase();
      const allowed = policy.allowedApps.some((candidate) => candidate.toLowerCase() === app);
      if (!allowed) return 'Application is outside the approved desktop-control scope.';
    }
    if (request.filesystem) {
      const absolute = resolve(request.filesystem.path);
      const canonical = await existingRealpath(absolute, request.filesystem.permission).catch(() => absolute);
      const grant = policy.filesystem.find((candidate) => (
        candidate.permissions.includes(request.filesystem!.permission) && within(candidate.root, canonical)
      ));
      if (!grant) return 'Filesystem target is outside the approved roots or operation set.';
      const rel = relative(grant.root, canonical).replace(/\\/g, '/');
      if (grant.excludeGlobs.some((glob) => globExpression(glob).test(rel))) {
        return 'Filesystem target matches an excluded path pattern.';
      }
      if (request.filesystem.size && request.filesystem.size > grant.maxFileSize) {
        return 'Filesystem payload exceeds the approved size.';
      }
      try {
        const info = await lstat(absolute);
        if (info.isSymbolicLink() && !grant.followSymlinks) return 'Symbolic links require a separate standing grant.';
      } catch {
        // Creation targets are validated through their canonical parent.
      }
    }
    if (request.network) {
      let url: URL;
      try {
        url = new URL(request.network.url);
      } catch {
        return 'Network destination is invalid.';
      }
      if (url.username || url.password) return 'Credentials embedded in URLs are never allowed.';
      const method = (request.network.method ?? 'GET').toUpperCase();
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      const grant = policy.network.find((candidate) => {
        const host = url.hostname.toLowerCase();
        const hostAllowed = candidate.hosts.some((allowed) => (
          allowed === host || (allowed.startsWith('*.') && host.endsWith(allowed.slice(1)))
        ));
        return candidate.schemes.includes(url.protocol.slice(0, -1) as 'http' | 'https')
          && hostAllowed
          && (candidate.ports.length === 0 || candidate.ports.includes(port))
          && candidate.methods.includes(method as never)
          && (candidate.operations.length === 0 || candidate.operations.includes(request.operation));
      });
      if (!grant) return 'Network destination is outside the approved host, method, port or operation set.';
    }
    return null;
  }

  private quietHoursRetry(policy: AutonomyPolicyDocument, now: Date): Date | null {
    if (!policy.quietHours.enabled) return null;
    const [startHour, startMinute] = policy.quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = policy.quietHours.end.split(':').map(Number);
    const minute = now.getHours() * 60 + now.getMinutes();
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    const inside = start === end || (start < end ? minute >= start && minute < end : minute >= start || minute < end);
    if (!inside) return null;
    const retry = new Date(now);
    retry.setHours(endHour, endMinute, 0, 0);
    if (start === end || retry.getTime() <= now.getTime()) retry.setDate(retry.getDate() + 1);
    return retry;
  }

  private async gate(
    policy: AutonomyPolicyRecord,
    request: AutonomyOperation,
    risk: AutonomyRisk,
    requirement: GateRequirement,
    reason: string,
  ): Promise<AutonomyDecision> {
    if (requirement === 'preapproved') {
      return { status: 'allowed', reason: 'This risk is pre-approved by the standing policy.', policy };
    }
    const requestDigest = digest({
      capability: request.capability,
      operation: request.operation,
      target: request.target,
      input: request.input,
      risk,
      actorType: request.actorType,
      actorId: request.actorId ?? null,
      runId: request.runId ?? null,
      stepId: request.stepId ?? null,
      policyRevision: policy.revision,
    });
    const previous = await AgentApprovalGate.query()
      .where('workspace_id', request.workspaceId)
      .where('request_digest', requestDigest)
      .orderBy('created_at', 'desc')
      .first();
    if (previous && String(previous.getAttribute('status')) === 'approved'
      && new Date(previous.getAttribute('expires_at') as string).getTime() > Date.now()) {
      return { status: 'allowed', reason: 'The matching high-risk operation was approved.', policy };
    }
    if (previous && String(previous.getAttribute('status')) === 'pending') {
      return { status: 'gated', reason, policy, gate: mapGate(previous) };
    }
    const now = new Date();
    const model = await AgentApprovalGate.create({
      id: uuidv7(),
      workspace_id: request.workspaceId,
      run_id: request.runId ?? null,
      step_id: request.stepId ?? null,
      risk,
      capability: request.capability,
      target: request.target?.slice(0, 2_000) ?? null,
      summary: (request.operation + (request.target ? ' · ' + request.target : '')).slice(0, 2_000),
      status: 'pending',
      requirement,
      requested_by: request.actorId ?? null,
      resolved_by: null,
      resolution_note: null,
      request_digest: requestDigest,
      expires_at: new Date(now.getTime() + 24 * 60 * 60_000),
      resolved_at: null,
      created_at: now,
      updated_at: now,
    });
    return { status: 'gated', reason, policy, gate: mapGate(model) };
  }

  private async expireGates(workspaceId: string): Promise<void> {
    const pending = await AgentApprovalGate.query().where('workspace_id', workspaceId).where('status', 'pending').get();
    const now = new Date();
    for (const gate of pending) {
      const expiry = gate.getAttribute('expires_at');
      if (expiry && new Date(expiry as Date).getTime() <= now.getTime()) {
        await AgentApprovalGate.query().where('id', gate.getAttribute('id')).update({
          status: 'expired',
          resolved_at: now,
          updated_at: now,
        });
      }
    }
  }

  private async appendAudit(
    operation: AutonomyOperation,
    eventType: string,
    policyRevision: number,
    metadata: Record<string, unknown> = {},
    output?: unknown,
  ): Promise<AutonomyAuditRecord> {
    const previous = this.auditWrites.get(operation.workspaceId) ?? Promise.resolve(null as unknown as AutonomyAuditRecord);
    const write = previous.catch(() => null).then(async () => {
      const latest = await AgentAutonomyAuditEvent.query()
        .where('workspace_id', operation.workspaceId)
        .orderBy('created_at', 'desc')
        .first();
      const previousHash = latest ? String(latest.getAttribute('event_hash')) : null;
      const now = new Date();
      const record = {
        id: uuidv7(),
        workspace_id: operation.workspaceId,
        run_id: operation.runId ?? null,
        step_id: operation.stepId ?? null,
        correlation_id: operation.correlationId ?? uuidv7(),
        actor_type: operation.actorType,
        actor_id: operation.actorId ?? null,
        event_type: eventType,
        capability: operation.capability,
        target: operation.target?.slice(0, 2_000) ?? null,
        certainty: operation.certainty ?? 'semantic',
        policy_revision: policyRevision,
        input_digest: operation.input === undefined ? null : digest(operation.input),
        output_digest: output === undefined ? null : digest(output),
        metadata_json: JSON.stringify(redactAutonomyValue({ operation: operation.operation, ...metadata,
          ...(operation.operation.startsWith('portal:') ? { action: operation.input } : {}) })),
        previous_hash: previousHash,
        created_at: now,
      };
      const eventHash = digest({ ...record, previous_hash: previousHash, created_at: now.toISOString() });
      const model = await AgentAutonomyAuditEvent.create({ ...record, event_hash: eventHash });
      return mapAudit(model);
    });
    this.auditWrites.set(operation.workspaceId, write);
    return write.finally(() => {
      if (this.auditWrites.get(operation.workspaceId) === write) this.auditWrites.delete(operation.workspaceId);
    });
  }

  private auditHashPayload(model: AgentAutonomyAuditEvent, previousHash: string | null): Record<string, unknown> {
    return {
      id: model.getAttribute('id'),
      workspace_id: model.getAttribute('workspace_id'),
      run_id: model.getAttribute('run_id'),
      step_id: model.getAttribute('step_id'),
      correlation_id: model.getAttribute('correlation_id'),
      actor_type: model.getAttribute('actor_type'),
      actor_id: model.getAttribute('actor_id'),
      event_type: model.getAttribute('event_type'),
      capability: model.getAttribute('capability'),
      target: model.getAttribute('target'),
      certainty: model.getAttribute('certainty'),
      policy_revision: model.getAttribute('policy_revision'),
      input_digest: model.getAttribute('input_digest'),
      output_digest: model.getAttribute('output_digest'),
      metadata_json: model.getAttribute('metadata_json'),
      previous_hash: previousHash,
      created_at: iso(model.getAttribute('created_at')),
    };
  }
}

export const autonomyPolicyService = new AutonomyPolicyService();
