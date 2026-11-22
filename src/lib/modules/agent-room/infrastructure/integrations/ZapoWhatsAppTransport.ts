import { EventEmitter } from 'node:events';
import { WaClient, createNoopLogger, type WaSendMessageContent, type WaClientOptions } from 'zapo-js';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppTransport } from './WhatsAppTransport.js';
import type { ZapoSecureStore } from './ZapoSecureStore.js';

/** Normalize the verified Zapo API; routing, filtering and outbox stay app-owned. */
export class ZapoWhatsAppTransport {
  private active: WaClient | null = null;
  private shutdown: Promise<void> = Promise.resolve();
  constructor(private readonly auth: ZapoSecureStore, private readonly sessionId: string,
    private readonly testOptions?: Pick<WaClientOptions, 'chatSocketUrls' | 'proxy' | 'testHooks'>,
    private readonly onClient?: (client: WaClient) => void) {}

  async create(isCurrent: () => boolean, report: (event: 'pairing_refresh' | 'passkey_required' | 'paired' | 'transport_error') => void): Promise<WhatsAppTransport> {
    // Never start a second writer over the same Signal state.
    if (this.active) await this.active.disconnect();
    await this.shutdown;
    if (!isCurrent()) throw new Error('WHATSAPP_CONNECTION_STALE');
    const events = new EventEmitter();
    let blocked = false, lastErrorLog = 0;
    const client = new WaClient({ store: this.auth.store, sessionId: this.sessionId,
      deviceBrowser: 'Chrome', deviceOsDisplayName: 'Orkestrai',
      history: { enabled: false, groupBundles: false, requireFullSync: false },
      linkPreview: { enabled: false },
      chatEvents: { emitSnapshotMutations: true },
      writeBehind: { maxPendingKeys: 256, maxWriteConcurrency: 1, flushTimeoutMs: 5_000 },
      ...this.testOptions,
    }, createNoopLogger());
    this.onClient?.(client);
    this.active = client;
    const socket: WhatsAppTransport = {
      ev: { on: (event, listener) => { events.on(event, listener); } },
      user: undefined,
      end: () => { this.shutdown = client.disconnect(); return this.shutdown; },
      groupFetchAllParticipating: async () => Object.fromEntries((await client.group.queryAllGroups()).slice(0, 1000)
        .map(group => [group.jid, { id: group.jid, subject: group.subject, owner: group.owner, participants: [] }])),
      sendMessage: async (jid, content, options) => {
        if (!isCurrent() || blocked || this.auth.failed) throw new Error('WHATSAPP_CONNECTION_STALE');
        let body: WaSendMessageContent;
        if ('text' in content && typeof content.text === 'string') body = content.text;
        else if ('image' in content && Buffer.isBuffer(content.image)) body = { type: 'image', media: content.image, mimetype: content.mimetype, caption: content.caption };
        else if ('document' in content && Buffer.isBuffer(content.document)) body = { type: 'document', media: content.document, mimetype: content.mimetype, fileName: content.fileName };
        else throw new Error('WHATSAPP_MEDIA_UNSUPPORTED');
        const result = await client.message.send(jid, body, { id: options?.messageId, ackTimeoutMs: 15_000, maxAttempts: 1 });
        if (result.id !== options?.messageId) throw new Error('WHATSAPP_DELIVERY_UNCONFIRMED');
        return { key: { id: result.id, remoteJid: jid, fromMe: true } };
      },
    };
    const emit = (event: string, value: unknown) => { if (isCurrent() && (!blocked || event === 'connection.update' && (value as { pairingError?: string })?.pairingError)) events.emit(event, value); };
    client.on('auth_qr', ({ qr }) => { report('pairing_refresh'); emit('connection.update', { qr }); });
    client.on('auth_paired', () => { report('paired'); emit('connection.update', { isNewLogin: true }); });
    client.on('auth_passkey_required', ({ hasSigner }) => {
      if (!hasSigner && isCurrent()) {
        blocked = true; report('passkey_required');
        emit('connection.update', { pairingError: 'WHATSAPP_PASSKEY_REQUIRED' });
        this.shutdown = client.disconnect().catch(() => undefined);
      }
    });
    client.on('connection', event => {
      if (!isCurrent()) return;
      if (event.status === 'open') {
        const credentials = client.getCredentials();
        if (credentials?.meJid) socket.user = { id: credentials.meJid, name: credentials.meDisplayName };
        emit('connection.update', { connection: 'open' });
        if (socket.user) emit('contacts.upsert', [{ id: socket.user.id, name: credentials?.meDisplayName }]);
      } else if (event.status === 'close') {
        emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: event.isLogout ? 401 : event.code ?? 428 } } } });
      }
    });
    client.on('message', message => {
      if (!isCurrent()) return;
      // Both protobufs implement the WhatsApp wire format. App routing only
      // consumes normalized text/image/document fields and validates media URLs.
      const normalized: WAMessage = { key: message.key, message: message.message as unknown as WAMessage['message'],
        pushName: message.pushName, messageTimestamp: message.timestampSeconds };
      emit('messages.upsert', { type: 'notify', messages: [normalized] });
    });
    client.on('mutation', mutation => {
      if (!isCurrent() || mutation.schema !== 'Contact' || mutation.operation !== 'set') return;
      emit('contacts.upsert', [{ id: mutation.id, name: mutation.fullName ?? mutation.firstName }]);
    });
    client.on('debug_client_error', () => {
      if (!isCurrent() || blocked) return;
      if (Date.now() - lastErrorLog >= 10_000) { report('transport_error'); lastErrorLog = Date.now(); }
      if (this.auth.failed) {
        blocked = true; emit('connection.update', { pairingError: 'WHATSAPP_CREDENTIAL_WRITE_FAILED' });
        this.shutdown = client.disconnect().catch(() => undefined);
      }
    });
    // Let the service attach listeners and set link.socket before any QR/event.
    setImmediate(() => { if (!isCurrent() || blocked) return; void client.connect().catch(() => {
      if (!isCurrent() || blocked) return;
      report('transport_error');
      if (this.auth.failed) {
        blocked = true; emit('connection.update', { pairingError: 'WHATSAPP_CREDENTIAL_WRITE_FAILED' });
        this.shutdown = client.disconnect().catch(() => undefined);
      } else emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 428 } } } });
    }); });
    return socket;
  }
  async close() { if (this.active) await this.active.disconnect(); await this.shutdown; this.active = null; }
}
