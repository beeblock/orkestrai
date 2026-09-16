import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachmentsFromTransfer, transferHasWorkspaceAttachments } from '$lib/components/agent-room/workspace-attachments.js';

vi.mock('@beeblock/svelar/http', () => ({ getCsrfToken: () => 'test-csrf' }));

afterEach(() => vi.unstubAllGlobals());

describe('external file drag lifecycle', () => {
  it('accepts protected dragover with Files metadata before the browser exposes files', () => {
    expect(transferHasWorkspaceAttachments({ files: [], types: ['Files'] } as unknown as DataTransfer)).toBe(true);
  });

  it('does not intercept normal text or an internal node drag', () => {
    expect(transferHasWorkspaceAttachments(null)).toBe(false);
    expect(transferHasWorkspaceAttachments({ files: [], types: ['text/plain'] } as unknown as DataTransfer)).toBe(false);
  });

  it('rejects an oversized batch before uploading instead of silently dropping references', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const transfer = { files: Array.from({ length: 13 }, () => new File(['x'], 'ref.png')), getData: () => '' } as unknown as DataTransfer;
    await expect(attachmentsFromTransfer('workspace', transfer)).rejects.toThrow('attachment_too_many');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('snapshots files and links before asynchronous uploads clear the drag store', async () => {
    let url = 'https://example.com/brief';
    const files = [new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' })];
    const transfer = { files, types: ['Files', 'text/uri-list'], getData: () => url } as unknown as DataTransfer;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      url = '';
      files.splice(0);
      expect(init.headers).toMatchObject({ 'X-CSRF-Token': 'test-csrf' });
      const name = init.body instanceof FormData ? (init.body.get('file') as File).name : JSON.parse(String(init.body)).url;
      return Response.json({ data: { name } });
    });
    vi.stubGlobal('fetch', fetchMock);
    expect((await attachmentsFromTransfer('workspace', transfer)).map(item => item.name)).toEqual(['one.png', 'two.png', 'https://example.com/brief']);
  });

  it('removes unreferenced successful uploads if a later file fails', async () => {
    const saved = { kind: 'file', id: 'one', path: '.orkestrai/attachments/one-ref.png', name: 'ref.png' };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: saved }))
      .mockResolvedValueOnce(Response.json({ error: 'upload_failed' }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ data: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const transfer = { files: [new File(['one'], 'one.png'), new File(['two'], 'two.png')], getData: () => '' } as unknown as DataTransfer;
    await expect(attachmentsFromTransfer('workspace', transfer)).rejects.toThrow('upload_failed');
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ attachment: saved }) });
  });
});
