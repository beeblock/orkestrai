import type { BridgeAutomationInput } from '../../contracts/schemas/bridge-automation.schema.js';
export class BridgeAutomationCommandDto {
  constructor(public readonly request: BridgeAutomationInput) {}
}
