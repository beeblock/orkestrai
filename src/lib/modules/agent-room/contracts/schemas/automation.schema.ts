import { z } from 'zod';

export const automationTriggerTypeSchema = z.enum([
  'manual', 'schedule', 'task', 'message', 'git_commit', 'github_pull_request',
  'webhook', 'file_change', 'usage_threshold',
]);

export const automationActionTypeSchema = z.enum(['prompt_agent', 'create_task', 'notify', 'browser', 'integration']);

export const automationFormSchema = z.object({
  name: z.string().trim().min(1).max(120),
  triggerType: automationTriggerTypeSchema,
  intervalMinutes: z.coerce.number().int().min(1).max(525_600).nullish(),
  taskEvent: z.enum(['created', 'updated', 'status_changed', 'completed']).nullish(),
  taskStatus: z.string().trim().max(80).nullish(),
  messageContains: z.string().trim().max(500).nullish(),
  gitBranch: z.string().trim().max(255).nullish(),
  githubEvent: z.enum(['opened', 'updated', 'merged', 'closed']).nullish(),
  webhookSecret: z.string().trim().min(16).max(500).nullish(),
  filePath: z.string().trim().max(2000).nullish(),
  usageProvider: z.enum(['claude', 'codex', 'kimi']).nullish(),
  usageWindow: z.enum(['5h', 'weekly', 'monthly']).nullish(),
  usagePercent: z.coerce.number().int().min(1).max(100).nullish(),
  actionType: automationActionTypeSchema,
  targetNodeId: z.string().trim().nullish(),
  prompt: z.string().trim().max(50_000).nullish(),
  taskTitle: z.string().trim().max(180).nullish(),
  taskDescription: z.string().trim().max(20_000).nullish(),
  notificationTitle: z.string().trim().max(180).nullish(),
  notificationMessage: z.string().trim().max(2_000).nullish(),
  portalNodeId: z.string().trim().nullish(),
  portalAction: z.enum(['navigate', 'snapshot', 'click', 'type', 'wait', 'extract', 'screenshot']).nullish(),
  portalUrl: z.string().trim().max(4_096).nullish(),
  portalRef: z.string().trim().regex(/^e\d{1,6}$/).nullish(),
  portalText: z.string().max(100_000).nullish(),
  portalSubmit: z.boolean().default(false),
  integrationId: z.string().uuid().nullish(),
  integrationAction: z.string().trim().min(1).max(120).nullish(),
  integrationPayload: z.string().max(1_000_000).default('{}'),
  enabled: z.boolean().default(true),
  recipeId: z.string().trim().max(80).nullish(),
}).superRefine((value, context) => {
  if (value.triggerType === 'schedule' && !value.intervalMinutes) {
    context.addIssue({ code: 'custom', path: ['intervalMinutes'], message: 'Interval is required.' });
  }
  if (value.triggerType === 'task' && !value.taskEvent) {
    context.addIssue({ code: 'custom', path: ['taskEvent'], message: 'Task event is required.' });
  }
  if (value.triggerType === 'file_change' && !value.filePath) {
    context.addIssue({ code: 'custom', path: ['filePath'], message: 'File path is required.' });
  }
  if (value.triggerType === 'usage_threshold' && (!value.usageProvider || !value.usageWindow || !value.usagePercent)) {
    context.addIssue({ code: 'custom', path: ['usagePercent'], message: 'Usage threshold is incomplete.' });
  }
  if (value.triggerType === 'github_pull_request' && !value.githubEvent) {
    context.addIssue({ code: 'custom', path: ['githubEvent'], message: 'Pull request event is required.' });
  }
  if (value.triggerType === 'webhook' && !value.webhookSecret) {
    context.addIssue({ code: 'custom', path: ['webhookSecret'], message: 'Webhook secret is required.' });
  }
  if (value.actionType === 'prompt_agent' && (!value.targetNodeId || !value.prompt)) {
    context.addIssue({ code: 'custom', path: ['prompt'], message: 'Target and prompt are required.' });
  }
  if (value.actionType === 'create_task' && !value.taskTitle) {
    context.addIssue({ code: 'custom', path: ['taskTitle'], message: 'Task title is required.' });
  }
  if (value.actionType === 'notify' && !value.notificationMessage) {
    context.addIssue({ code: 'custom', path: ['notificationMessage'], message: 'Notification message is required.' });
  }
  if (value.actionType === 'browser' && (!value.portalNodeId || !value.portalAction)) {
    context.addIssue({ code: 'custom', path: ['portalNodeId'], message: 'Portal and browser action are required.' });
  }
  if (value.actionType === 'browser' && value.portalAction === 'navigate' && !value.portalUrl) {
    context.addIssue({ code: 'custom', path: ['portalUrl'], message: 'Portal URL is required.' });
  }
  if (value.actionType === 'browser' && ['click', 'type'].includes(value.portalAction ?? '') && !value.portalRef) {
    context.addIssue({ code: 'custom', path: ['portalRef'], message: 'A semantic element reference is required.' });
  }
  if (value.actionType === 'integration' && (!value.integrationId || !value.integrationAction)) {
    context.addIssue({ code: 'custom', path: ['integrationId'], message: 'Integration and action are required.' });
  }
  if (value.actionType === 'integration') {
    try {
      const parsed = JSON.parse(value.integrationPayload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    } catch {
      context.addIssue({ code: 'custom', path: ['integrationPayload'], message: 'Integration payload must be a JSON object.' });
    }
  }
});

export const automationEnabledSchema = z.object({ enabled: z.boolean() });
export const githubIntegrationSchema = z.object({
  owner: z.string().trim().min(1).max(100),
  repo: z.string().trim().min(1).max(100),
});

export type AutomationFormInput = z.infer<typeof automationFormSchema>;
