import { FormRequest } from '@beeblock/svelar/forms';
import { integrationExecutionSchema } from '../../../contracts/schemas/integration.schema.js';
import { ExecuteIntegrationDto } from '../../../application/dto/IntegrationDtos.js';

export class ExecuteIntegrationRequest extends FormRequest {
  rules() {
    return integrationExecutionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ExecuteIntegrationDto {
    return new ExecuteIntegrationDto(integrationExecutionSchema.parse(data));
  }
}
