import type { AddImageWorkflowReferenceDto, CompleteImageWorkflowDto, ConnectImageWorkflowNodeDto, CreateImageWorkflowDto, FailImageWorkflowDto, RunImageWorkflowDto, UpdateImageWorkflowDto, ValidateImageWorkflowOutputDto } from '../dto/ImageWorkflowDtos.js';
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

export class CreateImageWorkflowAction {
  execute(dto: CreateImageWorkflowDto) { return imageWorkflowService.create(dto); }
}

export class UpdateImageWorkflowAction {
  execute(dto: UpdateImageWorkflowDto) { return imageWorkflowService.update(dto); }
}

export class ConnectImageWorkflowNodeAction {
  execute(dto: ConnectImageWorkflowNodeDto) { return imageWorkflowService.connect(dto); }
}

export class DisconnectImageWorkflowNodeAction {
  execute(dto: ConnectImageWorkflowNodeDto) { return imageWorkflowService.disconnect(dto); }
}

export class AddImageWorkflowReferenceAction {
  execute(dto: AddImageWorkflowReferenceDto) { return imageWorkflowService.addReference(dto); }
}

export class CompleteImageWorkflowAction {
  execute(dto: CompleteImageWorkflowDto) {
    return imageWorkflowService.complete(dto);
  }
}

export class ValidateImageWorkflowOutputAction {
  execute(dto: ValidateImageWorkflowOutputDto) {
    return imageWorkflowService.validateOutput(dto.workspaceId, dto.nodeId, dto.runId, dto.outputPath, dto.actorNodeId);
  }
}

export class FailImageWorkflowAction {
  execute(dto: FailImageWorkflowDto) {
    return imageWorkflowService.fail(dto);
  }
}
