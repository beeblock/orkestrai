import { uuidv7 } from '@beeblock/svelar/support';
import { AgentBotGroup } from '../../domain/models/AgentBotGroup.js';
import type { BotGroupSettings, PersonalBotGroup } from '../../contracts/schemas/personal-bot.schema.js';

function map(row: AgentBotGroup): PersonalBotGroup {
  return { id: row.getAttribute('id'), workspaceId: row.getAttribute('workspace_id'), title: row.getAttribute('title'),
    instructions: row.getAttribute('instructions') ?? '', memberIds: JSON.parse(row.getAttribute('member_ids_json')),
    coordinatorId: row.getAttribute('coordinator_id'), revision: Number(row.getAttribute('revision')), archived: Boolean(row.getAttribute('archived')) };
}
export class PersonalBotGroupRepository {
  async list(workspaceId: string): Promise<PersonalBotGroup[]> {
    return (await AgentBotGroup.query().where('workspace_id', workspaceId).where('archived', false).orderBy('created_at').get()).map(map);
  }
  async find(workspaceId: string, id: string): Promise<PersonalBotGroup | null> {
    const row = await AgentBotGroup.query().where('workspace_id', workspaceId).where('id', id).first();
    return row ? map(row) : null;
  }
  /** Called inside the same transaction as deleting the member node. */
  async detachMember(workspaceId: string, nodeId: string): Promise<void> {
    for (const group of await this.list(workspaceId)) {
      if (!group.memberIds.includes(nodeId)) continue;
      const memberIds = group.memberIds.filter(id => id !== nodeId);
      await this.update(workspaceId, group.id, group.revision, memberIds.length ? {
        title: group.title, instructions: group.instructions, memberIds,
        coordinatorId: group.coordinatorId === nodeId ? memberIds[0] : group.coordinatorId,
      } : undefined);
    }
  }
  async create(workspaceId: string, settings: BotGroupSettings): Promise<PersonalBotGroup> {
    const now = new Date().toISOString();
    return map(await AgentBotGroup.create({ id: uuidv7(), workspace_id: workspaceId, title: settings.title,
      instructions: settings.instructions, member_ids_json: JSON.stringify(settings.memberIds), coordinator_id: settings.coordinatorId,
      revision: 1, archived: false, created_at: now, updated_at: now }));
  }
  async update(workspaceId: string, id: string, revision: number, settings?: BotGroupSettings): Promise<PersonalBotGroup> {
    const changed = await AgentBotGroup.query().where('workspace_id', workspaceId).where('id', id).where('revision', revision).where('archived', false)
      .update({ ...(settings ? { title: settings.title, instructions: settings.instructions, member_ids_json: JSON.stringify(settings.memberIds),
        coordinator_id: settings.coordinatorId } : { archived: true }), revision: revision + 1, updated_at: new Date().toISOString() });
    if (!changed) throw new Error('BOT_GROUP_REVISION_CONFLICT');
    return (await this.find(workspaceId, id))!;
  }
}
export const personalBotGroupRepository = new PersonalBotGroupRepository();
