import { z } from 'zod';

export const autonomyModeSchema = z.enum(['observe', 'prepare', 'ask_mutations', 'bounded']);
export const autonomyCapabilitySchema = z.enum([
  'agent', 'browser', 'computer', 'filesystem', 'git', 'integration', 'network', 'notification', 'task', 'tool',
]);
export const autonomyRiskSchema = z.enum([
  'outside_boundary', 'secret_export', 'bulk_destructive', 'force_push', 'production_deploy',
  'purchase', 'external_publication', 'account_permission', 'irreversible',
]);
export const gateRequirementSchema = z.enum(['preapproved', 'user', 'reviewer', 'council']);

const relativeGlobSchema = z.string().trim().min(1).max(500).refine(
  (value) => !value.startsWith('/') && !value.startsWith('\\') && !/(^|[\\/])\.\.([\\/]|$)/.test(value),
  'Exclusion patterns must stay relative to their approved root.',
);

export const filesystemGrantSchema = z.object({
  root: z.string().trim().min(1).max(2_000),
  permissions: z.array(z.enum(['read', 'write', 'create', 'delete'])).min(1).max(4),
  excludeGlobs: z.array(relativeGlobSchema).max(100).default([]),
  followSymlinks: z.literal(false).default(false),
  maxFileSize: z.number().int().min(1_024).max(1_073_741_824).default(50 * 1024 * 1024),
}).strict();

export const networkGrantSchema = z.object({
  schemes: z.array(z.enum(['http', 'https'])).min(1).max(2).default(['https']),
  hosts: z.array(z.string().trim().min(1).max(253).toLowerCase()).min(1).max(100),
  ports: z.array(z.number().int().min(1).max(65_535)).max(100).default([]),
  methods: z.array(z.enum(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])).min(1).max(7),
  operations: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
}).strict();

export const autonomyPolicyDocumentSchema = z.object({
  halted: z.boolean().default(false),
  toolPublication: z.object({
    enabled: z.boolean().default(false),
    agentIds: z.array(z.string().uuid()).max(100).default([]),
    kinds: z.array(z.enum(['transform', 'browser', 'http', 'integration'])).max(4).default(['transform']),
    maxTimeoutMs: z.number().int().min(100).max(300000).default(30000),
    maxOutputBytes: z.number().int().min(1024).max(10485760).default(1048576),
  }).strict().default({}),
  capabilities: z.array(autonomyCapabilitySchema).max(10).default(['agent', 'browser', 'filesystem', 'git', 'notification', 'task']),
  filesystem: z.array(filesystemGrantSchema).max(32).default([]),
  network: z.array(networkGrantSchema).max(32).default([]),
  allowedApps: z.array(z.string().trim().min(1).max(255)).max(100).default([]),
  maxConcurrentRuns: z.number().int().min(1).max(64).default(4),
  maxTokensPerRun: z.number().int().min(1_000).max(100_000_000).default(500_000),
  maxSpendCentsPerDay: z.number().int().min(0).max(100_000_000).default(0),
  destructiveFileThreshold: z.number().int().min(1).max(100_000).default(25),
  quietHours: z.object({
    enabled: z.boolean().default(false),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('22:00'),
    end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('07:00'),
  }).strict().default({}),
  gates: z.record(autonomyRiskSchema, gateRequirementSchema).default({}),
  auditRetentionDays: z.number().int().min(1).max(3_650).default(365),
}).strict();

export const autonomyPolicyInputSchema = z.object({
  enabled: z.boolean(),
  mode: autonomyModeSchema,
  policy: autonomyPolicyDocumentSchema,
}).strict();

export const autonomyGateResolutionSchema = z.object({
  decision: z.enum(['approved', 'denied']),
  note: z.string().trim().max(2_000).nullish(),
}).strict();

export const secretRefInputSchema = z.object({
  name: z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9][a-zA-Z0-9 _.-]*$/),
  purpose: z.string().trim().max(500).nullish(),
  provider: z.enum(['desktop', 'host_vault']).default('desktop'),
  bindings: z.object({
    integrations: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    operations: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    destinations: z.array(z.string().trim().min(1).max(253).toLowerCase()).max(50).default([]),
  }).strict(),
}).strict();

export const autonomyAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1_000).default(200),
  runId: z.string().uuid().optional(),
}).strict();

export type AutonomyMode = z.infer<typeof autonomyModeSchema>;
export type AutonomyCapability = z.infer<typeof autonomyCapabilitySchema>;
export type AutonomyRisk = z.infer<typeof autonomyRiskSchema>;
export type GateRequirement = z.infer<typeof gateRequirementSchema>;
export type AutonomyPolicyDocument = z.infer<typeof autonomyPolicyDocumentSchema>;
export type AutonomyPolicyInput = z.infer<typeof autonomyPolicyInputSchema>;
export type SecretRefInput = z.infer<typeof secretRefInputSchema>;
