import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { channelService } from '$lib/modules/agent-room/application/services/ChannelService.js';
import { agentInboxService } from '$lib/modules/agent-room/application/services/AgentInboxService.js';
import { workspaceAttachmentService } from '$lib/modules/agent-room/application/services/WorkspaceAttachmentService.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { channelRepository } from '$lib/modules/agent-room/infrastructure/repositories/ChannelRepository.js';

const roots: string[] = [];

async function fixture(name: string) {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-attachment-owner-'));
  roots.push(root);
  const workspace = await workspaceRepository.createWorkspace({ name: 'Attachments', workingDir: root });
  const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'QA', payload: { provider: 'claude' } as never });
  const id = '01a14a44-5d87-7d1c-90e7-7b697f79bf90';
  const attachment = { id, kind: 'file' as const, name, path: `.orkestrai/attachments/${id}-${name}`, url: null, mimeType: 'image/png', size: 3 };
  await mkdir(join(root, '.orkestrai', 'attachments'), { recursive: true });
  await writeFile(join(root, attachment.path), 'png');
  return { root, workspace, agent, attachment, file: join(root, attachment.path) };
}

describe('attachments owned by a stored message', () => {
  useSvelarTest({ refreshDatabase: true });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  });

  it('keeps the file of a stored message whose delivery failed, even when its draft is discarded', async () => {
    const f = await fixture('erro.png');
    vi.spyOn(agentInboxService, 'enqueue').mockRejectedValue(new Error('database is locked'));
    const result = await channelService.postOwner(f.workspace.id, `dm:${f.agent.id}`, { body: 'veja', attachments: [f.attachment] });
    expect(result.delivered).toEqual([{ nodeId: f.agent.id, ok: false }]);
    // The screen treats it as failed and discards the draft: the stored message keeps its file.
    await workspaceAttachmentService.remove(f.workspace.id, { attachment: f.attachment } as never);
    expect(await readFile(f.file, 'utf8')).toBe('png');
    expect(await channelRepository.referencesAttachment(f.workspace.id, f.attachment.id)).toBe(true);
  });

  it('never leaves a stored message pointing at a file deleted at the same moment', async () => {
    const f = await fixture('mesma-hora.png');
    vi.spyOn(agentInboxService, 'enqueue').mockResolvedValue({} as never);
    const [posted, removed] = await Promise.allSettled([
      channelService.postOwner(f.workspace.id, `dm:${f.agent.id}`, { body: 'veja', attachments: [f.attachment] }),
      workspaceAttachmentService.remove(f.workspace.id, { attachment: f.attachment } as never),
    ]);
    expect(removed.status).toBe('fulfilled');
    const exists = await stat(f.file).then(() => true, () => false);
    if (posted.status === 'fulfilled') expect(exists).toBe(true);
    else expect(posted.reason.message).toMatch(/não está mais no workspace/);
  });

  it('still deletes a file no stored message carries', async () => {
    const f = await fixture('rascunho.png');
    await workspaceAttachmentService.remove(f.workspace.id, { attachment: f.attachment } as never);
    expect(await stat(f.file).then(() => true, () => false)).toBe(false);
  });
});
