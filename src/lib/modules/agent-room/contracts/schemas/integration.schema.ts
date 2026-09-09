import { z } from 'zod';

export const integrationTypeSchema = z.enum([
  'github', 'gmail', 'slack', 'telegram', 'whatsapp', 'webhook',
]);

const secretRefSchema = z.string().regex(/^secretref:[0-9a-f-]{16,}$/i);
const permissionSchema = z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9_.:-]*$/);
const safeIdentifier = z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9._:@/-]+$/);
const httpsUrl = z.string().url().max(4_096).refine((value) => new URL(value).protocol === 'https:', 'Only HTTPS integration endpoints are allowed.');

const base = {
  name: z.string().trim().min(1).max(120),
  secretRefs: z.array(secretRefSchema).max(8).default([]),
  permissions: z.array(permissionSchema).min(1).max(50),
  enabled: z.boolean().default(true),
};

export const integrationConnectionSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('github'),
    config: z.object({ owner: safeIdentifier, repo: safeIdentifier }).strict(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal('gmail'),
    config: z.object({
      clientId: z.string().trim().min(20).max(500),
      accountEmail: z.string().email().max(320).nullish(),
    }).strict(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal('slack'),
    config: z.object({ defaultChannel: safeIdentifier.nullish() }).strict(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal('telegram'),
    config: z.object({ defaultChatId: z.string().trim().min(1).max(100).regex(/^-?[0-9A-Za-z_@]+$/).nullish() }).strict(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal('whatsapp'),
    config: z.object({
      phoneNumberId: z.string().trim().regex(/^\d{5,40}$/),
      businessAccountId: z.string().trim().regex(/^\d{5,40}$/).nullish(),
      apiVersion: z.string().trim().regex(/^v\d{1,2}\.\d$/),
      defaultRecipient: z.string().trim().regex(/^\+?\d{7,20}$/).nullish(),
    }).strict(),
  }).strict(),
  z.object({
    ...base,
    type: z.literal('webhook'),
    config: z.object({
      url: httpsUrl,
      method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
      authScheme: z.enum(['none', 'bearer', 'header']).default('none'),
      authHeader: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9-]+$/).nullish(),
    }).strict(),
  }).strict(),
]);

export const integrationExecutionSchema = z.object({
  integrationId: z.string().uuid(),
  action: permissionSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  idempotencyKey: z.string().trim().min(8).max(240).regex(/^[a-zA-Z0-9._:@/-]+$/).optional(),
  taskId: z.string().uuid().optional(),
  from: z.string().trim().min(1).max(120).optional(),
}).strict();

export const integrationEventsQuerySchema = z.object({
  integrationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
}).strict();

export const integrationOauthStartSchema = z.object({
  name: z.string().trim().min(1).max(120),
  clientId: z.string().trim().min(20).max(500),
  permissions: z.array(permissionSchema).min(1).max(50),
}).strict();

export type IntegrationType = z.infer<typeof integrationTypeSchema>;
export type IntegrationConnectionInput = z.infer<typeof integrationConnectionSchema>;
export type IntegrationExecutionInput = z.infer<typeof integrationExecutionSchema>;
