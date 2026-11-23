import { botWorkflowSchema } from './bot-workflow.schema.js';
import type { AgentUsageBlock } from './agent-runtime.schema.js';
import { z } from 'zod/v3';
import { workspaceAttachmentSchema, MAX_WORKSPACE_ATTACHMENTS } from './workspaceAttachmentSchemas.js';
import { createChannelBindingSchema, updateChannelBindingSchema } from './channel.schema.js';
import { botSafetySchema, type BotSafetySettings } from './bot-safety.schema.js';
import { botPresetIds, botPresetLocales } from '../../domain/bot-preset-types.js';

export const personalBotSettingsSchema = z.object({
  title: z.string().trim().min(1).max(48),
  instructions: z.string().trim().min(1).max(24_000),
  /** Explicitly public purpose; never inferred from existing private instructions. */
  publicRole: z.string().trim().min(1).max(6_000).optional(),
  workflow: botWorkflowSchema.nullable().optional(),
  provider: z.string().trim().min(1).max(60),
  model: z.string().trim().max(160).nullable().default(null),
  effort: z.string().trim().max(24).nullable().default(null),
  profileId: z.string().uuid().nullable().default(null),
  transport: z.enum(['terminal', 'structured']).default('structured'),
}).strict();

/** Editable composition fields share the same bounds in the creation UI. */
export const personalBotEditorSchema = personalBotSettingsSchema.extend({
  personality: z.string().trim().max(1_200).default(''),
  rules: z.string().trim().max(1_600).default(''),
});

const personalBotCreationSettingsSchema = personalBotSettingsSchema.extend({
  instructions: personalBotSettingsSchema.shape.instructions.optional(),
  presetId: z.enum(botPresetIds).optional(),
  presetLocale: z.enum(botPresetLocales).default('en'),
}).superRefine((settings, context) => {
  if (!settings.instructions && !settings.presetId) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'Choose a preset or provide instructions.', path: ['instructions'] });
});

export const botGroupSettingsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().max(12_000).default(''),
  memberIds: z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length),
  coordinatorId: z.string().uuid(),
}).strict().refine(value => value.memberIds.includes(value.coordinatorId), { message: 'The coordinator must be a group member.', path: ['coordinatorId'] });

export const personalBotCommandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('workflow_cancel'), nodeId: z.string().uuid(), sourceId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('history_delete'), channel: z.string().regex(/^(?:dm|botgroup):[a-f0-9-]{36}$/i), messageId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('history_clear'), channel: z.string().regex(/^(?:dm|botgroup):[a-f0-9-]{36}$/i), throughMessageId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('create'), settings: personalBotCreationSettingsSchema }).strict(),
  z.object({ command: z.literal('preset_list'), locale: z.enum(botPresetLocales).default('en') }).strict(),
  z.object({ command: z.literal('update'), nodeId: z.string().uuid(), settings: personalBotSettingsSchema.omit({ publicRole: true }) }).strict(),
  z.object({ command: z.literal('remove'), nodeId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('repair_artifact_delivery'), nodeId: z.string().uuid(), messageId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('owner_senders'), nodeId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('safety_options'), nodeId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('safety_update'), nodeId: z.string().uuid(), revision: z.number().int().min(0), settings: botSafetySchema }).strict(),
  z.object({ command: z.literal('group_create'), settings: botGroupSettingsSchema }).strict(),
  z.object({ command: z.literal('group_update'), groupId: z.string().uuid(), revision: z.number().int().min(1), settings: botGroupSettingsSchema }).strict(),
  z.object({ command: z.literal('group_archive'), groupId: z.string().uuid(), revision: z.number().int().min(1) }).strict(),
  z.object({ command: z.literal('group_send'), groupId: z.string().uuid(), body: z.string().trim().min(1).max(8_000), attachments: z.array(workspaceAttachmentSchema).max(MAX_WORKSPACE_ATTACHMENTS).default([]) }).strict(),
  z.object({ command: z.literal('group_post'), groupId: z.string().uuid(), body: z.string().trim().min(1).max(8_000) }).strict(),
  z.object({ command: z.literal('connect'), binding: createChannelBindingSchema }).strict(),
  z.object({ command: z.literal('channel_targets'), nodeId: z.string().uuid(), integrationId: z.string().uuid() }).strict(),
  updateChannelBindingSchema.extend({ command: z.literal('set_binding'), bindingId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('disconnect'), bindingId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('slack_manifest') }).strict(),
  z.object({ command: z.literal('whatsapp_start'), name: z.string().trim().min(1).max(120) }).strict(),
  z.object({ command: z.literal('whatsapp_reconnect'), connectionId: z.string().uuid() }).strict(),
  z.object({ command: z.literal('whatsapp_disconnect'), connectionId: z.string().uuid() }).strict(),
]);

export type PersonalBotCommand = z.infer<typeof personalBotCommandSchema>;
export type PersonalBotSettings = z.infer<typeof personalBotSettingsSchema>;
export type BotGroupSettings = z.infer<typeof botGroupSettingsSchema>;
export type PersonalBotSummary = {
  id: string; title: string; provider: string; model: string | null; effort: string | null;
  profileId: string | null; instructions: string; transport: 'terminal' | 'structured'; sessionId: string | null;
  runtimeMode: 'interactive' | 'on_demand' | 'persistent';
  usageBlock?: AgentUsageBlock | null;
  safety: BotSafetySettings; safetyRevision: number; workflow?: import('./bot-workflow.schema.js').BotWorkflow | null;
};
export type PersonalBotGroup = BotGroupSettings & { id: string; workspaceId: string; revision: number; archived: boolean };
