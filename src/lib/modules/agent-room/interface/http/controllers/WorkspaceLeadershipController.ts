import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { FormValidationError, FormAuthorizationError } from '@beeblock/svelar/forms';
import { ZodError } from 'zod/v3';
import { workspaceLeadershipService } from '../../../application/services/WorkspaceLeadershipService.js';
import { WorkspaceLeadershipDto } from '../../../application/dto/WorkspaceLeadershipDto.js';
import { WorkspaceLeadershipRequest } from '../requests/WorkspaceLeadershipRequest.js';
import { bridgeService } from '../../../application/services/BridgeService.js';
import { ptySessionManager } from '../../../infrastructure/pty/PtySessionManager.js';
import { bridgeLeadershipCommandSchema, LeadershipError } from '../../../contracts/schemas/leadership.schema.js';

export class WorkspaceLeadershipController extends Controller {
  async show(event: RequestEvent) {
    try { return this.json({ data: await workspaceLeadershipService.snapshot(event.params.id) }); }
    catch (error) { return this.failure(error); }
  }
  async command(event: RequestEvent) {
    try {
      const input = await WorkspaceLeadershipRequest.validate(event);
      return this.json({ data: await workspaceLeadershipService.execute(new WorkspaceLeadershipDto(event.params.id, input), { kind: 'owner' }) });
    } catch (error) { return this.failure(error); }
  }
  private token(event: RequestEvent, body?: string | null): string {
    return String(body ?? event.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? event.url.searchParams.get('token') ?? '');
  }
  async bridgeShow(event: RequestEvent) {
    try {
      const workspace = await bridgeService.resolveWorkspaceByToken(this.token(event));
      return this.json({ data: await workspaceLeadershipService.snapshot(workspace.id) });
    } catch (error) { return this.failure(error); }
  }
  async bridgeCommand(event: RequestEvent) {
    try {
      const parsed = bridgeLeadershipCommandSchema.parse(await event.request.json());
      const workspace = await bridgeService.resolveWorkspaceByToken(this.token(event, parsed.token));
      const nodeId = ptySessionManager.resolveBridgeAgent(workspace.id, String(event.request.headers.get('x-orkestrai-agent-token') ?? ''));
      if (!nodeId) throw new LeadershipError('leadership_terminal_required', 403);
      if (parsed.from && (await bridgeService.callerAgent(workspace.id, parsed.from)).nodeId !== nodeId) throw new LeadershipError('leadership_identity', 403);
      return this.json({ data: await workspaceLeadershipService.execute(new WorkspaceLeadershipDto(workspace.id, parsed.input), { kind: 'agent', nodeId }) });
    } catch (error) { return this.failure(error); }
  }
  private failure(error: unknown) {
    if (error instanceof LeadershipError) return this.json({ error: error.code, code: error.code }, error.status);
    if (error instanceof ZodError || error instanceof FormValidationError || error instanceof FormAuthorizationError || error instanceof SyntaxError) return this.json({ error: 'leadership_invalid', code: 'leadership_invalid' }, 400);
    return this.json({ error: 'leadership_unavailable', code: 'leadership_unavailable' }, 500);
  }
}
