import { describe, expect, it, vi } from 'vitest';
import { WhatsAppSecureAuth } from '$lib/modules/agent-room/infrastructure/integrations/WhatsAppSecureAuth.js';
import { TrustedIntegrationHttpClient } from '$lib/modules/agent-room/infrastructure/integrations/TrustedIntegrationHttpClient.js';
import { botArtifactLinks, channelTextChunks } from '$lib/modules/agent-room/domain/bot-artifacts.js';
import { IntegrationExecutionService } from '$lib/modules/agent-room/application/services/IntegrationExecutionService.js';
import { whatsAppInboundSender, whatsAppOutputId } from '$lib/modules/agent-room/domain/whatsapp-messages.js';
import { allowedWhatsAppMediaUrl, downloadWhatsAppMedia } from '$lib/modules/agent-room/infrastructure/integrations/WhatsAppMedia.js';
import { Readable } from 'node:stream';
import { botMessageContent } from '$lib/components/agent-room/bots/bot-message-content.js';

function vault() {
  const values = new Map<string, string>();
  return { values, get: vi.fn(async (key: string) => values.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { values.set(key, value); }), delete: vi.fn(async (key: string) => { values.delete(key); }) };
}

describe('bot channel files and secure WhatsApp sessions', () => {
  it('opens only verified bot report links through the workspace file route', () => {
    const body = '[Report](report.pdf) [Other](missing.pdf) ![Image](image.png)';
    const meta = { artifacts: [{ path: 'report.pdf', name: 'report.pdf', mimeType: 'application/pdf', image: false, sha256: 'a'.repeat(64) }] };
    expect(botMessageContent(body, meta, 'workspace')).toBe('[Report](/api/agent-room/workspaces/workspace/fs/raw?path=report.pdf) [Other](missing.pdf) ![Image](image.png)');
    expect(botMessageContent(body, {}, 'workspace')).toBe(body);
  });
  it('bounds WhatsApp decoding and refuses redirected requests outside the media provider', async () => {
    expect(allowedWhatsAppMediaUrl('https://mmg.whatsapp.net/file')).toBe(true);
    for (const url of ['http://mmg.whatsapp.net/file', 'https://whatsapp.net.attacker.invalid/file', 'https://user@mmg.whatsapp.net/file', 'https://127.0.0.1/file']) expect(allowedWhatsAppMediaUrl(url)).toBe(false);
    const download = vi.fn(async () => Readable.from([Buffer.alloc(10 * 1024 * 1024 + 1)]));
    await expect(downloadWhatsAppMedia({} as never, download as never)).rejects.toThrow('CHANNEL_ATTACHMENT_TOO_LARGE');
    const redirected = vi.fn(async (_message: unknown, _type: unknown, options: { options: { dispatcher: unknown } }) => {
      await fetch('https://attacker.invalid/file', { dispatcher: options.options.dispatcher } as never);
      return Readable.from([]);
    });
    await expect(downloadWhatsAppMedia({} as never, redirected as never)).rejects.toThrow();
  });
  it('accepts human messages from the linked phone but never feeds bot output back into itself', () => {
    const chat = '5511999999999@s.whatsapp.net';
    expect(whatsAppInboundSender({ fromMe: true, id: 'HUMAN', remoteJid: chat }, '5511999999999:2@s.whatsapp.net')).toBe(chat);
    const id = whatsAppOutputId('binding', 'reply', 'text');
    expect(id).toHaveLength(32);
    expect(whatsAppOutputId('binding', 'reply', 'text')).toBe(id);
    expect(whatsAppInboundSender({ fromMe: true, id, remoteJid: chat }, chat)).toBeNull();
    expect(whatsAppInboundSender({ fromMe: true, id: 'HUMAN', remoteJid: chat })).toBeNull();
    expect(whatsAppInboundSender({ fromMe: false, id: 'HUMAN', remoteJid: chat })).toBe(chat);
  });
  it('persists concurrent signal keys and credentials atomically and restores binary keys', async () => {
    const store = vault(), auth = await WhatsAppSecureAuth.open('workspace', 'connection', store);
    const session = auth.state;
    const updated = { ...session.creds, registered: true };
    await Promise.all([session.keys.set({ session: { a: new Uint8Array([1, 2]) } }), session.keys.set({ session: { b: new Uint8Array([3, 4]) } }), auth.saveCreds(updated)]);
    await auth.close();
    const resumed = await WhatsAppSecureAuth.open('workspace', 'connection', store);
    const keys = await resumed.state.keys.get('session', ['a', 'b']);
    expect([...keys.a]).toEqual([1, 2]); expect([...keys.b]).toEqual([3, 4]);
    expect(resumed.state.creds.registered).toBe(true);
    expect([...store.values.keys()]).toEqual(['automation:whatsapp:workspace:connection']);
    await resumed.forget(); expect(store.values.size).toBe(0);
  });

  it('keeps an already-linked legacy account and identifies only fresh QR sessions for Zapo', async () => {
    const store = vault();
    expect(await WhatsAppSecureAuth.hasRegistered('workspace', 'connection', store)).toBe(false);
    const auth = await WhatsAppSecureAuth.open('workspace', 'connection', store);
    expect(await WhatsAppSecureAuth.hasRegistered('workspace', 'connection', store)).toBe(false);
    await auth.saveCreds({ ...auth.state.creds, me: { id: '5511999999999:1@s.whatsapp.net' }, registered: true });
    const saved = store.values.get('automation:whatsapp:workspace:connection');
    expect(await WhatsAppSecureAuth.hasRegistered('workspace', 'connection', store)).toBe(true);
    expect(store.values.get('automation:whatsapp:workspace:connection')).toBe(saved);
    store.values.set('automation:whatsapp:workspace:connection', '{broken');
    await expect(WhatsAppSecureAuth.hasRegistered('workspace', 'connection', store)).rejects.toThrow();
    expect(store.values.get('automation:whatsapp:workspace:connection')).toBe('{broken');
    await auth.close();
  });

  it('never acknowledges a key write the secure store rejected or lets an old socket overwrite new keys', async () => {
    const store = vault(), auth = await WhatsAppSecureAuth.open('workspace', 'connection', store);
    store.set.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(auth.state.keys.set({ session: { lost: new Uint8Array([9]) } })).rejects.toThrow('disk unavailable');
    expect(await auth.state.keys.get('session', ['lost'])).toEqual({});
    let live = true; const old = auth.forSession(() => live); live = false;
    await expect(old.keys.get('session', ['lost'])).rejects.toThrow('WHATSAPP_AUTH_STALE');
    await expect(old.keys.set({ session: { stale: new Uint8Array([8]) } })).rejects.toThrow('WHATSAPP_AUTH_STALE');
    expect(await auth.state.keys.get('session', ['stale'])).toEqual({});
    await auth.forget();
    await expect(old.keys.set({ session: { resurrect: new Uint8Array([7]) } })).rejects.toThrow('WHATSAPP_AUTH_CLOSED');
    expect(store.values.size).toBe(0);
  });

  it('fails closed for corrupt credentials or unavailable protected storage', async () => {
    const store = vault(); store.values.set('automation:whatsapp:workspace:connection', '{malformed');
    await expect(WhatsAppSecureAuth.open('workspace', 'connection', store)).rejects.toThrow();
    expect(store.set).not.toHaveBeenCalled();
    await expect(WhatsAppSecureAuth.open('workspace', 'connection', { get: async () => null, set: async () => {}, delete: async () => {} })).rejects.toThrow('WHATSAPP_SECURE_STORAGE_REQUIRED');
  });

  it('bounds binary downloads and never follows redirects carrying provider authentication', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('redirect', { status: 302, headers: { location: 'https://attacker.invalid/' } }));
    const http = new TrustedIntegrationHttpClient(fetcher);
    await expect(http.download('https://files.slack.com/files-pri/test', { headers: { authorization: 'Bearer PRIVATE' } })).rejects.toThrow('download failed');
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][1].redirect).toBe('manual');
    fetcher.mockResolvedValueOnce(new Response('large', { headers: { 'content-length': '100000000' } }));
    await expect(http.download('https://files.slack.com/files-pri/test')).rejects.toThrow('size');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array(20)));
    await expect(http.download('https://files.slack.com/files-pri/test', {}, 10)).rejects.toThrow('size');
  });

  it('recognizes explicit report/image artifacts without treating remote URLs or private files as attachments', () => {
    expect(botArtifactLinks('![Creative](.orkestrai/generated/creative.png) [Report](<reports/monthly report.pdf>)')).toEqual([
      { path: '.orkestrai/generated/creative.png', name: 'creative.png', mimeType: 'image/png', image: true },
      { path: 'reports/monthly report.pdf', name: 'monthly report.pdf', mimeType: 'application/pdf', image: false },
    ]);
    expect(botArtifactLinks('[a](https://attacker.invalid/a.pdf) [b](../../private.pdf) [c](%2e%2e/private.pdf) [d](credentials/report.pdf) [e](.env) [f](file:///secret.pdf)')).toEqual([]);
    const text = 'a'.repeat(3999) + '😀' + 'b'.repeat(5000);
    expect(channelTextChunks(text).join('')).toBe(text);
    expect(channelTextChunks(text).every(part => part.length <= 4000 && !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
  });

  it('accepts Telegram PDF/photo-only messages and Slack file shares without dropping the message', async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, status: 200, json: { ok: true, result: [
      { update_id: 1, message: { chat: { id: 42 }, from: { id: 3 }, document: { file_id: 'abc_123', file_name: 'bug.pdf', mime_type: 'application/pdf', file_size: 10 } } },
      { update_id: 2, message: { chat: { id: 42 }, from: { id: 3 }, photo: [{ file_id: 'small', file_size: 20 }, { file_id: 'large', file_size: 30 }] } },
    ] } });
    const service = new IntegrationExecutionService({ request } as never);
    vi.spyOn(service as any, 'requireIntegration').mockResolvedValue({ type: 'telegram', enabled: true, status: 'connected', permissions: ['telegram.read_updates'] });
    vi.spyOn(service as any, 'secret').mockResolvedValue('PRIVATE_TOKEN');
    const received = await service.pollInbound('workspace', 'integration', { cursor: null });
    expect(received.messages.map(item => item.attachments?.[0].name)).toEqual(['bug.pdf', 'photo.jpg']);
    expect(received.messages[1].attachments?.[0].id).toBe('large');
    request.mockResolvedValueOnce({ ok: true, status: 200, json: { ok: true, messages: [{ ts: '1700000001.000001', user: 'U1', subtype: 'file_share', files: [{ id: 'F123', name: 'details.pdf', size: 10, mimetype: 'application/pdf', url_private_download: 'https://files.slack.com/files-pri/T1/F123/details.pdf' }] }] } });
    vi.spyOn(service as any, 'requireIntegration').mockResolvedValue({ type: 'slack', enabled: true, status: 'connected', permissions: ['slack.read_messages'] });
    const slack = await service.pollInbound('workspace', 'integration', { cursor: '1700000000.000000', chatId: 'C1' });
    expect(slack.messages[0].attachments?.[0].name).toBe('details.pdf');
  });

  it('refuses a Slack attachment URL outside the exact provider before resolving credentials', async () => {
    const download = vi.fn(), service = new IntegrationExecutionService({ download } as never);
    vi.spyOn(service as any, 'requireIntegration').mockResolvedValue({ type: 'slack', enabled: true, status: 'connected', permissions: ['slack.read_messages'] });
    const secret = vi.spyOn(service as any, 'secret');
    for (const url of ['http://files.slack.com/files-pri/a', 'https://files.slack.com.attacker.invalid/files-pri/a', 'https://files.slack.com@attacker.invalid/files-pri/a', 'https://127.0.0.1/files-pri/a']) {
      await expect(service.downloadInbound('workspace', 'integration', { id: 'F1', name: 'file.pdf', mimeType: 'application/pdf', size: 10, url })).rejects.toThrow('CHANNEL_ATTACHMENT_DENIED');
    }
    expect(secret).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled();
  });
});
