import { z } from '@beeblock/svelar/validation';

const scope = { grantId: z.string().uuid() };
export const conversationMemorySearchSchema = z.object({
  command: z.literal('memory_search'), ...scope,
  query: z.string().trim().max(500).default(''),
  after: z.string().datetime().optional(), before: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const conversationMemorySaveSchema = z.object({
  command: z.literal('memory_save'), ...scope,
  id: z.string().uuid().optional(), revision: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(160), content: z.string().trim().min(1).max(4000),
  sourceDigests: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1).max(8),
}).strict();
export const conversationMemoryForgetSchema = z.object({
  command: z.literal('memory_forget'), ...scope, id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(), all: z.boolean().default(false),
}).strict();
export type ConversationMemoryInput = z.infer<typeof conversationMemorySearchSchema> | z.infer<typeof conversationMemorySaveSchema> | z.infer<typeof conversationMemoryForgetSchema>;
export const conversationMemorySourceSchema = z.object({ digest: z.string().regex(/^[a-f0-9]{64}$/), excerpt: z.string().max(4000), observedAt: z.string().datetime() });
export const conversationMemoryFactSchema = z.object({ id: z.string().uuid(), title: z.string().max(160), content: z.string().max(4000), sources: z.array(conversationMemorySourceSchema).max(8), revision: z.number().int().positive(), updatedAt: z.string().datetime() });
export const conversationMemoryMessageSchema = z.object({ id: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), direction: z.enum(['incoming', 'outgoing']), content: z.string().max(40000), observedAt: z.string().datetime() });
export const conversationMemoryResultSchema = z.object({ kind: z.literal('conversation_memory'), enabled: z.boolean(), retentionDays: z.number().int(), facts: z.array(conversationMemoryFactSchema).max(50), messages: z.array(conversationMemoryMessageSchema).max(50), totalFacts: z.number().int(), totalMessages: z.number().int(), forgotten: z.boolean().optional() });
export type ConversationMemorySource = z.infer<typeof conversationMemorySourceSchema>;
export type ConversationMemoryFact = z.infer<typeof conversationMemoryFactSchema>;
export type ConversationMemoryMessage = z.infer<typeof conversationMemoryMessageSchema>;
export type ConversationMemoryResult = z.infer<typeof conversationMemoryResultSchema>;
