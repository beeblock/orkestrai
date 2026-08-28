import { FormRequest } from '@beeblock/svelar/forms';
import {
  addImageWorkflowReferenceSchema,
  bridgeRunImageWorkflowSchema,
  completeImageWorkflowSchema,
  connectImageWorkflowNodeSchema,
  createImageWorkflowSchema,
  failImageWorkflowSchema,
  imageWorkflowActorSchema,
  runImageWorkflowSchema,
  updateImageWorkflowSchema,
  validateImageWorkflowOutputSchema,
  type AddImageWorkflowReferenceInput,
  type BridgeRunImageWorkflowInput,
  type CompleteImageWorkflowInput,
  type ConnectImageWorkflowNodeInput,
  type CreateImageWorkflowInput,
  type FailImageWorkflowInput,
  type ImageWorkflowActorInput,
  type RunImageWorkflowInput,
  type UpdateImageWorkflowInput,
  type ValidateImageWorkflowOutputInput,
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

export class CreateImageWorkflowRequest extends FormRequest {
  rules() { return createImageWorkflowSchema; }
  passedValidation(data: unknown): CreateImageWorkflowInput { return createImageWorkflowSchema.parse(data); }
}

export class UpdateImageWorkflowRequest extends FormRequest {
  rules() { return updateImageWorkflowSchema; }
  passedValidation(data: unknown): UpdateImageWorkflowInput { return updateImageWorkflowSchema.parse(data); }
}

export class ConnectImageWorkflowNodeRequest extends FormRequest {
  rules() { return connectImageWorkflowNodeSchema; }
  passedValidation(data: unknown): ConnectImageWorkflowNodeInput { return connectImageWorkflowNodeSchema.parse(data); }
}

export class AddImageWorkflowReferenceRequest extends FormRequest {
  rules() { return addImageWorkflowReferenceSchema; }
  passedValidation(data: unknown): AddImageWorkflowReferenceInput { return addImageWorkflowReferenceSchema.parse(data); }
}

export class ImageWorkflowActorRequest extends FormRequest {
  rules() { return imageWorkflowActorSchema; }
  passedValidation(data: unknown): ImageWorkflowActorInput { return imageWorkflowActorSchema.parse(data); }
}

export class CompleteImageWorkflowRequest extends FormRequest {
  rules() { return completeImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): CompleteImageWorkflowInput { return completeImageWorkflowSchema.parse(data); }
}

export class ValidateImageWorkflowOutputRequest extends FormRequest {
  rules() { return validateImageWorkflowOutputSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): ValidateImageWorkflowOutputInput { return validateImageWorkflowOutputSchema.parse(data); }
}

export class FailImageWorkflowRequest extends FormRequest {
  rules() { return failImageWorkflowSchema; }
  authorize(): boolean { return true; }
  passedValidation(data: unknown): FailImageWorkflowInput { return failImageWorkflowSchema.parse(data); }
}
