import { uuidv7 } from '@beeblock/svelar/support';
import { Connection } from '@beeblock/svelar/database';
import { z } from '@beeblock/svelar/validation';
import { AgentConversationMemory } from '../../domain/models/AgentConversationMemory.js';
import { AgentConversationMessage } from '../../domain/models/AgentConversationMessage.js';
import { AgentComputerAction } from '../../domain/models/AgentComputerAction.js';
import type { ConversationMemoryFact, ConversationMemoryMessage, ConversationMemorySource } from '../../contracts/schemas/conversation-memory.schema.js';

export type ConversationScope = { workspaceId: string; grantId: string; identity: string };
const sourcesSchema = z.array(z.object({ digest: z.string(), excerpt: z.string(), observedAt: z.string() }).strict()).max(8);
const iso = (value: unknown) => new Date(value as string).toISOString();
function factsQuery(scope: ConversationScope) { return AgentConversationMemory.query().where('workspace_id', scope.workspaceId).where('grant_id', scope.grantId).where('identity', scope.identity); }
function messagesQuery(scope: ConversationScope) { return AgentConversationMessage.query().where('workspace_id', scope.workspaceId).where('grant_id', scope.grantId).where('identity', scope.identity); }
function fact(row: AgentConversationMemory): ConversationMemoryFact {
  return { id: String(row.getAttribute('id')), title: String(row.getAttribute('title')), content: String(row.getAttribute('content')), sources: sourcesSchema.parse(JSON.parse(String(row.getAttribute('sources_json')))), revision: Number(row.getAttribute('revision')), updatedAt: iso(row.getAttribute('updated_at')) };
}
function message(row: AgentConversationMessage): ConversationMemoryMessage {
  return { id: String(row.getAttribute('id')), digest: String(row.getAttribute('digest')), direction: row.getAttribute('direction') as 'incoming' | 'outgoing', content: String(row.getAttribute('content')), observedAt: iso(row.getAttribute('observed_at')) };
}

export class ConversationMemoryRepository {
  async record(scope: ConversationScope, input: Omit<ConversationMemoryMessage, 'id'> & { actionId?: string }): Promise<void> {
    if (await messagesQuery(scope).where('digest', input.digest).first()) return;
    try {
      await AgentConversationMessage.create({ id: uuidv7(), workspace_id: scope.workspaceId, grant_id: scope.grantId, identity: scope.identity, digest: input.digest, direction: input.direction, action_id: input.actionId ?? null, content: input.content, observed_at: input.observedAt });
    } catch (error) { if (!await messagesQuery(scope).where('digest', input.digest).first()) throw error; }
  }

  async read(scope: ConversationScope) {
    const rows = await messagesQuery(scope).orderBy('observed_at', 'desc').orderBy('id', 'desc').limit(5000).get();
    const ids = rows.flatMap(row => row.getAttribute('action_id') ? [String(row.getAttribute('action_id'))] : []);
    const submitted = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += 200) {
      const actions = await AgentComputerAction.query().where('workspace_id', scope.workspaceId).where('status', 'succeeded').whereIn('id', ids.slice(offset, offset + 200)).get();
      for (const action of actions) submitted.add(String(action.getAttribute('id')));
    }
    return { facts: (await factsQuery(scope).orderBy('updated_at', 'desc').limit(256).get()).map(fact), messages: rows.filter(row => row.getAttribute('direction') === 'incoming' || submitted.has(String(row.getAttribute('action_id')))).map(message) };
  }

  async remember(scope: ConversationScope, input: { id?: string; revision?: number; title: string; content: string; sources: ConversationMemorySource[] }): Promise<ConversationMemoryFact> {
    return Connection.transaction(async () => {
      const now = new Date().toISOString();
      const values = { title: input.title, content: input.content, sources_json: JSON.stringify(input.sources), updated_at: now };
      if (input.id) {
        if (!input.revision) throw new Error('Read the current memory revision before editing.');
        const count = await factsQuery(scope).where('id', input.id).where('revision', input.revision).update({ ...values, revision: input.revision + 1 });
        if (!count) throw new Error('Conversation memory changed or does not belong to this conversation.');
        return fact((await factsQuery(scope).where('id', input.id).first())!);
      }
      // Exact retries are idempotent; a changed fact requires an explicit revision.
      const same = await factsQuery(scope).where('title', input.title).where('content', input.content).where('sources_json', values.sources_json).first();
      if (same) return fact(same);
      if (Number(await factsQuery(scope).count()) >= 256) throw new Error('Conversation memory is full. Review or delete facts before adding more.');
      return fact(await AgentConversationMemory.create({ id: uuidv7(), workspace_id: scope.workspaceId, grant_id: scope.grantId, identity: scope.identity, revision: 1, created_at: now, ...values }));
    });
  }

  async forget(scope: ConversationScope, id?: string, revision?: number) {
    return Connection.transaction(async () => {
      if (id) {
        if (!revision || !await factsQuery(scope).where('id', id).where('revision', revision).delete()) throw new Error('Conversation memory changed; read its current revision before deleting.');
        return;
      }
      await factsQuery(scope).delete();
      await messagesQuery(scope).delete();
    });
  }

  async prune(scope: ConversationScope, retentionDays: number) {
    await messagesQuery(scope).where('observed_at', '<', new Date(Date.now() - retentionDays * 86400_000).toISOString()).delete();
    const rows = await messagesQuery(scope).orderBy('observed_at', 'desc').orderBy('id', 'desc').get();
    let bytes = 0;
    const expired = rows.filter((row, index) => { bytes += Buffer.byteLength(String(row.getAttribute('content')), 'utf8'); return index >= 5000 || bytes > 16 * 1024 * 1024; });
    for (let offset = 0; offset < expired.length; offset += 200) await messagesQuery(scope).whereIn('id', expired.slice(offset, offset + 200).map(row => String(row.getAttribute('id')))).delete();
  }

  async removeGrant(workspaceId: string, grantId: string) {
    await Connection.transaction(async () => {
      await AgentConversationMemory.query().where('workspace_id', workspaceId).where('grant_id', grantId).delete();
      await AgentConversationMessage.query().where('workspace_id', workspaceId).where('grant_id', grantId).delete();
    });
  }

  async removeOrphans(workspaceId: string, grantIds: string[]) {
    for (const model of [AgentConversationMemory, AgentConversationMessage]) {
      const rows = await model.query().where('workspace_id', workspaceId).get();
      const orphanIds = [...new Set(rows.map(row => String(row.getAttribute('grant_id'))))].filter(id => !grantIds.includes(id));
      for (const id of orphanIds) await this.removeGrant(workspaceId, id);
    }
  }
}
export const conversationMemoryRepository = new ConversationMemoryRepository();
