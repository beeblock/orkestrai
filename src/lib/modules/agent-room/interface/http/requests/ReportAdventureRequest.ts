import { FormRequest } from '@beeblock/svelar/forms';
import { adventureReportSchema, type AdventureReportInput } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

export class ReportAdventureRequest extends FormRequest {
  rules() {
    return adventureReportSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): AdventureReportInput {
    return adventureReportSchema.parse(data);
  }
}
