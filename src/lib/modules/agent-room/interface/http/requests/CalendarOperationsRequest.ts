import { FormRequest } from '@beeblock/svelar/forms';
import { calendarOperationsSchema, type CalendarOperationsInput } from '$lib/modules/agent-room/contracts/schemas/planNodeSchemas.js';

export class CalendarOperationsRequest extends FormRequest {
  rules() {
    return calendarOperationsSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): CalendarOperationsInput {
    return calendarOperationsSchema.parse(data);
  }
}
