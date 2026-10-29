import { describe, expect, it } from 'vitest';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { randomUUID } from 'node:crypto';
import { ModelAccessRepository } from '$lib/modules/model-access/infrastructure/repositories/ModelAccessRepository.js';
import { ModelAccessRequest } from '$lib/modules/model-access/domain/models/ModelAccessRequest.js';

describe('model access durable request ledger', () => {
  useSvelarTest({ refreshDatabase: true });
  it('reserves once across concurrent calls and counts the same rate/quota for images', async () => {
    const repository = new ModelAccessRepository();
    let grant = await repository.createGrant({ name: 'Test', relayUrl: 'wss://relay.example', expiresAt: new Date(Date.now() + 600000).toISOString(), policy: { offerings: [{ id: randomUUID(), providerId: 'codex', profileId: null, label: 'Codex', models: null, efforts: null, images: true, availableModels: [] }], concurrency: 1, requestsPerMinute: 60, maxRequests: 2 } });
    grant = await repository.updateGrant(grant.id, grant.revision, { status: 'active' });
    const requestId = randomUUID();
    const results = await Promise.allSettled([repository.reserveRequest(grant.id, grant.revision, requestId),repository.reserveRequest(grant.id, grant.revision, requestId)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await repository.grant(grant.id))!.requestsUsed).toBe(1);
    await repository.reserveRequest(grant.id, grant.revision, randomUUID());
    await expect(repository.reserveRequest(grant.id, grant.revision, randomUUID())).rejects.toThrow('MODEL_ACCESS_REQUEST_LIMIT');
    await repository.recoverRequests();
    expect((await ModelAccessRequest.find(requestId))?.getAttribute('status')).toBe('unconfirmed');
    await expect(repository.reserveRequest(grant.id, grant.revision, requestId)).rejects.toThrow('INFERENCE_DUPLICATE_REQUEST');
  });
  it('enforces a durable rate limit and rejects a stale revision', async () => {
    const repository = new ModelAccessRepository();
    let grant = await repository.createGrant({ name: 'Test', relayUrl: 'wss://relay.example', expiresAt: new Date(Date.now() + 600000).toISOString(), policy: { offerings: [{ id: randomUUID(), providerId: 'claude', profileId: null, label: 'Claude', models: null, efforts: null, images: false, availableModels: [] }], concurrency: 1, requestsPerMinute: 1, maxRequests: null } });
    grant = await repository.updateGrant(grant.id, grant.revision, { status: 'active' });
    await repository.reserveRequest(grant.id, grant.revision, randomUUID());
    await expect(repository.reserveRequest(grant.id, grant.revision, randomUUID())).rejects.toThrow('INFERENCE_RATE_LIMIT');
    await expect(repository.updateGrant(grant.id, grant.revision - 1, { status: 'revoked' })).rejects.toThrow('MODEL_ACCESS_REVISION_CONFLICT');
  });
});
