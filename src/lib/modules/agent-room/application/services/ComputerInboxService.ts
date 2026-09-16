import { createHash } from 'node:crypto';
import { uuidv7 } from '@beeblock/svelar/support';
import type { ComputerAccessibility } from '../../contracts/schemas/computer.schema.js';
import type { ComputerReplyGrant } from '../../contracts/schemas/computer-reply.schema.js';
import { computerInboxRepository, isInboxHandled, type ComputerInboxState } from '../../infrastructure/repositories/ComputerInboxRepository.js';
import { incomingDigest } from '../adapters/computers/reply-scope.js';
import { conversationMemoryService } from './ConversationMemoryService.js';
import { AgentComputerAction } from '../../domain/models/AgentComputerAction.js';

function identity(grant: ComputerReplyGrant) {
  return createHash('sha256').update(JSON.stringify([grant.id, grant.nodeId, grant.agentId, grant.taskId, grant.applicationId, grant.recipient])).digest('hex');
}
function assertIdentity(state: ComputerInboxState | null, grant: ComputerReplyGrant): asserts state is ComputerInboxState {
  if (!state || state.identity !== identity(grant)) throw new Error('Conversation inbox identity changed. Review the authorization before continuing.');
}

export class ComputerInboxService {
  async ingest(workspaceId: string, grant: ComputerReplyGrant, tree: ComputerAccessibility) {
    if (!tree.available || tree.truncated) throw new Error('Complete native input is required; pending messages were preserved.');
    const incoming = tree.elements.map(element => ({ digest: incomingDigest(element), text: [element.name, element.value].filter(Boolean).join('\n') }));
    if (new Set(incoming.map(m => m.digest)).size !== incoming.length) throw new Error('Native message identities are ambiguous; pending messages were preserved.');
    const previous = await computerInboxRepository.read(workspaceId, grant.id);
    if (previous) {
      assertIdentity(previous, grant);
      if (incoming.every(m => previous.seen.includes(m.digest)) && !previous.messages.some(m => isInboxHandled(m) && m.receivedAt < Date.now() - 14 * 86400_000)) return previous;
      const fresh = incoming.filter(m => !previous.seen.includes(m.digest));
      if (previous.messages.filter(m => !isInboxHandled(m)).length + fresh.length > 128) throw new Error('Conversation inbox is full. Resolve pending messages before continuing.');
      // Journal before marking inputs seen, so a storage failure can be retried.
      // Initial history is only a baseline, never silently imported into memory.
      await conversationMemoryService.observe(workspaceId, grant, fresh);
    }
    return computerInboxRepository.change(workspaceId, grant.id, state => {
      if (!state) return { identity: identity(grant), seen: incoming.map(m => m.digest), messages: [], lastIncomingAt: 0 };
      assertIdentity(state, grant);
      const fresh = incoming.filter(m => !state.seen.includes(m.digest));
      // Bound retained content without ever silently dropping unprocessed questions.
      const cutoff = Date.now() - 14 * 86400_000;
      const pending = state.messages.filter(m => !isInboxHandled(m));
      const history = state.messages.filter(m => isInboxHandled(m) && m.receivedAt > cutoff).slice(-64);
      if (pending.length + fresh.length > 128) throw new Error('Conversation inbox is full. Resolve pending messages before continuing.');
      return { ...state, seen: [...state.seen, ...fresh.map(m => m.digest)].slice(-4096), lastIncomingAt: fresh.length ? Date.now() : state.lastIncomingAt,
        messages: [...history, ...pending, ...fresh.map(m => ({ ...m, receivedAt: Date.now(), status: 'pending' as const, batchId: null, dispatchedAt: null, attempts: 0 }))],
      };
    });
  }

  async claim(workspaceId: string, grant: ComputerReplyGrant, quietMs: number) {
    const ready = (state: ComputerInboxState | null) => {
      assertIdentity(state, grant);
      if (state.messages.some(m => m.status === 'uncertain')) throw new Error('A previous reply is uncertain. Inspect its draft/receipt before continuing; new messages remain queued.');
      if (Date.now() - state.lastIncomingAt < quietMs) return false;
      const active = state.messages.filter(m => m.status === 'dispatched');
      if (active.some(m => Date.now() - (m.dispatchedAt ?? 0) < 120_000)) return false;
      if (active.some(m => m.attempts >= 3)) throw new Error('The agent did not acknowledge the conversation batch. Pending questions remain queued.');
      return active.length > 0 || state.messages.some(m => m.status === 'pending');
    };
    if (!ready(await computerInboxRepository.read(workspaceId, grant.id))) return null;
    let batchId: string | null = null;
    const state = await computerInboxRepository.change(workspaceId, grant.id, state => {
      assertIdentity(state, grant);
      // Re-evaluate after every CAS retry: an acknowledgment may have arrived meanwhile.
      batchId = null;
      if (!ready(state)) return state;
      const active = state.messages.filter(m => m.status === 'dispatched');
      batchId = active[0]?.batchId ?? uuidv7();
      let characters = 0, count = 0;
      for (const m of state.messages) {
        if (active.length ? m.batchId !== batchId || m.status !== 'dispatched' : m.status !== 'pending') continue;
        if (count >= 20 || characters + m.text.length > 60_000) break;
        m.batchId = batchId; m.dispatchedAt = Date.now(); m.status = 'dispatched'; m.attempts++;
        characters += m.text.length; count++;
      }
      return state;
    });
    if (!batchId) return null;
    const messages = state.messages.filter(m => m.batchId === batchId);
    if (!messages.length) throw new Error('The next conversation message exceeds the batch budget. Nothing was discarded.');
    const digest = messages.at(-1)!.digest;
    const action = await AgentComputerAction.query().where('workspace_id', workspaceId).where('node_id', grant.nodeId).where('actor_id', grant.agentId).where('command', 'reply').where('idempotency_key', `reply:${grant.id}:${digest}`).first();
    const notAttempted = !action || (action.getAttribute('status') === 'gated' && JSON.parse(String(action.getAttribute('result_json') || '{}')).submission === 'not_attempted');
    const deliveryState = notAttempted ? 'not_attempted' : action?.getAttribute('status') === 'succeeded' ? 'submitted' : 'inspect_required';
    return { grantId: grant.id, batchId, inReplyToDigest: digest, deliveryState, originalRequestRequired: Boolean(action && notAttempted), dispatchAttempt: Math.max(...messages.map(m => m.attempts)), messages: messages.map(({ digest, text }) => ({ digest, text })),
      context: state.messages.filter(m => m.status === 'replied').slice(-10).map(({ text }) => ({ text })), pendingAfter: state.messages.filter(m => m.status === 'pending').length };
  }

  async releaseUndispatched(workspaceId: string, grant: ComputerReplyGrant, batchId: string) {
    await computerInboxRepository.change(workspaceId, grant.id, state => {
      assertIdentity(state, grant);
      for (const m of state.messages) if (m.batchId === batchId && m.status === 'dispatched') {
        m.status = 'pending'; m.batchId = null; m.dispatchedAt = null; m.attempts = Math.max(0, m.attempts - 1);
      }
      return state;
    });
  }

  async validateUnbatched(workspaceId: string, grant: ComputerReplyGrant, digest: string) {
    const state = await computerInboxRepository.read(workspaceId, grant.id);
    if (!state) return;
    assertIdentity(state, grant);
    if (state.messages.some(m => m.digest === digest && m.batchId)) throw new Error('This message belongs to a conversation batch. Read the full event and pass its batchId before replying.');
  }

  async validateBatch(workspaceId: string, grant: ComputerReplyGrant, batchId: string, digest: string) {
    const state = await computerInboxRepository.read(workspaceId, grant.id); assertIdentity(state, grant);
    const messages = state.messages.filter(m => m.batchId === batchId);
    if (!messages.length || messages.at(-1)!.digest !== digest || messages.some(m => !['dispatched', 'replied'].includes(m.status))) throw new Error('The conversation batch is missing, changed or uncertain.');
    return messages;
  }

  async acknowledge(workspaceId: string, grant: ComputerReplyGrant, batchId: string | undefined, digest: string, status: 'replied' | 'uncertain') {
    if (!await computerInboxRepository.read(workspaceId, grant.id)) return;
    await computerInboxRepository.change(workspaceId, grant.id, state => {
      assertIdentity(state, grant);
      for (const m of state.messages) if (batchId ? m.batchId === batchId : m.digest === digest) m.status = status;
      return state;
    });
  }

  async skipBatch(workspaceId: string, grant: ComputerReplyGrant, batchId: string, digest: string, reason: 'already_answered' | 'no_response_needed') {
    let count = 0;
    await computerInboxRepository.change(workspaceId, grant.id, state => {
      assertIdentity(state, grant);
      const messages = state.messages.filter(m => m.batchId === batchId);
      if (!messages.length || messages.at(-1)!.digest !== digest || messages.some(m => m.status !== 'dispatched' && !(m.status === 'skipped' && m.resolution === reason))) throw new Error('Only this exact dispatched batch can be acknowledged without a reply; uncertain or answered sends cannot be cleared.');
      count = messages.length;
      for (const message of messages) { message.status = 'skipped'; message.resolution = reason; }
      return state;
    });
    return count;
  }

  async reopenUnsubmitted(workspaceId: string, grant: ComputerReplyGrant, digest: string) {
    if (!await computerInboxRepository.read(workspaceId, grant.id)) return;
    await computerInboxRepository.change(workspaceId, grant.id, state => {
      assertIdentity(state, grant);
      const target = state.messages.find(m => m.digest === digest);
      if (!target || isInboxHandled(target)) throw new Error('The original inbox message cannot be reopened.');
      for (const message of state.messages) if (target.batchId ? message.batchId === target.batchId : message.digest === digest) {
        message.status = 'dispatched'; message.dispatchedAt = 0; message.attempts = 0;
      }
      return state;
    });
  }
}
export const computerInboxService = new ComputerInboxService();
