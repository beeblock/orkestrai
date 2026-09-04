import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { apiClientRequestSchema } from '$lib/modules/agent-room/contracts/schemas/apiClient.schema.js';
import { runBrunoScript } from '$lib/modules/agent-room/infrastructure/api-client/BrunoScriptRuntime.js';
import { runPostmanRequest } from '$lib/modules/agent-room/infrastructure/api-client/PostmanScriptRuntime.js';
import { mergeScriptScopes } from '$lib/modules/agent-room/infrastructure/api-client/ApiClientScriptRuntimeTypes.js';

const servers: Array<ReturnType<typeof createServer>> = [];
const require = createRequire(import.meta.url);

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function endpoint() {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        path: request.url,
        method: request.method,
        contentType: request.headers['content-type'] ?? null,
        scripted: request.headers['x-scripted'] ?? null,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
  return `http://127.0.0.1:${address.port}`;
}

function network() {
  return { cookieJarEnabled: true, cookies: [], proxyUrl: '', caPath: '', clientCertificatePath: '', clientKeyPath: '', clientPfxPath: '', clientKeyPassphrase: '', rejectUnauthorized: true };
}

function request(url: string, overrides: Record<string, unknown> = {}) {
  return apiClientRequestSchema.parse({ id: 'primary', name: 'Primary', method: 'GET', url, headers: [], auth: { type: 'none' }, ...overrides });
}

describe('compatible API Client script runtimes', () => {
  it('keeps every Postman dynamic variable available on the patched Faker runtime', () => {
    const dynamicVariables = require('postman-collection/lib/superstring/dynamic-variables') as Record<string, { generator: () => unknown }>;

    expect(Object.keys(dynamicVariables)).toHaveLength(118);
    for (const [name, entry] of Object.entries(dynamicVariables)) {
      expect(() => entry.generator(), name).not.toThrow();
      expect(entry.generator(), name).not.toBeNull();
    }
  });

  it('runs Postman scopes, sendRequest, tests, legacy globals, and collection flow in the official runtime', async () => {
    const baseUrl = await endpoint();
    const primary = request(`${baseUrl}/primary`, {
      preRequestScript: `
        pm.request.headers.upsert({ key: 'X-Scripted', value: pm.iterationData.get('header') });
        pm.globals.set('globalResult', 'global');
        pm.collectionVariables.set('collectionResult', 'collection');
        pm.environment.set('environmentResult', 'environment');
        pm.variables.set('runtimeResult', 'runtime');
        pm.environment.set('iterationInfo', pm.info.iteration + '/' + pm.info.iterationCount);
        pm.sendRequest('${baseUrl}/aux', (error, response) => {
          if (error) throw error;
          pm.environment.set('auxStatus', String(response.code));
        });
        pm.vault.get('apiKey').then((value) => pm.environment.set('vaultValue', value));
        pm.execution.runRequest('secondary').then((response) => pm.environment.set('nestedStatus', String(response.code)));
        pm.vault.set('rotatedKey', 'rotated-secret');
        pm.environment.set('libraryResult', pm.require('lodash').get({ deeply: { nested: 'loaded' } }, 'deeply.nested'));
      `,
      postResponseScript: `
        tests['legacy response works'] = responseCode.code === 200;
        pm.execution.setNextRequest('Secondary');
        pm.visualizer.set('<strong>{{state}}</strong>', { state: 'ready' });
      `,
      testScript: `
        pm.test('Postman response and Chai work', () => {
          pm.expect(pm.response.json()).to.have.property('scripted', 'from-iteration');
        });
      `,
    });
    const secondary = request(`${baseUrl}/secondary`, { id: 'secondary', name: 'Secondary' });
    const result = await runPostmanRequest({
      stage: 'requestPreRequest', script: '', request: primary,
      scopes: mergeScriptScopes({ collection: { baseUrl }, environment: {}, globals: {}, runtime: {}, iteration: { header: 'from-iteration' } }),
      collectionName: 'Compatibility', requests: [primary, secondary], network: network(), secrets: { apiKey: 'secret' }, iterationIndex: 3, iterationCount: 5,
    });

    expect(result.response).toMatchObject({ status: 200, ok: true });
    expect(JSON.parse(result.response?.body ?? '{}')).toMatchObject({ scripted: 'from-iteration' });
    expect(result.scopes.globals).toMatchObject({ globalResult: 'global' });
    expect(result.scopes.collection).toMatchObject({ collectionResult: 'collection' });
    expect(result.scopes.environment).toMatchObject({ environmentResult: 'environment', auxStatus: '200', vaultValue: 'secret', nestedStatus: '200', libraryResult: 'loaded', iterationInfo: '3/5' });
    expect(result.scopes.runtime).toMatchObject({ runtimeResult: 'runtime' });
    expect(result.secrets).toMatchObject({ apiKey: 'secret', rotatedKey: 'rotated-secret' });
    expect(result.tests).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'legacy response works', passed: true }),
      expect.objectContaining({ label: 'Postman response and Chai work', passed: true }),
    ]));
    expect(result.flow.nextRequest).toBe('Secondary');
    expect(result.visualizations).toEqual([expect.objectContaining({ type: 'html', content: '<strong>ready</strong>' })]);
  });

  it('runs Bruno request/response helpers, scopes, Chai, and runner flow in safe QuickJS', async () => {
    const baseUrl = await endpoint();
    const original = request(`${baseUrl}/primary`, { headers: [{ id: 'content', name: 'Content-Type', value: 'application/json', enabled: true }] });
    const scopes = mergeScriptScopes({ collection: { collectionValue: 'before' }, environment: {}, globals: {}, runtime: {}, iteration: { row: 3 } });
    const pre = await runBrunoScript({
      stage: 'requestPreRequest', request: original, scopes, collectionName: 'Compatibility', network: network(), secrets: { apiKey: 'secret' },
      script: `
        bru.setVar('runtimeValue', 'runtime');
        bru.setEnvVar('environmentValue', 'environment');
        bru.setGlobalEnvVar('globalValue', 'global');
        bru.setCollectionVar('collectionValue', 'after');
        req.setHeader('X-Scripted', String(bru.runner.iterationData.get('row')));
        const auxiliary = await bru.sendRequest({ url: '${baseUrl}/aux', method: 'GET' });
        const nested = await bru.runRequest('Secondary');
        bru.setVar('auxStatus', String(auxiliary.status));
        bru.setVar('nestedStatus', String(nested.status));
        bru.setVar('nestedMutation', bru.getEnvVar('fromNested'));
        bru.setVar('libraryResult', require('moment')('2026-08-21').format('YYYY'));
        await bru.cookies.jar().setCookie('${baseUrl.replace('127.0.0.1', 'localhost')}', 'session', 'bruno');
        test('request helper works', () => expect(req.getHeader('X-Scripted')).to.equal('3'));
      `,
      runRequest: async () => ({
        request: request(`${baseUrl}/secondary`, { id: 'secondary', name: 'Secondary' }),
        response: { status: 202, statusText: 'Accepted', ok: true, durationMs: 1, size: 2, contentType: 'application/json', headers: {}, body: '{}', binary: false },
        scopes: mergeScriptScopes({ ...scopes, environment: { ...scopes.environment, fromNested: 'propagated' } }),
        logs: [], tests: [], flow: { nextRequest: undefined, skipRequest: false, stopExecution: false }, visualizations: [],
      }),
    });
    const transportResponse = {
      status: 201, statusText: 'Created', ok: true, durationMs: 9, size: 11, contentType: 'application/json',
      headers: { 'content-type': 'application/json' }, body: '{"ok":true}', binary: false,
    };
    const post = await runBrunoScript({
      stage: 'requestPostResponse', request: pre.request, response: transportResponse, scopes: pre.scopes,
      collectionName: 'Compatibility', network: { ...network(), cookies: pre.cookies ?? [] }, secrets: { apiKey: 'secret' },
      script: `
        test('response helpers work', () => {
          expect(res.getStatus()).to.equal(201);
          expect(res.getBody()).to.deep.equal({ ok: true });
        });
        bru.setNextRequest('Secondary');
      `,
    });

    expect(post.scopes).toMatchObject({
      collection: { collectionValue: 'after' },
      environment: { environmentValue: 'environment' },
      globals: { globalValue: 'global' },
      runtime: { runtimeValue: 'runtime', auxStatus: '200', nestedStatus: '202', nestedMutation: 'propagated', libraryResult: '2026' },
    });
    expect(post.tests).toEqual([expect.objectContaining({ label: 'response helpers work', passed: true })]);
    expect(post.flow.nextRequest).toBe('Secondary');
    expect(post.cookies).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'session', value: 'bruno' })]));
  });

  it('executes GraphQL requests with variables through the official Postman runtime', async () => {
    const baseUrl = await endpoint();
    const graphql = request(`${baseUrl}/graphql`, {
      method: 'POST',
      protocol: 'graphql',
      graphql: {
        query: 'query Account($id: ID!) { account(id: $id) { id } }',
        variables: '{"id":"account-7"}',
        operationName: 'Account',
      },
      postResponseScript: `
        pm.test('GraphQL transport works', () => {
          const received = pm.response.json();
          pm.expect(received.method).to.equal('POST');
          pm.expect(received.contentType).to.include('application/json');
          pm.expect(JSON.parse(received.body)).to.deep.equal({
            query: 'query Account($id: ID!) { account(id: $id) { id } }',
            variables: { id: 'account-7' },
            operationName: 'Account'
          });
        });
      `,
    });
    const result = await runPostmanRequest({
      stage: 'requestPreRequest',
      script: '',
      request: graphql,
      scopes: mergeScriptScopes({}),
      collectionName: 'GraphQL compatibility',
      requests: [graphql],
      network: network(),
    });

    expect(result.response).toMatchObject({ status: 200, ok: true });
    expect(result.tests).toEqual([
      expect.objectContaining({ label: 'GraphQL transport works', passed: true }),
    ]);
  });

  it('honors request skipping in both compatible runtimes', async () => {
    const baseUrl = await endpoint();
    const postmanRequest = request(`${baseUrl}/postman-skipped`, {
      preRequestScript: 'pm.execution.skipRequest();',
    });
    const postmanResult = await runPostmanRequest({
      stage: 'requestPreRequest', script: '', request: postmanRequest,
      scopes: mergeScriptScopes({}), collectionName: 'Postman skip', requests: [postmanRequest], network: network(),
    });
    const brunoResult = await runBrunoScript({
      stage: 'requestPreRequest', script: 'bru.runner.skipRequest();', request: request(`${baseUrl}/bruno-skipped`),
      scopes: mergeScriptScopes({}), collectionName: 'Bruno skip', network: network(),
    });

    expect(postmanResult.response).toBeUndefined();
    expect(postmanResult.flow.skipRequest).toBe(true);
    expect(brunoResult.flow.skipRequest).toBe(true);
  });
});
