import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';
import { computerCommandSchema } from '../../../contracts/schemas/computer.schema.js';
import { ExecuteComputerCommandDto } from '../../../application/dto/ExecuteComputerCommandDto.js';

export class ComputerCommandRequest extends FormRequest {
  rules() {
    // FormRequest merges route parameters into the body before validation.
    return z.object({ id: z.string().uuid() }).passthrough()
      .transform(({ id: _id, ...command }) => command)
      .pipe(computerCommandSchema);
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): ExecuteComputerCommandDto {
    return ExecuteComputerCommandDto.from(computerCommandSchema.parse(data));
  }
}
