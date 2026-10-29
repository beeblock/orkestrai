import { uuidv7 } from '@beeblock/svelar/support';
import { inferenceIdentity, inferenceNonce, inferenceInvite, parseInferenceInvite, inferenceFingerprint, type InferenceMessage } from '@orkestrai/collaboration-protocol/inference';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { providerProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import { modelAccessRepository, type ModelAccessRepository } from '../../infrastructure/repositories/ModelAccessRepository.js';
import { InferenceHostTransport, InferenceGuestTransport, type OwnerKeys, type GuestKeys, type InferenceLink } from '../../infrastructure/transport/InferenceTransport.js';
import { InferenceBodies, sendInferenceBody } from '../../infrastructure/transport/InferenceBodies.js';
import type { InferenceProvider } from '../../infrastructure/providers/InferenceProvider.js';
import { createModelAccessSchema, joinModelAccessSchema, approveModelAccessSchema, reviseModelAccessSchema, inferenceRequestSchema, inferenceToolResultSchema, parseInferenceJson, type InferenceRequest, type InferenceToolResult, type ModelAccessPolicy } from '../../contracts/schemas/model-access.schema.js';
import type { CreateModelAccessDto, JoinModelAccessDto, ApproveModelAccessDto } from '../dto/ModelAccessDto.js';
import type { ModelAccessGrant, ModelAccessConnection } from '../../domain/types.js';

type SecretStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
type Host = { transport: InferenceHostTransport; state: string; assemblies: Map<string, InferenceBodies>; reconnect?: ReturnType<typeof setTimeout> };
type Guest = { transport: InferenceGuestTransport; state: string; assemblies: InferenceBodies; reconnect?: ReturnType<typeof setTimeout> };
type HostRun = { id: string; grantId: string; peer: string; request: InferenceRequest; revision: number; link: InferenceLink; controller: AbortController; running: boolean; bytes: number };
type GuestRun = { connectionId: string; emit: (event: string, text: string) => Promise<void>; callTool: (name: string, args: Record<string, unknown>) => Promise<InferenceToolResult>; resolve: () => void; reject: (e: Error) => void; outputBytes: number };
type ToolWait = { requestId: string; peer: string; grantId: string; resolve: (value: InferenceToolResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const key = (kind: string, id: string) => `automation:model-access:${kind}:${id}`;
const safeCode = (error: unknown) => error instanceof Error && /^(?:INFERENCE|MODEL_ACCESS)_[A-Z_]+$/.test(error.message) ? error.message : 'INFERENCE_FAILED';
export class ModelAccessService {
  private repo: ModelAccessRepository;
  private secrets: SecretStore;
  private provider: InferenceProvider;
  private profiles: Pick<typeof providerProfileService, 'assertCompatible' | 'list'>;
  private hosts = new Map<string, Host>();
  private guests = new Map<string, Guest>();
  private runs = new Map<string, HostRun>();
  private guestRuns = new Map<string, GuestRun>();
  private tools = new Map<string, ToolWait>();
  private locks = new Map<string, Promise<unknown>>();
  private expirations = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) { if (this.listeners.size >= 50) throw new Error('MODEL_ACCESS_LISTENER_LIMIT'); this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch {} } }
  private skipProviderVerification = false;
  private initialized = false;
  private starting?: Promise<void>;
  private stopped = false;
  constructor(options: { repository?: ModelAccessRepository; secrets?: SecretStore; provider?: InferenceProvider; profiles?: ModelAccessService['profiles'] } = {}) {
    this.skipProviderVerification = Boolean(options.provider);
    this.repo = options.repository ?? modelAccessRepository; this.secrets = options.secrets ?? desktopSecretService;
    this.provider = options.provider ?? { run: async input => {
      const { getAgentAdapter } = await import('$lib/modules/agent-room/application/adapters/registry.js');
      const adapter = getAgentAdapter(input.offering.providerId);
      if (!adapter.runDelegatedInference) throw new Error('INFERENCE_PROVIDER_UNAVAILABLE');
      await adapter.runDelegatedInference(input);
    } }; this.profiles = options.profiles ?? providerProfileService;
  }
  private locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn); this.locks.set(id, next);
    void next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); }).catch(() => {}); return next;
  }
  private async saveSecret(name: string, value: unknown) {
    const serialized = JSON.stringify(value); await this.secrets.set(name, serialized);
    if (await this.secrets.get(name) !== serialized) { await this.secrets.delete(name); throw new Error('MODEL_ACCESS_SECURE_STORAGE_UNAVAILABLE'); }
  }
  async start() {
    if (this.initialized || this.stopped) return;
    if (!this.starting) this.starting = (async () => {
      await this.repo.recoverRequests();
      for (const grant of await this.repo.grants()) if (['draft','active'].includes(grant.status)) await this.openHost(grant).catch(() => {});
      for (const connection of await this.repo.connections()) if (['pending','active'].includes(connection.status)) await this.openGuest(connection).catch(() => {});
      this.initialized = true;
    })().finally(() => { this.starting = undefined; });
    await this.starting;
  }
  async status() {
    await this.start();
    return { grants: (await this.repo.grants()).map(grant => ({ ...grant, state: this.hosts.get(grant.id)?.state ?? (Date.parse(grant.expiresAt) <= Date.now() ? 'expired' : 'offline'), pending: [...(this.hosts.get(grant.id)?.transport.pending.values() ?? [])], running: [...this.runs.values()].filter(run => run.grantId === grant.id && run.running).length, queued: [...this.runs.values()].filter(run => run.grantId === grant.id && !run.running).length })), connections: (await this.repo.connections()).map(connection => ({ ...connection, state: this.guests.get(connection.id)?.state ?? 'offline' })) };
  }
  private async policy(input: ModelAccessPolicy | Omit<import('../../contracts/schemas/model-access.schema.js').CreateModelAccessInput, 'relayUrl'>, previous?: ModelAccessPolicy): Promise<ModelAccessPolicy> {
    const profiles = await this.profiles.list();
    const offerings = [];
    for (const item of input.offerings) {
      if (item.profileId) await this.profiles.assertCompatible(item.profileId, item.providerId);
      const profile = profiles.find(profile => profile.id === item.profileId && profile.providerId === item.providerId);
      // The guest gets a human account label, never the configuration directory or private profile id.
      const { getAgentAdapter } = await import('$lib/modules/agent-room/application/adapters/registry.js');
      const adapter = getAgentAdapter(item.providerId);
      if (!this.skipProviderVerification) { if (!adapter.verifyDelegatedAccount) throw new Error('INFERENCE_PROVIDER_UNAVAILABLE'); await adapter.verifyDelegatedAccount(item.profileId, item.images); }
      const catalog = (await adapter.listModels()).slice(0, 100).filter(model => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model.value));
      const availableModels = (item.models ?? catalog.map(model => model.value)).slice(0, 100).map(value => { const model = catalog.find(model => model.value === value); return { value, label: (model?.label ?? value).slice(0, 100), efforts: (item.efforts ?? model?.efforts ?? adapter.efforts ?? ['low','medium','high']).filter(effort => ['none','minimal','low','medium','high','xhigh','max','ultra'].includes(effort)) as import('../../contracts/schemas/model-access.schema.js').ModelAccessOffering['availableModels'][number]['efforts'] }; });
      const prior = previous?.offerings.find(offering => offering.providerId === item.providerId && offering.profileId === item.profileId);
      offerings.push({ ...item, availableModels, id: prior?.id ?? ('id' in item && typeof item.id === 'string' ? item.id : uuidv7()), label: profile?.name ?? (item.providerId === 'claude' ? 'Claude' : 'Codex') });
    }
    return { offerings, concurrency: input.concurrency, requestsPerMinute: input.requestsPerMinute, maxRequests: input.maxRequests };
  }
  async referencesProfile(id: string) { return (await this.repo.grants()).some(grant => ['draft','active'].includes(grant.status) && grant.policy.offerings.some(offering => offering.profileId === id)); }
  async create(dto: CreateModelAccessDto) {
    const input = createModelAccessSchema.parse(dto.input);
    const current = await this.repo.grants(); if (current.filter(grant => ['draft','active'].includes(grant.status)).length >= 100) throw new Error('MODEL_ACCESS_GRANT_LIMIT');
    const policy = await this.policy(input);
    const grant = await this.repo.createGrant({ name: input.name, relayUrl: input.relayUrl, policy, expiresAt: new Date(Date.now() + input.expiresInMinutes * 60000).toISOString() });
    try {
      await this.saveSecret(key('owner', grant.id), { identity: inferenceIdentity(), secret: inferenceNonce(), hostId: uuidv7() } satisfies OwnerKeys);
      await this.openHost(grant); await this.repo.audit(grant.id, 'grant.created'); this.notify(); return grant;
    } catch (error) { await this.repo.updateGrant(grant.id, grant.revision, { status: 'revoked' }); await this.secrets.delete(key('owner', grant.id)); throw new Error(safeCode(error)); }
  }
  async invite(id: string) {
    const grant = await this.repo.grant(id); if (!grant || grant.status !== 'draft' || grant.guest || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('MODEL_ACCESS_INVITE_UNAVAILABLE');
    const raw = await this.secrets.get(key('owner', id)); if (!raw) throw new Error('MODEL_ACCESS_SECURE_STORAGE_UNAVAILABLE');
    const keys = JSON.parse(raw) as OwnerKeys;
    return { invite: inferenceInvite({ grantId: id, secret: keys.secret, ownerPublicKey: keys.identity.publicKey, relayUrl: grant.relayUrl }) };
  }
  async join(dto: JoinModelAccessDto) {
    const input = joinModelAccessSchema.parse(dto.input); const invite = parseInferenceInvite(input.invite);
    if (invite.relayUrl !== input.relayUrl) throw new Error('MODEL_ACCESS_RELAY_MISMATCH');
    if ((await this.repo.connections()).filter(connection => ['pending','active'].includes(connection.status)).length >= 100) throw new Error('MODEL_ACCESS_CONNECTION_LIMIT');
    // Persist no invitation, secret or private key in the connection row.
    const identity = inferenceIdentity(); inferenceFingerprint(invite.ownerPublicKey);
    const connection = await this.repo.createConnection({ grantId: invite.grantId, name: input.displayName, relayUrl: input.relayUrl, ownerPublicKey: invite.ownerPublicKey, guestId: uuidv7(), guestName: input.displayName, status: 'pending', policy: null, expiresAt: null });
    try { await this.saveSecret(key('guest', connection.id), { identity, secret: invite.secret } satisfies GuestKeys); await this.openGuest(connection); return { ...connection, fingerprint: inferenceFingerprint(identity.publicKey), ownerFingerprint: inferenceFingerprint(invite.ownerPublicKey) }; }
    catch (error) { await this.repo.updateConnection(connection.id, { status: 'revoked' }); await this.secrets.delete(key('guest', connection.id)); throw new Error(safeCode(error)); }
  }
  async approve(dto: ApproveModelAccessDto) {
    return this.locked(dto.grantId, async () => {
      const input = approveModelAccessSchema.parse(dto.input); const grant = await this.repo.grant(dto.grantId);
      if (!grant || grant.status !== 'draft' || grant.revision !== input.revision || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('MODEL_ACCESS_REVISION_CONFLICT');
      const host = this.hosts.get(grant.id), peer = host?.transport.pending.get(input.guestId);
      if (!host || !peer || peer.fingerprint !== input.fingerprint) throw new Error('MODEL_ACCESS_GUEST_MISMATCH');
      if (!input.approved) { host.transport.deny(peer.id); await this.repo.audit(grant.id, 'guest.denied', { guestId: peer.id, fingerprint: peer.fingerprint }); return grant; }
      const updated = await this.repo.updateGrant(grant.id, input.revision, { guest: peer, status: 'active' });
      await host.transport.approve(updated); await this.repo.audit(grant.id, 'guest.approved', { guestId: peer.id, fingerprint: peer.fingerprint }); this.notify(); return updated;
    });
  }
  async revise(id: string, value: unknown) {
    return this.locked(id, async () => {
      const input = reviseModelAccessSchema.parse(value); const grant = await this.repo.grant(id);
      if (!grant || !['draft','active'].includes(grant.status) || grant.revision !== input.revision) throw new Error('MODEL_ACCESS_REVISION_CONFLICT');
      const policy = await this.policy(input,grant.policy); const updated = await this.repo.updateGrant(id, input.revision, { policy, name: input.name, expiresAt: new Date(Date.now() + input.expiresInMinutes * 60000).toISOString() });
      await this.hosts.get(id)?.transport.revoke('policy_changed'); await this.closeHost(id); await this.openHost(updated); await this.repo.audit(id, 'grant.revised', { revision: updated.revision }); this.notify(); return updated;
    });
  }
  async revoke(id: string, revision: number) {
    return this.locked(id, async () => {
      const grant = await this.repo.grant(id); if (!grant || grant.revision !== revision) throw new Error('MODEL_ACCESS_REVISION_CONFLICT');
      if (grant.status === 'revoked') return grant;
      const updated = await this.repo.updateGrant(id, revision, { status: 'revoked' });
      await this.hosts.get(id)?.transport.revoke('revoked'); await this.closeHost(id); await this.secrets.delete(key('owner', id)); await this.repo.audit(id, 'grant.revoked'); this.notify(); return updated;
    });
  }
  async disconnect(id: string) {
    const connection = await this.repo.connection(id); if (!connection) throw new Error('MODEL_ACCESS_CONNECTION_NOT_FOUND');
    await this.repo.updateConnection(id, { status: 'revoked' }); this.closeGuest(id); await this.secrets.delete(key('guest', id)); this.notify(); return { disconnected: true };
  }
  audits(id: string) { return this.repo.audits(id); }
  private async openHost(grant: ModelAccessGrant) {
    if (this.stopped || this.hosts.has(grant.id)) return;
    if (Date.parse(grant.expiresAt) <= Date.now()) { if (['draft','active'].includes(grant.status)) await this.repo.updateGrant(grant.id, grant.revision, { status: 'expired' }); return; }
    const raw = await this.secrets.get(key('owner', grant.id)); if (!raw) throw new Error('MODEL_ACCESS_SECURE_STORAGE_UNAVAILABLE');
    const host: Host = { transport: null!, state: 'connecting', assemblies: new Map() };
    this.hosts.set(grant.id, host);
    host.transport = new InferenceHostTransport(grant, JSON.parse(raw), {
      state: state => { host.state = state; this.notify(); if (['offline','error'].includes(state)) this.reconnectHost(grant.id, host); },
      message: async (peer, message, link) => {
        if (message.type.startsWith('body.')) {
          let bodies = host.assemblies.get(peer);
          if (!bodies) { bodies = new InferenceBodies((id, kind, body) => this.ownerBody(grant.id, peer, id, kind, body, link), () => this.cancelPeer(grant.id, peer)); host.assemblies.set(peer, bodies); }
          await bodies.receive(message);
        } else if (message.type === 'request.cancel') { const run = this.runs.get(message.requestId); if (run?.grantId === grant.id && run.peer === peer) run.controller.abort(); }
      },
      disconnected: peer => this.cancelPeer(grant.id, peer),
    });
    const delay = Math.min(2147483647, Math.max(1, Date.parse(grant.expiresAt) - Date.now()));
    const expiry = setTimeout(() => { void this.expire(grant.id); }, delay); expiry.unref?.(); this.expirations.set(grant.id, expiry);
  }
  private reconnectHost(id: string, host: Host) {
    if (this.stopped || host.reconnect) return;
    host.reconnect = setTimeout(() => { if (this.hosts.get(id) !== host) return; void (async () => { await this.closeHost(id); const grant = await this.repo.grant(id); if (grant && ['draft','active'].includes(grant.status)) await this.openHost(grant); })().catch(() => {}); }, 10000); host.reconnect.unref?.();
  }
  private async expire(id: string) {
    return this.locked(id,async () => {
    const grant = await this.repo.grant(id); if (!grant) return;
    if (Date.parse(grant.expiresAt) > Date.now()) { await this.closeHost(id); await this.openHost(grant); return; }
    if (['draft','active'].includes(grant.status)) await this.repo.updateGrant(id, grant.revision, { status: 'expired' });
    await this.hosts.get(id)?.transport.revoke('expired'); await this.closeHost(id); await this.secrets.delete(key('owner', id)); await this.repo.audit(id, 'grant.expired');
    this.notify();
    });
  }
  private async closeHost(id: string) {
    const host = this.hosts.get(id); this.hosts.delete(id); clearTimeout(this.expirations.get(id)); this.expirations.delete(id);
    if (host) { clearTimeout(host.reconnect); for (const body of host.assemblies.values()) body.clear(); await host.transport.stop(); }
    this.cancelPeer(id);
    // Worker callbacks release concurrency only after the native child has exited.
    await Promise.all([...this.runs.values()].filter(run => run.grantId === id).map(run => this.waitRun(run.id)));
  }
  private waitRun(id: string): Promise<void> { if (!this.runs.has(id)) return Promise.resolve(); return new Promise(resolve => { const check = () => this.runs.has(id) ? setTimeout(check, 20) : resolve(); check(); }); }
  private cancelPeer(grantId: string, peer?: string) {
    for (const run of this.runs.values()) if (run.grantId === grantId && (!peer || run.peer === peer)) { run.controller.abort(); if (!run.running) void this.finish(run, 'cancelled'); }
    for (const [id, wait] of this.tools) if (wait.grantId === grantId && (!peer || wait.peer === peer)) { clearTimeout(wait.timer); this.tools.delete(id); wait.reject(new Error('INFERENCE_CANCELLED')); }
  }
  private async ownerBody(grantId: string, peer: string, id: string, kind: string, body: Buffer, link: InferenceLink) {
    if (kind === 'tool.result') {
      const wait = this.tools.get(id); if (!wait || wait.grantId !== grantId || wait.peer !== peer) throw new Error('INFERENCE_TOOL_MISMATCH');
      const parsed = inferenceToolResultSchema.safeParse(parseInferenceJson(body)); if (!parsed.success || parsed.data.callId !== id) throw new Error('INFERENCE_TOOL_MISMATCH');
      clearTimeout(wait.timer); this.tools.delete(id); wait.resolve(parsed.data); return;
    }
    if (kind !== 'inference' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('INFERENCE_INVALID_PAYLOAD');
    // Do not wait for the inference in the transport receive lane: tool results need that lane too.
    try {
      const parsed = inferenceRequestSchema.safeParse(parseInferenceJson(body)); if (!parsed.success) throw new Error('INFERENCE_INVALID_PAYLOAD');
      const request = parsed.data;
      await this.locked('admission', () => this.locked(grantId, async () => {
        const grant = await this.repo.grant(grantId); this.assertPolicy(grant, request);
        if (this.runs.size >= 32 || [...this.runs.values()].filter(run => run.grantId === grantId).length >= 8 || [...this.runs.values()].reduce((bytes,run) => bytes+run.bytes,body.length)>64*1024*1024) throw new Error('INFERENCE_QUEUE_FULL');
        await this.repo.reserveRequest(grantId, grant!.revision, id);
        const run: HostRun = { id, grantId, peer, request, revision: grant!.revision, link, controller: new AbortController(), running: false, bytes:body.length };
        this.runs.set(id, run); this.notify();
        try { await link.send({ type: 'request.accepted', requestId: id }); } catch { run.controller.abort(); await this.finish(run, 'cancelled'); return; }
        await this.repo.audit(grantId, 'request.accepted', { requestId: id, offeringId: request.offeringId, model: request.model, effort: request.effort }).catch(() => {});
        void this.drain();
      }));
    } catch (error) { await link.send({ type: 'request.done', requestId: id, status: 'failed', code: safeCode(error) }); }
  }
  private assertPolicy(grant: ModelAccessGrant | null, request: InferenceRequest) {
    if (!grant || grant.status !== 'active' || Date.parse(grant.expiresAt) <= Date.now()) throw new Error('INFERENCE_NOT_ACTIVE');
    const offering = grant.policy.offerings.find(item => item.id === request.offeringId);
    const model = offering?.availableModels.find(item => item.value === request.model);
    if (!offering || !model || !model.efforts.includes(request.effort) || (offering.models && !offering.models.includes(request.model)) || (offering.efforts && !offering.efforts.includes(request.effort))) throw new Error('INFERENCE_POLICY_DENIED');
    if (request.messages.flatMap(message => message.content).filter(part => part.type === 'image').length > 5) throw new Error('INFERENCE_IMAGE_LIMIT');
    return offering;
  }
  private draining = false;
  private async drain() {
    if (this.draining) return; this.draining = true;
    try {
      for (const run of this.runs.values()) {
        if (run.running || run.controller.signal.aborted) continue;
        const grant = await this.repo.grant(run.grantId);
        if (!grant || grant.revision !== run.revision) { run.controller.abort(); void this.finish(run, 'cancelled'); continue; }
        if ([...this.runs.values()].filter(item => item.running).length >= 2) break;
        if ([...this.runs.values()].filter(item => item.grantId === run.grantId && item.running).length >= grant.policy.concurrency) continue;
        run.running = true; this.notify(); void this.execute(run, grant);
      }
    } finally { this.draining = false; }
  }
  private async execute(run: HostRun, grant: ModelAccessGrant) {
    let status: 'completed' | 'failed' | 'cancelled' = 'completed'; let code: string | undefined;
    const timeout = setTimeout(() => run.controller.abort(), 2 * 60 * 60_000); timeout.unref?.();
    try {
      const offering = this.assertPolicy(grant, run.request);
      await this.provider.run({ request: run.request, offering, signal: run.controller.signal,
        reserveImage: async id => {
          // The repository atomically rechecks revision/expiry. Do not wait for the grant's
          // control lock: revocation holds it while waiting for this worker to stop.
          const latest = await this.repo.grant(run.grantId); const offer = this.assertPolicy(latest, run.request);
            if (!offer.images || offer.providerId !== 'codex' || latest!.revision !== run.revision || run.controller.signal.aborted) throw new Error('INFERENCE_IMAGE_DENIED');
            await this.repo.reserveRequest(run.grantId, run.revision, id); await this.repo.audit(run.grantId, 'image.accepted', { requestId: id, offeringId: offer.id });
        },
        finishImage: (id, state) => this.repo.finishRequest(id, state),
        emit: async (event, text) => {
          run.controller.signal.throwIfAborted();
          // UTF-8 output is split without splitting Unicode code points.
          const characters = [...text];
          for (let offset = 0; offset < characters.length; offset += 12000) await run.link.send({ type: 'stream', requestId: run.id, event, text: characters.slice(offset, offset + 12000).join('') });
        }, callTool: async (name, args) => {
          run.controller.signal.throwIfAborted();
          if (!run.request.tools.some(tool => tool.name === name) || [...this.tools.values()].filter(wait => wait.requestId === run.id).length >= 4) throw new Error('INFERENCE_TOOL_DENIED');
          const callId = uuidv7();
          const result = new Promise<InferenceToolResult>((resolve, reject) => {
            const timer = setTimeout(() => { this.tools.delete(callId); reject(new Error('INFERENCE_TOOL_TIMEOUT')); }, 10 * 60_000); timer.unref?.();
            this.tools.set(callId, { requestId: run.id, peer: run.peer, grantId: run.grantId, resolve, reject, timer });
          });
          void result.catch(() => {});
          try {
            const message = { type: 'tool.call' as const, requestId: run.id, callId, name, arguments: args };
            const encoded = Buffer.from(JSON.stringify(message));
            if (encoded.length > 120000) await this.locked(`host-send:${run.grantId}:${run.peer}`, () => sendInferenceBody(m => run.link.send(m), callId, 'tool.call', encoded, run.controller.signal));
            else await run.link.send(message);
            return await result;
          }
          finally { const wait = this.tools.get(callId); if (wait) { clearTimeout(wait.timer); this.tools.delete(callId); } }
        } });
      run.controller.signal.throwIfAborted();
    } catch (error) { status = run.controller.signal.aborted ? 'cancelled' : 'failed'; code = safeCode(error); }
    finally { clearTimeout(timeout); await this.finish(run, status, code); }
  }
  private async finish(run: HostRun, status: 'completed' | 'failed' | 'cancelled', code?: string) {
    if (this.runs.get(run.id) !== run) return;
    this.runs.delete(run.id); this.notify();
    for (const [id, wait] of this.tools) if (wait.requestId === run.id) { clearTimeout(wait.timer); this.tools.delete(id); wait.reject(new Error('INFERENCE_CANCELLED')); }
    await this.repo.finishRequest(run.id, status).catch(() => {});
    await run.link.send({ type: 'request.done', requestId: run.id, status, ...(code ? { code } : {}) }).catch(() => {});
    await this.repo.audit(run.grantId, `request.${status}`, { requestId: run.id, ...(code ? { reason: code } : {}) }).catch(() => {});
    void this.drain();
  }
  private async openGuest(connection: ModelAccessConnection) {
    if (this.stopped || this.guests.has(connection.id)) return;
    const raw = await this.secrets.get(key('guest', connection.id)); if (!raw) throw new Error('MODEL_ACCESS_SECURE_STORAGE_UNAVAILABLE');
    const guest: Guest = { transport: null!, state: 'connecting', assemblies: new InferenceBodies(async () => {}, () => this.closeGuest(connection.id)) };
    this.guests.set(connection.id, guest);
    guest.transport = new InferenceGuestTransport(connection, JSON.parse(raw), {
      state: state => { guest.state = state; this.notify(); if (['offline','error'].includes(state)) this.reconnectGuest(connection.id, guest); },
      approved: async (policy, expiresAt, name) => { await this.repo.updateConnection(connection.id, { status: 'active', policy, expiresAt, name }); },
      disconnected: () => { for (const [id, run] of this.guestRuns) if (run.connectionId === connection.id) { this.guestRuns.delete(id); run.reject(new Error('INFERENCE_UNCONFIRMED')); } },
      message: async message => {
        if (message.type === 'session.revoked' && message.reason === 'policy_changed') { this.closeGuest(connection.id); await this.openGuest((await this.repo.connection(connection.id))!); return; }
        if (message.type === 'session.revoked') { await this.repo.updateConnection(connection.id, { status: message.reason === 'expired' ? 'expired' : 'revoked' }); this.closeGuest(connection.id); return; }
        if (!('requestId' in message)) return;
        const run = this.guestRuns.get(message.requestId); if (!run || run.connectionId !== connection.id) return;
        if (message.type === 'stream') { run.outputBytes += Buffer.byteLength(message.text); if (run.outputBytes > 16 * 1024 * 1024) throw new Error('INFERENCE_OUTPUT_LIMIT'); await run.emit(message.event, message.text); }
        else if (message.type === 'tool.call') {
          // Execute tools outside the receive lane; the provider can still stream/cancel while a guest tool runs.
          void (async () => {
            let answer: InferenceToolResult;
            try { answer = inferenceToolResultSchema.parse({ ...await run.callTool(message.name, message.arguments), callId: message.callId }); }
            catch { answer = { callId: message.callId, success: false, content: [{ type: 'text', text: 'Guest tool failed.' }] }; }
            await this.locked(`send:${connection.id}`, () => sendInferenceBody(m => guest.transport.send(m), message.callId, 'tool.result', Buffer.from(JSON.stringify(answer))));
          })().catch(() => { run.reject(new Error('INFERENCE_TOOL_FAILED')); });
        } else if (message.type === 'request.done') {
          this.guestRuns.delete(message.requestId); if (message.status === 'completed') run.resolve(); else run.reject(new Error(message.code ?? `INFERENCE_${message.status.toUpperCase()}`));
        }
      },
    });
  }
  private reconnectGuest(id: string, guest: Guest) {
    if (this.stopped || guest.reconnect) return;
    guest.reconnect = setTimeout(() => { if (this.guests.get(id) !== guest) return; void (async () => { this.closeGuest(id); const connection = await this.repo.connection(id); if (connection && ['pending','active'].includes(connection.status)) await this.openGuest(connection); })().catch(() => {}); }, 10000); guest.reconnect.unref?.();
  }
  private closeGuest(id: string) {
    const guest = this.guests.get(id); this.guests.delete(id); if (guest) { clearTimeout(guest.reconnect); guest.assemblies.clear(); guest.transport.stop(); }
    for (const [requestId, run] of this.guestRuns) if (run.connectionId === id) { this.guestRuns.delete(requestId); run.reject(new Error('INFERENCE_UNCONFIRMED')); }
  }
  async infer(connectionId: string, value: unknown, options: { signal: AbortSignal; emit: GuestRun['emit']; callTool: GuestRun['callTool'] }) {
    await this.start(); const parsed = inferenceRequestSchema.safeParse(value); if (!parsed.success) throw new Error('INFERENCE_INVALID_PAYLOAD');
    const connection = await this.repo.connection(connectionId); const guest = this.guests.get(connectionId);
    if (!connection || connection.status !== 'active' || !connection.expiresAt || Date.parse(connection.expiresAt) <= Date.now() || !guest || guest.state !== 'connected') throw new Error('INFERENCE_OFFLINE');
    const id = uuidv7(); let abort = () => {};
    try {
      const result = new Promise<void>((resolve, reject) => {
        this.guestRuns.set(id, { connectionId, ...options, resolve, reject, outputBytes: 0 });
        abort = () => { this.guestRuns.delete(id); void guest.transport.send({ type: 'request.cancel', requestId: id }).catch(() => {}); reject(new Error('INFERENCE_CANCELLED')); };
        options.signal.addEventListener('abort', abort, { once: true });
      });
      void result.catch(() => {}); options.signal.throwIfAborted();
      await this.locked(`send:${connectionId}`, () => sendInferenceBody(message => guest.transport.send(message), id, 'inference', Buffer.from(JSON.stringify(parsed.data)), options.signal));
      await result;
    } finally { options.signal.removeEventListener('abort', abort); this.guestRuns.delete(id); }
  }
  async stop() { this.stopped = true; for (const id of [...this.guests.keys()]) this.closeGuest(id); await Promise.all([...this.hosts.keys()].map(id => this.closeHost(id))); }
}
const globalState = globalThis as typeof globalThis & { __orkestraiModelAccess?: ModelAccessService };
export const modelAccessService = globalState.__orkestraiModelAccess ??= new ModelAccessService();
