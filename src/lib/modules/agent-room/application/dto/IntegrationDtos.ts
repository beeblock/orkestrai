import type { IntegrationConnectionInput, IntegrationExecutionInput } from '../../contracts/schemas/integration.schema.js';

export class ConnectIntegrationDto {
  constructor(public readonly input: IntegrationConnectionInput) {}
}

export class ExecuteIntegrationDto {
  constructor(public readonly input: IntegrationExecutionInput) {}
}
