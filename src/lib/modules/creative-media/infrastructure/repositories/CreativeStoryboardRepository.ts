import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeStoryboard as StoryboardModel } from '../../domain/models/CreativeStoryboard.js';
import { CreativeMediaError } from '../../domain/types.js';
import type { CreativeStoryboard } from '../../domain/storyboard.js';
import { storyboardDocumentSchema, type StoryboardDocument } from '../../contracts/schemas/creative-storyboard.schema.js';

function record(row: StoryboardModel): CreativeStoryboard {
  const json = row.getAttribute('document_json');
  return { id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), nodeId: String(row.getAttribute('node_id')), revision: Number(row.getAttribute('revision')), document: storyboardDocumentSchema.parse(typeof json === 'string' ? JSON.parse(json) : json) };
}
export class CreativeStoryboardRepository {
  async list(workspaceId: string) { return (await StoryboardModel.query().where('workspace_id', workspaceId).orderBy('created_at').limit(500).get()).map(record); }
  async read(workspaceId: string, nodeId: string) { const row = await StoryboardModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).first(); return row ? record(row) : null; }
  async create(workspaceId: string, nodeId: string, source: StoryboardDocument) {
    const document = storyboardDocumentSchema.parse(source), stamp = new Date().toISOString();
    if ((await this.list(workspaceId)).length >= 500) throw new CreativeMediaError('creative_storyboard_limit', 409);
    await StoryboardModel.create({ id: uuidv7(), workspace_id: workspaceId, node_id: nodeId, revision: 1, document_json: JSON.stringify(document), created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, nodeId))!;
  }
  async update(workspaceId: string, nodeId: string, revision: number, source: StoryboardDocument) {
    const document = storyboardDocumentSchema.parse(source);
    if (!await StoryboardModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).where('revision', revision).update({ revision: revision + 1, document_json: JSON.stringify(document), updated_at: new Date().toISOString() })) throw new CreativeMediaError('creative_revision_conflict', 409);
    return (await this.read(workspaceId, nodeId))!;
  }
  async remove(workspaceId: string, nodeId: string) { await StoryboardModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).delete(); }
  async removeWorkspace(workspaceId: string) { await StoryboardModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeStoryboardRepository = new CreativeStoryboardRepository();
