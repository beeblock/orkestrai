import { Connection } from '@beeblock/svelar/database';
import { uuidv7 } from '@beeblock/svelar/support';
import type { WorkspaceToolActor, WorkspaceToolManifest } from '../../contracts/schemas/agent-workspace-tool.schema.js';
import { workspaceToolManifestSchema } from '../../contracts/schemas/agent-workspace-tool.schema.js';
import { AgentWorkspaceTool } from '../../domain/models/AgentWorkspaceTool.js';
import { AgentWorkspaceToolRevision } from '../../domain/models/AgentWorkspaceToolRevision.js';
import { AgentWorkspaceToolRun } from '../../domain/models/AgentWorkspaceToolRun.js';

export type WorkspaceToolRecord = {
  id: string;
  workspaceId: string;
  nodeId: string | null;
  name: string;
  slug: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  currentRevision: number;
  publishedRevision: number | null;
  manifest: WorkspaceToolManifest;
  createdBy: WorkspaceToolActor;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceToolRevisionRecord = {
  id: string;
  toolId: string;
  revision: number;
  manifest: WorkspaceToolManifest;
  changeSummary: string | null;
  createdBy: WorkspaceToolActor;
  createdAt: string;
};

export type WorkspaceToolRunRecord = {
  id: string;
  workspaceId: string;
  toolId: string;
  revision: number;
  actor: WorkspaceToolActor;
  automationRunId: string | null;
  idempotencyKey: string;
  requestDigest: string;
  status: 'running' | 'succeeded' | 'failed' | 'dry_run';
  input: Record<string, unknown>;
  output: unknown;
  outputDigest: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
};

function iso(value: unknown): string { return value instanceof Date ? value.toISOString() : String(value); }
function json(value: unknown): unknown { try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return {}; } }

function mapTool(model: AgentWorkspaceTool): WorkspaceToolRecord {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    nodeId: model.getAttribute('node_id') ? String(model.getAttribute('node_id')) : null,
    name: String(model.getAttribute('name')),
    slug: String(model.getAttribute('slug')),
    description: String(model.getAttribute('description') ?? ''),
    status: String(model.getAttribute('status')) as WorkspaceToolRecord['status'],
    currentRevision: Number(model.getAttribute('current_revision')),
    publishedRevision: model.getAttribute('published_revision') == null ? null : Number(model.getAttribute('published_revision')),
    manifest: workspaceToolManifestSchema.parse(json(model.getAttribute('manifest_json'))),
    createdBy: { type: String(model.getAttribute('created_by_type')) as WorkspaceToolActor['type'], id: model.getAttribute('created_by_id') ? String(model.getAttribute('created_by_id')) : null },
    createdAt: iso(model.getAttribute('created_at')),
    updatedAt: iso(model.getAttribute('updated_at')),
  };
}

function mapRevision(model: AgentWorkspaceToolRevision): WorkspaceToolRevisionRecord {
  return {
    id: String(model.getAttribute('id')),
    toolId: String(model.getAttribute('tool_id')),
    revision: Number(model.getAttribute('revision')),
    manifest: workspaceToolManifestSchema.parse(json(model.getAttribute('manifest_json'))),
    changeSummary: model.getAttribute('change_summary') ? String(model.getAttribute('change_summary')) : null,
    createdBy: { type: String(model.getAttribute('created_by_type')) as WorkspaceToolActor['type'], id: model.getAttribute('created_by_id') ? String(model.getAttribute('created_by_id')) : null },
    createdAt: iso(model.getAttribute('created_at')),
  };
}

function mapRun(model: AgentWorkspaceToolRun): WorkspaceToolRunRecord {
  return {
    id: String(model.getAttribute('id')),
    workspaceId: String(model.getAttribute('workspace_id')),
    toolId: String(model.getAttribute('tool_id')),
    revision: Number(model.getAttribute('revision')),
    actor: { type: String(model.getAttribute('actor_type')) as WorkspaceToolActor['type'], id: model.getAttribute('actor_id') ? String(model.getAttribute('actor_id')) : null },
    automationRunId: model.getAttribute('automation_run_id') ? String(model.getAttribute('automation_run_id')) : null,
    idempotencyKey: String(model.getAttribute('idempotency_key')),
    requestDigest: String(model.getAttribute('request_digest')),
    status: String(model.getAttribute('status')) as WorkspaceToolRunRecord['status'],
    input: json(model.getAttribute('input_json')) as Record<string, unknown>,
    output: model.getAttribute('output_json') ? json(model.getAttribute('output_json')) : null,
    outputDigest: model.getAttribute('output_digest') ? String(model.getAttribute('output_digest')) : null,
    error: model.getAttribute('error') ? String(model.getAttribute('error')) : null,
    startedAt: iso(model.getAttribute('started_at')),
    finishedAt: model.getAttribute('finished_at') ? iso(model.getAttribute('finished_at')) : null,
    durationMs: model.getAttribute('duration_ms') == null ? null : Number(model.getAttribute('duration_ms')),
  };
}

export class AgentWorkspaceToolRepository {
  async list(workspaceId: string): Promise<WorkspaceToolRecord[]> {
    const rows = await AgentWorkspaceTool.query().where('workspace_id', workspaceId).orderBy('updated_at', 'desc').get();
    return rows.map(mapTool);
  }

  async find(workspaceId: string, id: string): Promise<WorkspaceToolRecord | null> {
    const model = await AgentWorkspaceTool.query().where('workspace_id', workspaceId).where('id', id).first();
    return model ? mapTool(model) : null;
  }

  async create(input: Omit<WorkspaceToolRecord, 'id' | 'status' | 'currentRevision' | 'publishedRevision' | 'createdAt' | 'updatedAt'> & { changeSummary?: string | null }): Promise<WorkspaceToolRecord> {
    return Connection.transaction(async () => {
      const id = uuidv7();
      const now = new Date();
      const manifestJson = JSON.stringify(input.manifest);
      await AgentWorkspaceTool.create({
        id, workspace_id: input.workspaceId, node_id: input.nodeId, name: input.name,
        slug: input.slug, description: input.description, status: 'draft', current_revision: 1,
        published_revision: null,
        manifest_json: manifestJson, created_by_type: input.createdBy.type,
        created_by_id: input.createdBy.id ?? null, created_at: now, updated_at: now,
      });
      await AgentWorkspaceToolRevision.create({
        id: uuidv7(), tool_id: id, revision: 1, manifest_json: manifestJson,
        change_summary: input.changeSummary ?? null, created_by_type: input.createdBy.type,
        created_by_id: input.createdBy.id ?? null, created_at: now,
      });
      const created = await AgentWorkspaceTool.find(id);
      if (!created) throw new Error('Tool disappeared while being created.');
      return mapTool(created);
    });
  }

  async update(input: { workspaceId: string; id: string; name?: string; description?: string; manifest: WorkspaceToolManifest; actor: WorkspaceToolActor; changeSummary?: string | null }): Promise<WorkspaceToolRecord> {
    return Connection.transaction(async () => {
      const current = await this.find(input.workspaceId, input.id);
      if (!current) throw new Error('Tool not found.');
      const revision = current.currentRevision + 1;
      const now = new Date();
      const manifestJson = JSON.stringify(input.manifest);
      await AgentWorkspaceTool.query().where('workspace_id', input.workspaceId).where('id', input.id).update({
        name: input.name ?? current.name, description: input.description ?? current.description,
        manifest_json: manifestJson, current_revision: revision, status: 'draft', updated_at: now,
      });
      await AgentWorkspaceToolRevision.create({
        id: uuidv7(), tool_id: input.id, revision, manifest_json: manifestJson,
        change_summary: input.changeSummary ?? null, created_by_type: input.actor.type,
        created_by_id: input.actor.id ?? null, created_at: now,
      });
      const updated = await AgentWorkspaceTool.find(input.id);
      if (!updated) throw new Error('Tool disappeared while being updated.');
      return mapTool(updated);
    });
  }

  async setStatus(workspaceId: string, id: string, status: WorkspaceToolRecord['status']): Promise<WorkspaceToolRecord> {
    const current = await this.find(workspaceId, id);
    if (!current) throw new Error('Tool not found.');
    const changed = await AgentWorkspaceTool.query().where('workspace_id', workspaceId).where('id', id).update({
      status,
      ...(status === 'published' ? { published_revision: current.currentRevision } : {}),
      updated_at: new Date(),
    });
    if (!changed) throw new Error('Tool not found.');
    const updated = await AgentWorkspaceTool.find(id);
    if (!updated) throw new Error('Tool disappeared while publishing.');
    return mapTool(updated);
  }

  async revisions(workspaceId: string, toolId: string): Promise<WorkspaceToolRevisionRecord[]> {
    if (!await this.find(workspaceId, toolId)) throw new Error('Tool not found.');
    const rows = await AgentWorkspaceToolRevision.query().where('tool_id', toolId).orderBy('revision', 'desc').get();
    return rows.map(mapRevision);
  }

  async revision(workspaceId: string, toolId: string, revision: number): Promise<WorkspaceToolRevisionRecord | null> {
    if (!await this.find(workspaceId, toolId)) return null;
    const row = await AgentWorkspaceToolRevision.query().where('tool_id', toolId).where('revision', revision).first();
    return row ? mapRevision(row) : null;
  }

  async findRun(workspaceId: string, idempotencyKey: string): Promise<WorkspaceToolRunRecord | null> {
    const row = await AgentWorkspaceToolRun.query().where('workspace_id', workspaceId).where('idempotency_key', idempotencyKey).first();
    return row ? mapRun(row) : null;
  }

  async listRuns(workspaceId: string, toolId?: string, limit = 100): Promise<WorkspaceToolRunRecord[]> {
    let query = AgentWorkspaceToolRun.query().where('workspace_id', workspaceId);
    if (toolId) query = query.where('tool_id', toolId);
    const rows = await query.orderBy('created_at', 'desc').limit(Math.max(1, Math.min(limit, 500))).get();
    return rows.map(mapRun);
  }

  async startRun(input: Omit<WorkspaceToolRunRecord, 'id' | 'status' | 'output' | 'outputDigest' | 'error' | 'finishedAt' | 'durationMs'>): Promise<WorkspaceToolRunRecord> {
    const id = uuidv7();
    const now = new Date();
    const row = await AgentWorkspaceToolRun.create({
      id, workspace_id: input.workspaceId, tool_id: input.toolId, revision: input.revision,
      actor_type: input.actor.type, actor_id: input.actor.id ?? null,
      automation_run_id: input.automationRunId, idempotency_key: input.idempotencyKey,
      request_digest: input.requestDigest, status: 'running', input_json: JSON.stringify(input.input),
      output_json: null, output_digest: null, error: null, started_at: now,
      finished_at: null, duration_ms: null, created_at: now, updated_at: now,
    });
    return mapRun(row);
  }

  async reserveRun(input: Omit<WorkspaceToolRunRecord, 'id' | 'status' | 'output' | 'outputDigest' | 'error' | 'finishedAt' | 'durationMs'>): Promise<{ run: WorkspaceToolRunRecord; created: boolean }> {
    try {
      return { run: await this.startRun(input), created: true };
    } catch (error) {
      const winner = await this.findRun(input.workspaceId, input.idempotencyKey);
      if (winner) return { run: winner, created: false };
      throw error;
    }
  }

  async finishRun(id: string, input: { status: 'succeeded' | 'failed' | 'dry_run'; output?: unknown; outputDigest?: string | null; error?: string | null; durationMs: number }): Promise<WorkspaceToolRunRecord> {
    const now = new Date();
    await AgentWorkspaceToolRun.query().where('id', id).update({
      status: input.status, output_json: input.output === undefined ? null : JSON.stringify(input.output),
      output_digest: input.outputDigest ?? null, error: input.error ?? null,
      finished_at: now, duration_ms: input.durationMs, updated_at: now,
    });
    const row = await AgentWorkspaceToolRun.find(id);
    if (!row) throw new Error('Tool run disappeared while completing.');
    return mapRun(row);
  }
}

export const agentWorkspaceToolRepository = new AgentWorkspaceToolRepository();
