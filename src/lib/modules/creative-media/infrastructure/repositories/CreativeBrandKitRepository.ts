import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeBrandKit as BrandModel } from '../../domain/models/CreativeBrandKit.js';
import { CreativeMediaError } from '../../domain/types.js';
import type { CreativeBrandKit, CreativeBrandSnapshot } from '../../domain/brand-kit.js';
import { creativeBrandDefinitionSchema, type CreativeBrandDefinition } from '../../contracts/schemas/creative-brand.schema.js';
function record(row: BrandModel): CreativeBrandKit {
  return { id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), familyId: String(row.getAttribute('family_id')), version: Number(row.getAttribute('version')), revision: Number(row.getAttribute('revision')), state: row.getAttribute('state') as CreativeBrandKit['state'], definition: creativeBrandDefinitionSchema.parse(JSON.parse(String(row.getAttribute('definition_json')))), snapshot: row.getAttribute('snapshot_json') ? JSON.parse(String(row.getAttribute('snapshot_json'))) : null };
}
export class CreativeBrandKitRepository {
  async list(workspaceId: string) { return (await BrandModel.query().where('workspace_id', workspaceId).orderBy('created_at').limit(500).get()).map(record); }
  async library() { return (await BrandModel.query().where('state', 'locked').orderBy('created_at', 'desc').limit(2000).get()).map(record); }
  async read(workspaceId: string, id: string) { const row = await BrandModel.query().where('workspace_id', workspaceId).where('id', id).first(); return row ? record(row) : null; }
  async create(workspaceId: string, definition: CreativeBrandDefinition, familyId?: string) {
    if ((await this.list(workspaceId)).length >= 500) throw new CreativeMediaError('creative_brand_limit', 409);
    const previous = familyId ? await BrandModel.query().where('family_id', familyId).orderBy('version', 'desc').first() : null;
    const id = uuidv7(), stamp = new Date().toISOString();
    await BrandModel.create({ id, workspace_id: workspaceId, family_id: familyId ?? id, version: previous ? Number(previous.getAttribute('version')) + 1 : 1, revision: 1, state: 'draft', definition_json: JSON.stringify(definition), snapshot_json: null, created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, id))!;
  }
  async update(workspaceId: string, id: string, revision: number, definition: CreativeBrandDefinition, snapshot: CreativeBrandSnapshot | null = null) {
    const changed = await BrandModel.query().where('workspace_id', workspaceId).where('id', id).where('revision', revision).where('state', 'draft').update({ definition_json: JSON.stringify(definition), snapshot_json: snapshot ? JSON.stringify(snapshot) : null, state: snapshot ? 'locked' : 'draft', revision: revision + 1, updated_at: new Date().toISOString() });
    if (!changed) throw new CreativeMediaError('creative_revision_conflict', 409);
    return (await this.read(workspaceId, id))!;
  }
  async importLocked(workspaceId: string, source: CreativeBrandKit) {
    const previous = await BrandModel.query().where('workspace_id', workspaceId).where('family_id', source.familyId).where('version', source.version).first();
    if (previous) { const result = record(previous); if (result.state !== 'locked' || result.snapshot?.digest !== source.snapshot?.digest) throw new CreativeMediaError('creative_reference_changed', 409); return result; }
    if (source.state !== 'locked' || !source.snapshot) throw new CreativeMediaError('creative_brand_lock_required');
    if ((await this.list(workspaceId)).length >= 500) throw new CreativeMediaError('creative_brand_limit', 409);
    const id = uuidv7(), stamp = new Date().toISOString();
    await BrandModel.create({ id, workspace_id: workspaceId, family_id: source.familyId, version: source.version, revision: 1, state: 'locked', definition_json: JSON.stringify(source.definition), snapshot_json: JSON.stringify(source.snapshot), created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, id))!;
  }
  async remove(workspaceId: string, id: string, revision: number) { if (!await BrandModel.query().where('workspace_id', workspaceId).where('id', id).where('revision', revision).where('state', 'draft').delete()) throw new CreativeMediaError('creative_revision_conflict', 409); }
  async removeWorkspace(workspaceId: string) { await BrandModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeBrandKitRepository = new CreativeBrandKitRepository();
