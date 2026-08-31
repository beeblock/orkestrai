import type { CodeGraphIndexResult } from '../../domain/code-graph.js';
import type { IndexCodeGraphDto } from '../dto/CodeGraphDto.js';
import { codeGraphIndexService } from '../services/CodeGraphIndexService.js';

export class IndexCodeGraphAction {
  async execute(dto: IndexCodeGraphDto): Promise<CodeGraphIndexResult> {
    return codeGraphIndexService.index(dto.workspaceId, dto.options);
  }
}

export const indexCodeGraphAction = new IndexCodeGraphAction();
