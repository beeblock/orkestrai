import { z } from 'zod/v3';

const publicField = z.string().trim().min(1).max(160)
  .regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/)
  .refine(value => !value.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part)));

/** Owner-controlled capabilities; never inferred from a customer's message. */
export const botSafetySchema = z.object({
  publicInstructions: z.string().trim().max(6_000).default(''),
  publicKnowledge: z.string().trim().max(24_000).default(''),
  actions: z.array(z.object({
    toolId: z.string().uuid(),
    revision: z.number().int().min(1),
    outputFields: z.array(publicField).min(1).max(30),
    artifactFields: z.array(publicField).max(6).default([]),
  }).strict().refine(action => action.artifactFields.every(field => action.outputFields.includes(field)))).max(20).default([])
    .refine(actions => new Set(actions.map(action => action.toolId)).size === actions.length),
  requestsPerMinute: z.number().int().min(1).max(30).default(6),
  maxActionsPerTurn: z.number().int().min(0).max(20).default(5),
  maxReplyCharacters: z.number().int().min(200).max(8_000).default(4_000),
}).strict();

export type BotSafetySettings = z.infer<typeof botSafetySchema>;
export const defaultBotSafety = (): BotSafetySettings => botSafetySchema.parse({});
