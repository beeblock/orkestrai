import { describe, expect, it } from 'vitest';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { NativeInferenceProvider } from '$lib/modules/agent-room/application/adapters/delegated-inference.js';
import { JsonLineProcess } from '$lib/modules/agent-room/application/adapters/delegated-process.js';

describe.skipIf(process.env.ORKESTRAI_MODEL_ACCESS_WIRE !== '1')('native Codex tool wire contract', () => {
  it('advertises only the guest MCP tools to the native model client', async () => {
    let names: unknown[] = []; let diagnostic = '';
    const server = http.createServer(async (request, response) => {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); console.info('Wire request', request.url, Object.keys(body)); names = (body.tools ?? []).map((tool: any) => ({ type: tool.type, name: tool.name, namespace: tool.namespace, tools: tool.tools?.map((nested: any) => nested.name) }));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = 'OK'; const item = { id: 'msg_test', type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] };
      for (const event of [{ type: 'response.created', response: { id: 'resp_test' } }, { type: 'response.output_item.done', output_index: 0, item }, { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('address');
    try {
      const provider = new NativeInferenceProvider({ verifyAccount: async () => {}, process: (name, args, cwd, env, signal) => {
        const child = new JsonLineProcess(name, [...args.slice(0,-1),'-c','model_provider="fixture"','-c','model_providers.fixture.name="fixture"','-c',`model_providers.fixture.base_url="http://127.0.0.1:${address.port}/v1"`,'-c','model_providers.fixture.wire_api="responses"','-c','model_providers.fixture.requires_openai_auth=false','-'], cwd, { ...env, CODEX_HOME: cwd }, signal);
        child.child.stderr.on('data', data => diagnostic += data.toString()); return child;
      } });
      await provider.run({ offering: { id: randomUUID(), label: 'Fixture', providerId: 'codex', profileId: null, models: null, efforts: null, images: false, availableModels: [] }, request: { offeringId: randomUUID(), model: 'gpt-6.1-sol', effort: 'low', system: 'Return OK', messages: [{ role: 'user', content: [{ type: 'text', text: 'Test' }] }], tools: [{ name: 'guest_probe', description: 'Guest tool.', inputSchema: { type: 'object', properties: {} }, internal: false }] }, signal: AbortSignal.timeout(20000), emit: async () => {}, callTool: async () => { throw new Error('unexpected'); }, reserveImage: async () => {}, finishImage: async () => {} }).catch(error => { console.info(diagnostic.slice(0,2000)); throw error; });
      console.info('Native tool definitions', names);
      expect(JSON.stringify(names)).toContain('guest_probe');
      expect(JSON.stringify(names)).not.toMatch(/exec_command|apply_patch|web_search|view_image/);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 30000);
});
