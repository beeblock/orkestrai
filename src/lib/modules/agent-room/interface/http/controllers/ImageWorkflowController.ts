import { Controller } from '@beeblock/svelar/routing';
import { RunImageWorkflowAction } from '../../../application/actions/RunImageWorkflowAction.js';
import { RunImageWorkflowDto } from '../../../application/dto/ImageWorkflowDtos.js';
import { ImageWorkflowError, imageWorkflowService } from '../../../application/services/ImageWorkflowService.js';
import { RunImageWorkflowRequest } from '../requests/ImageWorkflowRequests.js';

export class ImageWorkflowController extends Controller {
  async status(event: any) {
    try {
      return this.json({ data: await imageWorkflowService.status(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.failure(error);
    }
  }

  async run(event: any) {
    try {
      const input = await RunImageWorkflowRequest.validate(event);
      const actorNodeId = event.locals?.bridge?.nodeId ?? null;
      const result = await new RunImageWorkflowAction().execute(
        RunImageWorkflowDto.from(event.params.id, event.params.nodeId, input, actorNodeId),
      );
      return this.json({ data: result }, 201);
    } catch (error) {
      return this.failure(error);
    }
  }

  async cancel(event: any) {
    try {
      return this.json({ data: await imageWorkflowService.cancel(event.params.id, event.params.nodeId) });
    } catch (error) {
      return this.failure(error);
    }
  }

  private failure(error: unknown) {
    const code = error instanceof ImageWorkflowError ? error.code : 'image_workflow_failed';
    const status = error instanceof ImageWorkflowError ? error.status : 500;
    return this.json({ error: code }, status);
  }
}
