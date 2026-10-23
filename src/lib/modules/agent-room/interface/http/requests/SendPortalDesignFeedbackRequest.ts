import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod/v3';
import { PortalDesignFeedbackDto } from '$lib/modules/agent-room/application/dto/PortalDesignFeedbackDto.js';
import { sendPortalDesignFeedbackSchema } from '$lib/modules/agent-room/contracts/schemas/portal-design-feedback.schema.js';

const sendPortalDesignFeedbackRequestSchema = sendPortalDesignFeedbackSchema.extend({
  id: z.string().uuid(),
  nodeId: z.string().uuid(),
}).strict();

export class SendPortalDesignFeedbackRequest extends FormRequest {
  rules() {
    return sendPortalDesignFeedbackRequestSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): PortalDesignFeedbackDto {
    const { id: _workspaceId, nodeId: _portalNodeId, ...input } = sendPortalDesignFeedbackRequestSchema.parse(data);
    return PortalDesignFeedbackDto.fromInput(sendPortalDesignFeedbackSchema.parse(input));
  }
}
