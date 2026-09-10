import { Resource } from '@beeblock/svelar/routing';
import type { WorkspaceToolRecord, WorkspaceToolRevisionRecord, WorkspaceToolRunRecord } from '../../../infrastructure/repositories/AgentWorkspaceToolRepository.js';

type ToolResourceData = WorkspaceToolRecord | WorkspaceToolRevisionRecord | WorkspaceToolRunRecord;

export class AgentWorkspaceToolResource extends Resource<any, ToolResourceData> {
  toJSON(): ToolResourceData { return this.data; }
}
