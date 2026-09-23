import { Controller, type RequestEvent } from '@beeblock/svelar/routing';
import { z } from 'zod';
import { knowledgeService } from '../../../application/services/KnowledgeService.js';
import { bridgeService } from '../../../application/services/BridgeService.js';
import { KnowledgeCommandDto } from '../../../application/dto/KnowledgeCommandDto.js';
import { KnowledgeCommandRequest, KnowledgeUploadRequest } from '../requests/KnowledgeCommandRequest.js';
import { knowledgeQuerySchema } from '../../../contracts/schemas/knowledge.schema.js';
import { ptySessionManager } from '../../../infrastructure/pty/PtySessionManager.ts';

export class KnowledgeController extends Controller {
  async index(event: RequestEvent) {
    try {
      const workspaceId = await this.workspaceId(event);
      const id = event.url.searchParams.get('id');
      if (id) return this.json({ data: await knowledgeService.read(workspaceId, z.string().max(100).parse(id)) });
      const query = knowledgeQuerySchema.parse({ query: event.url.searchParams.get('q') ?? '', kind: event.url.searchParams.get('kind') || undefined, tag: event.url.searchParams.get('tag') || undefined, limit: event.url.searchParams.get('limit') ?? 150 });
      const data = await knowledgeService.search(workspaceId, query);
      if (event.params.id && event.url.searchParams.get('live') === '1') await knowledgeService.watch(workspaceId);
      return this.json({ data });
    } catch (error) { return this.failure(error); }
  }
  async store(event: RequestEvent) {
    try {
      const workspaceId = await this.workspaceId(event);
      const input = await KnowledgeCommandRequest.validate({ ...event, params: {} });
      const author = event.params.id ? undefined : ptySessionManager.resolveBridgeAgent(workspaceId, event.request.headers.get('x-orkestrai-agent-token') ?? '') ?? undefined;
      return this.json({ data: await knowledgeService.execute(new KnowledgeCommandDto(workspaceId, input, author)) });
    } catch (error) { return this.failure(error); }
  }
  async upload(event: RequestEvent) {
    try {
      const { file, ...placement } = await KnowledgeUploadRequest.validate(event);
      return this.json({ data: await knowledgeService.upload(event.params.id, file, placement) }, 201);
    } catch (error) { return this.failure(error); }
  }
  async file(event: RequestEvent) {
    try {
      const nodeId = z.string().uuid().parse(event.url.searchParams.get('nodeId'));
      const file = await knowledgeService.file(event.params.id, nodeId);
      return new Response(file.bytes, { headers: { 'Content-Type': file.extension === '.pdf' ? 'application/pdf' : 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } });
    } catch (error) { return this.failure(error); }
  }
  private async workspaceId(event: RequestEvent) {
    if (event.params.id) return event.params.id;
    const token = event.request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    return (await bridgeService.resolveWorkspaceByToken(token)).id;
  }
  private failure(error: unknown) {
    const code = error instanceof Error && error.message.startsWith('knowledge_') ? error.message : 'knowledge_request_failed';
    return this.json({ error: code }, 422);
  }
}
