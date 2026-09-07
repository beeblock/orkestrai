import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useSvelarTest } from '@beeblock/svelar/testing';
import { ApiClientOAuthDto, ApiClientSyncDto, ExecuteApiClientRequestDto, ImportAgentApiClientDto, ImportApiClientCollectionDto, ReplaceAgentApiClientDto, SyncAgentApiClientDto } from '$lib/modules/agent-room/application/dto/ApiClientDtos.js';
import { apiClientOAuthService } from '$lib/modules/agent-room/application/services/ApiClientOAuthService.js';
import { apiClientService } from '$lib/modules/agent-room/application/services/ApiClientService.js';
import { apiClientSyncService } from '$lib/modules/agent-room/application/services/ApiClientSyncService.js';
import { bridgeService } from '$lib/modules/agent-room/application/services/BridgeService.js';
import { apiClientNativePayloadSchema, apiClientRequestSchema } from '$lib/modules/agent-room/contracts/schemas/apiClient.schema.js';
import { workspaceRepository } from '$lib/modules/agent-room/infrastructure/repositories/WorkspaceRepository.js';
import { BridgeController } from '$lib/modules/agent-room/interface/http/controllers/BridgeController.js';

function bridgeEvent(method: string, path: string, body: unknown, params: Record<string, string>, token: string) {
  const url = new URL(`http://localhost${path}`);
  return {
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
    }),
    params,
    url,
  };
}

describe('API Client OAuth, cookies, and sync', () => {
  useSvelarTest({ refreshDatabase: true });
  let server: Server | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    server = null;
    tempDir = null;
  });

  async function fixture() {
    tempDir = await mkdtemp(join(tmpdir(), 'orkestrai-api-auth-sync-'));
    const workspace = await workspaceRepository.createWorkspace({ name: 'API', workingDir: tempDir });
    const node = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'apiClient', title: 'Project API', payload: {} });
    return { workspace, node };
  }

  it('obtains OAuth client-credentials tokens with client authentication', async () => {
    const { workspace, node } = await fixture();
    let authorization = '';
    let submitted = '';
    server = createServer((request, response) => {
      authorization = String(request.headers.authorization ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        submitted = Buffer.concat(chunks).toString('utf8');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ access_token: 'access-123', refresh_token: 'refresh-456', token_type: 'Bearer', expires_in: 3600 }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OAuth test server did not bind.');
    const request = apiClientRequestSchema.parse({
      id: 'oauth-request', name: 'OAuth', method: 'GET', url: 'https://api.example.test', headers: [], body: '', bodyMode: 'none',
      auth: { type: 'oauth2', oauth2: { grantType: 'client_credentials', tokenUrl: `http://127.0.0.1:${address.port}/token`, clientId: 'client', clientSecret: 'secret', scope: 'read:all', clientAuthentication: 'header' } },
    });

    const result = await apiClientOAuthService.authorize(workspace.id, ApiClientOAuthDto.from({ action: 'authorize', nodeId: node.id, request, variables: {}, locale: 'en' }), 'http://127.0.0.1:3000');

    expect(result).toMatchObject({ status: 'complete', tokens: { accessToken: 'access-123', refreshToken: 'refresh-456', tokenType: 'Bearer' } });
    expect(authorization).toBe(`Basic ${Buffer.from('client:secret').toString('base64')}`);
    expect(new URLSearchParams(submitted).get('grant_type')).toBe('client_credentials');
  });

  it('completes the OAuth authorization-code flow with state and PKCE', async () => {
    const { workspace, node } = await fixture();
    let submitted = '';
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        submitted = Buffer.concat(chunks).toString('utf8');
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ access_token: 'authorized-token', token_type: 'Bearer' }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('OAuth test server did not bind.');
    const request = apiClientRequestSchema.parse({
      id: 'oauth-code', name: 'OAuth code', method: 'GET', url: 'https://api.example.test', headers: [], body: '', bodyMode: 'none',
      auth: { type: 'oauth2', oauth2: { grantType: 'authorization_code', authorizationUrl: 'https://identity.example.test/authorize', tokenUrl: `http://127.0.0.1:${address.port}/token`, clientId: 'desktop-client', clientAuthentication: 'body', usePkce: true } },
    });
    const started = await apiClientOAuthService.authorize(workspace.id, ApiClientOAuthDto.from({ action: 'authorize', nodeId: node.id, request, variables: {}, locale: 'en' }), 'http://127.0.0.1:3000');
    expect(started.status).toBe('pending');
    if (started.status !== 'pending') throw new Error('Expected a pending OAuth flow.');
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.searchParams.get('state')).toBe(started.state);
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.get('code_challenge')).toBeTruthy();

    expect(await apiClientOAuthService.complete(workspace.id, started.state, 'provider-code', null)).toBe(true);
    const completed = apiClientOAuthService.poll(workspace.id, ApiClientOAuthDto.from({ action: 'poll', nodeId: node.id, state: started.state }));
    expect(completed).toMatchObject({ status: 'complete', tokens: { accessToken: 'authorized-token' } });
    const form = new URLSearchParams(submitted);
    expect(form.get('code')).toBe('provider-code');
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('redirect_uri')).toContain('locale=en');
  });

  it('persists response cookies and sends them on the next request', async () => {
    const { workspace, node } = await fixture();
    let seenCookie = '';
    server = createServer((request, response) => {
      if (request.url === '/login') response.setHeader('set-cookie', 'session=abc123; Path=/; HttpOnly');
      else seenCookie = String(request.headers.cookie ?? '');
      response.setHeader('content-type', 'application/json');
      response.end('{}');
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cookie test server did not bind.');
    const base = `http://127.0.0.1:${address.port}`;
    const request = apiClientRequestSchema.parse({ id: 'cookie', name: 'Cookie', method: 'GET', url: `${base}/login`, headers: [], auth: { type: 'none' }, body: '', bodyMode: 'none' });
    await workspaceRepository.updateNode(node.id, { payload: { network: { cookieJarEnabled: true } } });
    const first = await apiClientService.execute(workspace.id, ExecuteApiClientRequestDto.from({ nodeId: node.id, request, variables: {}, timeoutMs: 3_000 }));
    expect(first.cookies).toEqual([expect.objectContaining({ key: 'session', value: 'abc123', httpOnly: true })]);
    await workspaceRepository.updateNode(node.id, { payload: { network: { cookieJarEnabled: true, cookies: first.cookies } } });
    await apiClientService.execute(workspace.id, ExecuteApiClientRequestDto.from({ nodeId: node.id, request: { ...request, url: `${base}/me` }, variables: {}, timeoutMs: 3_000 }));
    expect(seenCookie).toContain('session=abc123');
  });

  it('pushes linked Bruno changes, removes stale managed files, and detects external edits', async () => {
    const { workspace, node } = await fixture();
    const collection = join(tempDir!, 'collection');
    await mkdir(collection);
    await writeFile(join(collection, 'health.bru'), `meta {\n  name: Health\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://example.test/health\n  body: none\n  auth: none\n}\n`);
    const imported = await apiClientService.import(workspace.id, ImportApiClientCollectionDto.from({ nodeId: node.id, kind: 'bruno', path: collection }));
    const changed = apiClientNativePayloadSchema.parse({
      ...imported.payload,
      requests: imported.payload.requests!.map((request) => ({ ...request, name: 'Status', url: 'https://example.test/status' })),
    });
    const pushed = await apiClientSyncService.execute(workspace.id, ApiClientSyncDto.from({ action: 'push', nodeId: node.id, payload: changed, resolution: 'orkestrai' }));
    expect(pushed).toMatchObject({ status: 'complete', direction: 'push' });
    expect(await readdir(collection)).not.toContain('health.bru');
    const statusFile = (await readdir(collection)).find((file) => /^Status\.bru$/i.test(file));
    expect(statusFile).toBeTruthy();
    expect(await readFile(join(collection, statusFile!), 'utf8')).toContain('https://example.test/status');

    await writeFile(join(collection, statusFile!), (await readFile(join(collection, statusFile!), 'utf8')).replace('/status', '/external'));
    const status = await apiClientSyncService.status(workspace.id, node.id);
    expect(status).toMatchObject({ linked: true, writable: true, sourceChanged: true, localChanged: false });
    const pulled = await apiClientSyncService.execute(workspace.id, ApiClientSyncDto.from({ action: 'pull', nodeId: node.id }));
    expect(pulled).toMatchObject({ status: 'complete', direction: 'pull', payload: { requests: [expect.objectContaining({ url: 'https://example.test/external' })] } });
  });

  it('lets an agent link and update the repository Bruno collection seen in the canvas', async () => {
    const { workspace } = await fixture();
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'API Agent', x: 20, y: 30, width: 480 });
    const collection = join(tempDir!, 'tests', 'api');
    await mkdir(collection, { recursive: true });
    await writeFile(join(collection, 'health.bru'), `meta {\n  name: Health\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://example.test/health\n  body: none\n  auth: none\n}\n\ntests {\n  test('returns 200', function () {\n    expect(res.getStatus()).to.equal(200);\n  });\n}\n`);

    const imported = await apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from({
      path: 'tests/api', kind: 'auto', syncMode: 'watch', from: agent.id,
    }));

    expect(imported).toMatchObject({
      repository: { linked: true, kind: 'bruno', path: 'tests/api', sync: { mode: 'watch' } },
      collection: { requests: [expect.objectContaining({ name: 'Health', testScript: expect.stringContaining('returns 200') })] },
    });
    expect((await workspaceRepository.listEdges(workspace.id)).some((edge) => edge.sourceNodeId === agent.id && edge.targetNodeId === imported.nodeId)).toBe(true);

    const edited = structuredClone(imported.collection);
    edited.requests[0].name = 'Health check';
    edited.requests[0].documentation = 'Maintained by the workspace API agent.';
    const replaced = await apiClientService.replaceForAgent(workspace.id, imported.nodeId, ReplaceAgentApiClientDto.from({
      baseFingerprint: imported.fingerprint, collection: edited, from: agent.id,
    }));
    const pushed = await apiClientSyncService.executeForAgent(workspace.id, imported.nodeId, SyncAgentApiClientDto.from({ action: 'push', from: agent.id }));

    expect(pushed).toMatchObject({ status: 'complete', direction: 'push' });
    expect(replaced.repository).toMatchObject({ linked: true, kind: 'bruno', path: 'tests/api' });
    const generated = (await readdir(collection)).find((file) => /^Health check\.bru$/i.test(file));
    expect(generated).toBeTruthy();
    const source = await readFile(join(collection, generated!), 'utf8');
    expect(source).toContain('returns 200');
    expect(source).toContain('Maintained by the workspace API agent.');
  });

  it('links a Bruno collection in an explicitly registered sibling repository', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'orkestrai-multi-repo-'));
    const coordinator = join(tempDir, 'workspace-coordinator');
    const testRepository = join(tempDir, 'api-tests');
    const collection = join(testRepository, 'bruno');
    await mkdir(coordinator);
    await mkdir(collection, { recursive: true });
    await writeFile(join(collection, 'health.bru'), `meta {\n  name: Health\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://example.test/health\n  body: none\n  auth: none\n}\n`);
    const workspace = await workspaceRepository.createWorkspace({
      name: 'Multi repository project',
      workingDir: coordinator,
      repositoryRoots: [{ alias: 'api-tests', path: testRepository }],
    });
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'API Agent' });

    const imported = await apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from({
      path: '@api-tests/bruno', kind: 'auto', syncMode: 'watch', from: agent.id,
    }));
    expect(imported.repository).toMatchObject({ linked: true, kind: 'bruno', path: '@api-tests/bruno' });

    const edited = structuredClone(imported.collection);
    edited.requests[0].name = 'Sibling health check';
    await apiClientService.replaceForAgent(workspace.id, imported.nodeId, ReplaceAgentApiClientDto.from({
      baseFingerprint: imported.fingerprint, collection: edited, from: agent.id,
    }));
    await apiClientSyncService.executeForAgent(workspace.id, imported.nodeId, SyncAgentApiClientDto.from({ action: 'push', from: agent.id }));

    const generated = (await readdir(collection)).find((file) => /^Sibling health check\.bru$/i.test(file));
    expect(generated).toBeTruthy();
    expect(await readFile(join(collection, generated!), 'utf8')).toContain('https://example.test/health');
    await expect(apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from({
      path: '../api-tests/bruno', kind: 'bruno', syncMode: 'watch', from: agent.id,
    }))).rejects.toThrow('escapes');

    const token = await bridgeService.getOrCreateToken(workspace.id);
    const response = await new BridgeController().listAgents(bridgeEvent('GET', '/api/agent-room/bridge/agents', {}, {}, token) as any) as Response;
    const body = await response.json();
    expect(body.data.repositories).toEqual([{ alias: 'api-tests', reference: '@api-tests' }]);
    expect(body.data.workspace.repository).toMatchObject({ reference: '.', primary: true, isGit: false, runtimeKind: 'native' });
    expect(JSON.stringify(body.data.repositories)).not.toContain(testRepository);
    expect(JSON.stringify(body.data.workspace.repository)).not.toContain(coordinator);
  });

  it('writes linked Postman changes atomically and refuses silent conflict overwrites', async () => {
    const { workspace } = await fixture();
    const agent = await workspaceRepository.createNode({ workspaceId: workspace.id, type: 'terminal', title: 'Postman Agent', x: 10, y: 10, width: 480 });
    const path = join(tempDir!, 'project.postman_collection.json');
    const postman = {
      info: { name: 'Project API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      item: [{
        name: 'Health',
        request: { method: 'GET', header: [], url: { raw: 'https://example.test/health' } },
        event: [{ listen: 'test', script: { type: 'text/javascript', exec: ["pm.test('healthy', () => pm.response.to.have.status(200));"] } }],
      }],
    };
    await writeFile(path, `${JSON.stringify(postman, null, 2)}\n`);
    const imported = await apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from({
      path: 'project.postman_collection.json', kind: 'auto', syncMode: 'watch', from: agent.id,
    }));
    expect(imported.repository).toMatchObject({ linked: true, kind: 'postman', path: 'project.postman_collection.json' });
    const token = await bridgeService.getOrCreateToken(workspace.id);
    const controller = new BridgeController();

    const edited = structuredClone(imported.collection);
    edited.requests[0].documentation = 'Repository-backed request.';
    edited.requests[0].testScript += "\npm.collectionVariables.set('verified', 'yes');";
    const replacedResponse = await controller.replaceApiClient(bridgeEvent('PUT', `/api/agent-room/bridge/api-clients/${imported.nodeId}`, {
      baseFingerprint: imported.fingerprint, collection: edited, from: agent.id,
    }, { nodeId: imported.nodeId }, token) as any) as Response;
    const replacedBody = await replacedResponse.json();
    expect(replacedResponse.status, JSON.stringify(replacedBody)).toBe(200);
    expect(replacedBody.data.repositorySync).toMatchObject({ status: 'complete', direction: 'push', files: 1 });
    let stored = JSON.parse(await readFile(path, 'utf8'));
    expect(stored.item[0].request.description).toBe('Repository-backed request.');
    expect(stored.item[0].event[0].script.exec.join('\n')).toContain("collectionVariables.set('verified'");

    stored.info.description = 'External edit';
    await writeFile(path, `${JSON.stringify(stored, null, 2)}\n`);
    const fresh = await apiClientService.readForAgent(workspace.id, imported.nodeId, agent.id);
    const localEdit = structuredClone(fresh.collection);
    localEdit.requests[0].name = 'Local health';
    const conflictResponse = await controller.replaceApiClient(bridgeEvent('PUT', `/api/agent-room/bridge/api-clients/${imported.nodeId}`, {
      baseFingerprint: fresh.fingerprint, collection: localEdit, from: agent.id,
    }, { nodeId: imported.nodeId }, token) as any) as Response;
    expect(conflictResponse.status).toBe(409);
    expect((await conflictResponse.json()).data.repositorySync).toMatchObject({ status: 'conflict', sourceChanged: true, localChanged: true });
    expect(JSON.parse(await readFile(path, 'utf8')).info.description).toBe('External edit');

    const statusResponse = await controller.syncApiClient(bridgeEvent('POST', `/api/agent-room/bridge/api-clients/${imported.nodeId}/sync`, {
      action: 'status', from: agent.id,
    }, { nodeId: imported.nodeId }, token) as any) as Response;
    expect(statusResponse.status).toBe(200);
    expect((await statusResponse.json()).data).toMatchObject({ conflict: true, sourceChanged: true, localChanged: true });
    const forceResponse = await controller.syncApiClient(bridgeEvent('POST', `/api/agent-room/bridge/api-clients/${imported.nodeId}/sync`, {
      action: 'push', resolution: 'orkestrai', from: agent.id,
    }, { nodeId: imported.nodeId }, token) as any) as Response;
    expect(forceResponse.status).toBe(200);
    expect((await forceResponse.json()).data).toMatchObject({ status: 'complete', direction: 'push' });
    expect(JSON.parse(await readFile(path, 'utf8')).item[0].name).toBe('Local health');

    await expect(apiClientService.importForAgent(workspace.id, ImportAgentApiClientDto.from({ path, kind: 'postman', syncMode: 'watch', from: agent.id }))).rejects.toThrow('relative');
  });
});
