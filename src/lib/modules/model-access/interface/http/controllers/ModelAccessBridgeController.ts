import { Controller } from '@beeblock/svelar/routing';
import { join } from 'node:path';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { guestAgentService } from '../../../application/services/GuestAgentService.js';
import { modelAccessService } from '../../../application/services/ModelAccessService.js';
import { CreateModelAccessDto, GuestAgentDto } from '../../../application/dto/ModelAccessDto.js';
import { GuestAgentRequest, BridgeModelAccessRequest } from '../requests/GuestAgentRequest.js';

export class ModelAccessBridgeController extends Controller {
  private async actor(event: any) {
    const token = String(event.request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const workspace = await bridgeService.resolveWorkspaceByToken(token);
    const agentToken = String(event.request.headers.get('x-orkestrai-agent-token') ?? '');
    const nodeId = ptySessionManager.resolveBridgeAgent(workspace.id, agentToken);
    if (!nodeId || workspace.suspendedAt || !(await autonomyPolicyService.runWindow(workspace.id, 'model_access')).allowed) throw new Error('MODEL_ACCESS_AGENT_IDENTITY');
    return { workspace, nodeId, token, agentToken };
  }
  private failure(error: unknown) {
    const message = error instanceof Error && /^(?:INFERENCE|MODEL_ACCESS)_[A-Z_]+$/.test(error.message) ? error.message : 'MODEL_ACCESS_REQUEST_FAILED';
    return this.json({ error: message }, message.includes('IDENTITY') ? 403 : 400);
  }
  async command(event: any) {
    try {
      const { workspace, nodeId } = await this.actor(event), input = await BridgeModelAccessRequest.validate(event);
      if (input.operation === 'status') return this.json({ data: await modelAccessService.status() });
      const task = (await taskBoardService.list(workspace.id)).find(item => item.id === input.taskId);
      if (!task || task.assigneeNodeId !== nodeId || ['todo','done'].includes(task.status)) throw new Error('MODEL_ACCESS_ACTIVE_TASK_REQUIRED');
      const run: () => Promise<unknown> = () => input.operation === 'propose' ? modelAccessService.create(CreateModelAccessDto.from(input.input)) : input.operation === 'revoke' ? modelAccessService.revoke(input.grantId,input.revision) : modelAccessService.disconnect(input.connectionId);
      const result = await autonomyPolicyService.execute({workspaceId:workspace.id,capability:'agent',operation:`model_access.${input.operation}`,actorType:'agent',actorId:nodeId,mutation:true,input:{taskId:input.taskId},auditOutput:()=>({operation:input.operation})},run);
      return this.json({ data:result });
    } catch (error) { return this.failure(error); }
  }
  async agent(event: any) {
    try {
      const { workspace, nodeId, token, agentToken } = await this.actor(event);
      const input = await GuestAgentRequest.validate(event);
      const controller = new AbortController(); const abort = () => controller.abort();
      event.request.signal.addEventListener('abort', abort, { once: true });
      const stream = new TransformStream<Uint8Array, Uint8Array>(), writer = stream.writable.getWriter(), encoder = new TextEncoder();
      const send = (event: string, text: string) => writer.write(encoder.encode(JSON.stringify({ event, text }) + '\n'));
      void writer.closed.catch(abort);
      const bridge = async (method: string, path: string, body?: unknown) => {
        if (!path.startsWith('/api/agent-room/bridge/')) throw new Error('INFERENCE_GUEST_TOOL_ROUTE');
        // The guest's live terminal identity stays on this computer. It never enters model input.
        const response = await event.fetch(path, { method, headers: { authorization: `Bearer ${token}`, 'x-orkestrai-agent-token': agentToken, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
        const payload = await response.json(); if (!response.ok || payload.error) throw new Error(typeof payload.error === 'string' ? payload.error : 'Guest tool failed.');
        return payload.data;
      };
      const env = { ORKESTRAI_NODE_ID: nodeId, ORKESTRAI_AGENT_TITLE: nodeId, ORKESTRAI_AGENT_TOKEN: agentToken, ORKESTRAI_WORKSPACE_CONFIG: join(workspace.workingDir, '.orkestrai/workspace.json'), ORKESTRAI_API_URL: event.url.origin };
      void guestAgentService.run(GuestAgentDto.from(workspace.id, nodeId, input), { signal: controller.signal, emit: send, bridge, env }).then(() => send('done','')).catch(async error => {
        const code = error instanceof Error && /^(?:INFERENCE|MODEL_ACCESS)_[A-Z_]+$/.test(error.message) ? error.message : 'INFERENCE_FAILED';
        await send('error', code).catch(() => {});
      }).finally(async () => { controller.abort(); event.request.signal.removeEventListener('abort', abort); await writer.close().catch(() => {}); });
      return new Response(stream.readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    } catch (error) { return this.failure(error); }
  }
}
