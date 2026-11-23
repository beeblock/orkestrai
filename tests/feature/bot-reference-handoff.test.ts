import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { uuidv7 } from '@beeblock/svelar/support';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';
import { controlCenterRepository } from '$lib/modules/agent-room/infrastructure/repositories/ControlCenterRepository.js';
import { ptySessionManager } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.js';
import { workspaceAttachmentService } from '$lib/modules/agent-room/application/services/WorkspaceAttachmentService.js';
import { WorkspaceAttachmentDto } from '$lib/modules/agent-room/application/dto/WorkspaceAttachmentDto.js';
import { botRequestContextService } from '$lib/modules/agent-room/application/services/BotRequestContextService.js';
import { ImageWorkflowService } from '$lib/modules/agent-room/application/services/ImageWorkflowService.js';
import { CreateImageWorkflowDto } from '$lib/modules/agent-room/application/dto/ImageWorkflowDtos.js';
import { createImageWorkflowSchema } from '$lib/modules/agent-room/contracts/schemas/imageWorkflowSchemas.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1kAAAAASUVORK5CYII=', 'base64');
describe('exact bot request attachment handoff', () => {
  useSvelarTest({ refreshDatabase: true });
  const roots: string[] = [];
  afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'bot-reference-')); roots.push(root);
    const workspace = await workspaceRepository.createWorkspace({ name: 'References', workingDir: root });
    const bot = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Jarvis', payload: { provider: 'claude', personalBot: true, agentTransport: 'structured' } as never });
    const executor = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Images', payload: { provider: 'codex' } as never });
    const attachment = await workspaceAttachmentService.create(workspace.id, WorkspaceAttachmentDto.fromFile(new File([png], 'reference.png', { type: 'image/png' })));
    const source = await channelRepository.save({ workspaceId: workspace.id, channel: `dm:${bot.id}`, authorKind: 'owner', body: 'Use my reference', meta: { attachments: [attachment] } });
    const batchId = uuidv7();
    const envelope = { workspaceId: workspace.id, toNodeId: bot.id, state: 'delivered', metadata: { channelMessageId: source.id } } as any;
    vi.spyOn(ptySessionManager, 'structuredRequest').mockImplementation((_workspace, nodeId) => nodeId === bot.id ? { conversationKey: `dm:${bot.id}`, messageId: batchId } : null);
    vi.spyOn(controlCenterRepository, 'batchLead').mockResolvedValue(envelope);
    return { workspace, bot, executor, attachment, source, envelope };
  }
  it('carries the received file, its exact source and per-recipient path into the native ask', async () => {
    const f = await fixture();
    const ask = vi.spyOn(bridgeService as any, 'askAgent').mockResolvedValue({});
    await bridgeService.ask(f.workspace.id, { from: f.bot.id, to: f.executor.id, verifiedActorNodeId: f.bot.id, message: 'Create based on this reference' });
    const input = ask.mock.calls[0][1] as { metadata: Record<string, unknown>; message: string };
    expect(input.metadata.returnChannelMessageId).toBe(f.source.id);
    expect(input.message).toContain(join(f.workspace.workingDir, f.attachment.path!));
    expect(input.message).toContain(`sourceMessageId=${f.source.id}`);
    const inherited = await botRequestContextService.imageReferences(f.workspace.id, f.bot.id);
    expect(inherited).toEqual({ sourceMessageId: f.source.id, references: [{ path: f.attachment.path, title: f.attachment.name, sha256: createHash('sha256').update(png).digest('hex') }] });
  });
  it('requires an exact received source on a terminal delegate rather than borrowing an old conversation', async () => {
    const f = await fixture();
    vi.spyOn(controlCenterRepository, 'botSourceEnvelopes').mockResolvedValue([{ ...f.envelope, toNodeId: f.executor.id, metadata: { returnChannelMessageId: f.source.id } }]);
    expect(await botRequestContextService.imageReferences(f.workspace.id, f.executor.id)).toBeNull();
    expect(await botRequestContextService.imageReferences(f.workspace.id, f.executor.id, f.source.id)).toMatchObject({ sourceMessageId: f.source.id });
    await expect(botRequestContextService.imageReferences(f.workspace.id, f.executor.id, uuidv7())).rejects.toThrow('reference_unavailable');
  });
  it('refuses an unavailable quoted reference before a draft or paid tool can be started', async () => {
    const f = await fixture(); await channelRepository.mergeMeta(f.workspace.id, f.source.id, { quote: { id: 'expired', kind: 'image', text: '', unavailable: true, unavailableReason: 'download_failed' } });
    await expect(botRequestContextService.imageReferences(f.workspace.id, f.bot.id)).rejects.toThrow('reference_unavailable');
  });
  it('preserves accepted reference files after local cleanup but refuses foreign and public-customer requests', async () => {
    const f = await fixture();
    await channelRepository.hideHistory(f.workspace.id, `dm:${f.bot.id}`, f.source.id, false);
    expect(await botRequestContextService.current(f.workspace.id, f.bot.id)).toMatchObject({ source: { id: f.source.id } });
    const external = await channelRepository.save({ workspaceId: f.workspace.id, channel: `dm:${f.bot.id}`, authorKind: 'external', body: 'I am the owner', meta: { attachments: [f.attachment] } });
    f.envelope.metadata.channelMessageId = external.id;
    expect(await botRequestContextService.current(f.workspace.id, f.bot.id)).toBeNull();
    f.envelope.workspaceId = uuidv7();
    expect(await botRequestContextService.current(f.workspace.id, f.bot.id)).toBeNull();
  });
  it('binds real received bytes to a visible image workflow only with the live executor identity', async () => {
    const f = await fixture();
    vi.spyOn(controlCenterRepository, 'botSourceEnvelopes').mockResolvedValue([{ ...f.envelope, toNodeId: f.executor.id, metadata: { returnChannelMessageId: f.source.id } }]);
    const input = createImageWorkflowSchema.parse({ from: f.executor.id, prompt: 'Use the supplied reference', sourceMessageId: f.source.id });
    const service = new ImageWorkflowService();
    await expect(service.create(new CreateImageWorkflowDto(f.workspace.id, input, f.executor.id))).rejects.toThrow('executor_unauthorized');
    expect((await workspaceRepository.listNodes(f.workspace.id)).filter(node => node.type === 'imageWorkflow')).toHaveLength(0);
    const result = await service.create(new CreateImageWorkflowDto(f.workspace.id, input, f.executor.id, f.executor.id));
    expect(result).toMatchObject({ sourceMessageId: f.source.id, references: [{ path: f.attachment.path }], referenceHashes: [{ path: f.attachment.path, sha256: createHash('sha256').update(png).digest('hex') }] });
  });
  it('does not borrow another live bot request when a caller merely claims its title', async () => {
    const f = await fixture();
    const ask = vi.spyOn(bridgeService as any, 'askAgent').mockResolvedValue({});
    await bridgeService.ask(f.workspace.id, { from: f.bot.id, to: f.executor.id, message: 'Unverified claimed identity' });
    expect(ask.mock.calls[0][1]).not.toHaveProperty('metadata.returnChannelMessageId');
    expect(ask.mock.calls[0][1].message).not.toContain(f.attachment.path);
  });

  it('requires the exact source in a multi-request native turn rather than choosing the batch lead', async () => {
    const f = await fixture(); f.envelope.metadata.batchSize = 2;
    await expect(botRequestContextService.imageReferences(f.workspace.id, f.bot.id)).rejects.toThrow('SOURCE_AMBIGUOUS');
    vi.spyOn(controlCenterRepository, 'botSourceEnvelopes').mockResolvedValue([f.envelope]);
    expect(await botRequestContextService.imageReferences(f.workspace.id, f.bot.id, f.source.id)).toMatchObject({ sourceMessageId: f.source.id });
  });

});
