import { uuidv7 } from '@beeblock/svelar/support';
import type { CodeGraphInvestigation, CodeGraphInvestigationState } from '../../domain/code-graph.js';
import { AgentCodeGraphInvestigation } from '../../domain/models/AgentCodeGraphInvestigation.js';

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function mapInvestigation(model: AgentCodeGraphInvestigation): CodeGraphInvestigation {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    name: String(model.getAttribute('name')),
    state: JSON.parse(String(model.getAttribute('state_json'))) as CodeGraphInvestigationState,
    createdBy: String(model.getAttribute('created_by')),
    createdAt: iso(model.getAttribute('created_at')),
    updatedAt: iso(model.getAttribute('updated_at')),
  };
}

export class CodeGraphInvestigationRepository {
  async list(workspaceId: string): Promise<CodeGraphInvestigation[]> {
    const rows = await AgentCodeGraphInvestigation.query()
      .where('workspace_id', workspaceId)
      .orderBy('updated_at', 'desc')
      .limit(100)
      .get();
    return rows.map(mapInvestigation);
  }

  async get(workspaceId: string, investigationId: string): Promise<CodeGraphInvestigation | null> {
    const model = await AgentCodeGraphInvestigation.query()
      .where('workspace_id', workspaceId)
      .where('id', investigationId)
      .first();
    return model ? mapInvestigation(model) : null;
  }

  async create(
    workspaceId: string,
    input: { name: string; state: CodeGraphInvestigationState; createdBy: string },
  ): Promise<CodeGraphInvestigation> {
    const existing = await AgentCodeGraphInvestigation.query().where('workspace_id', workspaceId).get();
    if (existing.length >= 100) throw new Error('This workspace already has 100 saved investigations. Remove one before saving another.');
    const now = new Date().toISOString();
    const id = uuidv7();
    await AgentCodeGraphInvestigation.query().insert({
      id,
      workspace_id: workspaceId,
      name: input.name,
      state_json: JSON.stringify(input.state),
      created_by: input.createdBy,
      created_at: now,
      updated_at: now,
    });
    return (await this.get(workspaceId, id))!;
  }

  async update(
    workspaceId: string,
    investigationId: string,
    input: { name?: string; state?: CodeGraphInvestigationState },
  ): Promise<CodeGraphInvestigation | null> {
    const current = await this.get(workspaceId, investigationId);
    if (!current) return null;
    await AgentCodeGraphInvestigation.query()
      .where('workspace_id', workspaceId)
      .where('id', investigationId)
      .update({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.state === undefined ? {} : { state_json: JSON.stringify(input.state) }),
        updated_at: new Date().toISOString(),
      });
    return this.get(workspaceId, investigationId);
  }

  async delete(workspaceId: string, investigationId: string): Promise<boolean> {
    const current = await this.get(workspaceId, investigationId);
    if (!current) return false;
    await AgentCodeGraphInvestigation.query()
      .where('workspace_id', workspaceId)
      .where('id', investigationId)
      .delete();
    return true;
  }
}

export const codeGraphInvestigationRepository = new CodeGraphInvestigationRepository();
