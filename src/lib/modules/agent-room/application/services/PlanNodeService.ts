import { uuidv7 } from '@beeblock/svelar/support';
import type { CalendarEvent, CanvasNode, ChecklistItem } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import {
  MAX_CALENDAR_EVENTS,
  MAX_CHECKLIST_ITEMS,
  type CalendarOperation,
  type ChecklistOperation,
} from '../../contracts/schemas/planNodeSchemas.js';

const DEFAULT_EVENT_COLOR = '#e8b84a';

export type ChecklistView = { nodeId: string; title: string; items: ChecklistItem[] };
export type CalendarView = { nodeId: string; title: string; events: CalendarEvent[] };

function storedItems(payload: unknown): ChecklistItem[] {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is ChecklistItem => Boolean(item) && typeof item === 'object'
    && typeof (item as ChecklistItem).id === 'string' && typeof (item as ChecklistItem).text === 'string')
    .map((item) => ({ id: item.id, text: item.text, done: item.done === true }));
}

function storedEvents(payload: unknown): CalendarEvent[] {
  const events = (payload as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) return [];
  return events.filter((event): event is CalendarEvent => Boolean(event) && typeof event === 'object'
    && typeof (event as CalendarEvent).id === 'string' && typeof (event as CalendarEvent).title === 'string'
    && typeof (event as CalendarEvent).date === 'string');
}

function timed(event: CalendarEvent): CalendarEvent {
  // An event without a time lasts the whole day.
  const allDay = event.allDay || !event.time;
  return { ...event, allDay, time: allDay ? null : event.time ?? null };
}

/**
 * Checklists and calendars on the Canvas. Every change is an operation applied
 * to the node's latest content, one at a time per node, so two screens or an
 * agent editing at once never write over each other's items. The screens and
 * the agents' bridge share these operations.
 */
export class PlanNodeService {
  private queues = new Map<string, Promise<unknown>>();

  async checklist(workspaceId: string, ref: string): Promise<ChecklistView> {
    const node = await this.node(workspaceId, ref, 'checklist');
    return { nodeId: node.id, title: node.title ?? '', items: storedItems(node.payload) };
  }

  async calendar(workspaceId: string, ref: string): Promise<CalendarView> {
    const node = await this.node(workspaceId, ref, 'calendar');
    return { nodeId: node.id, title: node.title ?? '', events: this.sorted(storedEvents(node.payload)) };
  }

  async applyChecklist(workspaceId: string, ref: string, operations: ChecklistOperation[]): Promise<ChecklistView> {
    const target = await this.node(workspaceId, ref, 'checklist');
    return this.exclusive(target.id, async () => {
      const node = await this.node(workspaceId, target.id, 'checklist');
      const items = storedItems(node.payload);
      for (const operation of operations) {
        if (operation.op === 'add') {
          const id = operation.id ?? uuidv7();
          if (items.some((item) => item.id === id)) continue;
          if (items.length >= MAX_CHECKLIST_ITEMS) throw new Error(`Um checklist guarda até ${MAX_CHECKLIST_ITEMS} itens.`);
          items.push({ id, text: operation.text, done: operation.done ?? false });
          continue;
        }
        const index = items.findIndex((item) => item.id === operation.itemId);
        if (operation.op === 'remove') {
          if (index >= 0) items.splice(index, 1);
          continue;
        }
        if (index < 0) throw new Error(`O item ${operation.itemId} não existe mais neste checklist.`);
        items[index] = operation.op === 'set' ? { ...items[index], done: operation.done } : { ...items[index], text: operation.text };
      }
      await this.write(node, { ...(node.payload as Record<string, unknown>), items });
      return { nodeId: node.id, title: node.title ?? '', items };
    });
  }

  async applyCalendar(workspaceId: string, ref: string, operations: CalendarOperation[]): Promise<CalendarView> {
    const target = await this.node(workspaceId, ref, 'calendar');
    return this.exclusive(target.id, async () => {
      const node = await this.node(workspaceId, target.id, 'calendar');
      const events = storedEvents(node.payload);
      for (const operation of operations) {
        if (operation.op === 'add') {
          const id = operation.id ?? uuidv7();
          if (events.some((event) => event.id === id)) continue;
          if (events.length >= MAX_CALENDAR_EVENTS) throw new Error(`Um calendário guarda até ${MAX_CALENDAR_EVENTS} eventos.`);
          events.push(timed({
            id,
            title: operation.title,
            date: operation.date,
            allDay: operation.allDay ?? !operation.time,
            time: operation.time ?? null,
            color: operation.color ?? DEFAULT_EVENT_COLOR,
            notes: operation.notes || null,
          }));
          continue;
        }
        const index = events.findIndex((event) => event.id === operation.eventId);
        if (operation.op === 'remove') {
          if (index >= 0) events.splice(index, 1);
          continue;
        }
        if (index < 0) throw new Error(`O evento ${operation.eventId} não existe mais neste calendário.`);
        const current = events[index];
        events[index] = timed({
          ...current,
          ...(operation.title !== undefined ? { title: operation.title } : {}),
          ...(operation.date !== undefined ? { date: operation.date } : {}),
          ...(operation.allDay !== undefined ? { allDay: operation.allDay } : {}),
          ...(operation.time !== undefined ? { time: operation.time, ...(operation.time && operation.allDay === undefined ? { allDay: false } : {}) } : {}),
          ...(operation.color !== undefined ? { color: operation.color ?? DEFAULT_EVENT_COLOR } : {}),
          ...(operation.notes !== undefined ? { notes: operation.notes || null } : {}),
        });
      }
      await this.write(node, { ...(node.payload as Record<string, unknown>), events });
      return { nodeId: node.id, title: node.title ?? '', events: this.sorted(events) };
    });
  }

  private sorted(events: CalendarEvent[]): CalendarEvent[] {
    return [...events].sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
  }

  /** A node of this workspace by id, or by its exact title when only one has it. */
  private async node(workspaceId: string, ref: string, type: 'checklist' | 'calendar'): Promise<CanvasNode> {
    const label = type === 'checklist' ? 'checklist' : 'calendário';
    const byId = await workspaceRepository.getNode(ref);
    if (byId) {
      if (byId.workspaceId !== workspaceId || byId.type !== type) throw new Error(`Esse nó não é um ${label} deste workspace.`);
      return byId;
    }
    const wanted = ref.trim().toLowerCase();
    const matches = (await workspaceRepository.listNodes(workspaceId, undefined, false, true))
      .filter((node) => node.type === type && (node.title ?? '').trim().toLowerCase() === wanted);
    if (matches.length > 1) throw new Error(`Há ${matches.length} nós chamados "${ref}"; use o id do nó.`);
    if (!matches[0]) throw new Error(`Nenhum ${label} "${ref}" neste workspace.`);
    return matches[0];
  }

  private async write(node: CanvasNode, payload: Record<string, unknown>): Promise<void> {
    const updated = await workspaceRepository.updateNode(node.id, { payload: payload as never });
    if (!updated) throw new Error('O nó foi removido.');
    // Other screens on this workspace reload it; one discrete change, never a drag.
    (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId: node.workspaceId });
  }

  private exclusive<T>(nodeId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(nodeId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.catch(() => undefined);
    this.queues.set(nodeId, tail);
    void tail.then(() => { if (this.queues.get(nodeId) === tail) this.queues.delete(nodeId); });
    return run;
  }
}

const globalRef = globalThis as unknown as { __orkestraiPlanNodes?: PlanNodeService };
export const planNodeService = (globalRef.__orkestraiPlanNodes ??= new PlanNodeService());
