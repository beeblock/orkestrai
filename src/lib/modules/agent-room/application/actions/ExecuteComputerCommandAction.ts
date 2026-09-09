import { Action } from '@beeblock/svelar/actions';
import type { ComputerCommandResult } from '../../contracts/schemas/computer.schema.js';
import type { ExecuteComputerCommandDto } from '../dto/ExecuteComputerCommandDto.js';
import { computerService, type ComputerExecutionContext } from '../services/ComputerService.js';

type ExecuteComputerCommandActionInput = { workspaceId: string; dto: ExecuteComputerCommandDto; context: ComputerExecutionContext };

export class ExecuteComputerCommandAction extends Action<ExecuteComputerCommandActionInput, ComputerCommandResult> {
  async execute(input: ExecuteComputerCommandActionInput): Promise<ComputerCommandResult> {
    return computerService.execute(input.workspaceId, input.dto.command, input.context);
  }
}
