import { FormRequest } from '@beeblock/svelar/forms';
import {
  bridgeAskSchema,
  bridgeReplySchema,
  type BridgeReplyInput,
  bridgeRoleEditSchema,
  bridgeRoleWriteSchema,
  type BridgeRoleEditInput,
  type BridgeRoleWriteInput,
  bridgeConnectSchema,
  bridgeDismissSchema,
  bridgeRecruitSchema,
  bridgeNoteEditSchema,
  bridgeNoteWriteSchema,
  bridgeNotifySchema,
  bridgeActivitySchema,
  type BridgeAskInput,
  type BridgeConnectInput,
  type BridgeDismissInput,
  type BridgeRecruitInput,
  type BridgeNoteEditInput,
  type BridgeNoteWriteInput,
  type BridgeNotifyInput,
  type BridgeActivityInput,
} from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';

export class BridgeAskRequest extends FormRequest {
  rules() {
    return bridgeAskSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeAskInput {
    return bridgeAskSchema.parse(data);
  }
}

export class BridgeReplyRequest extends FormRequest {
  rules() {
    return bridgeReplySchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeReplyInput {
    return bridgeReplySchema.parse(data);
  }
}

export class BridgeNoteWriteRequest extends FormRequest {
  rules() {
    return bridgeNoteWriteSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeNoteWriteInput {
    return bridgeNoteWriteSchema.parse(data);
  }
}

export class BridgeNoteEditRequest extends FormRequest {
  rules() {
    return bridgeNoteEditSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeNoteEditInput {
    return bridgeNoteEditSchema.parse(data);
  }
}

export class BridgeNotifyRequest extends FormRequest {
  rules() {
    return bridgeNotifySchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeNotifyInput {
    return bridgeNotifySchema.parse(data);
  }
}

export class BridgeActivityRequest extends FormRequest {
  rules() {
    return bridgeActivitySchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeActivityInput {
    return bridgeActivitySchema.parse(data);
  }
}

export class BridgeRecruitRequest extends FormRequest {
  rules() {
    return bridgeRecruitSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeRecruitInput {
    return bridgeRecruitSchema.parse(data);
  }
}

export class BridgeDismissRequest extends FormRequest {
  rules() {
    return bridgeDismissSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeDismissInput {
    return bridgeDismissSchema.parse(data);
  }
}

export class BridgeConnectRequest extends FormRequest {
  rules() {
    return bridgeConnectSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeConnectInput {
    return bridgeConnectSchema.parse(data);
  }
}

export class BridgeRoleWriteRequest extends FormRequest {
  rules() {
    return bridgeRoleWriteSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeRoleWriteInput {
    return bridgeRoleWriteSchema.parse(data);
  }
}

export class BridgeRoleEditRequest extends FormRequest {
  rules() {
    return bridgeRoleEditSchema;
  }

  authorize(): boolean {
    return true;
  }

  passedValidation(data: unknown): BridgeRoleEditInput {
    return bridgeRoleEditSchema.parse(data);
  }
}
