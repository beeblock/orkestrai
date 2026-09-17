import { FormRequest } from '@beeblock/svelar/forms';
import { z } from '@beeblock/svelar/validation';
import { creativePolicySaveSchema, creativeProfileSaveSchema, creativeRunCommandSchema, creativeRunRequestSchema, creativeWorkflowSaveSchema } from '../../../contracts/schemas/creative-media.schema.js';

export class CreativeProfileRequest extends FormRequest { rules() { return creativeProfileSaveSchema; } }
export class CreativePolicyRequest extends FormRequest { rules() { return creativePolicySaveSchema; } }
export class CreativeWorkflowRequest extends FormRequest { rules() { return creativeWorkflowSaveSchema; } }
export class CreativeRunRequest extends FormRequest { rules() { return creativeRunRequestSchema; } }
export class CreativeRunCommandRequest extends FormRequest { rules() { return creativeRunCommandSchema; } }
export const creativeBridgeSchema = z.object({
  command: z.enum(['list', 'read', 'create', 'update', 'preview', 'run', 'cancel', 'retry_download', 'remove']),
  nodeId: z.string().uuid().optional(), runId: z.string().uuid().optional(), taskId: z.string().uuid(), input: z.unknown().optional(),
}).strict();
export class CreativeBridgeRequest extends FormRequest { rules() { return creativeBridgeSchema; } }

// Route identity must never be supplied or overridden by the JSON body.
export function creativeBodyEvent(event: any) {
  const url = new URL(event.url); url.search = '';
  return { ...event, params: {}, url };
}
