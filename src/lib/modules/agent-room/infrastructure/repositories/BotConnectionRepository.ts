import { uuidv7 } from '@beeblock/svelar/support';
import { AgentBotConnection } from '../../domain/models/AgentBotConnection.js';
export type BotConnection = { id: string; workspaceId: string; name: string; kind: 'whatsapp'; enabled: boolean };
function map(row: AgentBotConnection): BotConnection {
  return { id: row.getAttribute('id'), workspaceId: row.getAttribute('workspace_id'), name: row.getAttribute('name'), kind: 'whatsapp', enabled: Boolean(row.getAttribute('enabled')) };
}
export class BotConnectionRepository {
  async create(workspaceId: string, name: string) {
    const now = new Date().toISOString();
    return map(await AgentBotConnection.create({ id: uuidv7(), workspace_id: workspaceId, name, kind: 'whatsapp', enabled: true, created_at: now, updated_at: now }));
  }
  async list(workspaceId?: string): Promise<BotConnection[]> {
    const query = AgentBotConnection.query().where('kind', 'whatsapp');
    if (workspaceId) query.where('workspace_id', workspaceId);
    return (await query.orderBy('created_at').get()).map(map);
  }
  async find(workspaceId: string, id: string) {
    const row = await AgentBotConnection.query().where('workspace_id', workspaceId).where('id', id).first();
    return row ? map(row) : null;
  }
  async enable(workspaceId: string, id: string) {
    await AgentBotConnection.query().where('workspace_id', workspaceId).where('id', id).update({ enabled: true, updated_at: new Date().toISOString() });
  }
  async disable(workspaceId: string, id: string) {
    await AgentBotConnection.query().where('workspace_id', workspaceId).where('id', id).update({ enabled: false, updated_at: new Date().toISOString() });
  }
  async remove(workspaceId: string, id: string) { await AgentBotConnection.query().where('workspace_id', workspaceId).where('id', id).delete(); }
}
export const botConnectionRepository = new BotConnectionRepository();
