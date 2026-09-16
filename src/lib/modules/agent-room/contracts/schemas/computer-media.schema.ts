import { z } from '@beeblock/svelar/validation';

export const computerMediaSendSchema = z.object({
  command: z.literal('media_send'),
  targetId: z.string().min(1).max(160),
  grantId: z.string().uuid(),
  path: z.string().min(1).max(2000),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/),
  presentation: z.enum(['auto', 'photo', 'document']).optional(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('incoming'), digest: z.string().regex(/^[a-f0-9]{64}$/), batchId: z.string().uuid().optional() }).strict(),
    z.object({ kind: z.enum(['task', 'automation']), id: z.string().uuid() }).strict(),
  ]),
}).strict();

export const computerMediaResultSchema = z.object({
  kind: z.literal('media'),
  actionId: z.string().uuid(),
  grantId: z.string().uuid(),
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  size: z.number().int().positive(),
  contentType: z.string(),
  status: z.enum(['submitted', 'received']),
  delivery: z.enum(['unconfirmed', 'not_applicable']),
  presentation: z.enum(['photo', 'document']).optional(),
  transcription: z.object({ state: z.enum(['ready', 'unavailable']), trust: z.literal('external'), text: z.string().max(100000).optional() }).optional(),
}).strict();

export const computerMediaReceiveSchema = z.object({
  command: z.literal('media_receive'),
  targetId: z.string().min(1).max(160),
  grantId: z.string().uuid(),
  inReplyToDigest: z.string().regex(/^[a-f0-9]{64}$/),
  downloadId: z.string().regex(/^0(?:\.\d{1,4}){1,24}$/),
  transcribeAudio: z.boolean().optional(),
  path: z.string().min(1).max(2000),
}).strict();

export type ComputerMediaSend = z.infer<typeof computerMediaSendSchema>;
export type ComputerMediaResult = z.infer<typeof computerMediaResultSchema>;
export type ComputerMediaReceive = z.infer<typeof computerMediaReceiveSchema>;
