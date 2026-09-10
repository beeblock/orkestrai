import { z } from 'zod';
import { autonomyCapabilitySchema } from './autonomy-policy.schema.js';

const actorSchema = z.object({
  type: z.enum(['user', 'agent', 'automation', 'system']),
  id: z.string().trim().max(255).nullish(),
}).strict();

const jsonSchemaSchema = z.object({
  type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']),
  title: z.string().trim().max(120).optional(),
  description: z.string().trim().max(500).optional(),
  properties: z.record(z.string().trim().min(1).max(120), z.unknown()).optional(),
  required: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  items: z.unknown().optional(),
  enum: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).max(100).optional(),
  default: z.unknown().optional(),
  minLength: z.number().int().min(0).max(1_000_000).optional(),
  maxLength: z.number().int().min(1).max(1_000_000).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  additionalProperties: z.boolean().optional(),
}).strict();

function validateSchemaTree(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  const parsed = jsonSchemaSchema.safeParse(value);
  if (!parsed.success) return false;
  const schema = parsed.data;
  if (schema.type === 'object') {
    const entries = Object.entries(schema.properties ?? {});
    if (entries.length > 100 || entries.some(([, child]) => !validateSchemaTree(child, depth + 1))) return false;
    if ((schema.required ?? []).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
  }
  if (schema.type === 'array' && schema.items && !validateSchemaTree(schema.items, depth + 1)) return false;
  return JSON.stringify(value).length <= 100_000;
}

export const boundedJsonSchema = z.unknown().refine(validateSchemaTree, 'Use the supported, bounded JSON Schema subset.');

const headerSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9-]+$/),
  value: z.string().max(8_000).optional(),
  secretRef: z.string().regex(/^secretref:[0-9a-f-]{16,}$/i).optional(),
}).strict().superRefine((header, context) => {
  if (Boolean(header.value) === Boolean(header.secretRef)) context.addIssue({ code: 'custom', message: 'Header requires exactly one literal value or SecretRef.' });
  if (/authorization|api[-_]?key|token|secret|cookie/i.test(header.name) && header.value) {
    context.addIssue({ code: 'custom', path: ['value'], message: 'Sensitive headers must use a SecretRef.' });
  }
});

const executorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('http'),
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']),
    urlTemplate: z.string().trim().min(1).max(4_096),
    headers: z.array(headerSchema).max(50).default([]),
    bodyTemplate: z.string().max(1_000_000).nullish(),
  }).strict(),
  z.object({
    kind: z.literal('integration'),
    integrationId: z.string().uuid(),
    action: z.string().trim().min(1).max(120),
    inputTemplate: z.record(z.string().max(120), z.unknown()).default({}),
  }).strict(),
  z.object({
    kind: z.literal('transform'),
    operations: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('pick'), paths: z.array(z.string().trim().min(1).max(500)).min(1).max(100) }).strict(),
      z.object({ kind: z.literal('set'), path: z.string().trim().min(1).max(500), value: z.unknown() }).strict(),
      z.object({ kind: z.literal('rename'), from: z.string().trim().min(1).max(500), to: z.string().trim().min(1).max(500) }).strict(),
      z.object({ kind: z.literal('template'), path: z.string().trim().min(1).max(500), template: z.string().max(100_000) }).strict(),
    ])).min(1).max(50),
  }).strict(),
  z.object({
    kind: z.literal('workspace_command'),
    executable: z.string().trim().min(1).max(1_000).refine((value) => !/[;&|`\r\n]/.test(value), 'Shell syntax is not allowed.'),
    args: z.array(z.string().max(10_000)).max(100).default([]),
    cwd: z.string().trim().min(1).max(2_000).default('.'),
    stdinSecretRef: z.string().regex(/^secretref:[0-9a-f-]{16,}$/i).nullish(),
  }).strict(),
]);

export const workspaceToolManifestSchema = z.object({
  schemaVersion: z.literal(1),
  executor: executorSchema,
  inputSchema: boundedJsonSchema,
  outputSchema: boundedJsonSchema,
  capabilities: z.array(autonomyCapabilitySchema).min(1).max(10),
  secretRefs: z.array(z.string().regex(/^secretref:[0-9a-f-]{16,}$/i)).max(50).default([]),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
  maxOutputBytes: z.number().int().min(1_024).max(10_485_760).default(1_048_576),
  fixtures: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    input: z.record(z.string().max(120), z.unknown()),
  }).strict()).max(20).default([]),
}).strict().superRefine((manifest, context) => {
  const references = new Set(manifest.secretRefs);
  if (manifest.executor.kind === 'http') {
    for (const header of manifest.executor.headers) {
      if (header.secretRef && !references.has(header.secretRef)) context.addIssue({ code: 'custom', path: ['secretRefs'], message: 'Every executor SecretRef must be declared.' });
    }
  }
  if (manifest.executor.kind === 'workspace_command' && manifest.executor.stdinSecretRef && !references.has(manifest.executor.stdinSecretRef)) {
    context.addIssue({ code: 'custom', path: ['secretRefs'], message: 'The protected stdin SecretRef must be declared.' });
  }
  const required = manifest.executor.kind === 'http' ? ['network', 'tool']
    : manifest.executor.kind === 'integration' ? ['integration', 'tool']
      : manifest.executor.kind === 'workspace_command' ? ['filesystem', 'tool'] : ['tool'];
  for (const capability of required) {
    if (!manifest.capabilities.includes(capability as never)) context.addIssue({ code: 'custom', path: ['capabilities'], message: `Executor requires the ${capability} capability.` });
  }
});

export const createWorkspaceToolSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2_000).default(''),
  nodeId: z.string().uuid().nullish(),
  manifest: workspaceToolManifestSchema,
  changeSummary: z.string().trim().max(500).nullish(),
  actor: actorSchema,
}).strict();

export const updateWorkspaceToolSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2_000).optional(),
  manifest: workspaceToolManifestSchema,
  changeSummary: z.string().trim().max(500).nullish(),
  actor: actorSchema,
}).strict();

export const executeWorkspaceToolSchema = z.object({
  input: z.record(z.string().max(120), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(255),
  dryRun: z.boolean().default(false),
  actor: actorSchema,
  automationRunId: z.string().uuid().nullish(),
}).strict();

export const rollbackWorkspaceToolSchema = z.object({
  revision: z.number().int().min(1),
  actor: actorSchema,
}).strict();

function editorJsonObject(value: string): boolean {
  try { const parsed = JSON.parse(value); return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed)); }
  catch { return false; }
}

export const workspaceToolEditorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(2_000).default(''),
  executorKind: z.enum(['http', 'integration', 'transform', 'workspace_command']),
  executorConfig: z.string().max(1_000_000).refine(editorJsonObject, 'Executor configuration must be a JSON object.'),
  inputSchema: z.string().max(100_000).refine(editorJsonObject, 'Input schema must be a JSON object.'),
  outputSchema: z.string().max(100_000).refine(editorJsonObject, 'Output schema must be a JSON object.'),
  fixtures: z.string().max(1_000_000).refine((value) => { try { return Array.isArray(JSON.parse(value)); } catch { return false; } }, 'Fixtures must be a JSON array.'),
  timeoutMs: z.coerce.number().int().min(100).max(300_000),
  maxOutputBytes: z.coerce.number().int().min(1_024).max(10_485_760),
  changeSummary: z.string().trim().max(500).default(''),
}).strict().superRefine((value, context) => {
  try {
    const executor = { kind: value.executorKind, ...JSON.parse(value.executorConfig) };
    const capabilities = value.executorKind === 'http' ? ['tool', 'network']
      : value.executorKind === 'integration' ? ['tool', 'integration']
        : value.executorKind === 'workspace_command' ? ['tool', 'filesystem'] : ['tool'];
    workspaceToolManifestSchema.parse({
      schemaVersion: 1, executor, inputSchema: JSON.parse(value.inputSchema), outputSchema: JSON.parse(value.outputSchema),
      capabilities, secretRefs: [executor.stdinSecretRef, ...(executor.headers ?? []).map((header: { secretRef?: string }) => header.secretRef)].filter(Boolean),
      timeoutMs: value.timeoutMs, maxOutputBytes: value.maxOutputBytes, fixtures: JSON.parse(value.fixtures),
    });
  } catch (error) {
    context.addIssue({ code: 'custom', path: ['executorConfig'], message: error instanceof Error ? error.message : 'Invalid tool manifest.' });
  }
});

export type WorkspaceToolManifest = z.infer<typeof workspaceToolManifestSchema>;
export type CreateWorkspaceToolInput = z.infer<typeof createWorkspaceToolSchema>;
export type UpdateWorkspaceToolInput = z.infer<typeof updateWorkspaceToolSchema>;
export type ExecuteWorkspaceToolInput = z.infer<typeof executeWorkspaceToolSchema>;
export type WorkspaceToolActor = z.infer<typeof actorSchema>;
export type WorkspaceToolEditorInput = z.infer<typeof workspaceToolEditorSchema>;
