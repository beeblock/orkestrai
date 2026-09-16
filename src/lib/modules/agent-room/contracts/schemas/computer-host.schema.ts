import { z } from '@beeblock/svelar/validation';
import { computerInteractionSchema } from './computer.schema.js';
import { computerReplyGrantSchema } from './computer-reply.schema.js';

const target = z.string().regex(/^[1-9]\d{0,9}:cg:[1-9]\d{0,9}$/);
const appId = z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const binding = z.object({ targetId: target, appId }).strict();
const key = z.string().min(1).max(32).regex(/^[A-Za-z0-9_+\-]+$/);

// Private server-to-Electron contract, never a generic Cua tool passthrough.
export const computerHostRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('snapshot'), targetId: target.optional() }).strict(),
  z.object({ operation: z.literal('read'), targetId: target, appId }).strict(),
  z.object({ operation: z.literal('open_conversation'), targetId: target, appId, identity: computerReplyGrantSchema.pick({ recipient: true, composer: true, send: true }) }).strict(),
  z.object({ operation: z.literal('interact'), input: computerInteractionSchema, appId, background: z.boolean() }).strict(),
  z.object({ operation: z.literal('launch'), appId }).strict(),
  z.object({ operation: z.literal('focus'), targetId: target }).strict(),
  z.object({ operation: z.literal('type'), text: z.string().max(20_000), binding: binding.optional() }).strict(),
  z.object({ operation: z.literal('shortcut'), keys: z.array(key).min(1).max(8), binding: binding.optional() }).strict(),
  z.object({ operation: z.literal('click'), x: z.number().finite(), y: z.number().finite(), button: z.enum(['left', 'right', 'middle']), count: z.number().int().min(1).max(3), binding: binding.optional() }).strict(),
  z.object({ operation: z.literal('capture'), target: z.enum(['window', 'display', 'all']), targetId: z.string().min(1).max(160).optional() }).strict(),
  z.object({ operation: z.literal('settings'), permission: z.enum(['accessibility', 'screenRecording']) }).strict(),
]);

export type ComputerHostRequest = z.infer<typeof computerHostRequestSchema>;

export const computerHostImageSchema = z.object({
  base64: z.string().min(1).max(40_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  width: z.number().int().positive().max(32_768), height: z.number().int().positive().max(32_768),
}).strict();

export function computerHostMutation(request: ComputerHostRequest): boolean {
  return !['snapshot', 'read', 'capture', 'settings'].includes(request.operation);
}
