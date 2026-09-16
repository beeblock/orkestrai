import { createHash } from 'node:crypto';
import { z } from '@beeblock/svelar/validation';
import type { ComputerReplyGrant } from '../../contracts/schemas/computer-reply.schema.js';
import { getAgentAdapter } from '../adapters/registry.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { companionInstructions, companionPolicyService, redactCompanionSource } from './CompanionPolicyService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { computerInboxService } from './ComputerInboxService.js';
import { terminalExecutionRuntime } from '../../domain/runtime.js';
import { providerProfileService } from './ProviderProfileService.js';
import type { TerminalNodePayload } from '../../domain/types.js';

const eventSchema = z.object({ reply: z.object({ grantId: z.string().uuid(), batchId: z.string().uuid(), inReplyToDigest: z.string().regex(/^[a-f0-9]{64}$/), messages: z.array(z.object({ digest: z.string(), text: z.string().max(60000) })).min(1).max(20) }) });

export class CompanionResponseService {
  async respond(workspaceId: string, grant: ComputerReplyGrant, event: string, windowId: string, runId: string, signal: AbortSignal, assertCurrent: () => Promise<void>) {
    const input = eventSchema.parse(JSON.parse(event));
    if (input.reply.grantId !== grant.id || grant.companion?.execution !== 'restricted') throw new Error('Restricted conversation identity changed.');
    const node = await workspaceRepository.getNode(grant.agentId);
    if (!node || node.workspaceId !== workspaceId || node.type !== 'terminal') throw new Error('Companion agent not found.');
    const payload = node.payload as TerminalNodePayload;
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace || workspace.suspendedAt) throw new Error('Companion workspace is unloaded.');
    if (terminalExecutionRuntime(workspace, payload).kind === 'wsl') throw new Error('Restricted companion currently requires a native provider runtime.');
    const adapter = getAgentAdapter(String(payload.provider));
    if (!adapter.respondPrivately) throw new Error('This provider has no verified restricted responder. No unrestricted fallback is allowed.');
    const revision = createHash('sha256').update(JSON.stringify(grant)).digest('hex');
    const validate = async () => {
      signal.throwIfAborted(); await assertCurrent();
      const live = (await autonomyPolicyService.get(workspaceId)).policy.computerReplyGrants.find(g => g.id === grant.id && g.enabled);
      if (!live || createHash('sha256').update(JSON.stringify(live)).digest('hex') !== revision) throw new Error('Companion policy changed while responding.');
      await computerInboxService.validateBatch(workspaceId, live, input.reply.batchId, input.reply.inReplyToDigest);
    };
    await validate();
    const { conversationMemoryService } = await import('./ConversationMemoryService.js');
    const memory = await conversationMemoryService.context(workspaceId, grant, input.reply.messages.map(m => m.text).join('\n'));
    // Fetch memory from its authorized service, not an injected event envelope.
    const content = JSON.stringify(redactCompanionSource({ untrustedMessages: input.reply.messages, untrustedMemory: memory }));
    const operation = { workspaceId, capability: 'agent' as const, operation: 'companion.respond_restricted', actorType: 'agent' as const, actorId: grant.agentId, runId, mutation: false };
    await autonomyPolicyService.recordSemanticEffect(operation, { grantId: grant.id, batchId: input.reply.batchId, state: 'started' });
    const profileEnv = payload.profileId && payload.provider ? await providerProfileService.resolveEnv(payload.profileId, payload.provider) : undefined;
    const answer = await adapter.respondPrivately({ launchArgs: payload.args, profileEnv, signal, instructions: `${companionInstructions(grant)}\nReturn JSON with only a text field, at most ${grant.maxCharacters} characters. This restricted responder can converse and recall supplied per-contact memory, but cannot run shell commands, access files, create images or perform scheduled actions. Never claim an action has been done. Refer action requests to the workspace owner without technical jargon.`, content });
    const text = await companionPolicyService.publication(workspaceId, grant, answer, grant.agentId);
    await validate();
    const { computerService } = await import('./ComputerService.js');
    const result = await computerService.execute(workspaceId, { command: 'reply', targetId: windowId, grantId: grant.id, batchId: input.reply.batchId, inReplyToDigest: input.reply.inReplyToDigest, text }, { actorType: 'agent', actorId: grant.agentId, taskId: grant.taskId, runId, idempotencyKey: `companion:${input.reply.batchId}`, risk: 'external_publication', assertRelevant: validate });
    await autonomyPolicyService.recordSemanticEffect(operation, { grantId: grant.id, batchId: input.reply.batchId, state: 'submitted', delivery: 'unconfirmed' });
    return { detail: 'Restricted companion response submitted; external delivery is unconfirmed.', result: result.kind, target: node.title };
  }
}
export const companionResponseService = new CompanionResponseService();
