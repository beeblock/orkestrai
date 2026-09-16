import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComputerMediaService } from '$lib/modules/agent-room/application/services/ComputerMediaService.js';
import { assistantArtifactService } from '$lib/modules/agent-room/application/services/AssistantArtifactService.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { taskBoardService } from '$lib/modules/agent-room/application/services/TaskBoardService.js';
import { AgentComputerAction } from '$lib/modules/agent-room/domain/models/AgentComputerAction.js';
import { attachmentPreview, verifiedPhotoSelection } from '$lib/modules/agent-room/application/adapters/computers/media-scope.js';
import { incomingDigest } from '$lib/modules/agent-room/application/adapters/computers/reply-scope.js';
import { conversationMemoryService } from '$lib/modules/agent-room/application/services/ConversationMemoryService.js';
import { pcm16ToWav } from '$lib/modules/agent-room/infrastructure/voice/EmbeddedVoice.js';
import { voiceService } from '$lib/modules/agent-room/application/services/VoiceService.js';
import type { ComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerAccessibility } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true }); });
async function setup(applicationId = 'test.chat') {
  const root = await mkdtemp(join(tmpdir(), 'ork-media-test-')); folders.push(root);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Native media fixture', workingDir: root });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal' });
  const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'computer', payload: { computerConfig: { enabled: true, allowedApplications: [applicationId] } } });
  const task = await taskBoardService.create(workspace.id, { title: 'Send fixture', assigneeNodeId: agent.id, dispatch: false });
  const element = (id: string, name: string, action: 'press' | 'fill' | null = null) => ({ id, name, role: action === 'fill' ? 'AXTextArea' : action ? 'AXButton' : 'AXStaticText', value: '', enabled: true, protected: false, focused: false, actions: action ? [action] : [] });
  const tree: ComputerAccessibility = { available: true, truncated: false, elements: [element('0.0.0', 'Taylor', 'press'), element('0.0.1', 'Composer', 'fill'), element('0.0.2', 'Send', 'press'), element('0.0.3', 'Attach', 'press')] };
  const selector = (i: number) => { const { id, role, name } = tree.elements[i]; return { id, role, name }; };
  const prior = await autonomyPolicyService.get(workspace.id);
  const policy = await autonomyPolicyService.update(workspace.id, { enabled: true, mode: 'bounded', policy: { ...prior.policy, capabilities: ['filesystem', 'computer'], allowedApps: [applicationId], filesystem: [{ root, permissions: ['read', 'create'], excludeGlobs: [], followSymlinks: false, maxFileSize: 50 * 1024 * 1024 }], computerReplyGrants: [{ id: task.id, enabled: true, nodeId: node.id, agentId: agent.id, taskId: task.id, applicationId, recipient: selector(0), composer: selector(1), send: selector(2), incomingMarker: 'Incoming:', maxCharacters: 1000, maxPerHour: 60, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: true, media: { enabled: true, open: selector(3), send: { id: '0.0.4.1', role: 'AXButton', name: 'Send attachment' }, contentTypes: ['application/pdf'], maxMiB: 20 } }] } });
  const grant = policy.policy.computerReplyGrants[0];
  const bytes = Buffer.from('%PDF-1.7\nprivate-test-content');
  await writeFile(join(root, 'report.pdf'), bytes);
  const input = { command: 'media_send' as const, grantId: grant.id, targetId: 'chat', path: 'report.pdf', expectedHash: createHash('sha256').update(bytes).digest('hex'), source: { kind: 'task' as const, id: task.id } };
  const context = { actorType: 'agent' as const, actorId: agent.id, taskId: task.id, idempotencyKey: 'test-media' };
  const attachFile = vi.fn(async (input) => {
    expect(await readFile(input.path)).toEqual(bytes);
    expect(input.path).not.toBe(join(root, 'report.pdf'));
    tree.elements.push(element('0.0.4.0', 'report.pdf'), element('0.0.4.1', 'Send attachment', 'press'));
    return structuredClone(tree);
  });
  const interact = vi.fn(async (_input: Parameters<NonNullable<ComputerAdapter['interact']>>[0]) => { tree.elements = tree.elements.filter(e => !e.id.startsWith('0.0.4.')); return structuredClone(tree); });
  const adapter = { platform: 'macos', read: async () => structuredClone(tree), attachFile, interact } as unknown as ComputerAdapter;
  const service = new ComputerMediaService(assistantArtifactService, join(root, 'staging'));
  const execute = () => service.execute(workspace.id, input, context, adapter, async () => undefined);
  return { root, workspace, grant, policy, input, context, tree, attachFile, interact, execute, adapter, service };
}

describe('Recipient-bound native attachments', () => {
  useSvelarTest({ refreshDatabase: true });
  // Observed in the installed WhatsApp macOS preview on 2026-09-14. Photos
  // expose recipient, count and caption, but no filename (unlike Documents).
  function whatsappPhotoPreview(s: Awaited<ReturnType<typeof setup>>): ComputerAccessibility {
    return { available: true, truncated: false, elements: [
      { ...s.tree.elements[0], id: '0.0.0.11.0', name: 'Taylor' },
      { ...s.tree.elements[1], id: '0.0.0.9', name: '\u200eCaption text field' },
      { ...s.tree.elements[2], id: '0.0.0.12', name: '\u200eSend' },
      { ...s.tree.elements[0], id: '0.0.0.0', role: 'AXGenericElement', name: '\u200ePhoto', value: '14 September 2026 at 10:08, \u200eOriginal' },
      { ...s.tree.elements[0], id: '0.0.0.7', role: 'AXGenericElement', name: '\u200e1 media item.' },
    ] };
  }
  it.each(['valid', 'no-receipt', 'recipient', 'sidebar', 'caption', 'two-items', 'missing-count', 'duplicate-photo', 'filename', 'another-app', 'truncated'])('guards the observed filename-free WhatsApp photo preview (%s)', async variant => {
    const s = await setup(), preview = whatsappPhotoPreview(s);
    const grant = { ...s.grant, applicationId: variant === 'another-app' ? 'test.chat' : 'net.whatsapp.WhatsApp', media: { ...s.grant.media!, send: { id: '0.0.0.12', role: 'AXButton', name: '\u200eSend' } } };
    if (variant === 'recipient') preview.elements[0].name = 'Another contact';
    if (variant === 'sidebar') preview.elements[0].id = '0.1.0';
    if (variant === 'caption') preview.elements[1].value = 'Human draft';
    if (variant === 'two-items') preview.elements[4].name = '\u200e2 media items.';
    if (variant === 'missing-count') preview.elements.pop();
    if (variant === 'duplicate-photo') preview.elements.push({ ...preview.elements[3], id: '0.0.0.1' });
    if (variant === 'filename') preview.elements.push({ ...preview.elements[3], id: '0.0.0.2', role: 'AXStaticText', name: 'another.png' });
    if (variant === 'truncated') preview.truncated = true;
    const check = () => attachmentPreview(preview, grant, 'photo.png', variant !== 'no-receipt');
    if (variant === 'valid') expect(check()).toMatchObject({ recipient: { name: 'Taylor' }, composer: { value: '' }, file: { name: '\u200ePhoto' }, additionalGuards: [{ name: '\u200e1 media item.' }] });
    else expect(check).toThrow();
  });
  it('binds a native selection receipt to the exact private file, app and window', () => {
    const expected = { path: '/private/staging/photo.png', targetId: '123:cg:4', applicationId: 'net.whatsapp.WhatsApp' };
    expect(verifiedPhotoSelection({ ...expected }, expected)).toBe(true);
    for (const receipt of [undefined, { ...expected, path: '/other/photo.png' }, { ...expected, targetId: '123:cg:5' }, { ...expected, applicationId: 'other.app' }]) expect(verifiedPhotoSelection(receipt, expected)).toBe(false);
  });
  it('submits a verified native photo once and guards the item count again at Send', async () => {
    const s = await setup('net.whatsapp.WhatsApp'), original = structuredClone(s.tree), preview = whatsappPhotoPreview(s);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6sAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(s.root, 'photo.png'), bytes);
    const photo = { open: s.grant.media!.open, menu: { id: '0.9.0', role: 'AXButton', name: '\u200ePhotos and videos' }, send: { id: '0.0.0.12', role: 'AXButton', name: '\u200eSend' } };
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, allowedApps: ['net.whatsapp.WhatsApp'], computerReplyGrants: [{ ...s.grant, applicationId: 'net.whatsapp.WhatsApp', media: { ...s.grant.media!, photo, contentTypes: ['image/png'] } }] } });
    s.attachFile.mockImplementation(async input => {
      expect(await readFile(input.path)).toEqual(bytes);
      s.tree.elements = preview.elements;
      return { ...structuredClone(preview), selectedFile: { path: input.path, targetId: input.targetId, applicationId: input.appId } };
    });
    s.interact.mockImplementation(async input => {
      expect(input.guards).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Taylor' }), expect.objectContaining({ name: '\u200ePhoto' }), expect.objectContaining({ name: '\u200e1 media item.' }), expect.objectContaining({ name: '\u200eCaption text field', value: '' })]));
      s.tree.elements = original.elements;
      return structuredClone(s.tree);
    });
    const input = { ...s.input, path: 'photo.png', expectedHash: createHash('sha256').update(bytes).digest('hex') };
    const run = () => s.service.execute(s.workspace.id, input, s.context, s.adapter, async () => undefined);
    expect(await run()).toMatchObject({ status: 'submitted', presentation: 'photo', delivery: 'unconfirmed' });
    await run();
    expect(s.interact).toHaveBeenCalledTimes(1);
  });
  it('selects the photo picker for image bytes, retaining native recipient and single-submit guards', async () => {
    const s = await setup();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP6sAAAAASUVORK5CYII=', 'base64');
    await writeFile(join(s.root, 'photo.png'), bytes);
    const photo = { open: s.grant.media!.open, menu: { id: '0.9.0', role: 'AXButton', name: 'Photos' }, send: s.grant.media!.send };
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, media: { ...s.grant.media!, menu: { ...photo.menu, name: 'Document' }, photo, contentTypes: ['image/png'] } }] } });
    s.attachFile.mockImplementation(async input => {
      expect(input.menu).toEqual(photo.menu);
      expect(input.guards[0]).toEqual(s.grant.recipient);
      expect(await readFile(input.path)).toEqual(bytes);
      s.tree.elements.push({ ...s.tree.elements[0], id: '0.0.4.0', role: 'AXStaticText', name: 'photo.png', actions: [] }, { ...s.tree.elements[2], id: '0.0.4.1', name: 'Send attachment' });
      return structuredClone(s.tree);
    });
    const input = { ...s.input, path: 'photo.png', expectedHash: createHash('sha256').update(bytes).digest('hex') };
    const run = () => s.service.execute(s.workspace.id, input, s.context, s.adapter, async () => undefined);
    expect(await run()).toMatchObject({ status: 'submitted', presentation: 'photo', delivery: 'unconfirmed' });
    await run();
    expect(s.attachFile).toHaveBeenCalledTimes(1);
    expect(s.interact).toHaveBeenCalledTimes(1);
  });
  it('transcribes authorized incoming audio transiently without downloading it twice', async () => {
    const s = await setup();
    const message = { ...s.tree.elements[0], id: '0.0.5.0', name: 'Incoming: voice.wav', role: 'AXStaticText', actions: [] as ('press' | 'fill')[] };
    const download = { ...s.tree.elements[2], id: '0.0.5.1', name: 'Download' };
    s.tree.elements.push(message, download);
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, media: { ...s.grant.media!, contentTypes: ['audio/wav'], receive: { enabled: true, download: { id: download.id, role: download.role, name: download.name }, incomingMarkers: ['Incoming:'] } } }] } });
    const receiveFile = vi.fn(async input => { await writeFile(input.path, pcm16ToWav(Buffer.alloc(16000),16000)); return structuredClone(s.tree); });
    s.adapter.receiveFile = receiveFile;
    vi.spyOn(voiceService, 'transcribe').mockResolvedValue('Private external audio fixture');
    const input = { command: 'media_receive' as const, targetId: 'chat', grantId: s.grant.id, inReplyToDigest: incomingDigest(message), downloadId: download.id, path: 'received/voice.wav', transcribeAudio: true };
    const run = () => s.service.receive(s.workspace.id, input, s.context, s.adapter, async () => undefined);
    expect(await run()).toMatchObject({ status: 'received', transcription: { state: 'ready', trust: 'external', text: 'Private external audio fixture' } });
    expect(await run()).toMatchObject({ transcription: { state: 'ready' } });
    expect(receiveFile).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await autonomyPolicyService.exportAudit(s.workspace.id))).not.toContain('Private external audio fixture');
    expect(JSON.stringify(await AgentComputerAction.query().where('workspace_id',s.workspace.id).get())).not.toContain('Private external audio fixture');
  });
  it('stages verified bytes, guards recipient and preview, and never repeats an exact retry', async () => {
    const s = await setup();
    const result = await s.execute();
    expect(result).toMatchObject({ kind: 'media', status: 'submitted', delivery: 'unconfirmed', sha256: s.input.expectedHash });
    expect(s.interact.mock.calls[0][0]).toMatchObject({ action: 'press', guards: [s.grant.recipient, { name: 'report.pdf' }, { name: 'Composer', value: '' }] });
    s.context.idempotencyKey = 'another-key';
    expect(await s.execute()).toEqual(result);
    expect(s.attachFile).toHaveBeenCalledTimes(1); expect(s.interact).toHaveBeenCalledTimes(1);
    const audit = await autonomyPolicyService.exportAudit(s.workspace.id);
    expect(audit.integrity.valid).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('private-test-content');
  });
  it('preserves human drafts and rejects a different contact despite the sidebar match', async () => {
    const s = await setup(); s.tree.elements[1].value = 'human draft';
    await expect(s.execute()).rejects.toThrow('existing draft');
    s.tree.elements[1].value = ''; s.tree.elements[0].name = 'Other contact';
    s.tree.elements.push({ ...s.tree.elements[0], id: '0.1.0', name: 'Taylor' });
    await expect(s.execute()).rejects.toThrow('conversation changed');
    expect(s.attachFile).not.toHaveBeenCalled();
  });
  it('checks the file hash before opening any native controls', async () => {
    const s = await setup(); await writeFile(join(s.root, 'report.pdf'), '%PDF-changed');
    await expect(s.execute()).rejects.toThrow('changed after'); expect(s.attachFile).not.toHaveBeenCalled();
  });
  it.each(['valid', 'recipient', 'sidebar', 'filename', 'caption', 'duplicate', 'whole-window', 'truncated'])('validates standalone native attachment previews (%s)', async variant => {
    const s = await setup();
    const preview: ComputerAccessibility = { available: true, truncated: variant === 'truncated', elements: [
      { ...s.tree.elements[0], id: '0.9.0.6.0', name: variant === 'recipient' ? 'Another contact' : 'Taylor' },
      { ...s.tree.elements[1], id: '0.9.0.4', name: 'Caption', value: variant === 'caption' ? 'Human draft' : '' },
      { ...s.tree.elements[2], id: '0.9.0.7', name: 'Send attachment' },
      { ...s.tree.elements[0], id: '0.9.0.1', role: 'AXStaticText', name: variant === 'filename' ? 'other.pdf' : 'report.pdf', actions: [] },
    ] };
    if (variant === 'sidebar') preview.elements[0].id = '0.1.0';
    if (variant === 'duplicate') preview.elements.push({ ...preview.elements[0], id: '0.9.0.6.1' });
    if (variant === 'whole-window') preview.elements[2].id = '0.7';
    if (variant === 'valid') expect(attachmentPreview(preview, s.grant, 'report.pdf')).toMatchObject({ recipient: { name: 'Taylor', id: '0.9.0.6.0' }, composer: { name: 'Caption', value: '' }, file: { name: 'report.pdf' } });
    else expect(() => attachmentPreview(preview, s.grant, 'report.pdf')).toThrow();
  });
  it('waits for a standalone preview and original chat to settle without repeating Send', async () => {
    const s = await setup(); const original = structuredClone(s.tree);
    s.attachFile.mockImplementation(async () => {
      s.tree.elements = [
        { ...original.elements[0], id: '0.9.0.6.0' },
        { ...original.elements[1], id: '0.9.0.4', name: 'Caption' },
        { ...original.elements[2], id: '0.9.0.7', name: 'Send attachment' },
        { ...original.elements[0], id: '0.9.0.1', role: 'AXStaticText', name: 'report.pdf', actions: [] },
      ]; return { available: true, truncated: false, elements: [] };
    });
    s.interact.mockImplementation(async input => {
      expect(input.guards).toEqual(expect.arrayContaining([expect.objectContaining({ id: '0.9.0.6.0', name: 'Taylor' }), expect.objectContaining({ id: '0.9.0.4', name: 'Caption', value: '' })]));
      s.tree.elements = original.elements; return { available: true, truncated: false, elements: [] };
    });
    expect(await s.execute()).toMatchObject({ status: 'submitted' });
    expect(s.interact).toHaveBeenCalledTimes(1);
  });
  it('requires fresh owner inspection before recovering a failed pre-Send attachment', async () => {
    const s = await setup();
    s.attachFile.mockRejectedValueOnce(new Error('Native picker failed'));
    await expect(s.execute()).rejects.toThrow('Native picker failed');
    await expect(s.execute()).rejects.toThrow('automatic replay');
    const input = { grantId: s.grant.id, targetId: 'chat' };
    const recover = (extra = {}, context = { actorType: 'user' as const, actorId: 'owner' }) => s.service.recover(s.workspace.id, { ...input, ...extra }, context, s.adapter, async () => undefined);
    await expect(recover({}, s.context as never)).rejects.toThrow('Only the owner');
    const review = await recover();
    expect(review.state).toBe('available');
    await expect(recover({ actionId: review.actionId, expectedRequestDigest: '0'.repeat(64) })).rejects.toThrow('changed since inspection');
    const repaired = await recover({ actionId: review.actionId, expectedRequestDigest: review.requestDigest });
    expect(repaired.state).toBe('repaired');
    expect((await s.execute()).actionId).toBe(review.actionId);
    expect(s.interact).toHaveBeenCalledTimes(1);
    await s.execute();
    expect(s.interact).toHaveBeenCalledTimes(1);
    expect((await autonomyPolicyService.verifyAudit(s.workspace.id)).valid).toBe(true);
  });
  it('never authorizes attachment recovery after an uncertain Send', async () => {
    const s = await setup();
    s.interact.mockRejectedValueOnce(new Error('Uncertain native Send'));
    await expect(s.execute()).rejects.toThrow('Uncertain native Send');
    s.tree.elements = s.tree.elements.filter(e => !e.id.startsWith('0.0.4.'));
    const review = await s.service.recover(s.workspace.id, { grantId: s.grant.id, targetId: 'chat' }, { actorType: 'user', actorId: 'owner' }, s.adapter, async () => undefined);
    expect(review.state).toBe('uncertain');
    await expect(s.execute()).rejects.toThrow('automatic replay');
  });
  it.each([false, true])('journals only successful attachment metadata when memory is enabled (uncertain=%s)', async uncertain => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, memoryEnabled: true }] } });
    if (uncertain) {
      s.interact.mockImplementation(async () => { throw new Error('Unknown native result'); });
      await expect(s.execute()).rejects.toThrow('Unknown native result');
    } else await s.execute();
    const memory = await conversationMemoryService.execute(s.workspace.id, { command: 'memory_search', grantId: s.grant.id, query: 'report', limit: 20 }, s.context);
    expect(memory.messages).toHaveLength(uncertain ? 0 : 1);
    if (!uncertain) {
      expect(memory.messages[0].content).toContain(s.input.expectedHash);
      expect(memory.messages[0].content).toContain('delivery unconfirmed');
      expect(memory.messages[0].content).not.toContain('private-test-content');
    }
  });
  it('preserves stronger publication gates', async () => {
    const s = await setup();
    await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, gates: { ...s.policy.policy.gates, external_publication: 'reviewer' } } });
    await expect(s.execute()).rejects.toThrow('approval gate'); expect(s.attachFile).not.toHaveBeenCalled();
  });
  it('rechecks revocation after the picker before Send', async () => {
    const s = await setup(), stage = s.attachFile.getMockImplementation()!;
    s.attachFile.mockImplementation(async input => {
      const result = await stage(input);
      await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, halted: true } });
      return result;
    });
    await expect(s.execute()).rejects.toThrow('authorization changed'); expect(s.interact).not.toHaveBeenCalled();
  });
  it('does not confuse a filename in history with the active attachment', async () => {
    const s = await setup();
    s.tree.elements.push({ ...s.tree.elements[0], id: '0.0.8', role: 'AXStaticText', name: 'report.pdf', actions: [] }, { ...s.tree.elements[2], id: '0.0.4.1', name: 'Send attachment' });
    expect(() => attachmentPreview(s.tree, s.grant, 'report.pdf')).toThrow('preview');
  });
  it('blocks automatic replay after a Send whose result is uncertain', async () => {
    const s = await setup(); s.interact.mockImplementation(async () => structuredClone(s.tree));
    await expect(s.execute()).rejects.toThrow('uncertain');
    s.context.idempotencyKey = 'retry-with-new-key';
    await expect(s.execute()).rejects.toThrow('automatic replay');
    expect(s.interact).toHaveBeenCalledTimes(1);
    const actions = await AgentComputerAction.query().where('workspace_id', s.workspace.id).where('command', 'media_send').get();
    expect(actions).toHaveLength(1); expect(actions[0].getAttribute('status')).toBe('failed');
  });

  it('waits for a delayed preview close without pressing Send again', async () => {
    const s = await setup();
    s.interact.mockImplementation(async () => structuredClone(s.tree));
    let reads = 0;
    s.adapter.read = async () => {
      if (++reads >= 3) s.tree.elements = s.tree.elements.filter(e => !e.id.startsWith('0.0.4.'));
      return structuredClone(s.tree);
    };
    expect(await s.execute()).toMatchObject({ status: 'submitted', delivery: 'unconfirmed' });
    expect(s.interact).toHaveBeenCalledTimes(1);
    expect(reads).toBe(3);
  });

  it('preserves a changed human draft while observing submission', async () => {
    const s = await setup();
    s.interact.mockImplementation(async () => { s.tree.elements[1].value = 'new human draft'; return structuredClone(s.tree); });
    await expect(s.execute()).rejects.toThrow('Draft changed');
    expect(s.interact).toHaveBeenCalledTimes(1);
    expect(s.tree.elements[1].value).toBe('new human draft');
  });

  it.each([false, true])('receives only the incoming message file into a new confined path (wrong message=%s)', async wrong => {
    const s = await setup();
    const message = { ...s.tree.elements[0], id: '0.0.5.0', name: 'Incoming: report.pdf', role: 'AXStaticText', actions: [] as ('press' | 'fill')[] };
    const download = { ...s.tree.elements[2], id: wrong ? '0.0.6.1' : '0.0.5.1', name: 'Download' };
    s.tree.elements.push(message, download);
    const policy = await autonomyPolicyService.update(s.workspace.id, { enabled: true, mode: 'bounded', policy: { ...s.policy.policy, computerReplyGrants: [{ ...s.grant, media: { ...s.grant.media!, receive: { enabled: true, download: { id: download.id, role: download.role, name: download.name }, incomingMarkers: ['Incoming:'] } } }] } });
    const receiveFile = vi.fn(async input => { await writeFile(input.path, '%PDF-1.7\nreceived-fixture'); return structuredClone(s.tree); });
    s.adapter.receiveFile = receiveFile;
    const input = { command: 'media_receive' as const, targetId: 'chat', grantId: policy.policy.computerReplyGrants[0].id, inReplyToDigest: incomingDigest(message), downloadId: download.id, path: 'received/new.pdf' };
    const run = () => s.service.receive(s.workspace.id, input, s.context, s.adapter, async () => undefined);
    if (wrong) { await expect(run()).rejects.toThrow('belong uniquely'); expect(receiveFile).not.toHaveBeenCalled(); return; }
    const result = await run();
    expect(result).toMatchObject({ kind: 'media', status: 'received', delivery: 'not_applicable', contentType: 'application/pdf' });
    expect(await readFile(join(s.root, input.path), 'utf8')).toBe('%PDF-1.7\nreceived-fixture');
    expect(await run()).toEqual(result); expect(receiveFile).toHaveBeenCalledTimes(1);
    await writeFile(join(s.root, input.path), '%PDF-human-edit');
    await expect(run()).rejects.toThrow('changed after'); expect(receiveFile).toHaveBeenCalledTimes(1);
  });
});
