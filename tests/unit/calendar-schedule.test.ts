import { describe, expect, it } from 'vitest';
import { calendarScheduleSchema } from '$lib/modules/agent-room/contracts/schemas/calendar-schedule.schema.js';
import { calendarOccurrence, calendarDue } from '$lib/modules/agent-room/domain/calendar-schedule.js';

describe('Calendar triggers on the existing automation runner', () => {
  it('keeps Monday 14:00 and Saturday 04:00 in the requested timezone', () => {
    const monday = calendarScheduleSchema.parse({ frequency: 'weekly', timeZone: 'America/Sao_Paulo', time: '14:00', weekdays: [1] });
    const saturday = calendarScheduleSchema.parse({ ...monday, time: '04:00', weekdays: [6] });
    expect(calendarOccurrence(monday, new Date('2026-09-13T12:00:00Z'), 'next')?.toISOString()).toBe('2026-09-14T17:00:00.000Z');
    expect(calendarOccurrence(saturday, new Date('2026-09-13T12:00:00Z'), 'next')?.toISOString()).toBe('2026-09-19T07:00:00.000Z');
  });
  it('uses one occurrence at a repeated DST hour and skips nonexistent wall-clock hours', () => {
    const fall = calendarScheduleSchema.parse({ frequency: 'daily', timeZone: 'America/New_York', time: '01:30' });
    expect(calendarOccurrence(fall, new Date('2026-11-01T04:00:00Z'), 'next')?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(calendarOccurrence(fall, new Date('2026-11-01T05:31:00Z'), 'next')?.toISOString()).toBe('2026-11-02T06:30:00.000Z');
    const spring = calendarScheduleSchema.parse({ ...fall, time: '02:30' });
    expect(calendarOccurrence(spring, new Date('2026-03-08T05:00:00Z'), 'next')?.toISOString()).toBe('2026-03-09T06:30:00.000Z');
  });
  it('does not turn the 31st into a different date or backfill before creation', () => {
    const calendar = calendarScheduleSchema.parse({ frequency: 'monthly', timeZone: 'UTC', time: '12:00', dayOfMonth: 31, missed: 'latest', maxLatenessMinutes: 10080 });
    expect(calendarOccurrence(calendar, new Date('2026-02-01T00:00:00Z'), 'next')?.toISOString()).toBe('2026-03-31T12:00:00.000Z');
    expect(calendarDue({ calendar }, '2026-02-01T00:00:00Z', new Date('2026-02-02T00:00:00Z'))).toBeNull();
  });
  it('applies explicit skip/latest policy and chooses only the most recent missed occurrence', () => {
    const calendar = calendarScheduleSchema.parse({ frequency: 'daily', timeZone: 'UTC', time: '14:00' });
    const created = '2026-09-01T00:00:00Z';
    expect(calendarDue({ calendar }, created, new Date('2026-09-14T14:00:15Z'))?.toISOString()).toBe('2026-09-14T14:00:00.000Z');
    expect(calendarDue({ calendar }, created, new Date('2026-09-14T14:20:00Z'))).toBeNull();
    expect(calendarDue({ calendar: { ...calendar, missed: 'latest' } }, created, new Date('2026-09-14T14:20:00Z'))?.toISOString()).toBe('2026-09-14T14:00:00.000Z');
    expect(calendarDue({ calendar: { ...calendar, missed: 'latest' } }, created, new Date('2026-09-14T16:00:00Z'))).toBeNull();
    expect(calendarDue({ calendar, calendarChangedAt: '2026-09-14T14:00:10Z' }, created, new Date('2026-09-14T14:00:15Z'))).toBeNull();
  });
  it('validates timezone, date, weekdays and one-time schedules', () => {
    expect(calendarScheduleSchema.safeParse({ frequency: 'weekly', timeZone: 'Fake/Timezone', time: '14:00' }).success).toBe(false);
    expect(calendarScheduleSchema.safeParse({ frequency: 'once', timeZone: 'UTC', time: '14:00', date: '2026-02-30' }).success).toBe(false);
    const once = calendarScheduleSchema.parse({ frequency: 'once', timeZone: 'UTC', time: '14:00', date: '2026-09-14' });
    expect(calendarOccurrence(once, new Date('2026-09-13T00:00:00Z'), 'next')?.toISOString()).toBe('2026-09-14T14:00:00.000Z');
    expect(calendarOccurrence(once, new Date('2026-09-15T00:00:00Z'), 'next')).toBeNull();
  });
});
