import { uuidv7 } from '@beeblock/svelar/support';
import { z } from '@beeblock/svelar/validation';
import { AgentComputerInbox } from '../../domain/models/AgentComputerInbox.js';

const messageSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().max(22_000),
  receivedAt: z.number(), status: z.enum(['pending', 'dispatched', 'replied', 'skipped', 'uncertain']),
  resolution: z.enum(['already_answered', 'no_response_needed']).optional(),
  batchId: z.string().uuid().nullable(), dispatchedAt: z.number().nullable(), attempts: z.number().int(),
});
const stateSchema = z.object({
  identity: z.string(), seen: z.array(z.string()).max(4096), messages: z.array(messageSchema).max(256),
  lastIncomingAt: z.number(),
});
export type ComputerInboxState = z.infer<typeof stateSchema>;
export type ComputerInboxMessage = z.infer<typeof messageSchema>;
export const isInboxHandled = (message: ComputerInboxMessage) => message.status === 'replied' || message.status === 'skipped';

export class ComputerInboxRepository {
  async read(workspaceId: string, grantId: string): Promise<ComputerInboxState | null> {
    const row = await AgentComputerInbox.query().where('workspace_id', workspaceId).where('grant_id', grantId).first();
    return row ? stateSchema.parse(JSON.parse(String(row.getAttribute('state_json')))) : null;
  }

  async change(workspaceId: string, grantId: string, update: (current: ComputerInboxState | null) => ComputerInboxState): Promise<ComputerInboxState> {
    // Observation and native submission share the inbox; never overwrite a newer acknowledgment.
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await AgentComputerInbox.query().where('workspace_id', workspaceId).where('grant_id', grantId).first();
      const state = stateSchema.parse(update(row ? stateSchema.parse(JSON.parse(String(row.getAttribute('state_json')))) : null));
      const values = { state_json: JSON.stringify(state), updated_at: new Date() };
      if (!row) {
        try { await AgentComputerInbox.create({ id: uuidv7(), workspace_id: workspaceId, grant_id: grantId, revision: 0, ...values }); return state; }
        catch (error) { if (!await this.read(workspaceId, grantId)) throw error; }
      } else {
        const revision = Number(row.getAttribute('revision'));
        const changed = await AgentComputerInbox.query().where('id', row.getAttribute('id')).where('revision', revision).update({ ...values, revision: revision + 1 });
        if (changed) return state;
      }
    }
    throw new Error('Conversation inbox changed concurrently; no pending messages were discarded.');
  }
}
export const computerInboxRepository = new ComputerInboxRepository();
