import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWaServer, parsePairingQrString } from '@zapo-js/fake-server';
import { ZapoSecureStore } from '$lib/modules/agent-room/infrastructure/integrations/ZapoSecureStore.js';
import { ZapoWhatsAppTransport } from '$lib/modules/agent-room/infrastructure/integrations/ZapoWhatsAppTransport.js';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; }
const stop: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of stop.splice(0).reverse()) await close().catch(() => undefined); });

describe('Zapo WhatsApp transport on the official local protocol server', () => {
  it('pairs by QR, sends and receives with exact IDs, then restores without another QR', async () => {
    const values = new Map<string, string>();
    const vault = { get: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: string) => { values.set(key, value); }, delete: async (key: string) => { values.delete(key); } };
    const server = await FakeWaServer.start(); stop.push(() => server.stop());
    const options = { chatSocketUrls: [server.url], proxy: { mediaUpload: server.mediaProxyAgent, mediaDownload: server.mediaProxyAgent }, testHooks: { noiseRootCa: server.noiseRootCa } };
    let auth = await ZapoSecureStore.open('workspace', 'connection', vault); stop.push(() => auth.close());
    let transport = new ZapoWhatsAppTransport(auth, 'connection', options); stop.push(() => transport.close());
    const report = vi.fn(), current = () => true;
    const material = deferred<ReturnType<typeof parsePairingQrString>>(), paired = deferred<void>();
    let socket = await transport.create(current, report);
    socket.ev.on('connection.update', event => {
      if (event.qr) material.resolve(parsePairingQrString(event.qr));
      if (event.isNewLogin) paired.resolve();
    });
    const registration = await server.waitForAuthenticatedPipeline();
    const loginPromise = server.waitForNextAuthenticatedPipeline();
    await server.runPairing(registration, { deviceJid: '5511999999999:1@s.whatsapp.net' }, () => material.promise);
    await paired.promise;
    const login = await loginPromise;
    await server.triggerPreKeyUpload(login);
    await vi.waitFor(() => expect(socket.user?.id).toBe('5511999999999:1@s.whatsapp.net'), { timeout: 15_000 });
    const peer = await server.createFakePeer({ jid: '5511777777777@s.whatsapp.net' }, login);
    const received = deferred<any>();
    socket.ev.on('messages.upsert', event => received.resolve(event));
    await peer.sendConversation('@Bot investigate this');
    expect(await received.promise).toMatchObject({ type: 'notify', messages: [{ message: { conversation: '@Bot investigate this' }, key: { fromMe: false } }] });
    const outgoing = peer.expectMessage({ timeoutMs: 8_000 });
    const id = 'ORK1133557799AABBCCDDEEFF';
    expect(await socket.sendMessage('5511777777777@s.whatsapp.net', { text: 'Acknowledged' }, { messageId: id })).toMatchObject({ key: { id, fromMe: true } });
    expect((await outgoing).message.conversation).toBe('Acknowledged');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1kAAAAASUVORK5CYII=', 'base64');
    const imageReceipt = peer.expectMessage({ timeoutMs: 8_000 });
    await socket.sendMessage('5511777777777@s.whatsapp.net', { image: png, mimetype: 'image/png', caption: 'Test image' }, { messageId: 'ORKIMAGE1133557799' });
    expect((await imageReceipt).message.imageMessage?.caption).toBe('Test image');
    const pdfReceipt = peer.expectMessage({ timeoutMs: 8_000 });
    await socket.sendMessage('5511777777777@s.whatsapp.net', { document: Buffer.from('%PDF-1.4\n%%EOF'), mimetype: 'application/pdf', fileName: 'test.pdf' }, { messageId: 'ORKPDF1133557799' });
    expect((await pdfReceipt).message.documentMessage?.fileName).toBe('test.pdf');
    await transport.close(); await auth.close();
    auth = await ZapoSecureStore.open('workspace', 'connection', vault);
    transport = new ZapoWhatsAppTransport(auth, 'connection', options);
    const next = server.waitForNextAuthenticatedPipeline(), updates = vi.fn();
    socket = await transport.create(current, report); socket.ev.on('connection.update', updates);
    await next;
    await vi.waitFor(() => expect(socket.user?.id).toBeTruthy(), { timeout: 15_000 });
    expect(updates.mock.calls.some(([event]) => event.qr)).toBe(false);
    expect(report.mock.calls.some(([event]) => event === 'paired')).toBe(true);
    await transport.close(); await auth.forget();
    expect(values.size).toBe(0);
  }, 45_000);
  it('reports unsupported additional verification and stops before any reconnect or send', async () => {
    const values = new Map<string, string>();
    const auth = await ZapoSecureStore.open('workspace', 'passkey', { get: async key => values.get(key) ?? null,
      set: async (key, value) => { values.set(key, value); }, delete: async key => { values.delete(key); } });
    stop.push(() => auth.close());
    let client: any, connect: any;
    const transport = new ZapoWhatsAppTransport(auth, 'passkey', undefined, raw => {
      client = raw; connect = vi.spyOn(raw, 'connect').mockResolvedValue(undefined);
    });
    stop.push(() => transport.close());
    const report = vi.fn(), updates = vi.fn();
    const socket = await transport.create(() => true, report); socket.ev.on('connection.update', updates);
    client.emit('auth_passkey_required', { hasSigner: false });
    client.emit('auth_qr', { qr: 'must-not-overwrite-error', ttlMs: 60_000 });
    await new Promise(resolve => setImmediate(resolve));
    expect(connect).not.toHaveBeenCalled();
    expect(updates.mock.calls).toEqual([[{ pairingError: 'WHATSAPP_PASSKEY_REQUIRED' }]]);
    expect(report).toHaveBeenCalledWith('passkey_required');
    await expect(socket.sendMessage('5511999999999@s.whatsapp.net', { text: 'No unauthorized send' }, { messageId: 'blocked' })).rejects.toThrow();
  });

  it('surfaces a durable-store failure instead of repeatedly reconnecting with unsaved keys', async () => {
    const values = new Map<string, string>();
    const vault = { get: async (key: string) => values.get(key) ?? null,
      set: vi.fn(async (key: string, value: string) => { values.set(key, value); }), delete: async (key: string) => { values.delete(key); } };
    const auth = await ZapoSecureStore.open('workspace', 'failed', vault);
    stop.push(() => auth.close());
    const session = auth.store.session('failed'); await session.preKey.getPreKeyById(1);
    vault.set.mockRejectedValueOnce(new Error('Simulated encrypted vault failure'));
    await expect(session.preKey.putPreKey({ keyId: 2, keyPair: { pubKey: new Uint8Array(32), privKey: new Uint8Array(32) } })).rejects.toThrow();
    const transport = new ZapoWhatsAppTransport(auth, 'failed', undefined, raw => { vi.spyOn(raw, 'connect').mockRejectedValue(new Error('Simulated key persistence failure')); });
    stop.push(() => transport.close());
    const updates = vi.fn();
    const socket = await transport.create(() => true, () => {}); socket.ev.on('connection.update', updates);
    await vi.waitFor(() => expect(updates).toHaveBeenCalledWith({ pairingError: 'WHATSAPP_CREDENTIAL_WRITE_FAILED' }));
    expect(updates.mock.calls.some(([event]) => event.connection === 'close')).toBe(false);
  });

});
