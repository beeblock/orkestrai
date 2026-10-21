import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { planNodeService } from '../../../application/services/PlanNodeService.js';
import { CalendarOperationsRequest } from '../requests/CalendarOperationsRequest.js';
import { ChecklistOperationsRequest } from '../requests/ChecklistOperationsRequest.js';

/** Checklist and calendar nodes, changed one operation at a time. */
export class PlanNodeController extends Controller {
  async checklist(event: RequestEvent) {
    try {
      return this.json({ data: await planNodeService.checklist(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.failure(error, 'Could not read the checklist.');
    }
  }

  async updateChecklist(event: RequestEvent) {
    try {
      const input = await ChecklistOperationsRequest.validate(event);
      return this.json({ data: await planNodeService.applyChecklist(event.params.id, event.params.nodeId, input.operations) });
    } catch (error) {
      return this.failure(error, 'Could not change the checklist.');
    }
  }

  async calendar(event: RequestEvent) {
    try {
      return this.json({ data: await planNodeService.calendar(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.failure(error, 'Could not read the calendar.');
    }
  }

  async updateCalendar(event: RequestEvent) {
    try {
      const input = await CalendarOperationsRequest.validate(event);
      return this.json({ data: await planNodeService.applyCalendar(event.params.id, event.params.nodeId, input.operations) });
    } catch (error) {
      return this.failure(error, 'Could not change the calendar.');
    }
  }

  private failure(error: unknown, fallback: string) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, 400);
  }
}
