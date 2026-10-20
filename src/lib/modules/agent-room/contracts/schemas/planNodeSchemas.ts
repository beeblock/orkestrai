import { z } from 'zod';

export const MAX_CHECKLIST_ITEMS = 500;
export const MAX_CALENDAR_EVENTS = 2_000;

const entryId = z.string().trim().min(1).max(80);
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }, 'Data inexistente.');
const calendarTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a hora no formato HH:MM.');
const calendarColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * One change to a checklist, applied to its latest items so concurrent edits
 * never overwrite each other. Fields an operation does not use are dropped.
 */
export const checklistOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), id: z.string().uuid().optional(), text: z.string().trim().min(1).max(400), done: z.boolean().optional() }),
  z.object({ op: z.literal('set'), itemId: entryId, done: z.boolean() }),
  z.object({ op: z.literal('edit'), itemId: entryId, text: z.string().trim().min(1).max(400) }),
  z.object({ op: z.literal('remove'), itemId: entryId }),
]);

/** One change to a calendar, applied to its latest events. */
export const calendarOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('add'),
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    date: calendarDate,
    allDay: z.boolean().optional(),
    time: calendarTime.nullish(),
    color: calendarColor.nullish(),
    notes: z.string().trim().max(4_000).nullish(),
  }),
  z.object({
    op: z.literal('edit'),
    eventId: entryId,
    title: z.string().trim().min(1).max(160).optional(),
    date: calendarDate.optional(),
    allDay: z.boolean().optional(),
    time: calendarTime.nullish(),
    color: calendarColor.nullish(),
    notes: z.string().trim().max(4_000).nullish(),
  }),
  z.object({ op: z.literal('remove'), eventId: entryId }),
]);

// Not strict: Svelar's FormRequest validates the route parameters (id, nodeId) together with the body.
export const checklistOperationsSchema = z.object({ operations: z.array(checklistOperationSchema).min(1).max(50) });
export const calendarOperationsSchema = z.object({ operations: z.array(calendarOperationSchema).min(1).max(50) });

const bridgeIdentity = { token: z.string().trim().min(1).nullish(), from: z.string().trim().min(1).max(120).nullish() };
export const bridgeChecklistOperationsSchema = checklistOperationsSchema.extend(bridgeIdentity);
export const bridgeCalendarOperationsSchema = calendarOperationsSchema.extend(bridgeIdentity);

export type ChecklistOperation = z.infer<typeof checklistOperationSchema>;
export type CalendarOperation = z.infer<typeof calendarOperationSchema>;
export type ChecklistOperationsInput = z.infer<typeof checklistOperationsSchema>;
export type CalendarOperationsInput = z.infer<typeof calendarOperationsSchema>;
