import { z } from '@beeblock/svelar/validation';
import { EMBEDDED_TTS_VOICES } from '../../domain/voice.js';

export const companionProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  persona: z.string().trim().min(1).max(4000),
  locale: z.enum(['pt-BR', 'en', 'es']).default('pt-BR'),
  voice: z.string().refine(value => EMBEDDED_TTS_VOICES.some(voice => voice.id === value), 'Unknown local voice.').default('pt-BR-f1'),
  speed: z.number().min(0.75).max(1.5).default(1),
  noEmDash: z.boolean().default(true),
  hideOperationalDetails: z.boolean().default(true),
  execution: z.enum(['agent', 'restricted']).default('agent'),
}).strict();

const control = z.object({
  id: z.string().regex(/^0(?:\.\d{1,4}){1,24}$/),
  role: z.string().min(1).max(120),
  name: z.string().min(1).max(2000),
}).strict();

export const computerMediaContentTypes = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'audio/wav', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'text/plain', 'application/json'] as const;

export const computerMediaGrantSchema = z.object({
  enabled: z.boolean().default(false),
  open: control,
  menu: control.optional(),
  send: control,
  photo: z.object({ open: control, menu: control.optional(), send: control }).strict().optional(),
  maxMiB: z.number().int().min(1).max(50).default(20),
  contentTypes: z.array(z.enum(computerMediaContentTypes)).min(1).max(computerMediaContentTypes.length),
  receive: z.object({
    enabled: z.boolean().default(false),
    download: control,
    menu: control.optional(),
    incomingMarkers: z.array(z.string().min(1).max(500)).max(8).default([]),
  }).strict().optional(),
}).strict();

export const computerReplyGrantSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
  nodeId: z.string().uuid(),
  agentId: z.string().uuid(),
  taskId: z.string().uuid(),
  applicationId: z.string().min(1).max(255),
  recipient: control,
  composer: control,
  send: control,
  incomingMarker: z.string().min(1).max(500),
  maxCharacters: z.number().int().min(1).max(4000).default(2000),
  maxPerHour: z.number().int().min(1).max(120).default(60),
  memoryEnabled: z.boolean().default(false),
  memoryRetentionDays: z.number().int().min(30).max(3650).default(365),
  allowProactive: z.boolean().default(false),
  allowForegroundSend: z.boolean().default(false),
  allowConversationNavigation: z.boolean().default(false),
  companion: companionProfileSchema.optional(),
  media: computerMediaGrantSchema.optional(),
}).strict();

export type ComputerReplyGrant = z.infer<typeof computerReplyGrantSchema>;
