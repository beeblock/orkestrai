import { uuidv7 } from '@beeblock/svelar/support';
import { AgentBotDelivery } from '../../domain/models/AgentBotDelivery.js';
export type BotDelivery = { id: string; workspaceId: string; nodeId: string; bindingId: string; state: 'queued' | 'sending' | 'accepted' | 'uncertain' | 'cancelled'; lease: string | null };
function map(row: AgentBotDelivery): BotDelivery {
  return { id: row.getAttribute('id'), workspaceId: row.getAttribute('workspace_id'), nodeId: row.getAttribute('node_id'), bindingId: row.getAttribute('binding_id'), state: row.getAttribute('state') as BotDelivery['state'], lease: row.getAttribute('lease_token') ?? null };
}
export class BotDeliveryRepository {
  async find(id: string) { const row = await AgentBotDelivery.find(id); return row ? map(row) : null; }
  async create(workspaceId: string, nodeId: string, bindingId: string, messageId: string) {
    const previous = await AgentBotDelivery.find(messageId);
    if (previous) return map(previous);
    const now = new Date().toISOString();
    return map(await AgentBotDelivery.create({ id: messageId, workspace_id: workspaceId, node_id: nodeId, binding_id: bindingId, state: 'queued', lease_token: null, created_at: now, updated_at: now }));
  }
  async pending(limit = 50, afterId?: string) {
    const query = AgentBotDelivery.query().whereIn('state', ['queued', 'sending']);
    if (afterId) query.where('id', '>', afterId);
    return (await query.orderBy('id').limit(limit).get()).map(map);
  }
  async claim(delivery: BotDelivery): Promise<BotDelivery | null> {
    const lease = uuidv7();
    const query = AgentBotDelivery.query().where('id', delivery.id).whereIn('state', ['queued', 'sending']);
    if (delivery.lease) query.where('lease_token', delivery.lease); else query.whereNull('lease_token');
    const changed = await query.update({ state: 'sending', lease_token: lease, updated_at: new Date().toISOString() });
    return changed ? { ...delivery, state: 'sending', lease } : null;
  }
  async settle(delivery: BotDelivery, state: BotDelivery['state']) {
    await AgentBotDelivery.query().where('id', delivery.id).where('lease_token', delivery.lease!).update({ state, updated_at: new Date().toISOString() });
  }
}
export const botDeliveryRepository = new BotDeliveryRepository();
