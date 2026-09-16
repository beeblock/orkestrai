import { z } from '@beeblock/svelar/validation';
import { parseDate } from '@internationalized/date';

export const calendarScheduleSchema = z.object({
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly']),
  timeZone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; } catch { return false; } }, 'Use a valid IANA timezone.'),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  date: z.string().refine(value => { try { parseDate(value); return true; } catch { return false; } }, 'Use YYYY-MM-DD.').optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  missed: z.enum(['skip', 'latest']).default('skip'),
  maxLatenessMinutes: z.number().int().min(1).max(10080).default(60),
}).strict().superRefine((value, ctx) => {
  if (value.frequency === 'once' && !value.date) ctx.addIssue({ code: 'custom', path: ['date'], message: 'Date is required.' });
  if (value.frequency === 'weekly' && !value.weekdays?.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Choose weekdays.' });
  if (value.frequency === 'monthly' && !value.dayOfMonth) ctx.addIssue({ code: 'custom', path: ['dayOfMonth'], message: 'Choose a day of month.' });
  if (value.weekdays && new Set(value.weekdays).size !== value.weekdays.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Weekdays must be unique.' });
});
export type CalendarSchedule = z.infer<typeof calendarScheduleSchema>;
