import { FormRequest } from '@beeblock/svelar/forms';
import { integrationConnectionSchema } from '../../../contracts/schemas/integration.schema.js';
import { ConnectIntegrationDto } from '../../../application/dto/IntegrationDtos.js';

export class ConnectIntegrationRequest extends FormRequest {
  rules() {
    return integrationConnectionSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ConnectIntegrationDto {
    return new ConnectIntegrationDto(integrationConnectionSchema.parse(data));
  }
}
