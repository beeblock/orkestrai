import { z } from 'zod/v3';
import { workspaceAttachmentSchema, MAX_WORKSPACE_ATTACHMENTS } from './workspaceAttachmentSchemas.js';
import { createChannelBindingSchema } from './channel.schema.js';

export const personalBotSettingsSchema = z.object({
  title: z.string().trim().min(1).max(48),
  instructions: z.string().trim().min(1).max(24_000),
  provider: z.string().trim().min(1).max(60),
  model: z.string().trim().max(160).nullable().default(null),
  effort: z.string().trim().max(24).nullable().default(null),
  profileId: z.string().uuid().nullable().default(null),
  transport: z.enum(['terminal', 'structured']).default('structured'),
}).strict();

export const botGroupSettingsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(12_000).default(''),
  memberIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  coordinatorId: z.string().uuid(),
}).strict().refine(value => value.memberIds.includes(value.coordinatorId), { message: 'The coordinator must be a group member.', path: ['coordinatorId'] });

export const personalBotCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('create'), settings: personalBotSettingsSchema }).strict(),
  z.object({ command: z.literal('update'), nodeId: z.string().uuid(), settings: personalBotSettingsSchema }).strict(),
  z.object({ command: z.literal('remove'), nodeId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('group_create'), settings: botGroupSettingsSchema }).strict(),
  z.object({ command: z.literal('group_update'), groupId: z.string().uuid(), revision: z.number().int().min(1), settings: botGroupSettingsSchema }).strict(),
  z.object({ command: z.literal('group_archive'), groupId: z.string().uuid(), revision: z.number().int().min(1) }).strict(),
  z.object({ command: z.literal('group_send'), groupId: z.string().uuid(), body: z.string().trim().min(1).max(8_000), attachments: z.array(workspaceAttachmentSchema).max(MAX_WORKSPACE_ATTACHMENTS).default([]) }).strict(),
  z.object({ command: z.literal('group_post'), groupId: z.string().uuid(), body: z.string().trim().min(1).max(8_000) }).strict(),
  z.object({ command: z.literal('connect'), binding: createChannelBindingSchema }).strict(),
  z.object({ command: z.literal('set_binding'), bindingId: z.string().uuid(), enabled: z.boolean() }).strict(),
  z.object({ command: z.literal('disconnect'), bindingId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('whatsapp_start'), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ command: z.literal('whatsapp_disconnect'), connectionId: z.string().uuid() }).strict(),
]);

export type PersonalBotCommand = z.infer<typeof personalBotCommandSchema>;
export type PersonalBotSettings = z.infer<typeof personalBotSettingsSchema>;
export type BotGroupSettings = z.infer<typeof botGroupSettingsSchema>;
export type PersonalBotSummary = {
  id: string; title: string; provider: string; model: string | null; effort: string | null;
  profileId: string | null; instructions: string; transport: 'terminal' | 'structured'; sessionId: string | null;
  runtimeMode: 'interactive' | 'on_demand' | 'persistent';
};
export type PersonalBotGroup = BotGroupSettings & { id: string; workspaceId: string; revision: number; archived: boolean };
