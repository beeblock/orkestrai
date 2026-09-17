import { createHash } from 'node:crypto';
import { uuidv7 } from '@beeblock/svelar/support';
import { CreativeRecipe as RecipeModel } from '../../domain/models/CreativeRecipe.js';
import { creativeRecipeDefinitionSchema, type CreativeRecipeDefinition } from '../../contracts/schemas/creative-recipe.schema.js';
import type { CreativeRecipe } from '../../domain/creative-recipe.js';
import { CreativeMediaError } from '../../domain/types.js';
function record(row: RecipeModel): CreativeRecipe {
  const json = row.getAttribute('definition_json');
  return { id: String(row.getAttribute('id')), workspaceId: String(row.getAttribute('workspace_id')), familyId: String(row.getAttribute('family_id')), version: Number(row.getAttribute('version')), name: String(row.getAttribute('name')), description: String(row.getAttribute('description')), definition: creativeRecipeDefinitionSchema.parse(typeof json === 'string' ? JSON.parse(json) : json), digest: String(row.getAttribute('digest')), createdAt: String(row.getAttribute('created_at')) };
}
export class CreativeRecipeRepository {
  async list(workspaceId?: string) { const query = RecipeModel.query(); if (workspaceId) query.where('workspace_id', workspaceId); return (await query.orderBy('created_at', 'desc').limit(workspaceId ? 500 : 2000).get()).map(record); }
  async read(workspaceId: string, id: string) { const row = await RecipeModel.query().where('workspace_id', workspaceId).where('id', id).first(); return row ? record(row) : null; }
  async create(workspaceId: string, name: string, description: string, input: CreativeRecipeDefinition, familyId = uuidv7()) {
    if ((await this.list(workspaceId)).length >= 500) throw new CreativeMediaError('creative_recipe_limit', 409);
    const definition = creativeRecipeDefinitionSchema.parse(input), serialized = JSON.stringify(definition);
    if (serialized.length > 1000000) throw new CreativeMediaError('creative_invalid_input');
    const latest = await RecipeModel.query().where('family_id', familyId).orderBy('version', 'desc').first();
    const id = uuidv7(), stamp = new Date().toISOString();
    await RecipeModel.create({ id, workspace_id: workspaceId, family_id: familyId, version: Number(latest?.getAttribute('version') ?? 0) + 1, name, description, definition_json: serialized, digest: createHash('sha256').update(serialized).digest('hex'), created_at: stamp, updated_at: stamp });
    return (await this.read(workspaceId, id))!;
  }
  async remove(workspaceId: string, id: string) { await RecipeModel.query().where('workspace_id', workspaceId).where('id', id).delete(); }
  async removeWorkspace(workspaceId: string) { await RecipeModel.query().where('workspace_id', workspaceId).delete(); }
}
export const creativeRecipeRepository = new CreativeRecipeRepository();
