import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import type {
  CreateWorkspaceToolInput, ExecuteWorkspaceToolInput, UpdateWorkspaceToolInput,
  WorkspaceToolActor, WorkspaceToolManifest,
} from '../../contracts/schemas/agent-workspace-tool.schema.js';
import {
  createWorkspaceToolSchema, executeWorkspaceToolSchema, updateWorkspaceToolSchema,
} from '../../contracts/schemas/agent-workspace-tool.schema.js';
import { buildWorkspaceRuntimeLaunch } from '../../infrastructure/WslRuntime.js';
import {
  agentWorkspaceToolRepository, type WorkspaceToolRecord, type WorkspaceToolRunRecord,
} from '../../infrastructure/repositories/AgentWorkspaceToolRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { TrustedIntegrationHttpClient } from '../../infrastructure/integrations/TrustedIntegrationHttpClient.js';
import { AutonomyGatePendingError, autonomyPolicyService, redactAutonomyValue } from './AutonomyPolicyService.js';
import { integrationExecutionService } from './IntegrationExecutionService.js';
import { secretRefService } from './SecretRefService.js';
import { managedPortalService, portalProfileFromPayload } from './ManagedPortalService.js';
import { managedPortalCommandSchema } from '../../contracts/schemas/managed-portal.schema.js';

const SECRET_KEY = /(?:password|passwd|secret|token|authorization|cookie|api[-_]?key|credential)/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}

function digest(value: unknown): string { return createHash('sha256').update(stable(redactAutonomyValue(value))).digest('hex'); }

function redactString(value: string, secrets: string[]): string {
  return [...new Set(secrets.filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, secret) => redacted.split(secret).join('[redacted-secret]'), value);
}

export function redactResolvedSecrets(value: unknown, secrets: string[], depth = 0): unknown {
  if (depth > 12) return '[redacted-depth-limit]';
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactResolvedSecrets(entry, secrets, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    redactString(key, secrets),
    redactResolvedSecrets(entry, secrets, depth + 1),
  ]));
}

function atPath(value: unknown, path: string): unknown {
  return path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined;
  }, value);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.').filter(Boolean);
  if (!keys.length || keys.some((key) => key === '__proto__' || key === 'constructor' || key === 'prototype')) throw new Error('Invalid transform path.');
  let current = target;
  for (const key of keys.slice(0, -1)) {
    if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) current[key] = {};
    current = current[key] as Record<string, unknown>;
  }
  current[keys.at(-1)!] = value;
}

function render(template: string, input: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, path: string) => {
    const value = atPath(input, path);
    return value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function renderValue(value: unknown, input: Record<string, unknown>): unknown {
  if (typeof value === 'string') return render(value, input);
  if (Array.isArray(value)) return value.map((entry) => renderValue(entry, input));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, renderValue(entry, input)]));
  return value;
}

function validateValue(schemaValue: unknown, value: unknown, path = '$'): void {
  const schema = record(schemaValue);
  const type = String(schema.type);
  const matches = type === 'null' ? value === null
    : type === 'array' ? Array.isArray(value)
      : type === 'object' ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
        : type === 'integer' ? Number.isInteger(value)
          : type === 'number' ? typeof value === 'number' && Number.isFinite(value)
            : typeof value === type;
  if (!matches) throw new Error(`${path} must be ${type}.`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) throw new Error(`${path} is outside the allowed values.`);
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) throw new Error(`${path} is too short.`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) throw new Error(`${path} is too long.`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) throw new Error(`${path} is below the minimum.`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) throw new Error(`${path} is above the maximum.`);
  }
  if (Array.isArray(value) && schema.items) value.forEach((entry, index) => validateValue(schema.items, entry, `${path}[${index}]`));
  if (type === 'object') {
    const object = record(value);
    const properties = record(schema.properties);
    for (const key of Array.isArray(schema.required) ? schema.required.map(String) : []) if (!Object.hasOwn(object, key)) throw new Error(`${path}.${key} is required.`);
    if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!Object.hasOwn(properties, key)) throw new Error(`${path}.${key} is not allowed.`);
    for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(object, key)) validateValue(child, object[key], `${path}.${key}`);
  }
}

function assertNoEmbeddedSecrets(value: unknown, path = 'manifest'): void {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoEmbeddedSecrets(entry, `${path}.${index}`));
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key) && key !== 'secretRef' && key !== 'secretRefs' && key !== 'stdinSecretRef' && entry) {
      throw new Error(`${path}.${key} must be represented by a SecretRef.`);
    }
    assertNoEmbeddedSecrets(entry, `${path}.${key}`);
  }
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(process.platform === 'win32' ? root.toLowerCase() : root, process.platform === 'win32' ? candidate.toLowerCase() : candidate);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep));
}

function destinationAllowed(allowed: string[], destination: string): boolean {
  const normalized = destination.toLowerCase();
  return allowed.some((candidate) => candidate === normalized || (candidate.startsWith('*.') && normalized.endsWith(candidate.slice(1))));
}

export class AgentWorkspaceToolService {
  async list(workspaceId: string) { return agentWorkspaceToolRepository.list(workspaceId); }

  async find(workspaceId: string, id: string) {
    const tool = await agentWorkspaceToolRepository.find(workspaceId, id);
    if (!tool) throw new Error('Tool not found.');
    return tool;
  }

  async create(workspaceId: string, raw: CreateWorkspaceToolInput) {
    if (!await workspaceRepository.getWorkspace(workspaceId)) throw new Error('Workspace not found.');
    const input = createWorkspaceToolSchema.parse(raw);
    assertNoEmbeddedSecrets(input.manifest);
    if (input.actor.type === 'agent' && input.nodeId && input.actor.id !== input.nodeId) throw new Error('Agents can only propose tools from their own node.');
    const tool = await autonomyPolicyService.execute({ workspaceId, capability: 'tool', operation: 'tool:create',
      actorType: input.actor.type, actorId: input.actor.id, mutation: true, input: { manifestDigest: digest(input.manifest) },
      auditOutput: (result) => ({ id: (result as WorkspaceToolRecord).id, revision: (result as WorkspaceToolRecord).currentRevision }),
    }, () => agentWorkspaceToolRepository.create({
      workspaceId, nodeId: input.nodeId ?? null, name: input.name, slug: input.slug,
      description: input.description, manifest: input.manifest, createdBy: input.actor,
      changeSummary: input.changeSummary,
    }));
    return input.actor.type === 'agent' ? this.tryAutoPublish(tool, input.actor) : tool;
  }

  async update(workspaceId: string, id: string, raw: UpdateWorkspaceToolInput) {
    const input = updateWorkspaceToolSchema.parse(raw);
    assertNoEmbeddedSecrets(input.manifest);
    const tool = await autonomyPolicyService.execute({ workspaceId, capability: 'tool', operation: 'tool:update', target: id,
      actorType: input.actor.type, actorId: input.actor.id, mutation: true, input: { manifestDigest: digest(input.manifest) },
      auditOutput: (result) => ({ revision: (result as WorkspaceToolRecord).currentRevision }),
    }, () => agentWorkspaceToolRepository.update({ workspaceId, id, name: input.name, description: input.description, manifest: input.manifest, actor: input.actor, changeSummary: input.changeSummary }));
    return input.actor.type === 'agent' ? this.tryAutoPublish(tool, input.actor) : tool;
  }

  async publish(workspaceId: string, id: string, actor: WorkspaceToolActor) {
    if (actor.type !== 'user') throw new Error('Only the workspace owner can publish a tool revision.');
    const tool = await this.find(workspaceId, id);
    await this.assertDependenciesReady(tool);
    return autonomyPolicyService.execute({ workspaceId, capability: 'tool', operation: 'tool:publish', target: id,
      actorType: 'user', actorId: actor.id, input: { revision: tool.currentRevision },
    }, () => agentWorkspaceToolRepository.setStatus(workspaceId, id, 'published', tool.currentRevision));
  }

  private async tryAutoPublish(tool: WorkspaceToolRecord, actor: WorkspaceToolActor): Promise<WorkspaceToolRecord> {
    const policy = await autonomyPolicyService.get(tool.workspaceId);
    const grant = policy.policy.toolPublication;
    if (!grant.enabled) return tool;
    try {
      return await autonomyPolicyService.execute({ workspaceId: tool.workspaceId, capability: 'tool', operation: 'tool:auto_publish', target: tool.id,
        actorType: 'agent', actorId: actor.id, mutation: true, input: { revision: tool.currentRevision, kind: tool.manifest.executor.kind },
        auditOutput: () => ({ publishedRevision: tool.currentRevision }),
      }, async () => {
        if (!policy.enabled || policy.mode !== 'bounded' || policy.policy.halted || !actor.id || !grant.agentIds.includes(actor.id)) throw new Error('Automatic publication is outside the standing grant.');
        const executor = tool.manifest.executor;
        if (executor.kind === 'workspace_command' || !grant.kinds.includes(executor.kind)) throw new Error('This executor requires owner publication.');
        if (tool.manifest.timeoutMs > grant.maxTimeoutMs || tool.manifest.maxOutputBytes > grant.maxOutputBytes) throw new Error('Tool exceeds the automatic publication limits.');
        if (tool.manifest.capabilities.some((capability) => !policy.policy.capabilities.includes(capability))) throw new Error('Tool expands the workspace capability grant.');
        if (!tool.manifest.fixtures.length) throw new Error('Automatic publication requires fixtures.');
        await this.assertDependenciesReady(tool);
        if (executor.kind === 'browser') {
          const node = await workspaceRepository.getNode(executor.nodeId);
          const profile = node ? portalProfileFromPayload(node.payload as never) : null;
          if (!profile || node?.workspaceId !== tool.workspaceId || !profile.agentIds.includes(actor.id) || profile.control === 'disabled' || profile.paused) throw new Error('Browser tool is outside the Portal grant.');
          if (profile.control !== 'interact' && executor.steps.some((step) => !['snapshot', 'extract', 'screenshot', 'wait'].includes(step.action))) throw new Error('Browser mutations exceed the Portal grant.');
        }
        if (executor.kind === 'http') {
          const url = new URL(executor.urlTemplate.replace(/\{\{[^}]+\}\}/g, 'fixture'));
          if (/[{}]/.test(new URL(executor.urlTemplate).host)) throw new Error('The tool destination must be literal.');
          const decision = await autonomyPolicyService.decide({ workspaceId: tool.workspaceId, capability: 'network', operation: `tool:${tool.slug}`,
            actorType: 'agent', actorId: actor.id, network: { url: url.toString(), method: executor.method }, mutation: !['GET', 'HEAD'].includes(executor.method),
            risk: ['GET', 'HEAD'].includes(executor.method) ? null : 'external_publication' });
          if (decision.status !== 'allowed') throw new Error('The endpoint or operation requires approval.');
        }
        for (const fixture of tool.manifest.fixtures) {
          validateValue(tool.manifest.inputSchema, fixture.input);
          if (executor.kind === 'transform') validateValue(tool.manifest.outputSchema, new ToolExecutionService().transform(fixture.input, executor.operations));
        }
        const currentPolicy = await autonomyPolicyService.get(tool.workspaceId);
        if (currentPolicy.revision !== policy.revision) throw new Error('Publication policy changed during validation.');
        return agentWorkspaceToolRepository.setStatus(tool.workspaceId, tool.id, 'published', tool.currentRevision);
      });
    } catch {
      // The draft remains available for owner review; the failed decision is audited.
      return tool;
    }
  }

  async archive(workspaceId: string, id: string, actor: WorkspaceToolActor) {
    if (actor.type !== 'user') throw new Error('Only the workspace owner can archive a tool.');
    return autonomyPolicyService.execute({ workspaceId, capability: 'tool', operation: 'tool:archive', target: id,
      actorType: 'user', actorId: actor.id, mutation: true, auditOutput: () => ({ archived: true }),
    }, () => agentWorkspaceToolRepository.setStatus(workspaceId, id, 'archived'));
  }

  async revisions(workspaceId: string, id: string) { return agentWorkspaceToolRepository.revisions(workspaceId, id); }

  async rollback(workspaceId: string, id: string, revision: number, actor: WorkspaceToolActor) {
    if (actor.type !== 'user') throw new Error('Only the workspace owner can roll back a tool.');
    const previous = await agentWorkspaceToolRepository.revision(workspaceId, id, revision);
    if (!previous) throw new Error('Tool revision not found.');
    return autonomyPolicyService.execute({ workspaceId, capability: 'tool', operation: 'tool:rollback', target: id,
      actorType: 'user', actorId: actor.id, mutation: true, input: { sourceRevision: revision },
      auditOutput: (result) => ({ revision: (result as WorkspaceToolRecord).currentRevision }),
    }, () => agentWorkspaceToolRepository.update({ workspaceId, id, manifest: previous.manifest, actor, changeSummary: `Rollback to revision ${revision}` }));
  }

  private async assertDependenciesReady(tool: WorkspaceToolRecord): Promise<void> {
    const secrets = new Map((await secretRefService.list(tool.workspaceId)).map((secret) => [secret.ref, secret]));
    const executor = tool.manifest.executor;
    if (executor.kind === 'browser') {
      const node = await workspaceRepository.getNode(executor.nodeId);
      if (!node || node.workspaceId !== tool.workspaceId || node.type !== 'portal') throw new Error('Browser tool requires a Portal in this workspace.');
      for (const step of executor.steps) managedPortalCommandSchema.parse({ nodeId: executor.nodeId, action: step.action,
        args: { ...step.args, ...(step.target ? { ref: 'e1' } : {}) } });
    }
    const usedReferences = executor.kind === 'http'
      ? executor.headers.flatMap((header) => header.secretRef ? [header.secretRef] : [])
      : executor.kind === 'workspace_command' && executor.stdinSecretRef ? [executor.stdinSecretRef] : [];
    if (tool.manifest.secretRefs.some((reference) => !usedReferences.includes(reference))) {
      throw new Error('Tool manifest contains an unused SecretRef.');
    }
    let destination: string | null = null;
    if (executor.kind === 'http') {
      const previewUrl = executor.urlTemplate.replace(/\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/g, 'preview');
      let url: URL;
      try { url = new URL(previewUrl); } catch { throw new Error('Tool URL template must resolve to an absolute HTTP or HTTPS URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Tool URL template is not allowed.');
      destination = url.hostname;
    } else if (executor.kind === 'workspace_command') {
      destination = 'workspace-command';
    }
    for (const reference of usedReferences) {
      const secret = secrets.get(reference);
      if (!secret?.enabled) throw new Error(`SecretRef ${reference} is unavailable.`);
      if (!secret.bindings.integrations.includes('tool')) throw new Error(`SecretRef ${reference} is not bound to Tool Workshop.`);
      if (!secret.bindings.operations.includes(`tool:${tool.slug}`)) throw new Error(`SecretRef ${reference} is not bound to tool:${tool.slug}.`);
      if (!destination || !destinationAllowed(secret.bindings.destinations, destination)) {
        throw new Error(`SecretRef ${reference} is not bound to ${destination ?? 'this destination'}.`);
      }
    }
    if (executor.kind === 'integration') {
      const integration = await integrationExecutionService.get(tool.workspaceId, executor.integrationId);
      if (!integration.enabled || integration.status !== 'connected') throw new Error('The selected integration is not connected and enabled.');
      if (!integration.permissions.includes(executor.action)) throw new Error('The selected integration action is outside the standing account grant.');
    }
  }
}

export class ToolExecutionService {
  constructor(private readonly http = new TrustedIntegrationHttpClient()) {}

  async execute(workspaceId: string, toolId: string, raw: ExecuteWorkspaceToolInput): Promise<WorkspaceToolRunRecord> {
    const request = executeWorkspaceToolSchema.parse(raw);
    assertNoEmbeddedSecrets(request.input, 'input');
    const tool = await agentWorkspaceToolRepository.find(workspaceId, toolId);
    if (!tool || tool.status === 'archived') throw new Error('Archived workspace tools cannot run.');
    let executableTool = tool;
    const previous = await agentWorkspaceToolRepository.findRun(workspaceId, request.idempotencyKey);
    if (!request.dryRun) {
      if (tool.publishedRevision == null) throw new Error('Only a published workspace tool can perform effects.');
      const published = await agentWorkspaceToolRepository.revision(workspaceId, toolId, previous?.revision ?? tool.publishedRevision);
      if (!published) throw new Error('Published tool revision is unavailable.');
      executableTool = { ...tool, currentRevision: published.revision, manifest: published.manifest };
    }
    validateValue(executableTool.manifest.inputSchema, request.input);
    const requestDigest = digest({ toolId, revision: executableTool.currentRevision, dryRun: request.dryRun, input: request.input });
    if (previous) {
      if (previous.requestDigest !== requestDigest) throw new Error('Idempotency key was already used with different input.');
      if (previous.actor.type !== request.actor.type || previous.actor.id !== (request.actor.id ?? null)) throw new Error('Tool run belongs to another actor.');
      if (previous.status !== 'waiting_approval' || !await agentWorkspaceToolRepository.claimWaitingRun(previous.id)) return previous;
    }
    const now = new Date();
    const reservation = previous ? { run: previous, created: true } : await agentWorkspaceToolRepository.reserveRun({
      workspaceId, toolId, revision: executableTool.currentRevision, actor: request.actor,
      automationRunId: request.automationRunId ?? null, idempotencyKey: request.idempotencyKey,
      requestDigest, input: record(redactAutonomyValue(request.input)), startedAt: now.toISOString(),
    });
    const run = reservation.run;
    if (!reservation.created) {
      if (run.requestDigest !== requestDigest) throw new Error('Idempotency key was already used with different input.');
      if (run.actor.type !== request.actor.type || run.actor.id !== (request.actor.id ?? null)) throw new Error('Tool run belongs to another actor.');
      return run;
    }
    try {
      const output = request.dryRun ? this.preview(executableTool, request.input) : await autonomyPolicyService.execute({
        workspaceId, runId: request.automationRunId ?? null, capability: 'tool',
        operation: `tool:${executableTool.slug}`, target: executableTool.name,
        mutation: executableTool.manifest.executor.kind !== 'transform', actorType: request.actor.type,
        actorId: request.actor.id ?? null, input: { toolId, toolRunId: run.id, revision: executableTool.currentRevision }, certainty: 'semantic',
      }, () => this.run(executableTool, request.input, request, run));
      if (!request.dryRun) validateValue(executableTool.manifest.outputSchema, output);
      const serialized = JSON.stringify(redactAutonomyValue(output));
      if (Buffer.byteLength(serialized) > executableTool.manifest.maxOutputBytes) throw new Error('Tool output exceeded its published limit.');
      const finished = new Date();
      return agentWorkspaceToolRepository.finishRun(run.id, {
        status: request.dryRun ? 'dry_run' : 'succeeded', output: JSON.parse(serialized), outputDigest: digest(output),
        error: null, durationMs: finished.getTime() - now.getTime(),
      });
    } catch (error) {
      const finished = new Date();
      await agentWorkspaceToolRepository.finishRun(run.id, {
        status: error instanceof AutonomyGatePendingError ? 'waiting_approval' : 'failed', output: null, outputDigest: null,
        error: String(error instanceof Error ? error.message : error).slice(0, 2_000),
        durationMs: finished.getTime() - now.getTime(),
      });
      throw error;
    }
  }

  async listRuns(workspaceId: string, toolId?: string) { return agentWorkspaceToolRepository.listRuns(workspaceId, toolId); }

  private preview(tool: WorkspaceToolRecord, input: Record<string, unknown>): Record<string, unknown> {
    return { valid: true, executor: tool.manifest.executor.kind, revision: tool.currentRevision, requestDigest: digest({ toolId: tool.id, input }) };
  }

  private async run(tool: WorkspaceToolRecord, input: Record<string, unknown>, request: ExecuteWorkspaceToolInput, run: WorkspaceToolRunRecord): Promise<unknown> {
    const executor = tool.manifest.executor;
    if (executor.kind === 'transform') return this.transform(input, executor.operations);
    if (executor.kind === 'integration') {
      return integrationExecutionService.execute(tool.workspaceId, {
        integrationId: executor.integrationId, action: executor.action,
        input: record(renderValue(executor.inputTemplate, input)), idempotencyKey: request.idempotencyKey,
      }, { actorType: request.actor.type === 'automation' ? 'automation' : request.actor.type === 'agent' ? 'agent' : 'user', actorId: request.actor.id, runId: request.automationRunId });
    }
    if (executor.kind === 'http') return this.httpRequest(tool, input);
    if (executor.kind === 'browser') {
      const outputs: unknown[] = [...(run.checkpoint?.steps ?? [])];
      const deadline = Date.now() + tool.manifest.timeoutMs;
      for (let index = outputs.length; index < executor.steps.length; index++) {
        if (Date.now() >= deadline) throw new Error('Browser tool timed out.');
        const step = executor.steps[index];
        const args = record(renderValue(step.args, { ...input, steps: outputs }));
        const context = { actorType: request.actor.type === 'agent' ? 'agent' as const : request.actor.type === 'automation' ? 'automation' as const : 'user' as const, actorId: request.actor.id, runId: request.automationRunId, stepId: run.id + ':' + index };
        if (step.target) {
          const snapshot = await managedPortalService.execute(tool.workspaceId, managedPortalCommandSchema.parse({ nodeId: executor.nodeId, action: 'snapshot', args: {} }), context);
          const matches = (snapshot.result as { elements?: Array<{ ref: string; role: string; name: string }> })?.elements?.filter((element) => element.role === step.target!.role && element.name === render(step.target!.name, input)) ?? [];
          if (matches.length !== 1) throw new Error('Browser target must match exactly one visible element.');
          args.ref = matches[0].ref;
        }
        const result = await managedPortalService.execute(tool.workspaceId, managedPortalCommandSchema.parse({ nodeId: executor.nodeId, action: step.action, args, timeoutMs: Math.max(1000, deadline - Date.now()) }), context);
        outputs.push(redactAutonomyValue(result.result));
        if (Buffer.byteLength(JSON.stringify(outputs)) > tool.manifest.maxOutputBytes) throw new Error('Tool output exceeded its published limit.');
        await agentWorkspaceToolRepository.checkpoint(run.id, outputs);
      }
      return { steps: outputs };
    }
    return this.command(tool, input, executor);
  }

  transform(input: Record<string, unknown>, operations: Extract<WorkspaceToolManifest['executor'], { kind: 'transform' }>['operations']): Record<string, unknown> {
    let output: Record<string, unknown> = structuredClone(input);
    for (const operation of operations) {
      if (operation.kind === 'pick') {
        const next: Record<string, unknown> = {};
        for (const path of operation.paths) setPath(next, path, atPath(output, path));
        output = next;
      } else if (operation.kind === 'set') setPath(output, operation.path, renderValue(operation.value, input));
      else if (operation.kind === 'template') setPath(output, operation.path, render(operation.template, input));
      else {
        const value = atPath(output, operation.from);
        setPath(output, operation.to, value);
        const keys = operation.from.split('.');
        const parent = atPath(output, keys.slice(0, -1).join('.'));
        if (parent && typeof parent === 'object') delete (parent as Record<string, unknown>)[keys.at(-1)!];
      }
    }
    return output;
  }

  private async httpRequest(tool: WorkspaceToolRecord, input: Record<string, unknown>): Promise<unknown> {
    const executor = tool.manifest.executor as Extract<WorkspaceToolManifest['executor'], { kind: 'http' }>;
    const url = new URL(render(executor.urlTemplate, input));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Tool URL is not allowed.');
    const headers: Record<string, string> = { accept: 'application/json' };
    const resolvedSecrets: string[] = [];
    for (const header of executor.headers) {
      if (header.secretRef) {
        const value = (await secretRefService.resolve(tool.workspaceId, header.secretRef, {
          integration: 'tool', operation: `tool:${tool.slug}`, destination: url.hostname,
        })).revealInsideTrustedExecutor();
        resolvedSecrets.push(value);
        headers[header.name] = value;
      } else headers[header.name] = render(header.value ?? '', input);
    }
    const mutation = !['GET', 'HEAD'].includes(executor.method);
    try {
      return await autonomyPolicyService.execute({
        workspaceId: tool.workspaceId, capability: 'network', operation: `tool:${tool.slug}`, target: url.hostname,
        mutation, actorType: 'integration', actorId: tool.id, input: { url: url.toString(), method: executor.method },
        network: { url: url.toString(), method: executor.method }, certainty: 'semantic',
      }, async () => {
        try {
        const response = await this.http.request(url.toString(), {
          method: executor.method, headers,
          ...(executor.bodyTemplate && mutation ? { body: render(executor.bodyTemplate, input) } : {}),
          signal: AbortSignal.timeout(tool.manifest.timeoutMs),
        });
        if (!response.ok) throw new Error(`Tool endpoint returned HTTP ${response.status}.`);
        return redactResolvedSecrets(response.json, resolvedSecrets);
        } catch (error) { throw new Error(redactString(error instanceof Error ? error.message : String(error), resolvedSecrets)); }
      });
    } catch (error) {
      if (error instanceof AutonomyGatePendingError) throw error;
      throw new Error(redactString(error instanceof Error ? error.message : String(error), resolvedSecrets));
    }
  }

  private async command(tool: WorkspaceToolRecord, input: Record<string, unknown>, executor: Extract<WorkspaceToolManifest['executor'], { kind: 'workspace_command' }>): Promise<unknown> {
    const workspace = await workspaceRepository.getWorkspace(tool.workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const cwd = await realpath(resolve(workspace.workingDir, render(executor.cwd, input)));
    if (!inside(await realpath(workspace.workingDir), cwd)) throw new Error('Tool working directory escaped the workspace.');
    const command = render(executor.executable, input);
    if ((command.includes('/') || command.includes('\\')) && !inside(await realpath(workspace.workingDir), resolve(cwd, command))) throw new Error('Tool executable escaped the workspace.');
    const args = executor.args.map((argument) => render(argument, input));
    const secret = executor.stdinSecretRef
      ? await secretRefService.resolve(tool.workspaceId, executor.stdinSecretRef, { integration: 'tool', operation: `tool:${tool.slug}`, destination: 'workspace-command' })
      : null;
    const stdin = secret?.revealInsideTrustedExecutor() ?? '';
    try {
      const result = await autonomyPolicyService.execute({
        workspaceId: tool.workspaceId, capability: 'filesystem', operation: `tool:${tool.slug}`, target: command,
        mutation: true, actorType: 'system', actorId: tool.id, input: { executable: command, args, cwd },
        filesystem: { path: cwd, permission: 'write' }, certainty: 'inferred',
      }, async () => {
        try { return redactResolvedSecrets(await this.spawnCommand(workspace, command, args, cwd, tool.manifest.timeoutMs, tool.manifest.maxOutputBytes, stdin), [stdin]); }
        catch (error) { throw new Error(redactString(error instanceof Error ? error.message : String(error), [stdin])); }
      });
      return redactResolvedSecrets(result, [stdin]);
    } catch (error) {
      if (error instanceof AutonomyGatePendingError) throw error;
      throw new Error(redactString(error instanceof Error ? error.message : String(error), [stdin]));
    }
  }

  private spawnCommand(workspace: NonNullable<Awaited<ReturnType<typeof workspaceRepository.getWorkspace>>>, command: string, args: string[], cwd: string, timeoutMs: number, maxBytes: number, stdin: string): Promise<Record<string, unknown>> {
    const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'SHELL', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
    const target = buildWorkspaceRuntimeLaunch({ workspace, command, args, hostCwd: cwd, hostEnv: env });
    return new Promise((resolvePromise, reject) => {
      const child = spawn(target.command, target.args, { cwd: target.cwd, env: target.env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = []; const stderr: Buffer[] = []; let size = 0; let exceeded = false;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Tool command timed out.')); }, timeoutMs);
      const collect = (chunks: Buffer[], chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > maxBytes) { exceeded = true; child.kill('SIGKILL'); return; }
        chunks.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (exceeded) return reject(new Error('Tool command output exceeded its published limit.'));
        const result = { code: code ?? -1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
        if (code !== 0) return reject(new Error(`Tool command exited with code ${code ?? -1}.`));
        resolvePromise(result);
      });
      child.stdin.end(stdin);
    });
  }
}

export const agentWorkspaceToolService = new AgentWorkspaceToolService();
export const toolExecutionService = new ToolExecutionService();
