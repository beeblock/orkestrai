import { z } from '@beeblock/svelar/validation';
import { calendarScheduleSchema } from './calendar-schedule.schema.js';

export const agentRoutineDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(20000),
  trigger: z.enum(['manual', 'interval', 'calendar']),
  intervalMinutes: z.number().int().min(1).max(525600).optional(),
  calendar: calendarScheduleSchema.optional(),
  enabled: z.boolean().default(true),
}).strict().superRefine((v, ctx) => {
  if (v.trigger === 'interval' && !v.intervalMinutes) ctx.addIssue({ code: 'custom', path: ['intervalMinutes'], message: 'Interval is required.' });
  if (v.trigger === 'calendar' && !v.calendar) ctx.addIssue({ code: 'custom', path: ['calendar'], message: 'Calendar schedule is required.' });
});

export const bridgeAutomationCommandSchema = z.object({
  from: z.string().trim().min(1).max(120),
  taskId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(160).regex(/^[a-zA-Z0-9._:@/-]+$/),
  input: z.discriminatedUnion('command', [
    z.object({ command: z.literal('list') }).strict(),
    z.object({ command: z.literal('history'), id: z.string().uuid() }).strict(),
    z.object({ command: z.literal('save'), definition: agentRoutineDefinitionSchema, id: z.string().uuid().optional(), revision: z.number().int().positive().optional() }).strict(),
    z.object({ command: z.literal('enabled'), id: z.string().uuid(), revision: z.number().int().positive(), enabled: z.boolean() }).strict(),
    z.object({ command: z.literal('cancel'), id: z.string().uuid(), revision: z.number().int().positive() }).strict(),
  ]),
}).strict();
export type BridgeAutomationInput = z.infer<typeof bridgeAutomationCommandSchema>;
