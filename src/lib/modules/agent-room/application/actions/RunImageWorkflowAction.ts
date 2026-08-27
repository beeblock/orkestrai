import type { CompleteImageWorkflowDto, FailImageWorkflowDto, RunImageWorkflowDto } from '../dto/ImageWorkflowDtos.js';
import { imageWorkflowService } from '../services/ImageWorkflowService.js';
import type { BridgeRunImageWorkflowInput } from '../../contracts/schemas/imageWorkflowSchemas.js';

export class RunImageWorkflowAction {
  execute(dto: RunImageWorkflowDto) {
    return imageWorkflowService.dispatch(dto);
  }
}

export class RunSavedImageWorkflowAction {
  execute(workspaceId: string, nodeId: string, input: BridgeRunImageWorkflowInput, actorNodeId: string | null) {
    return imageWorkflowService.runSaved(workspaceId, nodeId, input, actorNodeId);
  }
}

export class CompleteImageWorkflowAction {
  execute(dto: CompleteImageWorkflowDto) {
    return imageWorkflowService.complete(dto);
  }
}

export class FailImageWorkflowAction {
  execute(dto: FailImageWorkflowDto) {
    return imageWorkflowService.fail(dto);
  }
}
