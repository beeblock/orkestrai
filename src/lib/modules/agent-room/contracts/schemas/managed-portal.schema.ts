import { z } from 'zod';

const portalRefSchema = z.string().trim().regex(/^e\d{1,6}$/);
const safeRelativePathSchema = z.string().trim().min(1).max(1_024).refine(
  (value) => !value.startsWith('/') && !value.startsWith('\\') && !/(^|[\\/])\.\.([\\/]|$)/.test(value),
  'Path must stay inside the workspace.',
);

export const portalProfileSchema = z.object({
  profileId: z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).default('default'),
  profileScope: z.enum(['private', 'workspace']).default('workspace'),
  allowedHosts: z.array(z.string().trim().min(1).max(253).toLowerCase()).max(64).default([]),
  downloadDirectory: safeRelativePathSchema.default('.orkestrai/downloads'),
  control: z.enum(['disabled', 'read', 'interact']).default('disabled'),
  agentIds: z.array(z.string().uuid()).max(100).default([]),
  paused: z.boolean().default(false),
  allowBackground: z.boolean().default(false),
}).strict();

const common = {
  token: z.string().trim().min(1).nullish(),
  nodeId: z.string().trim().min(1).max(128),
  from: z.string().trim().min(1).max(128).nullish(),
  taskId: z.string().uuid().optional(),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
};

export const managedPortalCommandSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('navigate'), args: z.object({ url: z.string().trim().min(1).max(4_096) }).strict() }),
  z.object({ ...common, action: z.literal('tabs'), args: z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('list') }),
    z.object({ operation: z.literal('new'), url: z.string().trim().min(1).max(4_096) }),
    z.object({ operation: z.literal('activate'), tabId: z.string().trim().min(1).max(128) }),
    z.object({ operation: z.literal('close'), tabId: z.string().trim().min(1).max(128) }),
  ]) }),
  z.object({ ...common, action: z.literal('snapshot'), args: z.object({ interactiveOnly: z.boolean().default(true) }).strict().default({ interactiveOnly: true }) }),
  z.object({ ...common, action: z.literal('click'), args: z.object({ ref: portalRefSchema, button: z.enum(['left', 'middle', 'right']).default('left') }).strict() }),
  z.object({ ...common, action: z.literal('type'), args: z.object({ ref: portalRefSchema, text: z.string().max(100_000), clear: z.boolean().default(true), submit: z.boolean().default(false) }).strict() }),
  z.object({ ...common, action: z.literal('select'), args: z.object({ ref: portalRefSchema, values: z.array(z.string().max(2_000)).min(1).max(100) }).strict() }),
  z.object({ ...common, action: z.literal('upload'), args: z.object({ ref: portalRefSchema, paths: z.array(safeRelativePathSchema).min(1).max(20) }).strict() }),
  z.object({ ...common, action: z.literal('download'), args: z.object({ ref: portalRefSchema, filename: z.string().trim().min(1).max(255).optional() }).strict() }),
  z.object({ ...common, action: z.literal('wait'), args: z.object({ ref: portalRefSchema.optional(), text: z.string().max(2_000).optional(), urlIncludes: z.string().max(2_000).optional(), delayMs: z.number().int().min(0).max(120_000).optional() }).strict().refine((value) => value.ref || value.text || value.urlIncludes || value.delayMs !== undefined, 'Provide a wait condition.') }),
  z.object({ ...common, action: z.literal('screenshot'), args: z.object({ fullPage: z.boolean().default(false) }).strict().default({ fullPage: false }) }),
  z.object({ ...common, action: z.literal('extract'), args: z.object({ kind: z.enum(['text', 'links', 'table', 'attribute']).default('text'), ref: portalRefSchema.optional(), attribute: z.string().trim().min(1).max(128).optional() }).strict() }),
  z.object({ ...common, action: z.literal('dom'), args: z.object({}).strict().default({}) }),
  z.object({ ...common, action: z.literal('eval'), args: z.object({ js: z.string().max(200_000) }).strict() }),
]);

export const updatePortalProfileSchema = portalProfileSchema.partial().strict();

export type PortalProfile = z.infer<typeof portalProfileSchema>;
export type ManagedPortalCommand = z.infer<typeof managedPortalCommandSchema>;
export type ManagedPortalAction = ManagedPortalCommand['action'];

export type ManagedPortalExecutorRequest = {
  requestId: string;
  workspaceId: string;
  workspaceRoot: string;
  nodeId: string;
  profile: PortalProfile;
  initialUrl: string;
  initialTabs?: Array<{ id: string; url: string; title?: string }>;
  initialActiveTabId?: string;
  action: ManagedPortalAction;
  args: Record<string, unknown>;
  timeoutMs: number;
};

export type ManagedPortalExecutorResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  state?: { url?: string; title?: string; activeTabId?: string; tabs?: Array<{ id: string; url: string; title: string }> };
};
