import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeSequence as SequenceModel } from '../../domain/models/CreativeSequence.js';
import { CreativeMediaError } from '../../domain/types.js';
import type { CreativeSequence, SequenceExport } from '../../domain/sequence.js';
import { sequenceDocumentSchema, type SequenceDocument } from '../../contracts/schemas/creative-sequence.schema.js';
function record(row: SequenceModel): CreativeSequence {
  return { id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), nodeId: String(row.getAttribute('node_id')), revision: Number(row.getAttribute('revision')), document: sequenceDocumentSchema.parse(JSON.parse(String(row.getAttribute('document_json')))), export: row.getAttribute('export_json') ? JSON.parse(String(row.getAttribute('export_json'))) : null };
}
export class CreativeSequenceRepository {
  async list(workspaceId: string) { return (await SequenceModel.query().where('workspace_id', workspaceId).limit(200).get()).map(record); }
  async read(workspaceId: string, nodeId: string) { const row = await SequenceModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).first(); return row ? record(row) : null; }
  async create(workspaceId: string, nodeId: string, document: SequenceDocument) {
    if ((await this.list(workspaceId)).length >= 200) throw new CreativeMediaError('creative_sequence_limit');
    const stamp = new Date().toISOString();
    await SequenceModel.create({ id: uuidv7(), workspace_id: workspaceId, node_id: nodeId, revision: 1, document_json: JSON.stringify(sequenceDocumentSchema.parse(document)), export_json: null, created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, nodeId))!;
  }
  async update(workspaceId: string, nodeId: string, revision: number, document: SequenceDocument) {
    if (!await SequenceModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).where('revision', revision).update({ document_json: JSON.stringify(sequenceDocumentSchema.parse(document)), revision: revision + 1, updated_at: new Date().toISOString() })) throw new CreativeMediaError('creative_revision_conflict', 409);
    return (await this.read(workspaceId, nodeId))!;
  }
  async setExport(workspaceId: string, nodeId: string, value: SequenceExport) { await SequenceModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).update({ export_json: JSON.stringify(value) }); }
  async remove(workspaceId: string, nodeId: string) { await SequenceModel.query().where('workspace_id', workspaceId).where('node_id', nodeId).delete(); }
  async removeWorkspace(workspaceId: string) { await SequenceModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeSequenceRepository = new CreativeSequenceRepository();
