import { Connection } from '@beeblock/svelar/database';
import { AgentLearningEntry } from '../../domain/models/AgentLearningEntry.js';
import type { AgentLesson } from '../../domain/agent-learning.js';

const project = (model: AgentLearningEntry): AgentLesson => JSON.parse(String(model.getAttribute('document_json')));
export class AgentLearningRepository {
  async list(workspaceId: string, nodeId?: string, status?: AgentLesson['status']): Promise<AgentLesson[]> {
    const query = AgentLearningEntry.query().where('workspace_id', workspaceId);
    if (nodeId) query.where('node_id', nodeId);
    if (status) query.where('status', status);
    return (await query.orderBy('updated_at', 'desc').limit(1000).get()).map(project);
  }
  async create(entry: AgentLesson): Promise<AgentLesson> {
    return Connection.transaction(async () => {
      const duplicate = await AgentLearningEntry.query().where('workspace_id', entry.workspaceId).where('node_id', entry.nodeId).where('fingerprint', entry.fingerprint).first();
      if (duplicate) return project(duplicate);
      await AgentLearningEntry.create({ id: entry.id, workspace_id: entry.workspaceId, node_id: entry.nodeId, task_id: entry.taskId, status: entry.status, revision: entry.revision, fingerprint: entry.fingerprint, document_json: JSON.stringify(entry), created_at: entry.createdAt, updated_at: entry.updatedAt });
      return entry;
    });
  }
  async update(entry: AgentLesson, revision: number): Promise<AgentLesson> {
    const changed = await AgentLearningEntry.query().where('workspace_id', entry.workspaceId).where('node_id', entry.nodeId).where('id', entry.id).where('revision', revision).update({ status: entry.status, revision: entry.revision, document_json: JSON.stringify(entry), updated_at: entry.updatedAt });
    if (!changed) throw new Error('learning_revision_conflict');
    return entry;
  }
}
export const agentLearningRepository = new AgentLearningRepository();
