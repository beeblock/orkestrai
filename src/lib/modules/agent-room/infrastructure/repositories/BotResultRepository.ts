import { Connection } from '@beeblock/svelar/database';
import { AgentBotResult } from '../../domain/models/AgentBotResult.js';
export type BotResult = { id: string; workspaceId: string; nodeId: string; messageIds: string[]; body: string };
function map(row: AgentBotResult): BotResult {
  return { id: row.getAttribute('id'), workspaceId: row.getAttribute('workspace_id'), nodeId: row.getAttribute('node_id'),
    messageIds: JSON.parse(row.getAttribute('message_ids_json')), body: row.getAttribute('body') };
}
export class BotResultRepository {
  async save(input: BotResult) {
    if (input.body.length > 2_000_000 || input.messageIds.length > 50) throw new Error('BOT_RESULT_LIMIT');
    return Connection.transaction(async () => {
      const previous = await AgentBotResult.find(input.id);
      if (previous) {
        if (previous.getAttribute('workspace_id') !== input.workspaceId || previous.getAttribute('node_id') !== input.nodeId) throw new Error('BOT_RESULT_SCOPE_MISMATCH');
        return;
      }
      const now = new Date().toISOString();
      await AgentBotResult.create({ id: input.id, workspace_id: input.workspaceId, node_id: input.nodeId,
        message_ids_json: JSON.stringify(input.messageIds), body: input.body, processed_at: null, created_at: now, updated_at: now });
    });
  }
  async pending(after: string | null = null, limit = 50): Promise<BotResult[]> {
    const query = AgentBotResult.query().whereNull('processed_at');
    if (after) query.where('id', '>', after);
    return (await query.orderBy('id').limit(limit).get()).map(map);
  }
  async finish(id: string) {
    await AgentBotResult.query().where('id', id).whereNull('processed_at').update({ body: '', processed_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
}
export const botResultRepository = new BotResultRepository();
