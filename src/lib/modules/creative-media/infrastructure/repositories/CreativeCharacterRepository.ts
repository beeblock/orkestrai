import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeCharacter as CharacterModel } from '../../domain/models/CreativeCharacter.js';
import { CreativeMediaError } from '../../domain/types.js';
import type { CreativeCharacter, CharacterSnapshot } from '../../domain/character.js';
import { creativeCharacterDefinitionSchema, type CreativeCharacterDefinition } from '../../contracts/schemas/creative-character.schema.js';

const json = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value;
function character(row: CharacterModel): CreativeCharacter {
  return { id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), familyId: String(row.getAttribute('family_id')), version: Number(row.getAttribute('version')), revision: Number(row.getAttribute('revision')), state: row.getAttribute('state') as CreativeCharacter['state'], definition: creativeCharacterDefinitionSchema.parse(json(row.getAttribute('definition_json'))), snapshot: json(row.getAttribute('snapshot_json')) as CharacterSnapshot | null };
}
export class CreativeCharacterRepository {
  async library() { return (await CharacterModel.query().where('state', 'locked').orderBy('created_at', 'desc').limit(2000).get()).map(character); }
  async imported(workspaceId: string, source: CreativeCharacter) {
    const row = await CharacterModel.query().where('workspace_id', workspaceId).where('family_id', source.familyId).where('version', source.version).first();
    return row ? character(row) : null;
  }
  async importLocked(workspaceId: string, source: CreativeCharacter) {
    const existing = await this.imported(workspaceId, source);
    if (existing) {
      if (existing.state !== 'locked' || existing.snapshot?.digest !== source.snapshot?.digest) throw new CreativeMediaError('creative_reference_changed', 409);
      return existing;
    }
    if (source.state !== 'locked' || !source.snapshot) throw new CreativeMediaError('creative_character_lock_required');
    if ((await this.list(workspaceId)).length >= 500) throw new CreativeMediaError('creative_character_limit', 409);
    const id = uuidv7(), stamp = new Date().toISOString();
    await CharacterModel.create({ id, workspace_id: workspaceId, family_id: source.familyId, version: source.version, revision: 1, state: 'locked', definition_json: JSON.stringify(source.definition), snapshot_json: JSON.stringify(source.snapshot), created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, id))!;
  }
  async list(workspaceId: string) { return (await CharacterModel.query().where('workspace_id', workspaceId).orderBy('created_at').limit(500).get()).map(character); }
  async read(workspaceId: string, id: string) { const row = await CharacterModel.query().where('workspace_id', workspaceId).where('id', id).first(); return row ? character(row) : null; }
  async create(workspaceId: string, definition: CreativeCharacterDefinition, familyId?: string) {
    const records = await this.list(workspaceId);
    if (records.length >= 500) throw new CreativeMediaError('creative_character_limit', 409);
    const id = uuidv7(); const stamp = new Date().toISOString();
    const lastVersion = familyId ? await CharacterModel.query().where('family_id', familyId).orderBy('version', 'desc').first() : null;
    const version = lastVersion ? Number(lastVersion.getAttribute('version')) + 1 : 1;
    await CharacterModel.create({ id, workspace_id: workspaceId, family_id: familyId ?? id, version, revision: 1, state: 'draft', definition_json: JSON.stringify(definition), snapshot_json: null, created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, id))!;
  }
  async update(workspaceId: string, id: string, revision: number, definition: CreativeCharacterDefinition, snapshot: CharacterSnapshot | null = null) {
    const changed = await CharacterModel.query().where('workspace_id', workspaceId).where('id', id).where('revision', revision).where('state', 'draft').update({ definition_json: JSON.stringify(definition), snapshot_json: snapshot ? JSON.stringify(snapshot) : null, state: snapshot ? 'locked' : 'draft', revision: revision + 1, updated_at: new Date().toISOString() });
    if (!changed) throw new CreativeMediaError('creative_character_locked_or_changed', 409);
    return (await this.read(workspaceId, id))!;
  }
  async remove(workspaceId: string, id: string, revision: number) {
    const changed = await CharacterModel.query().where('workspace_id', workspaceId).where('id', id).where('revision', revision).where('state', 'draft').delete();
    if (!changed) throw new CreativeMediaError('creative_character_locked_or_changed', 409);
  }
  async removeWorkspace(workspaceId: string) { await CharacterModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeCharacterRepository = new CreativeCharacterRepository();
