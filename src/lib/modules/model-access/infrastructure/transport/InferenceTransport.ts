import { InferenceBodies } from './InferenceBodies.js';
import { parseInferenceJson } from '../../contracts/schemas/model-access.schema.js';
import { inferenceMessageSchema } from '@orkestrai/collaboration-protocol/inference';
import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import { SecureInferenceChannel, INFERENCE_PROTOCOL, assertInferenceRelay, inferenceEphemeral, inferenceNonce, inferencePairingMaterial, inferenceSessionMaterial, inferenceFingerprint, signInference, verifyInference, type InferenceIdentity, type InferenceMessage, type InferenceEnvelope } from '@orkestrai/collaboration-protocol/inference';
import { modelAccessPublicPolicySchema } from '../../contracts/schemas/model-access.schema.js';
import type { ModelAccessGrant, ModelAccessConnection, ModelAccessPublicPolicy } from '../../domain/types.js';
import type { ModelAccessPeer } from '../../contracts/schemas/model-access.schema.js';

type PairRequest = Extract<InferenceMessage, { type: 'pair.request' }>;
type Approval = Extract<InferenceMessage, { type: 'pair.approved' }>;
export type InferenceLink = { id: string; send: (message: InferenceMessage) => Promise<void>; close: () => void };
export type OwnerKeys = { identity: InferenceIdentity; secret: string; hostId: string };
export type GuestKeys = { identity: InferenceIdentity; secret: string };
const requestFields = (grantId: string, m: Omit<PairRequest, 'type' | 'signature'>) => [grantId, m.guestId, m.name, m.publicKey, m.ephemeralKey, m.nonce];
const approvalFields = (grantId: string, m: Omit<Approval, 'type' | 'signature'>) => [grantId, m.guestId, m.guestNonce, m.hostId, m.sessionId, m.hostNonce, m.ephemeralKey, m.revision, m.expiresAt, m.name, m.policy];
function publicPolicy(grant: ModelAccessGrant): ModelAccessPublicPolicy {
  return modelAccessPublicPolicySchema.parse({ ...grant.policy, offerings: grant.policy.offerings.map(({ profileId: _private, ...publicOffering }) => publicOffering) });
}
function socket(urlValue: string, grantId: string, peer: string, role: 'host' | 'guest') {
  const url = assertInferenceRelay(urlValue);
  url.pathname = '/v1/inference'; url.search = new URLSearchParams({ share: grantId, peer, role }).toString();
  return new WebSocket(url, INFERENCE_PROTOCOL, { maxPayload: 256 * 1024, perMessageDeflate: false, handshakeTimeout: 10_000, followRedirects: false });
}
function send(ws: WebSocket, channel: SecureInferenceChannel, message: InferenceMessage, recipient?: string) {
  return new Promise<void>((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1024 * 1024) return reject(new Error('INFERENCE_OFFLINE'));
    const data = JSON.stringify(channel.encrypt(message, recipient));
    ws.send(data, { compress: false }, error => error ? reject(new Error('INFERENCE_OFFLINE')) : resolve());
  });
}

export class InferenceHostTransport {
  private ws: WebSocket;
  private stopped = false;
  private channels = new Map<string, { pairing: SecureInferenceChannel; request: PairRequest; session?: SecureInferenceChannel; sessionId?: string; ready: boolean; expires: number }>();
  private chain = Promise.resolve();
  private timer: ReturnType<typeof setInterval>;
  readonly pending = new Map<string, ModelAccessPeer>();
  constructor(private grant: ModelAccessGrant, private keys: OwnerKeys, private callbacks: {
    state: (state: string) => void;
    message: (peer: string, message: InferenceMessage, link: InferenceLink) => Promise<void>;
    disconnected: (peer?: string) => void;
  }) {
    this.ws = socket(grant.relayUrl, grant.id, keys.hostId, 'host');
    this.ws.on('open', () => callbacks.state('connected'));
    this.ws.on('error', () => callbacks.state('offline'));
    this.ws.on('close', () => { this.clear(); callbacks.state('offline'); callbacks.disconnected(); });
    this.ws.on('message', data => {
      // Pairing/state mutations run in wire order. Inference work itself must never block this lane.
      this.chain = this.chain.then(() => this.receive(JSON.parse(data.toString()))).catch(() => { callbacks.state('error'); });
    });
    this.timer = setInterval(() => {
      if (Date.parse(this.grant.expiresAt) <= Date.now()) { this.stop(); callbacks.state('expired'); return; }
      for (const [id, entry] of this.channels) if (!entry.ready && entry.expires < Date.now()) { entry.pairing.destroy(); entry.session?.destroy(); this.channels.delete(id); this.pending.delete(id); }
    }, 15_000); this.timer.unref?.();
  }
  deny(id: string) {
    const entry = this.channels.get(id); if (!entry) return;
    const state = 'denied' as const;
    void send(this.ws, entry.pairing, { type: 'pair.control', guestId: id, guestNonce: entry.request.nonce, state, signature: signInference(this.keys.identity.privateKey, 'pair.control', [this.grant.id, id, entry.request.nonce, state]) }, id).catch(() => {});
    this.pending.delete(id);
  }
  async revoke(reason: 'revoked' | 'expired' | 'policy_changed') {
    await Promise.all([...this.channels.entries()].filter(([, entry]) => entry.ready && entry.session).map(([id, entry]) => send(this.ws, entry.session!, { type: 'session.revoked', reason }, id).catch(() => {})));
  }
  async approve(grant: ModelAccessGrant) {
    this.grant = grant;
    if (!grant.guest) return;
    const entry = this.channels.get(grant.guest.id);
    if (!entry || entry.request.publicKey !== grant.guest.publicKey) return;
    await this.establish(grant.guest.id, entry);
  }
  private async receive(raw: InferenceEnvelope) {
    if (this.stopped || Date.parse(this.grant.expiresAt) <= Date.now()) return;
    const id = raw.senderDeviceId;
    if (id === this.keys.hostId || !/^[0-9a-f-]{36}$/i.test(id)) return;
    let entry = this.channels.get(id);
    if (entry?.session && raw.keyId === entry.session.keyId) {
      const message = entry.session.decrypt(raw);
      if (message.type === 'session.ready') {
        if (message.sessionId !== entry.sessionId || message.revision !== this.grant.revision) throw new Error('INFERENCE_SESSION_MISMATCH');
        entry.ready = true; this.pending.delete(id); this.callbacks.state('connected'); return;
      }
      if (!entry.ready) return;
      if (message.type === 'ping') { await send(this.ws, entry.session, { type: 'pong', at: message.at }, id); return; }
      const current = entry;
      await this.callbacks.message(id, message, { id, send: message => send(this.ws, current.session!, message, id), close: () => this.remove(id) });
      return;
    }
    // A reconnect has fresh ephemeral keys and a fresh signed nonce. Never accept an old request as a rekey.
    const previous = entry;
    if (!entry && this.channels.size >= 5) return;
    const pairing = new SecureInferenceChannel({ role: 'host', grantId: this.grant.id, localId: this.keys.hostId, remoteId: id, material: inferencePairingMaterial(this.keys.secret, this.grant.id) });
    let request: InferenceMessage;
    try { request = pairing.decrypt(raw); } catch { pairing.destroy(); return; }
    if (request.type !== 'pair.request' || request.guestId !== id || !verifyInference(request.publicKey, request.signature, 'pair.request', requestFields(this.grant.id, request))) { pairing.destroy(); return; }
    if (previous) {
      if (previous.request.nonce === request.nonce || previous.request.publicKey !== request.publicKey) { pairing.destroy(); return; }
      this.remove(id);
    }
    entry = { pairing, request, ready: false, expires: Date.now() + 5 * 60_000 }; this.channels.set(id, entry);
    const approved = this.grant.status === 'active' && this.grant.guest?.id === id && this.grant.guest.publicKey === request.publicKey;
    if (approved) await this.establish(id, entry);
    else {
      const state = this.grant.guest ? 'denied' : 'waiting_approval';
      if (state === 'waiting_approval') this.pending.set(id, { id, name: request.name, publicKey: request.publicKey, fingerprint: inferenceFingerprint(request.publicKey), requestedAt: new Date().toISOString() });
      this.callbacks.state('connected');
      const fields = [this.grant.id, id, request.nonce, state];
      await send(this.ws, pairing, { type: 'pair.control', guestId: id, guestNonce: request.nonce, state, signature: signInference(this.keys.identity.privateKey, 'pair.control', fields) }, id);
    }
  }
  private async establish(id: string, entry: NonNullable<ReturnType<InferenceHostTransport['channels']['get']>>) {
    const ephemeral = inferenceEphemeral(); const sessionId = randomUUID(), hostNonce = inferenceNonce();
    const message: Omit<Approval, 'signature'> = { type: 'pair.approved', guestId: id, guestNonce: entry.request.nonce, hostId: this.keys.hostId, sessionId, hostNonce, ephemeralKey: ephemeral.publicKey, revision: this.grant.revision, expiresAt: this.grant.expiresAt, name: this.grant.name, policy: publicPolicy(this.grant) };
    entry.session?.destroy(); entry.sessionId = sessionId; entry.ready = false;
    entry.session = new SecureInferenceChannel({ role: 'host', grantId: this.grant.id, localId: this.keys.hostId, remoteId: id, material: inferenceSessionMaterial({ privateKey: ephemeral.privateKey, remotePublicKey: entry.request.ephemeralKey, secret: this.keys.secret, grantId: this.grant.id, sessionId, guestNonce: entry.request.nonce, hostNonce, guestId: id, hostId: this.keys.hostId, revision: this.grant.revision }) });
    await send(this.ws, entry.pairing, { ...message, signature: signInference(this.keys.identity.privateKey, 'pair.approved', approvalFields(this.grant.id, message)) }, id);
  }
  private remove(id: string) { const entry = this.channels.get(id); entry?.pairing.destroy(); entry?.session?.destroy(); this.channels.delete(id); this.pending.delete(id); this.callbacks.disconnected(id); }
  private clear() { for (const id of [...this.channels.keys()]) this.remove(id); }
  async stop() {
    this.stopped = true; clearInterval(this.timer); this.clear();
    if (this.ws.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => {
      const timer=setTimeout(()=>this.ws.terminate(),1000);timer.unref?.();
      this.ws.once('close',()=>{clearTimeout(timer);resolve();});this.ws.close(1000);
    });
  }
}

export class InferenceGuestTransport {
  private ws: WebSocket;
  private pairing: SecureInferenceChannel;
  private session?: SecureInferenceChannel;
  private ephemeral = inferenceEphemeral();
  private nonce = inferenceNonce();
  private hostId?: string;
  private chain = Promise.resolve();
  private stopped = false;
  private heartbeat?: ReturnType<typeof setInterval>;
  private bodies: InferenceBodies;
  constructor(private connection: ModelAccessConnection, private keys: GuestKeys, private callbacks: {
    state: (state: string) => void;
    approved: (policy: ModelAccessPublicPolicy, expiresAt: string, name: string) => Promise<void>;
    message: (message: InferenceMessage) => Promise<void>;
    disconnected: () => void;
  }) {
    this.bodies = new InferenceBodies(async (id, kind, bytes) => {
      const message = inferenceMessageSchema.parse(parseInferenceJson(bytes));
      if (kind !== 'tool.call' || message.type !== 'tool.call' || message.callId !== id) throw new Error('INFERENCE_TOOL_MISMATCH');
      await this.callbacks.message(message);
    }, () => this.stop());
    this.pairing = new SecureInferenceChannel({ role: 'guest', grantId: connection.grantId, localId: connection.guestId, remoteId: null, material: inferencePairingMaterial(keys.secret, connection.grantId) });
    this.ws = socket(connection.relayUrl, connection.grantId, connection.guestId, 'guest');
    this.ws.on('open', () => {
      const request = { guestId: connection.guestId, name: connection.guestName, publicKey: keys.identity.publicKey, ephemeralKey: this.ephemeral.publicKey, nonce: this.nonce };
      void send(this.ws, this.pairing, { type: 'pair.request', ...request, signature: signInference(keys.identity.privateKey, 'pair.request', requestFields(connection.grantId, request)) }).catch(() => this.stop());
    });
    this.ws.on('error', () => callbacks.state('offline'));
    this.ws.on('close', () => { this.session?.destroy(); this.pairing.destroy(); clearInterval(this.heartbeat); callbacks.state('offline'); callbacks.disconnected(); });
    this.ws.on('message', data => { this.chain = this.chain.then(() => this.receive(JSON.parse(data.toString()))).catch(() => { callbacks.state('error'); this.stop(); }); });
  }
  private async receive(raw: InferenceEnvelope) {
    if (this.stopped) return;
    if (this.session && raw.keyId === this.session.keyId) {
      const message = this.session.decrypt(raw);
      if (message.type === 'pong') return;
      if (message.type.startsWith('body.')) { await this.bodies.receive(message); return; }
      await this.callbacks.message(message); return;
    }
    if (this.session) return;
    const message = this.pairing.decrypt(raw);
    if (message.type === 'pair.control') {
      if (message.guestId !== this.connection.guestId || message.guestNonce !== this.nonce || !verifyInference(this.connection.ownerPublicKey, message.signature, 'pair.control', [this.connection.grantId, message.guestId, message.guestNonce, message.state])) throw new Error('INFERENCE_OWNER_IDENTITY');
      this.callbacks.state(message.state); return;
    }
    if (message.type !== 'pair.approved' || message.guestId !== this.connection.guestId || message.guestNonce !== this.nonce || raw.senderDeviceId !== message.hostId || !verifyInference(this.connection.ownerPublicKey, message.signature, 'pair.approved', approvalFields(this.connection.grantId, message))) throw new Error('INFERENCE_OWNER_IDENTITY');
    if (Date.parse(message.expiresAt) <= Date.now()) throw new Error('INFERENCE_EXPIRED');
    const policy = modelAccessPublicPolicySchema.parse(message.policy);
    this.hostId = message.hostId;
    this.session = new SecureInferenceChannel({ role: 'guest', grantId: this.connection.grantId, localId: this.connection.guestId, remoteId: message.hostId, material: inferenceSessionMaterial({ privateKey: this.ephemeral.privateKey, remotePublicKey: message.ephemeralKey, secret: this.keys.secret, grantId: this.connection.grantId, sessionId: message.sessionId, guestNonce: this.nonce, hostNonce: message.hostNonce, guestId: this.connection.guestId, hostId: message.hostId, revision: message.revision }) });
    await this.callbacks.approved(policy, message.expiresAt, message.name);
    await this.send({ type: 'session.ready', sessionId: message.sessionId, revision: message.revision });
    this.callbacks.state('connected');
    this.heartbeat = setInterval(() => { void this.send({ type: 'ping', at: Date.now() }).catch(() => this.stop()); }, 60_000); this.heartbeat.unref?.();
  }
  send(message: InferenceMessage) { if (!this.session || !this.hostId || this.stopped) return Promise.reject(new Error('INFERENCE_OFFLINE')); return send(this.ws, this.session, message, this.hostId); }
  stop() { this.stopped = true; this.bodies.clear(); clearInterval(this.heartbeat); this.session?.destroy(); this.pairing.destroy(); this.ws.close(1000); }
}
