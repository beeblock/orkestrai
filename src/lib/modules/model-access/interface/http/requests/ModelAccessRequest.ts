import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';
import { createModelAccessSchema, joinModelAccessSchema, approveModelAccessSchema, reviseModelAccessSchema, modelAccessActionSchema } from '../../../contracts/schemas/model-access.schema.js';
export class CreateModelAccessRequest extends FormRequest { rules() { return createModelAccessSchema; } authorize() { return true; } }
export class JoinModelAccessRequest extends FormRequest { rules() { return joinModelAccessSchema; } authorize() { return true; } }
// Svelar merges route params into the input before validation. Validate id here,
// then remove it so the same strict body contract reaches the service/DTO.
export class ApproveModelAccessRequest extends FormRequest { rules() { return approveModelAccessSchema.extend({id:z.string().uuid()}).transform(({id:_id,...body})=>body); } authorize() { return true; } }
export class ReviseModelAccessRequest extends FormRequest { rules() { return reviseModelAccessSchema.extend({id:z.string().uuid()}).transform(({id:_id,...body})=>body); } authorize() { return true; } }
export class ModelAccessActionRequest extends FormRequest { rules() { return modelAccessActionSchema.extend({id:z.string().uuid()}).transform(({id:_id,...body})=>body); } authorize() { return true; } }
