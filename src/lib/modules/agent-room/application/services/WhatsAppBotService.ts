import { validWhatsAppJid as validJid, whatsAppInboundSender, whatsAppOutputId } from '../../domain/whatsapp-messages.js';
import { botConnectionRepository, type BotConnection } from '../../infrastructure/repositories/BotConnectionRepository.js';
import { channelBindingRepository } from '../../infrastructure/repositories/ChannelBindingRepository.js';
import { channelRepository } from '../../infrastructure/repositories/ChannelRepository.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { directChannel, senderAllowed, channelPrefixAllowed } from '../../domain/channels.js';
import { WorkspaceAttachmentDto, WorkspaceAttachmentDeleteDto } from '../dto/WorkspaceAttachmentDto.js';
import { workspaceAttachmentService } from './WorkspaceAttachmentService.js';
import { channelService } from './ChannelService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';
import { desktopSecretService } from '../../infrastructure/secrets/DesktopSecretService.js';
import type { BotArtifact } from '../../domain/bot-artifacts.js';
import type { WorkspaceAttachment } from '../../domain/types.js';
import type { WAMessage } from '@whiskeysockets/baileys';
import type { WhatsAppSecureAuth } from '../../infrastructure/integrations/WhatsAppSecureAuth.js';
import { allowedWhatsAppMediaUrl, downloadWhatsAppMedia } from '../../infrastructure/integrations/WhatsAppMedia.js';
import { attentionService } from './AttentionService.js';
import { attentionRepository } from '../../infrastructure/repositories/AttentionRepository.js';
import { nativeNotificationService } from './NativeNotificationService.js';
import { settingsService } from './SettingsService.js';
import * as m from '$lib/paraglide/messages.js';
import type { ZapoSecureStore } from '../../infrastructure/integrations/ZapoSecureStore.js';
import type { ZapoWhatsAppTransport } from '../../infrastructure/integrations/ZapoWhatsAppTransport.js';
import type { WhatsAppTransport } from '../../infrastructure/integrations/WhatsAppTransport.js';

const logger = { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {} };
type Link = {
  connection: BotConnection; auth: WhatsAppSecureAuth | ZapoSecureStore; socket: WhatsAppTransport | null;
  zapo?: ZapoWhatsAppTransport;
  state: 'connecting' | 'qr' | 'connected' | 'offline' | 'error'; qr: string | null; error: string | null;
  chats: Map<string, string>; stopped: boolean; retry: ReturnType<typeof setTimeout> | null;
  drainRetry: ReturnType<typeof setTimeout> | null;
  wakeDrain?: () => void;
  pending: WAMessage[]; saveTail: Promise<unknown>; draining: boolean; attempts: number; epoch: number;
  disconnectTimer?: ReturnType<typeof setTimeout> | null;
};
const PENDING_LIMIT = 64;

/** Linked-device WhatsApp. All keys and pending encrypted messages stay in desktop secure storage. */
export class WhatsAppBotService {
  private links = new Map<string, Link>();
  private starts = new Map<string, Promise<Link>>();
  private lifecycle = new Map<string, Promise<unknown>>();
  private withLifecycle<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const run = (this.lifecycle.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation);
    this.lifecycle.set(id, run);
    void run.finally(() => { if (this.lifecycle.get(id) === run) this.lifecycle.delete(id); }).catch(() => undefined);
    return run;
  }
  private notices = new Map<string, Promise<void>>();
  private pendingKey(link: Link) { return `automation:whatsapp:pending:${link.connection.workspaceId}:${link.connection.id}`; }
  private changed(workspaceId: string) {
    (globalThis as { __orkestraiBroadcast?: (frame: Record<string, unknown>) => void }).__orkestraiBroadcast?.({ type: 'workspaceChanged', workspaceId });
  }
  private async require(workspaceId: string, id: string) {
    const connection = await botConnectionRepository.find(workspaceId, id);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!connection?.enabled || !workspace || workspace.suspendedAt) throw new Error('BOT_CONNECTION_UNAVAILABLE');
    return connection;
  }
  async create(workspaceId: string, name: string) {
    if ((await botConnectionRepository.list(workspaceId)).length >= 5) throw new Error('BOT_CONNECTION_LIMIT');
    const connection = await botConnectionRepository.create(workspaceId, name);
    try { await this.open(connection, true); return { id: connection.id }; }
    catch (error) {
      await botConnectionRepository.remove(workspaceId, connection.id);
      throw error;
    }
  }
  async restore() {
    for (const connection of await botConnectionRepository.list()) {
      if (connection.enabled) void this.open(connection).catch(() => this.notice(connection, 'unavailable'));
      else void this.notice(connection, 'relink');
    }
  }
  private notice(connection: BotConnection, kind: 'relink' | 'offline' | 'unavailable', link?: Link): Promise<void> {
    const previous = this.notices.get(connection.id) ?? Promise.resolve();
    const run = previous.then(async () => {
      const recovered = () => Boolean(link?.stopped || link?.state === 'connected');
      if (recovered()) return;
      const current = await botConnectionRepository.find(connection.workspaceId, connection.id);
      const workspace = await workspaceRepository.getWorkspace(connection.workspaceId);
      if (!current || !workspace || workspace.suspendedAt) return;
      const correlationId = `whatsapp:${connection.id}:${kind === 'relink' ? 'relink' : 'offline'}`;
      // A revoked session keeps the same identity across app restarts. Reading
      // or dismissing its notice must not generate another OS notification.
      if (kind === 'relink' ? await attentionRepository.hasCorrelation(workspace.id, correlationId)
        : await attentionRepository.hasUnresolved(workspace.id, correlationId)) return;
      if (recovered()) return;
      if (kind === 'relink') await attentionService.resolveSource(workspace.id, 'whatsapp_connection', connection.id);
      const language = await settingsService.get('uiLanguage');
      const locale = language === 'pt-BR' || language === 'es' ? language : 'en';
      const title = m['bots.whatsapp_notice_title']({}, { locale });
      const body = kind === 'relink' ? m['bots.whatsapp_notice_relink']({}, { locale }) : m['bots.whatsapp_notice_offline']({}, { locale });
      await attentionService.raise({ workspaceId: workspace.id, nodeId: null, category: 'system', severity: 'warning',
        title, body, sourceType: 'whatsapp_connection', sourceId: connection.id, correlationId, action: { target: 'bots' } });
      if (!recovered()) await nativeNotificationService.send(workspace, { kind: 'attention', title: current.name, message: body });
    }).catch(() => { console.warn('WHATSAPP_CONNECTION_NOTICE_FAILED'); });
    this.notices.set(connection.id, run);
    void run.finally(() => { if (this.notices.get(connection.id) === run) this.notices.delete(connection.id); });
    return run;
  }
  private scheduleDisconnectNotice(link: Link) {
    if (link.disconnectTimer || link.stopped) return;
    link.disconnectTimer = setTimeout(() => {
      link.disconnectTimer = null;
      void this.notice(link.connection, 'offline', link);
    }, 60_000);
    link.disconnectTimer.unref?.();
  }
  private async resolveConnectionNotice(connection: BotConnection, link?: Link) {
    if (link?.disconnectTimer) clearTimeout(link.disconnectTimer);
    if (link) link.disconnectTimer = null;
    await this.notices.get(connection.id);
    await attentionService.resolveSource(connection.workspaceId, 'whatsapp_connection', connection.id);
  }
  private connectionClosed(link: Link, code: number | undefined, reasons: { loggedOut: number; connectionReplaced: number }) {
    link.epoch++;
    link.qr = null; link.state = 'offline'; link.socket = null;
    if (code === reasons.loggedOut || code === reasons.connectionReplaced) {
      link.error = code === reasons.loggedOut ? 'WHATSAPP_LOGGED_OUT' : 'WHATSAPP_CONNECTION_REPLACED';
      link.connection.enabled = false;
      if (link.retry) clearTimeout(link.retry);
      link.retry = null;
      if (link.disconnectTimer) clearTimeout(link.disconnectTimer);
      link.disconnectTimer = null;
      void botConnectionRepository.disable(link.connection.workspaceId, link.connection.id)
        .then(() => this.notice(link.connection, 'relink', link)).catch(() => { console.warn('WHATSAPP_CONNECTION_NOTICE_FAILED'); });
    } else { this.scheduleDisconnectNotice(link); this.reconnect(link); }
  }
  private open(connection: BotConnection, allowInteractiveUnlock = false): Promise<Link> {
    return this.withLifecycle(connection.id, () => this.openOnce(connection, allowInteractiveUnlock));
  }
  private async openOnce(connection: BotConnection, allowInteractiveUnlock = false): Promise<Link> {
    await this.require(connection.workspaceId, connection.id);
    const current = this.links.get(connection.id);
    if (current && !current.stopped) return Promise.resolve(current);
    const starting = this.starts.get(connection.id);
    if (starting) return starting;
    const run = (async () => {
      const { WhatsAppSecureAuth } = await import('../../infrastructure/integrations/WhatsAppSecureAuth.js');
      const options = { allowInteractiveUnlock };
      // Keep registered preview sessions on their original transport. Fresh or
      // unpaired links use Zapo; no linked account is silently logged out.
      const useZapo = Boolean(await desktopSecretService.get(`automation:whatsapp:zapo:${connection.workspaceId}:${connection.id}`, options))
        || !await WhatsAppSecureAuth.hasRegistered(connection.workspaceId, connection.id, desktopSecretService, options);
      const auth = useZapo ? await (await import('../../infrastructure/integrations/ZapoSecureStore.js')).ZapoSecureStore.open(connection.workspaceId, connection.id, desktopSecretService, options)
        : await WhatsAppSecureAuth.open(connection.workspaceId, connection.id, desktopSecretService, options);
      const link: Link = { connection, auth, socket: null, state: 'connecting', qr: null, error: null,
        chats: new Map(), stopped: false, retry: null, drainRetry: null, pending: [], saveTail: Promise.resolve(), draining: false, attempts: 0, epoch: 0 };
      try {
        const previous = await desktopSecretService.get(this.pendingKey(link));
        if (previous) {
          const { BufferJSON } = await import('@whiskeysockets/baileys');
          if (Buffer.byteLength(previous) > 2 * 1024 * 1024) throw new Error('WHATSAPP_PENDING_LIMIT');
          const pending = JSON.parse(previous, BufferJSON.reviver);
          if (!Array.isArray(pending) || pending.length > PENDING_LIMIT) throw new Error('WHATSAPP_PENDING_INVALID');
          link.pending = pending;
        }
        this.links.set(connection.id, link);
        await this.connect(link);
      }
      catch (error) {
        link.stopped = true; link.epoch++;
        await link.socket?.end(undefined);
        await auth.close(); this.links.delete(connection.id);
        throw error;
      }
      return link;
    })();
    this.starts.set(connection.id, run);
    void run.finally(() => { if (this.starts.get(connection.id) === run) this.starts.delete(connection.id); }).catch(() => undefined);
    return run;
  }
  private async connect(link: Link) {
    await this.require(link.connection.workspaceId, link.connection.id);
    if (link.stopped) return;
    const { default: makeWASocket, DisconnectReason, proto } = await import('@whiskeysockets/baileys');
    const epoch = ++link.epoch;
    const isCurrent = () => !link.stopped && link.epoch === epoch;
    let socket: WhatsAppTransport;
    const auth = link.auth;
    if ('engine' in auth && auth.engine === 'zapo') {
      const { ZapoWhatsAppTransport } = await import('../../infrastructure/integrations/ZapoWhatsAppTransport.js');
      link.zapo ??= new ZapoWhatsAppTransport(auth, link.connection.id);
      socket = await link.zapo.create(isCurrent, event => this.linkEvent(link, event));
    } else {
      const legacy = makeWASocket({ auth: auth.forSession(isCurrent), logger, markOnlineOnConnect: false, syncFullHistory: false,
        // Import contact names, never past conversations or their attachments.
        shouldSyncHistoryMessage: message => message.syncType === proto.HistorySync.HistorySyncType.PUSH_NAME,
        browser: ['Orkestrai', 'Desktop', '1.0.0'], defaultQueryTimeoutMs: 15_000,
        getMessage: async () => undefined, connectTimeoutMs: 30_000 });
      legacy.ev.on('creds.update', () => {
        if (!isCurrent()) return;
        void auth.saveCreds(legacy.authState.creds, isCurrent).catch(() => { if (isCurrent()) this.fail(link, 'WHATSAPP_CREDENTIAL_WRITE_FAILED'); });
      });
      socket = legacy;
    }
    link.socket = socket;
    const remember = (id: unknown, name: unknown) => {
      if (!isCurrent() || typeof id !== 'string' || !validJid(id)) return;
      if (!link.chats.has(id) && link.chats.size >= 1000) return;
      link.chats.set(id, (typeof name === 'string' && name.trim() ? name.trim() : link.chats.get(id) ?? id).slice(0, 120));
    };
    const contacts = (items: Array<{ id?: string; name?: string; notify?: string }>) => {
      if (!isCurrent()) return;
      for (const item of items.slice(0, 1000)) remember(item.id, item.name ?? item.notify);
      this.changed(link.connection.workspaceId);
    };
    socket.ev.on('contacts.upsert', contacts);
    socket.ev.on('contacts.update', contacts);
    socket.ev.on('messaging-history.set', history => contacts(history.contacts));
    socket.ev.on('chats.upsert', chats => { for (const chat of chats.slice(0, 1000)) remember(chat.id, chat.name); this.changed(link.connection.workspaceId); });
    socket.ev.on('groups.upsert', groups => { for (const group of groups.slice(0, 1000)) remember(group.id, group.subject); this.changed(link.connection.workspaceId); });
    socket.ev.on('connection.update', update => {
      if (link.stopped || link.socket !== socket) return;
      if ('pairingError' in update && ['WHATSAPP_PASSKEY_REQUIRED', 'WHATSAPP_CREDENTIAL_WRITE_FAILED'].includes(String(update.pairingError))) {
        link.epoch++; link.state = 'error'; link.qr = null; link.error = String(update.pairingError);
        if (link.retry) clearTimeout(link.retry); link.retry = null;
        this.changed(link.connection.workspaceId); return;
      }
      if (update.qr) { this.linkEvent(link, 'qr'); link.qr = update.qr.slice(0, 4096); link.state = 'qr'; }
      if (update.connection === 'open') {
        this.linkEvent(link, 'open'); link.qr = null; link.state = 'connected'; link.error = null; link.attempts = 0; void this.drain(link);
        void this.resolveConnectionNotice(link.connection, link).catch(() => { console.warn('WHATSAPP_CONNECTION_NOTICE_FAILED'); });
        void socket.groupFetchAllParticipating().then(groups => {
          if (!isCurrent()) return;
          for (const group of Object.values(groups).slice(0, 1000)) remember(group.id, group.subject);
          this.changed(link.connection.workspaceId);
        }).catch(() => { if (isCurrent()) { link.error = 'WHATSAPP_CONTACTS_UNAVAILABLE'; this.changed(link.connection.workspaceId); } });
      }
      if (update.connection === 'close') {
        const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        this.linkEvent(link, 'close', code); this.connectionClosed(link, code, DisconnectReason);
      }
      this.changed(link.connection.workspaceId);
    });
    socket.ev.on('messages.upsert', update => {
      if (update.type !== 'notify' || link.stopped || link.socket !== socket) return;
      for (const message of update.messages) void this.receive(link, message).catch(() => this.fail(link, 'WHATSAPP_MESSAGE_STORE_FAILED'));
    });
  }
  private linkEvent(link: Link, event: string, code?: number) {
    // Safe diagnostics: never log QR data, credentials, messages, names or JIDs.
    if (!['qr', 'open', 'close', 'pairing_refresh', 'passkey_required', 'paired', 'transport_error'].includes(event)) return;
    console.info('[whatsapp-link]', JSON.stringify({ connectionId: link.connection.id,
      engine: 'engine' in link.auth ? link.auth.engine : 'baileys', event,
      ...(typeof code === 'number' && Number.isInteger(code) ? { code } : {}) }));
  }
  private reconnect(link: Link) {
    if (link.retry || link.stopped || !link.connection.enabled) return;
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(6, link.attempts++));
    link.retry = setTimeout(() => {
      link.retry = null;
      void this.connect(link).catch(() => { if (!link.stopped) { link.state = 'error'; link.error = 'WHATSAPP_RECONNECT_FAILED'; this.reconnect(link); } });
    }, wait);
    link.retry.unref?.();
  }
  private fail(link: Link, code: string) {
    link.error = code; link.state = 'error'; this.changed(link.connection.workspaceId);
    void link.socket?.end(new Error(code));
  }
  private async persistPending(link: Link) {
    const { BufferJSON } = await import('@whiskeysockets/baileys');
    const json = JSON.stringify(link.pending, BufferJSON.replacer);
    if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw new Error('WHATSAPP_PENDING_LIMIT');
    await desktopSecretService.set(this.pendingKey(link), json);
  }
  private mutatePending(link: Link, operation: () => Promise<void>) {
    const run = link.saveTail.catch(() => undefined).then(async () => { if (link.stopped) return; await operation(); });
    link.saveTail = run;
    return run;
  }
  private async receive(link: Link, message: WAMessage) {
    const chat = message.key.remoteJid ?? '';
    const sender = whatsAppInboundSender(message.key, link.socket?.user?.id);
    if (!sender || !message.message) return;
    const { normalizeMessageContent } = await import('@whiskeysockets/baileys');
    const content = normalizeMessageContent(message.message);
    if (!content?.conversation && !content?.extendedTextMessage && !content?.imageMessage && !content?.documentMessage) return;
    const discovered = link.chats.size < 1000 && !link.chats.has(chat);
    if (discovered) link.chats.set(chat, (message.pushName || chat).slice(0, 120));
    const bindings = (await channelBindingRepository.list(link.connection.workspaceId)).filter(binding => binding.enabled && binding.kind === 'whatsapp' && binding.integrationId === link.connection.id && binding.externalChatId === chat);
    const body = String(content?.conversation ?? content?.extendedTextMessage?.text ?? content?.imageMessage?.caption ?? content?.documentMessage?.caption ?? '');
    if (!bindings.some(binding => senderAllowed(binding, sender, null) && channelPrefixAllowed(binding, body))) { if (discovered) this.changed(link.connection.workspaceId); return; }
    await this.mutatePending(link, async () => {
      if (link.pending.some(item => item.key.id === message.key.id && item.key.remoteJid === chat)) return;
      if (link.pending.length >= PENDING_LIMIT) throw new Error('WHATSAPP_PENDING_LIMIT');
      const saved = { key: message.key, message: message.message, messageTimestamp: message.messageTimestamp, pushName: message.pushName };
      link.pending.push(saved);
      try { await this.persistPending(link); } catch (error) { link.pending.pop(); throw error; }
    });
    void this.drain(link);
  }
  private async drain(link: Link) {
    if (link.stopped) return;
    if (link.draining) { link.wakeDrain?.(); return; }
    link.draining = true;
    const blockedChats = new Set<string>();
    const active = new Map<string, Promise<void>>();
    let retry = false;
    const deliver = async (message: WAMessage) => {
      try { await this.dispatch(link, message); }
      catch (error) {
        const code = error instanceof Error ? error.message : '';
        if (!['CHANNEL_ATTACHMENT_TOO_LARGE', 'CHANNEL_ATTACHMENT_DENIED'].includes(code)) throw error;
        link.error = code; this.changed(link.connection.workspaceId);
        for (const binding of await channelBindingRepository.list(link.connection.workspaceId)) {
          if (binding.kind === 'whatsapp' && binding.integrationId === link.connection.id && binding.externalChatId === message.key.remoteJid) {
            await channelBindingRepository.update(binding.id, { lastError: code });
          }
        }
      }
      await this.mutatePending(link, async () => {
        const old = link.pending;
        link.pending = old.filter(item => !(item.key.id === message.key.id && item.key.remoteJid === message.key.remoteJid));
        try { await this.persistPending(link); } catch (error) { link.pending = old; throw error; }
      });
    };
    try {
      while (!link.stopped) {
        await link.saveTail.catch(() => undefined);
        // At most three chats work concurrently. Each chat retains FIFO order;
        // new arrivals can use a free slot while another chat downloads a file.
        for (const message of link.pending) {
          if (active.size >= 3) break;
          const chat = message.key.remoteJid ?? '';
          if (active.has(chat) || blockedChats.has(chat)) continue;
          const run = deliver(message).catch(() => { blockedChats.add(chat); retry = true; })
            .finally(() => active.delete(chat));
          active.set(chat, run);
        }
        if (!active.size) break;
        const incoming = new Promise<void>(resolve => { link.wakeDrain = resolve; });
        await Promise.race([...active.values(), incoming]);
        link.wakeDrain = undefined;
      }
    } finally {
      // Never release the drain while an earlier delivery is still in flight.
      await Promise.allSettled([...active.values()]);
      link.wakeDrain = undefined; link.draining = false;
      if (retry && !link.stopped) {
        link.error = 'WHATSAPP_MESSAGE_PENDING'; this.changed(link.connection.workspaceId);
        if (!link.drainRetry) { link.drainRetry = setTimeout(() => { link.drainRetry = null; void this.drain(link); }, 15_000); link.drainRetry.unref?.(); }
      }
    }
  }
  private async dispatch(link: Link, message: WAMessage) {
    const { normalizeMessageContent } = await import('@whiskeysockets/baileys');
    const chat = message.key.remoteJid ?? '', sender = whatsAppInboundSender(message.key, link.socket?.user?.id);
    if (!sender) return;
    const content = normalizeMessageContent(message.message);
    const media = content?.imageMessage ?? content?.documentMessage;
    const body = String(content?.conversation ?? content?.extendedTextMessage?.text ?? media?.caption ?? '').slice(0, 8000);
    const bindings = (await channelBindingRepository.list(link.connection.workspaceId)).filter(binding => binding.enabled && binding.kind === 'whatsapp' && binding.integrationId === link.connection.id && binding.externalChatId === chat && senderAllowed(binding, sender, null) && channelPrefixAllowed(binding, body));
    for (const binding of bindings) {
      await this.require(binding.workspaceId, link.connection.id);
      const externalId = `${chat}:${message.key.id}`;
      const previous = await channelRepository.findExternal(binding.workspaceId, directChannel(binding.nodeId), binding.id, externalId);
      const attachments: WorkspaceAttachment[] = Array.isArray(previous?.meta.attachments) ? previous.meta.attachments as WorkspaceAttachment[] : [];
      const uploaded: WorkspaceAttachment[] = [];
      try {
        if (media && !previous) {
          if (Number(media.fileLength ?? 0) > 10 * 1024 * 1024) throw new Error('CHANNEL_ATTACHMENT_TOO_LARGE');
          if (media.url && !allowedWhatsAppMediaUrl(media.url)) throw new Error('CHANNEL_ATTACHMENT_DENIED');
          const bytes = await downloadWhatsAppMedia(message);
          const filename = content?.documentMessage?.fileName ?? 'photo.jpg';
          const file = new File([new Uint8Array(bytes)], filename.slice(0, 180), { type: media.mimetype ?? 'application/octet-stream' });
          const attachment = await workspaceAttachmentService.create(binding.workspaceId, WorkspaceAttachmentDto.fromFile(file));
          attachments.push(attachment); uploaded.push(attachment);
        }
        const latest = await channelBindingRepository.find(binding.workspaceId, binding.id);
        if (link.stopped || !latest?.enabled || latest.integrationId !== link.connection.id || latest.nodeId !== binding.nodeId || latest.externalChatId !== chat || !senderAllowed(latest, sender, null) || !channelPrefixAllowed(latest, body)) continue;
        await channelService.postExternal(binding.workspaceId, binding.nodeId, { body, via: 'whatsapp', bindingId: binding.id,
          expectedBindingScope: (await import('./BotSafetyService.js')).botSafetyService.bindingScope(latest),
          sender: (message.pushName || sender).slice(0, 120), senderId: sender, externalId, attachments });
        await channelBindingRepository.update(binding.id, { lastInboundAt: new Date().toISOString(), lastError: null });
      } finally {
        for (const attachment of uploaded) await workspaceAttachmentService.remove(binding.workspaceId, WorkspaceAttachmentDeleteDto.fromAttachment(attachment)).catch(() => undefined);
      }
    }
  }
  async list(workspaceId: string) {
    return (await botConnectionRepository.list(workspaceId)).map(connection => {
      const link = this.links.get(connection.id);
      return { ...connection, state: link?.state ?? 'offline', error: link?.error ?? null, chats: [...(link?.chats.entries() ?? [])].map(([id, name]) => ({ id, name })) };
    });
  }
  retry(workspaceId: string, id: string) {
    return this.withLifecycle(id, () => this.retryOnce(workspaceId, id));
  }
  private async retryOnce(workspaceId: string, id: string) {
    const connection = await botConnectionRepository.find(workspaceId, id);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!connection || !workspace || workspace.suspendedAt) throw new Error('BOT_CONNECTION_UNAVAILABLE');
    await this.starts.get(id)?.catch(() => undefined);
    const link = this.links.get(id);
    if (link) {
      link.stopped = true; link.epoch++;
      for (const timer of [link.retry, link.disconnectTimer, link.drainRetry]) if (timer) clearTimeout(timer);
      await link.socket?.end(undefined); await link.zapo?.close();
      await link.saveTail.catch(() => undefined);
      await link.auth.close().catch(() => undefined);
      this.links.delete(id);
    }
    // A revoked legacy session cannot resume. Seed the new transport without
    // deleting saved chats, routes, history or another connection's credentials.
    if (!connection.enabled) {
      await desktopSecretService.delete(`automation:whatsapp:zapo:${workspaceId}:${id}`);
      const { ZapoSecureStore } = await import('../../infrastructure/integrations/ZapoSecureStore.js');
      const fresh = await ZapoSecureStore.open(workspaceId, id, desktopSecretService, { allowInteractiveUnlock: true });
      await fresh.close();
    }
    await botConnectionRepository.enable(workspaceId, id);
    connection.enabled = true;
    await this.openOnce(connection, true);
    this.changed(workspaceId);
    return { id };
  }
  async status(workspaceId: string, id: string) {
    const connection = await this.require(workspaceId, id), link = await this.open(connection);
    const { default: QRCode } = await import('qrcode');
    return { id, state: link.state, error: link.error, qr: link.qr ? await QRCode.toDataURL(link.qr, { margin: 2, width: 256 }) : null };
  }
  disconnect(workspaceId: string, id: string) {
    return this.withLifecycle(id, () => this.disconnectOnce(workspaceId, id));
  }
  private async disconnectOnce(workspaceId: string, id: string) {
    const connection = await botConnectionRepository.find(workspaceId, id);
    if (!connection) throw new Error('BOT_CONNECTION_NOT_FOUND');
    await this.starts.get(id)?.catch(() => undefined);
    const link = this.links.get(id);
    if (link) {
      link.stopped = true;
      link.epoch++;
      if (link.retry) clearTimeout(link.retry);
      if (link.disconnectTimer) clearTimeout(link.disconnectTimer);
      if (link.drainRetry) clearTimeout(link.drainRetry);
      await link.socket?.end(undefined);
      await link.zapo?.close();
      await link.saveTail.catch(() => undefined);
      await link.auth.forget();
      await desktopSecretService.delete(`automation:whatsapp:${workspaceId}:${id}`);
      await desktopSecretService.delete(`automation:whatsapp:zapo:${workspaceId}:${id}`);
      await desktopSecretService.delete(this.pendingKey(link));
      this.links.delete(id);
    } else {
      await desktopSecretService.delete(`automation:whatsapp:${workspaceId}:${id}`);
      await desktopSecretService.delete(`automation:whatsapp:zapo:${workspaceId}:${id}`);
      await desktopSecretService.delete(`automation:whatsapp:pending:${workspaceId}:${id}`);
    }
    for (const binding of await channelBindingRepository.list(workspaceId)) if (binding.integrationId === id && binding.kind === 'whatsapp') await channelBindingRepository.delete(workspaceId, binding.id);
    await botConnectionRepository.remove(workspaceId, id);
    await this.resolveConnectionNotice({ id, workspaceId, name: '', kind: 'whatsapp', enabled: false }, link);
    this.changed(workspaceId);
  }
  async disconnectWorkspace(workspaceId: string) {
    for (const connection of await botConnectionRepository.list(workspaceId)) await this.disconnect(workspaceId, connection.id);
  }
  async send(workspaceId: string, nodeId: string, bindingId: string, body: string, messageId: string, artifacts: BotArtifact[] = []) {
    const binding = await channelBindingRepository.find(workspaceId, bindingId);
    if (!binding?.enabled || binding.kind !== 'whatsapp' || binding.nodeId !== nodeId || !validJid(binding.externalChatId)) throw new Error('BOT_CONNECTION_UNAVAILABLE');
    const connection = await this.require(workspaceId, binding.integrationId), link = await this.open(connection);
    if (link.state !== 'connected' || !link.socket) throw new Error('WHATSAPP_NOT_CONNECTED');
    const { integrationExecutionService } = await import('./IntegrationExecutionService.js');
    const files: Array<BotArtifact & { bytes: Buffer }> = [];
    for (const artifact of artifacts) {
      if (!artifact.sha256) throw new Error('BOT_ARTIFACT_INVALID');
      const bytes = await integrationExecutionService.readBotArtifact(workspaceId, nodeId, artifact.path, artifact.sha256);
      files.push({ ...artifact, bytes });
    }
    await autonomyPolicyService.execute({ workspaceId, capability: 'integration', operation: 'whatsapp.linked.send_message',
      target: binding.externalChatId, mutation: true, risk: 'external_publication', actorType: 'agent', actorId: nodeId,
      input: { bindingId, messageId }, network: { url: 'https://web.whatsapp.com/', method: 'POST' }, certainty: 'semantic' }, async () => {
      const latest = await channelBindingRepository.find(workspaceId, bindingId);
      if (!latest?.enabled || latest.externalChatId !== binding.externalChatId || link.stopped) throw new Error('BOT_CONNECTION_UNAVAILABLE');
      const id = whatsAppOutputId(binding.id, messageId, 'text');
      const sent = await link.socket!.sendMessage(binding.externalChatId, { text: body.slice(0, 60_000) }, { messageId: id });
      if (!sent?.key.id) throw new Error('WHATSAPP_DELIVERY_UNCONFIRMED');
      const ids = [sent.key.id];
      for (const [index, file] of files.entries()) {
        const fileId = whatsAppOutputId(binding.id, messageId, `file:${index}`);
        const payload = file.image && file.mimeType !== 'image/gif'
          ? { image: file.bytes, mimetype: file.mimeType, caption: file.name }
          : { document: file.bytes, mimetype: file.mimeType, fileName: file.name };
        const receipt = await link.socket!.sendMessage(binding.externalChatId, payload, { messageId: fileId });
        if (!receipt?.key.id) throw new Error('WHATSAPP_DELIVERY_UNCONFIRMED');
        ids.push(receipt.key.id);
      }
      return { messageIds: ids };
    });
  }
}
const globalState = globalThis as typeof globalThis & { __orkestraiWhatsAppBots?: WhatsAppBotService };
export const whatsappBotService = globalState.__orkestraiWhatsAppBots ??= new WhatsAppBotService();
