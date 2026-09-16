import { fromDate, parseDate, parseTime, toCalendarDate, toCalendarDateTime, toZoned, type CalendarDate } from '@internationalized/date';
import { calendarScheduleSchema, type CalendarSchedule } from '../contracts/schemas/calendar-schedule.schema.js';

function occurrence(schedule: CalendarSchedule, date: CalendarDate): Date | null {
  if (schedule.frequency === 'weekly' && !schedule.weekdays!.includes(date.toDate('UTC').getUTCDay())) return null;
  if (schedule.frequency === 'monthly' && date.day !== schedule.dayOfMonth) return null;
  const local = toCalendarDateTime(date, parseTime(schedule.time));
  // The existing date library resolves repeated wall-clock times to the first
  // occurrence. Skip a nonexistent DST time rather than silently changing it.
  const zoned = toZoned(local, schedule.timeZone, 'earlier');
  if (zoned.hour !== local.hour || zoned.minute !== local.minute || zoned.day !== local.day) return null;
  return zoned.toDate();
}

export function calendarOccurrence(schedule: CalendarSchedule, now: Date, direction: 'next' | 'previous'): Date | null {
  if (schedule.frequency === 'once') {
    const result = occurrence(schedule, parseDate(schedule.date!));
    return result && (direction === 'next' ? result > now : result <= now) ? result : null;
  }
  const today = toCalendarDate(fromDate(now, schedule.timeZone));
  // Daily/weekly/monthly schedules need at most two months, including skipped 31sts.
  for (let offset = 0; offset <= 62; offset++) {
    const date = today.add({ days: direction === 'next' ? offset : -offset });
    const result = occurrence(schedule, date);
    if (result && (direction === 'next' ? result > now : result <= now)) return result;
  }
  return null;
}

export function calendarDue(config: Record<string, unknown>, createdAt: string, now = new Date()): Date | null {
  const parsed = calendarScheduleSchema.safeParse(config.calendar);
  if (!parsed.success) return null;
  const due = calendarOccurrence(parsed.data, now, 'previous');
  const boundary = new Date(String(config.calendarChangedAt ?? createdAt));
  if (!due || !Number.isFinite(boundary.getTime()) || due < boundary) return null;
  const grace = parsed.data.missed === 'latest' ? parsed.data.maxLatenessMinutes * 60_000 : 60_000;
  return now.getTime() - due.getTime() <= grace ? due : null;
}
