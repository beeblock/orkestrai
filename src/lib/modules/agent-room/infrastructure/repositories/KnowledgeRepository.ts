import { uuidv7 } from '@beeblock/svelar/support';
import { AgentKnowledgeSource } from '../../domain/models/AgentKnowledgeSource.js';
import type { KnowledgeDocument } from '../../domain/knowledge.js';

export class KnowledgeRepository {
  async list(workspaceId: string): Promise<KnowledgeDocument[]> {
    const rows = await AgentKnowledgeSource.query().where('workspace_id', workspaceId).limit(5000).get();
    return rows.map(row => JSON.parse(String(row.getAttribute('document_json'))) as KnowledgeDocument);
  }
  async save(workspaceId: string, document: KnowledgeDocument): Promise<void> {
    const row = await AgentKnowledgeSource.query().where('workspace_id', workspaceId).where('source_key', document.id).first();
    const data = { document_json: JSON.stringify(document), updated_at: document.indexedAt };
    if (row) await row.update(data);
    else await AgentKnowledgeSource.create({ id: uuidv7(), workspace_id: workspaceId, source_key: document.id, ...data });
  }
  async remove(workspaceId: string, id: string): Promise<void> {
    await AgentKnowledgeSource.query().where('workspace_id', workspaceId).where('source_key', id).delete();
  }
}
export const knowledgeRepository = new KnowledgeRepository();
