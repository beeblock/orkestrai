import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceAttachment } from '$lib/modules/agent-room/domain/types.js';

const uploads = new Map<string, (attachment: WorkspaceAttachment) => void>();
const failures = new Map<string, (error: Error) => void>();
const deleted: Array<{ workspaceId: string; id: string }> = [];

vi.mock('$lib/paraglide/messages.js', () => ({
  'attachment.too_large': () => 'too large',
  'attachment.too_many': () => 'too many',
  'attachment.error': () => 'error',
}));

vi.mock('$lib/components/agent-room/workspace-attachments.js', () => ({
  MAX_WORKSPACE_ATTACHMENTS: 12,
  transferHasWorkspaceAttachments: () => true,
  attachmentsFromTransfer: vi.fn(),
  // Each upload waits until the test settles it, so overlapping uploads can be ordered.
  uploadWorkspaceAttachment: (_workspaceId: string, file: File) => new Promise<WorkspaceAttachment>((resolve, reject) => {
    uploads.set(file.name, resolve);
    failures.set(file.name, reject);
  }),
  deleteWorkspaceAttachment: async (workspaceId: string, attachment: WorkspaceAttachment) => {
    deleted.push({ workspaceId, id: attachment.id });
  },
}));

function file(name: string): File {
  return { name, size: 3, type: 'image/png', arrayBuffer: async () => new ArrayBuffer(3) } as unknown as File;
}

function attachment(name: string): WorkspaceAttachment {
  return { id: `id-${name}`, kind: 'file', name, path: `.orkestrai/attachments/id-${name}-${name}`, url: null, mimeType: 'image/png', size: 3 };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ComposerAttachments', () => {
  let ComposerAttachments: typeof import('$lib/components/agent-room/composer-attachments.svelte.js').ComposerAttachments;
  let workspace: string | null;

  beforeAll(async () => {
    vi.stubGlobal('$state', <T>(value: T) => value);
    ({ ComposerAttachments } = await import('$lib/components/agent-room/composer-attachments.svelte.js'));
  }, 30_000);

  beforeEach(() => {
    uploads.clear();
    failures.clear();
    deleted.length = 0;
    workspace = 'w1';
  });

  it('stays busy until the last of overlapping uploads settles', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const first = staged.addFiles([file('a.png')]);
    const second = staged.addFiles([file('b.png')]);
    expect(staged.busy).toBe(true);
    uploads.get('a.png')!(attachment('a.png'));
    await first;
    expect(staged.busy).toBe(true);
    failures.get('b.png')!(new Error('network'));
    await second;
    expect(staged.busy).toBe(false);
    expect(staged.items.map((item) => item.name)).toEqual(['a.png']);
  });

  it('discards an upload that lands after the draft moved to another conversation or workspace', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const pending = staged.addFiles([file('old.png')]);
    staged.reset();
    workspace = 'w2';
    uploads.get('old.png')!(attachment('old.png'));
    await pending;
    expect(staged.items).toEqual([]);
    expect(staged.busy).toBe(false);
    // Deleted through the workspace that holds it, not the one now open.
    expect(deleted).toEqual([{ workspaceId: 'w1', id: 'id-old.png' }]);
  });

  it('deletes unsent files on reset through their own workspace', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const pending = staged.addFiles([file('draft.png')]);
    uploads.get('draft.png')!(attachment('draft.png'));
    await pending;
    workspace = 'w2';
    staged.reset();
    await flush();
    expect(staged.items).toEqual([]);
    expect(deleted).toEqual([{ workspaceId: 'w1', id: 'id-draft.png' }]);
  });

  it('sends only the files it reserved and keeps the next draft', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const first = staged.addFiles([file('outgoing.png')]);
    uploads.get('outgoing.png')!(attachment('outgoing.png'));
    await first;
    const submission = staged.reserve();
    expect(submission.attachments.map((item) => item.name)).toEqual(['outgoing.png']);
    expect(staged.sending).toBe(true);
    // Added while the send is in flight: it belongs to the next message.
    const next = staged.addFiles([file('next-draft.png')]);
    uploads.get('next-draft.png')!(attachment('next-draft.png'));
    await next;
    submission.commit();
    expect(staged.sending).toBe(false);
    expect(staged.items.map((item) => item.name)).toEqual(['next-draft.png']);
    expect(deleted).toEqual([]);
  });

  it('does not delete a file a send in flight carries, and keeps it when the send fails', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const pending = staged.addFiles([file('report.pdf')]);
    uploads.get('report.pdf')!(attachment('report.pdf'));
    await pending;
    const submission = staged.reserve();
    await staged.remove(attachment('report.pdf'));
    expect(deleted).toEqual([]);
    expect(staged.items.map((item) => item.name)).toEqual(['report.pdf']);
    submission.release();
    expect(staged.sending).toBe(false);
    expect(staged.items.map((item) => item.name)).toEqual(['report.pdf']);
    // Back in the draft, it can be removed again.
    await staged.remove(attachment('report.pdf'));
    expect(deleted).toEqual([{ workspaceId: 'w1', id: 'id-report.pdf' }]);
  });

  it('leaves the files of a send in flight alone when the draft is reset', async () => {
    const staged = new ComposerAttachments(() => workspace);
    const pending = staged.addFiles([file('sent.png')]);
    uploads.get('sent.png')!(attachment('sent.png'));
    await pending;
    const submission = staged.reserve();
    staged.reset();
    await flush();
    submission.commit();
    expect(deleted).toEqual([]);
    expect(staged.items).toEqual([]);
  });
});
