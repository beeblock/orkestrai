import { z } from 'zod';
import { MAX_CHANNEL_BODY, MAX_OPTION_LENGTH, MAX_QUESTION_OPTIONS } from '../../domain/channels.js';

export const listChannelMessagesSchema = z.object({
  before: z.string().datetime().nullable().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
});

export const postChannelMessageSchema = z.object({
  body: z.string().trim().min(1, 'A mensagem está vazia.').max(MAX_CHANNEL_BODY),
  replyToId: z.string().uuid().nullable().optional(),
});

export const bridgeChannelPostSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente que está postando.').max(120),
  message: z.string().trim().min(1, 'A mensagem está vazia.').max(MAX_CHANNEL_BODY),
  channel: z.enum(['team', 'owner']).default('owner'),
});

export const bridgeAskOwnerSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente que está perguntando.').max(120),
  question: z.string().trim().min(1, 'A pergunta está vazia.').max(MAX_CHANNEL_BODY),
  options: z.array(z.string().max(MAX_OPTION_LENGTH * 4)).max(MAX_QUESTION_OPTIONS * 2).optional(),
  taskId: z.string().uuid().nullish(),
});

export const bridgeCloseQuestionSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente que está fechando a pergunta.').max(120),
  questionId: z.string().uuid('Informe o id da pergunta.'),
  answer: z.string().trim().min(1, 'A resposta está vazia.').max(MAX_CHANNEL_BODY),
});

export type ListChannelMessagesInput = z.infer<typeof listChannelMessagesSchema>;
export type PostChannelMessageInput = z.infer<typeof postChannelMessageSchema>;
export type BridgeChannelPostInput = z.infer<typeof bridgeChannelPostSchema>;
export type BridgeAskOwnerInput = z.infer<typeof bridgeAskOwnerSchema>;
export type BridgeCloseQuestionInput = z.infer<typeof bridgeCloseQuestionSchema>;

export const createChannelBindingSchema = z.object({
  nodeId: z.string().uuid(),
  integrationId: z.string().uuid(),
  externalChatId: z.string().trim().min(1, 'Informe o chat ou canal.').max(120).regex(/^[A-Za-z0-9_@:.-]+$/, 'Use o id do chat ou canal.'),
  allowedSenders: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
});

export const updateChannelBindingSchema = z.object({
  enabled: z.boolean(),
});

export type CreateChannelBindingInput = z.infer<typeof createChannelBindingSchema>;
export type UpdateChannelBindingInput = z.infer<typeof updateChannelBindingSchema>;
