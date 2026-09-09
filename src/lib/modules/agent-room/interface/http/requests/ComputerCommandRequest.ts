import { FormRequest } from '@beeblock/svelar/forms';
import { computerCommandSchema } from '../../../contracts/schemas/computer.schema.js';
import { ExecuteComputerCommandDto } from '../../../application/dto/ExecuteComputerCommandDto.js';

export class ComputerCommandRequest extends FormRequest {
  rules() {
    return computerCommandSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ExecuteComputerCommandDto {
    return ExecuteComputerCommandDto.from(computerCommandSchema.parse(data));
  }
}
