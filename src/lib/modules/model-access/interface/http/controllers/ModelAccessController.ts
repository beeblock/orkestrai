import { Controller } from '@beeblock/svelar/routing';
import { z } from '@beeblock/svelar/validation';
import { modelAccessService } from '../../../application/services/ModelAccessService.js';
import { CreateModelAccessDto, JoinModelAccessDto, ApproveModelAccessDto } from '../../../application/dto/ModelAccessDto.js';
import { CreateModelAccessRequest, JoinModelAccessRequest, ApproveModelAccessRequest, ReviseModelAccessRequest, ModelAccessActionRequest } from '../requests/ModelAccessRequest.js';
export class ModelAccessController extends Controller {
  private async result(fn: () => Promise<unknown>, status = 200) {
    try { return this.json({ data: await fn() }, status); }
    catch (error) {
      // Validation and provider failures must never echo invitations, prompts or credentials.
      const message = error instanceof Error && /^(?:MODEL_ACCESS|INFERENCE)_[A-Z_]+$/.test(error.message) ? error.message : 'MODEL_ACCESS_REQUEST_FAILED';
      return this.json({ error: message }, message.includes('NOT_FOUND') ? 404 : message.includes('CONFLICT') ? 409 : 400);
    }
  }
  private id(event: any) { return z.string().uuid().parse(event.params.id); }
  events(event: any) {
    const encoder = new TextEncoder(); let cleanup = () => {};
    const stream = new ReadableStream({ start(controller) {
      const send = () => { try { controller.enqueue(encoder.encode('event: changed\ndata: {}\n\n')); } catch { cleanup(); } };
      const unsubscribe = modelAccessService.subscribe(send);
      const timer = setInterval(() => { try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { cleanup(); } }, 25000); timer.unref?.();
      cleanup = () => { unsubscribe(); clearInterval(timer); event.request.signal.removeEventListener('abort', cleanup); };
      event.request.signal.addEventListener('abort', cleanup, { once: true }); send();
    }, cancel() { cleanup(); } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  }
  index() { return this.result(() => modelAccessService.status()); }
  create(event: any) { return this.result(async () => modelAccessService.create(CreateModelAccessDto.from(await CreateModelAccessRequest.validate(event))), 201); }
  join(event: any) { return this.result(async () => modelAccessService.join(JoinModelAccessDto.from(await JoinModelAccessRequest.validate(event))), 201); }
  approve(event: any) { return this.result(async () => modelAccessService.approve(ApproveModelAccessDto.from(this.id(event), await ApproveModelAccessRequest.validate(event)))); }
  revise(event: any) { return this.result(async () => modelAccessService.revise(this.id(event), await ReviseModelAccessRequest.validate(event))); }
  action(event: any) { return this.result(async () => {
    const input = await ModelAccessActionRequest.validate(event), id = this.id(event);
    if (input.action === 'invite') return modelAccessService.invite(id);
    if (input.action === 'disconnect') return modelAccessService.disconnect(id);
    if (!input.revision) throw new Error('MODEL_ACCESS_REVISION_REQUIRED');
    return modelAccessService.revoke(id, input.revision);
  }); }
  audits(event: any) { return this.result(async () => modelAccessService.audits(this.id(event))); }
}
