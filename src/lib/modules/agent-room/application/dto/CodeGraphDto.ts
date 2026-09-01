import type {
  CodeGraphIndexInput,
  CodeGraphSearchInput,
  CodeGraphTraversalInput,
  CodeGraphOverviewInput,
  CodeGraphChangeInput,
  CodeGraphHandoffInput,
  CodeGraphContractInput,
  CodeGraphQualityInput,
  CodeGraphSemanticSearchInput,
  CodeGraphEvidenceImportInput,
} from '../../contracts/schemas/codeGraphSchemas.js';
import type { CodeGraphChangeOptions, CodeGraphContractOptions, CodeGraphEvidenceImportOptions, CodeGraphHandoffOptions, CodeGraphIndexOptions, CodeGraphQualityOptions, CodeGraphSearchOptions, CodeGraphSemanticSearchOptions, CodeGraphTraversalOptions } from '../../domain/code-graph.js';

export class IndexCodeGraphDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphIndexOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphIndexInput): IndexCodeGraphDto {
    return new IndexCodeGraphDto(workspaceId, { projectIds: input.projectIds, force: input.force });
  }
}

export class OverviewCodeGraphDto {
  constructor(
    public readonly workspaceId: string,
    public readonly projectId: string | undefined,
    public readonly limit: number,
  ) {}

  static from(workspaceId: string, input: CodeGraphOverviewInput): OverviewCodeGraphDto {
    return new OverviewCodeGraphDto(workspaceId, input.projectId, input.limit);
  }
}

export class SearchCodeGraphDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphSearchOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphSearchInput): SearchCodeGraphDto {
    return new SearchCodeGraphDto(workspaceId, {
      query: input.q,
      projectId: input.projectId,
      kinds: input.kinds,
      limit: input.limit,
    });
  }
}

export class TraverseCodeGraphDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphTraversalOptions,
  ) {}

  static from(workspaceId: string, symbolId: string, input: CodeGraphTraversalInput): TraverseCodeGraphDto {
    return new TraverseCodeGraphDto(workspaceId, {
      symbolId,
      direction: input.direction,
      kinds: input.kinds,
      depth: input.depth,
      limit: input.limit,
    });
  }
}

export class ChangeCodeGraphDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphChangeOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphChangeInput): ChangeCodeGraphDto {
    return new ChangeCodeGraphDto(workspaceId, { depth: input.depth, limit: input.limit });
  }
}

export class CodeGraphHandoffDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphHandoffOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphHandoffInput): CodeGraphHandoffDto {
    return new CodeGraphHandoffDto(workspaceId, input);
  }
}

export class CodeGraphContractDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphContractOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphContractInput): CodeGraphContractDto {
    return new CodeGraphContractDto(workspaceId, input);
  }
}

export class CodeGraphQualityDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphQualityOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphQualityInput): CodeGraphQualityDto {
    return new CodeGraphQualityDto(workspaceId, input);
  }
}

export class CodeGraphSemanticSearchDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphSemanticSearchOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphSemanticSearchInput): CodeGraphSemanticSearchDto {
    return new CodeGraphSemanticSearchDto(workspaceId, {
      query: input.q,
      projectId: input.projectId,
      kinds: input.kinds,
      limit: input.limit,
    });
  }
}

export class CodeGraphEvidenceImportDto {
  constructor(
    public readonly workspaceId: string,
    public readonly options: CodeGraphEvidenceImportOptions,
  ) {}

  static from(workspaceId: string, input: CodeGraphEvidenceImportInput): CodeGraphEvidenceImportDto {
    return new CodeGraphEvidenceImportDto(workspaceId, input);
  }
}
