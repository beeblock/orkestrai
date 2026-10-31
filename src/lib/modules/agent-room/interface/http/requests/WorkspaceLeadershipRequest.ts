import { FormRequest } from '@beeblock/svelar/forms';
import { leadershipCommandSchema } from '../../../contracts/schemas/leadership.schema.js';

export class WorkspaceLeadershipRequest extends FormRequest {
  rules() {
    return leadershipCommandSchema;
  }

  authorize(event: any): boolean {
    return true;
  }

}
