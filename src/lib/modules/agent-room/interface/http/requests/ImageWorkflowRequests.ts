import { FormRequest } from '@beeblock/svelar/forms';
import {
  bridgeRunImageWorkflowSchema,
  completeImageWorkflowSchema,
  failImageWorkflowSchema,
  runImageWorkflowSchema,
  type BridgeRunImageWorkflowInput,
  type CompleteImageWorkflowInput,
  type FailImageWorkflowInput,
  type RunImageWorkflowInput,
} from '../../../contracts/schemas/imageWorkflowSchemas.js';

export class RunImageWorkflowRequest extends FormRequest {
  rules() { return runImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): RunImageWorkflowInput { return runImageWorkflowSchema.parse(data); }
}

export class BridgeRunImageWorkflowRequest extends FormRequest {
  rules() { return bridgeRunImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): BridgeRunImageWorkflowInput { return bridgeRunImageWorkflowSchema.parse(data); }
}

export class CompleteImageWorkflowRequest extends FormRequest {
  rules() { return completeImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): CompleteImageWorkflowInput { return completeImageWorkflowSchema.parse(data); }
}

export class FailImageWorkflowRequest extends FormRequest {
  rules() { return failImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): FailImageWorkflowInput { return failImageWorkflowSchema.parse(data); }
}
