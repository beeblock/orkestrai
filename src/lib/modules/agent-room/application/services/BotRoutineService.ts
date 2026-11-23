import { createHash } from 'node:crypto';
import { botRoutineOriginSchema, type BotRoutineOrigin, type BridgeAutomationInput } from '../../contracts/schemas/bridge-automation.schema.js';
import { automationFormSchema } from '../../contracts/schemas/automation.schema.js';
import { AgentRoutine } from '../../domain/models/AgentRoutine.js';
import { AgentRoutineRun } from '../../domain/models/AgentRoutineRun.js';
import type { Routine, TerminalNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '../../infrastructure/repositories/ControlCenterRepository.js';
import { botDeliveryRepository } from '../../infrastructure/repositories/BotDeliveryRepository.js';
import { botRequestContextService } from './BotRequestContextService.js';
import { botSafetyService } from './BotSafetyService.js';
import { routineService } from './RoutineService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { agentInboxService } from './AgentInboxService.js';
import { channelService } from './ChannelService.js';

/** Owner/trusted chat schedules reuse the existing durable runner and native outbox. */
export class BotRoutineService {
  private async source(workspaceId: string, nodeId: string, origin: BotRoutineOrigin) {
    const [workspace, node, source] = await Promise.all([workspaceRepository.getWorkspace(workspaceId), workspaceRepository.getNode(nodeId), channelRepository.find(workspaceId, origin.sourceMessageId)]);
    const payload = node?.payload as TerminalNodePayload | undefined;
    if (!workspace || workspace.suspendedAt || node?.workspaceId !== workspaceId || !payload?.personalBot || payload.agentTransport !== 'structured'
      || origin.nodeId !== nodeId || !source || source.channel !== `dm:${nodeId}`) throw new Error('BOT_ROUTINE_REVOKED');
    if (origin.bindingId) {
      if (source.meta.bindingId !== origin.bindingId || !await botSafetyService.ownerSource(workspaceId, nodeId, origin.bindingId, source.id)) throw new Error('BOT_ROUTINE_REVOKED');
    } else if (source.authorKind !== 'owner') throw new Error('BOT_ROUTINE_REVOKED');
    if (!(await autonomyPolicyService.runWindow(workspaceId, 'bot_routine')).allowed) throw new Error('BOT_ROUTINE_REVOKED');
    return source;
  }

  async execute(workspaceId: string, nodeId: string, request: BridgeAutomationInput, sourceId: string, assertRelevant: () => Promise<void>) {
    const context = await botRequestContextService.current(workspaceId, nodeId, sourceId, request.taskId);
    if (!context || context.source.channel !== `dm:${nodeId}`) throw new Error('BOT_ROUTINE_OWNER_REQUIRED');
    if (context.envelope.metadata.botRoutineRunId && !['list', 'history'].includes(request.input.command)) throw new Error('BOT_ROUTINE_RECURSIVE_AUTHORING_DENIED');
    const origin: BotRoutineOrigin = { sourceMessageId: sourceId, nodeId, bindingId: typeof context.source.meta.bindingId === 'string' ? context.source.meta.bindingId : null, send: true };
    const validate = async () => { await assertRelevant(); await this.source(workspaceId, nodeId, origin); };
    await validate();
    const input = request.input;
    const sameChat = (routine: Routine) => {
      const value = botRoutineOriginSchema.safeParse(routine.actionConfig.botOrigin);
      return routine.workspaceId === workspaceId && routine.authorAgentId === nodeId && routine.targetNodeId === nodeId && !routine.authorTaskId
        && value.success && value.data.nodeId === nodeId && value.data.bindingId === origin.bindingId;
    };
    const owned = async (id: string) => { const routine = await routineService.get(id); if (!routine || !sameChat(routine)) throw new Error('BOT_ROUTINE_NOT_OWNED'); return routine; };
    if (input.command === 'list') return (await routineService.list(workspaceId)).filter(sameChat);
    if (input.command === 'history') { await owned(input.id); return routineService.history(input.id); }
    const hash = createHash('sha256').update(JSON.stringify({ sourceId, input })).digest('hex');
    const key = `bot:${createHash('sha256').update(request.idempotencyKey).digest('hex')}`;
    return autonomyPolicyService.execute({ workspaceId, capability: 'agent', operation: `bot.routine:${input.command}`, mutation: true,
      actorType: 'agent', actorId: nodeId, input: { sourceMessageId: sourceId, requestDigest: hash }, certainty: 'semantic',
      auditOutput: result => ({ id: (result as { id?: string })?.id, command: input.command }) }, async () => {
      await validate();
      if (input.command === 'save') {
        const definition = input.definition;
        const form = automationFormSchema.parse({ name: definition.name, prompt: definition.prompt, actionType: 'prompt_agent', targetNodeId: nodeId,
          triggerType: definition.trigger === 'manual' ? 'manual' : 'schedule', intervalMinutes: definition.trigger === 'interval' ? definition.intervalMinutes : null,
          calendar: definition.trigger === 'calendar' ? definition.calendar : null, enabled: definition.enabled });
        if (input.id) {
          const current = await owned(input.id);
          if (!input.revision) throw new Error('Read the automation revision before editing.');
          const previous = botRoutineOriginSchema.parse(current.actionConfig.botOrigin);
          return routineService.updateAutomation(input.id, form, input.revision, { ...previous, send: definition.delivery === undefined ? previous.send : definition.delivery === 'current_chat' });
        }
        const previous = () => AgentRoutine.query().where('workspace_id', workspaceId).where('author_agent_id', nodeId).where('author_key', key).first();
        const reuse = async (row: AgentRoutine) => { if (row.getAttribute('author_digest') !== hash) throw new Error('This automation key belongs to a different request.'); return owned(String(row.getAttribute('id'))); };
        const existing = await previous(); if (existing) return reuse(existing);
        if ((await routineService.list(workspaceId)).filter(row => row.authorAgentId === nodeId).length >= 100) throw new Error('Agent automation limit reached.');
        try { return await routineService.createAutomation(workspaceId, form, { agentId: nodeId, taskId: null, key, digest: hash, botOrigin: { ...origin, send: definition.delivery !== 'none' } }); }
        catch (error) { const raced = await previous(); if (raced) return reuse(raced); throw error; }
      }
      await owned(input.id);
      const updated = await routineService.setEnabled(input.id, input.command === 'enabled' ? input.enabled : false, input.revision);
      if (input.command === 'cancel') {
        const runs = await AgentRoutineRun.query().where('routine_id', input.id).whereIn('status', ['queued', 'running', 'waiting_approval']).get();
        for (const run of runs) await routineService.cancel(String(run.getAttribute('id')));
      }
      return updated;
    });
  }

  private async current(routine: Routine, runId: string) {
    const [latest, run] = await Promise.all([routineService.get(routine.id), AgentRoutineRun.find(runId)]);
    if (!latest?.enabled || latest.workspaceId !== routine.workspaceId || latest.revision !== routine.revision || latest.targetNodeId !== routine.targetNodeId
      || latest.authorAgentId !== routine.targetNodeId || latest.authorTaskId || !run || run.getAttribute('routine_id') !== routine.id || run.getAttribute('cancel_requested_at')
      || !['queued', 'running'].includes(String(run.getAttribute('status')))) throw new Error('BOT_ROUTINE_REVOKED');
    const input = JSON.parse(String(run.getAttribute('input_json') ?? '{}'));
    if (input.botRoutineRevision !== latest.revision) throw new Error('BOT_ROUTINE_REVOKED');
    const origin = botRoutineOriginSchema.parse(latest.actionConfig.botOrigin);
    return { origin, source: await this.source(routine.workspaceId, routine.targetNodeId!, origin) };
  }

  async relevant(workspaceId: string, nodeId: string, routineId: string, runId: string, revision: unknown) {
    const routine = await routineService.get(routineId);
    if (!routine || routine.workspaceId !== workspaceId || routine.targetNodeId !== nodeId || routine.revision !== revision) return false;
    try { await this.current(routine, runId); return true; }
    catch (error) { if (error instanceof Error && error.message === 'BOT_ROUTINE_REVOKED') return false; throw error; }
  }

  async dispatch(routine: Routine, runId: string, signal: AbortSignal): Promise<Record<string, unknown>> {
    const { origin } = await this.current(routine, runId);
    const previous = await controlCenterRepository.findEnvelope(runId);
    if (previous && (previous.metadata.botRoutineId !== routine.id || previous.metadata.botRoutineRevision !== routine.revision)) throw new Error('BOT_ROUTINE_REVOKED');
    if (!previous) {
      await agentInboxService.enqueue({ messageId: runId, workspaceId: routine.workspaceId, toNodeId: origin.nodeId, fromNodeId: origin.nodeId, kind: 'ask',
        content: `Execute this scheduled occurrence only. Routine ${routine.id}; run ${runId}. Do not create another routine or repeat the original request. Use current information and give its source when requested. Produce the result directly. The service returns the final answer and native files to the configured chat; do not send or post them yourself.\n\n${routine.prompt}`,
        dedupKey: `bot-routine:${runId}`, metadata: { botRoutineId: routine.id, botRoutineRunId: runId, botRoutineRevision: routine.revision, channelMessageId: origin.sourceMessageId,
          ...(origin.bindingId ? { bindingId: origin.bindingId } : {}) } });
    }
    const reply = await agentInboxService.awaitReply(runId, { timeoutMs: 8 * 60_000, busyGraceMs: 8 * 60_000, signal });
    if (reply.state !== 'replied' || !reply.text.trim()) throw new Error(reply.state === 'failed' ? 'BOT_ROUTINE_EXECUTION_FAILED' : 'BOT_ROUTINE_REPLY_PENDING');
    signal.throwIfAborted(); await this.current(routine, runId);
    if (!origin.send) return { detail: 'Scheduled work completed; external delivery disabled.', deliveryState: 'disabled', result: reply.text };
    const saved = await channelService.postStructuredResult(routine.workspaceId, origin.nodeId, origin.sourceMessageId, reply.text, runId, { id: routine.id, runId, revision: routine.revision ?? 1 });
    if (!saved) throw new Error('BOT_ROUTINE_REVOKED');
    if (!origin.bindingId) return { detail: 'Scheduled result posted to the bot conversation.', deliveryState: 'accepted', messageId: saved.id };
    const { botExternalDeliveryService } = await import('./BotExternalDeliveryService.js');
    const deadline = Date.now() + 15_000;
    do {
      signal.throwIfAborted(); await this.current(routine, runId);
      const delivery = await botDeliveryRepository.find(saved.id);
      if (delivery?.state === 'accepted') return { detail: 'Scheduled result accepted by the native chat connection.', deliveryState: 'accepted', messageId: saved.id };
      if (delivery?.state === 'uncertain') throw new Error('BOT_ROUTINE_DELIVERY_UNCERTAIN');
      if (delivery?.state === 'cancelled') throw new Error('BOT_ROUTINE_REVOKED');
      await botExternalDeliveryService.flush();
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    throw new Error('BOT_ROUTINE_DELIVERY_PENDING');
  }
}
export const botRoutineService = new BotRoutineService();
