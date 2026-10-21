import type { Routine } from '$lib/modules/agent-room/domain/types.js';
import { getLocale } from '$lib/paraglide/runtime.js';
import * as m from '$lib/paraglide/messages.js';

const text = m as unknown as Record<string, (input?: Record<string, unknown>) => string>;

/** How often a routine runs, in plain words: "daily · 09:00", "every 2 h", "paused". */
export function routineCadence(routine: Routine): string {
  if (!routine.enabled) return m['chat.routine_paused']();
  const config = routine.triggerConfig ?? {};
  const calendar = config.calendar as { frequency?: string; time?: string } | undefined;
  if (routine.triggerType === 'schedule' && calendar?.frequency) {
    const label = text[`companion.${calendar.frequency}`]?.() ?? calendar.frequency;
    return calendar.time ? `${label} · ${calendar.time}` : label;
  }
  const minutes = Number(routine.intervalMinutes ?? config.intervalMinutes ?? 0);
  if (routine.triggerType === 'schedule' && minutes > 0) {
    if (minutes % 1440 === 0) return m['chat.routine_every_days']({ count: minutes / 1440 });
    if (minutes % 60 === 0) return m['chat.routine_every_hours']({ count: minutes / 60 });
    return m['chat.routine_every']({ count: minutes });
  }
  if (routine.triggerType === 'agent_idle') return m['automation.idle_for']({ minutes: Number(config.minutes ?? 0) });
  if (routine.triggerType === 'agent_output') return m['automation.output_has']({ text: String(config.contains ?? '') });
  if (routine.triggerType === 'manual') return m['chat.routine_manual']();
  return m['chat.routine_on_event']();
}

/** When it runs next, for scheduled routines that are on. */
export function routineNextRun(routine: Routine): string | null {
  if (!routine.enabled || !routine.nextRunAt) return null;
  const date = new Date(routine.nextRunAt);
  if (!Number.isFinite(date.getTime())) return null;
  const sameDay = date.toDateString() === new Date().toDateString();
  const when = new Intl.DateTimeFormat(getLocale(), sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  return m['chat.routine_next']({ when });
}
