import { z } from 'zod/v3';
import { MAX_CHANNEL_BODY, MAX_OPTION_LENGTH, MAX_QUESTION_OPTIONS } from '../../domain/channels.js';
import { MAX_WORKSPACE_ATTACHMENTS, workspaceAttachmentSchema } from './workspaceAttachmentSchemas.js';

export const listChannelMessagesSchema = z.object({
  before: z.string().datetime().nullable().optional(),
  /** The id of the oldest message held, so a page continues past others of the same instant. */
  beforeId: z.string().trim().min(1).max(200).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(80),
  /** `open` lists only the questions of this channel still waiting for the owner. */
  questions: z.enum(['open']).nullable().optional(),
});

export const postChannelMessageSchema = z.object({
  body: z.string().trim().max(MAX_CHANNEL_BODY).default(''),
  replyToId: z.string().uuid().nullable().optional(),
  /** Images, PDFs, files or links already uploaded to the workspace's attachment folder. */
  attachments: z.array(workspaceAttachmentSchema).max(MAX_WORKSPACE_ATTACHMENTS).default([]),
}).refine((input) => input.body.length > 0 || input.attachments.length > 0, { message: 'A mensagem está vazia.', path: ['body'] });

export const bridgeChannelPostSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o agente que está postando.').max(120),
  message: z.string().trim().min(1, 'A mensagem está vazia.').max(MAX_CHANNEL_BODY),
  channel: z.enum(['team', 'owner']).default('owner'),
  /** The Telegram/Slack message this answers; only such a reply goes back to that chat. */
  replyTo: z.string().uuid('Informe o id da mensagem respondida.').nullish(),
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

export const bridgeEscalateQuestionSchema = z.object({
  token: z.string().trim().min(1).nullish(),
  from: z.string().trim().min(1, 'Informe o líder que leva a pergunta.').max(120),
  questionId: z.string().uuid('Informe o id da pergunta.'),
  note: z.string().trim().min(1, 'Explique por que só o dono decide.').max(400),
});

export type ListChannelMessagesInput = z.infer<typeof listChannelMessagesSchema>;
export type PostChannelMessageInput = z.infer<typeof postChannelMessageSchema>;
export type BridgeChannelPostInput = z.infer<typeof bridgeChannelPostSchema>;
export type BridgeAskOwnerInput = z.infer<typeof bridgeAskOwnerSchema>;
export type BridgeCloseQuestionInput = z.infer<typeof bridgeCloseQuestionSchema>;
export type BridgeEscalateQuestionInput = z.infer<typeof bridgeEscalateQuestionSchema>;

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
