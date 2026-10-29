import { uuidv7 } from '@beeblock/svelar/support';
import { Connection } from '@beeblock/svelar/database';
import { ModelAccessGrant as GrantModel } from '../../domain/models/ModelAccessGrant.js';
import { ModelAccessConnection as ConnectionModel } from '../../domain/models/ModelAccessConnection.js';
import { ModelAccessRequest as RequestModel } from '../../domain/models/ModelAccessRequest.js';
import { ModelAccessAudit as AuditModel } from '../../domain/models/ModelAccessAudit.js';
import { modelAccessPolicySchema, modelAccessPublicPolicySchema, peerIdentitySchema } from '../../contracts/schemas/model-access.schema.js';
import type { ModelAccessPolicy, ModelAccessPeer } from '../../contracts/schemas/model-access.schema.js';
import type { ModelAccessGrant, ModelAccessConnection, ModelAccessPublicPolicy, ModelAccessAudit } from '../../domain/types.js';

const iso = (value: unknown) => (value instanceof Date ? value : new Date(String(value))).toISOString();
function grant(model: GrantModel): ModelAccessGrant {
  const get = (key: string) => model.getAttribute(key);
  const status = String(get('status'));
  if (!['draft', 'active', 'revoked', 'expired'].includes(status)) throw new Error('MODEL_ACCESS_INVALID_STATE');
  return { id: String(get('id')), name: String(get('name')), status: status as ModelAccessGrant['status'],
    relayUrl: String(get('relay_url')), revision: Number(get('revision')), policy: modelAccessPolicySchema.parse(JSON.parse(String(get('policy_json')))),
    guest: get('guest_json') ? peerIdentitySchema.parse(JSON.parse(String(get('guest_json')))) : null,
    requestsUsed: Number(get('requests_used')), expiresAt: iso(get('expires_at')), createdAt: iso(get('created_at')), updatedAt: iso(get('updated_at')) };
}
function connection(model: ConnectionModel): ModelAccessConnection {
  const get = (key: string) => model.getAttribute(key);
  const status = String(get('status')); if (!['pending','active','revoked','expired'].includes(status)) throw new Error('MODEL_ACCESS_INVALID_STATE');
  return { id: String(get('id')), grantId: String(get('grant_id')), name: String(get('name')), relayUrl: String(get('relay_url')),
    ownerPublicKey: String(get('owner_public_key')), guestId: String(get('guest_id')), guestName: String(get('guest_name')),
    status: status as ModelAccessConnection['status'], policy: get('policy_json') ? modelAccessPublicPolicySchema.parse(JSON.parse(String(get('policy_json')))) : null,
    expiresAt: get('expires_at') ? iso(get('expires_at')) : null, createdAt: iso(get('created_at')), updatedAt: iso(get('updated_at')) };
}

export class ModelAccessRepository {
  async grants() {
    const active = await GrantModel.query().whereIn('status',['draft','active']).orderBy('created_at','desc').limit(100).get();
    const retired = await GrantModel.query().whereIn('status',['revoked','expired']).orderBy('created_at','desc').limit(100).get();
    return [...active,...retired].map(grant);
  }
  async grant(id: string) { const row = await GrantModel.find(id); return row ? grant(row) : null; }
  async createGrant(input: { name: string; relayUrl: string; policy: ModelAccessPolicy; expiresAt: string }) {
    return grant(await GrantModel.create({ id: uuidv7(), name: input.name, relay_url: input.relayUrl, status: 'draft', revision: 1,
      policy_json: JSON.stringify(modelAccessPolicySchema.parse(input.policy)), guest_json: null, requests_used: 0,
      expires_at: input.expiresAt, created_at: new Date(), updated_at: new Date() }));
  }
  async updateGrant(id: string, revision: number, input: { policy?: ModelAccessPolicy; guest?: ModelAccessPeer | null; status?: ModelAccessGrant['status']; name?: string; expiresAt?: string }) {
    return Connection.transaction(async () => {
      const row = await GrantModel.find(id);
      if (!row || Number(row.getAttribute('revision')) !== revision) throw new Error('MODEL_ACCESS_REVISION_CONFLICT');
      await GrantModel.query().where('id', id).update({ revision: revision + 1, updated_at: new Date(),
        ...(input.policy ? { policy_json: JSON.stringify(modelAccessPolicySchema.parse(input.policy)) } : {}),
        ...(input.guest === undefined ? {} : { guest_json: input.guest ? JSON.stringify(peerIdentitySchema.parse(input.guest)) : null }),
        ...(input.status ? { status: input.status } : {}), ...(input.name ? { name: input.name } : {}),
        ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
      });
      return (await this.grant(id))!;
    });
  }
  async reserveRequest(id: string, revision: number, requestId: string) {
    return Connection.transaction(async () => {
      const row = await this.grant(id);
      if (!row || row.status !== 'active' || row.revision !== revision || Date.parse(row.expiresAt) <= Date.now()) throw new Error('MODEL_ACCESS_NOT_ACTIVE');
      if (await RequestModel.find(requestId)) throw new Error('INFERENCE_DUPLICATE_REQUEST');
      const recent = await RequestModel.query().where('grant_id', id).where('created_at', '>=', new Date(Date.now() - 60000)).count();
      if (Number(recent) >= row.policy.requestsPerMinute) throw new Error('INFERENCE_RATE_LIMIT');
      if (row.requestsUsed >= 100000) throw new Error('INFERENCE_LEDGER_LIMIT');
      if (row.policy.maxRequests !== null && row.requestsUsed >= row.policy.maxRequests) throw new Error('MODEL_ACCESS_REQUEST_LIMIT');
      await RequestModel.create({ id: requestId, grant_id: id, revision, status: 'accepted', created_at: new Date(), updated_at: new Date() });
      await GrantModel.query().where('id', id).update({ requests_used: row.requestsUsed + 1, updated_at: new Date() });
      return row.requestsUsed + 1;
    });
  }
  async finishRequest(id: string, status: 'completed' | 'cancelled' | 'failed' | 'unconfirmed') { await RequestModel.query().where('id', id).update({ status, updated_at: new Date() }); }
  async recoverRequests() { await RequestModel.query().where('status', 'accepted').update({ status: 'unconfirmed', updated_at: new Date() }); }
  async connections() {
    const active = await ConnectionModel.query().whereIn('status',['pending','active']).orderBy('created_at','desc').limit(100).get();
    const retired = await ConnectionModel.query().whereIn('status',['revoked','expired']).orderBy('created_at','desc').limit(100).get();
    return [...active,...retired].map(connection);
  }
  async connection(id: string) { const row = await ConnectionModel.find(id); return row ? connection(row) : null; }
  async createConnection(input: Omit<ModelAccessConnection, 'id' | 'createdAt' | 'updatedAt'>) {
    return connection(await ConnectionModel.create({ id: uuidv7(), grant_id: input.grantId, name: input.name, relay_url: input.relayUrl,
      owner_public_key: input.ownerPublicKey, guest_id: input.guestId, guest_name: input.guestName, status: input.status,
      policy_json: input.policy ? JSON.stringify(modelAccessPublicPolicySchema.parse(input.policy)) : null, expires_at: input.expiresAt, created_at: new Date(), updated_at: new Date() }));
  }
  async updateConnection(id: string, input: { status?: ModelAccessConnection['status']; name?: string; policy?: ModelAccessPublicPolicy; expiresAt?: string }) {
    await ConnectionModel.query().where('id', id).update({ updated_at: new Date(), ...(input.status ? { status: input.status } : {}),
      ...(input.name ? { name: input.name } : {}), ...(input.policy ? { policy_json: JSON.stringify(modelAccessPublicPolicySchema.parse(input.policy)) } : {}),
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}) });
    return this.connection(id);
  }
  async audit(grantId: string, event: string, metadata: ModelAccessAudit['metadata'] = {}) {
    // Persist only operation metadata. No arbitrary request/response/error object can enter this row.
    const allowed = new Set(['requestId','model','effort','offeringId','guestId','fingerprint','reason','revision','bytes','count']);
    const safe = Object.fromEntries(Object.entries(metadata).filter(([key, value]) => allowed.has(key)
      && (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 200))));
    await AuditModel.create({ id: uuidv7(), grant_id: grantId, event: event.slice(0, 64), metadata_json: JSON.stringify(safe), created_at: new Date(), updated_at: new Date() });
    // Keep bounded metadata history; no transcript or credential retention on the owner.
    const stale = await AuditModel.query().where('grant_id', grantId).orderBy('created_at', 'desc').offset(500).limit(100).get();
    for (const row of stale) await row.delete();
  }
  async audits(grantId: string): Promise<ModelAccessAudit[]> {
    return (await AuditModel.query().where('grant_id', grantId).orderBy('created_at', 'desc').limit(100).get()).map(row => ({
      id: String(row.getAttribute('id')), grantId, event: String(row.getAttribute('event')),
      metadata: JSON.parse(String(row.getAttribute('metadata_json'))) as ModelAccessAudit['metadata'], createdAt: iso(row.getAttribute('created_at')),
    }));
  }
}
export const modelAccessRepository = new ModelAccessRepository();
