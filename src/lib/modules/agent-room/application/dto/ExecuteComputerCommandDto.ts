import type { ComputerCommandInput } from '../../contracts/schemas/computer.schema.js';

export class ExecuteComputerCommandDto {
  constructor(public readonly command: ComputerCommandInput) {}

  static from(input: ComputerCommandInput): ExecuteComputerCommandDto {
    return new ExecuteComputerCommandDto(input);
  }
}
