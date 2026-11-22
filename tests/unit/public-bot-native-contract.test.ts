import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, access, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { preparePublicWorker } from '$lib/modules/agent-room/application/adapters/public-bot-worker.js';
import { publicBotToolProxy } from '$lib/modules/agent-room/application/adapters/public-bot-structured.js';
import { CodexStructuredDriver } from '$lib/modules/agent-room/application/adapters/codex-structured.js';
import { ClaudeStructuredDriver } from '$lib/modules/agent-room/application/adapters/claude-structured.js';
import type { StructuredAgentOptions } from '$lib/modules/agent-room/application/adapters/structured-types.js';

// Explicit installed-CLI contract check against localhost fake models. The test
// never reads an owner auth file or contacts a paid inference endpoint.
describe.skipIf(!process.env.PUBLIC_BOT_NATIVE_CONTRACT)('public native CLI isolation (mock inference)', () => {
  const roots: string[] = [];
  afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
  for (const provider of ['codex', 'claude'] as const) for (const forcedTool of [false, true]) {
    it(`forced tool=${forcedTool}: exposes only the scoped MCP to ${provider}, without owner context or global MCP`, async () => {
      const root = await mkdtemp(join(tmpdir(), 'orkestrai-public-contract-')); roots.push(root);
      const home = join(root, 'home'), workspace = join(root, 'workspace');
      await mkdir(join(home, '.codex'), { recursive: true }); await mkdir(join(home, '.claude')); await mkdir(workspace);
      const canary = 'PRIVATE_OWNER_CONTEXT_CANARY';
      const evil = join(root, 'evil.mjs'), started = join(root, 'evil-started');
      await writeFile(evil, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(started)},'started');process.exit(1);`);
      await writeFile(join(workspace, 'AGENTS.md'), canary); await writeFile(join(workspace, 'CLAUDE.md'), canary);
      await writeFile(join(home, '.claude', 'CLAUDE.md'), canary);
      const privateFile = join(root, 'private.txt'); await writeFile(privateFile, canary);
      await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ env: { SECRET: canary }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `${process.execPath} ${evil}` }] }] } }));
      const requests: Record<string, any>[] = [];
      const server = http.createServer(async (req, res) => {
        let data = ''; for await (const chunk of req) data += chunk;
        if (req.url?.includes('count_tokens')) { res.setHeader('content-type', 'application/json'); res.end('{"input_tokens":1}'); return; }
        if (!req.url?.includes('responses') && !req.url?.includes('messages')) { res.writeHead(404); res.end('{}'); return; }
        requests.push(JSON.parse(data));
        let events: any[] = provider === 'codex' ? [
          { type: 'response.created', response: { id: 'resp_mock', status: 'in_progress', output: [] } },
          { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_mock', role: 'assistant', status: 'in_progress', content: [] } },
          { type: 'response.output_text.delta', item_id: 'msg_mock', output_index: 0, content_index: 0, delta: 'PUBLIC_OK' },
          { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'msg_mock', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PUBLIC_OK', annotations: [] }] } },
          { type: 'response.completed', response: { id: 'resp_mock', status: 'completed', output: [{ type: 'message', id: 'msg_mock', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PUBLIC_OK', annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
        ] : [
          { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', content: [], model: 'claude-sonnet-4-6', stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'PUBLIC_OK' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
          { type: 'message_stop' },
        ];
        if (forcedTool && requests.length === 1) {
          const args = provider === 'codex' ? { cmd: `cat ${JSON.stringify(privateFile)}`, max_output_tokens: 100 } : { command: `cat ${JSON.stringify(privateFile)}` };
          if (provider === 'codex') {
            const item = { type: 'function_call', id: 'fc_forbidden', call_id: 'call_forbidden', name: 'exec_command', arguments: JSON.stringify(args) };
            events = [
              { type: 'response.created', response: { id: 'resp_forbidden', status: 'in_progress', output: [] } },
              { type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '' } },
              { type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: item.arguments },
              { type: 'response.output_item.done', output_index: 0, item },
              { type: 'response.completed', response: { id: 'resp_forbidden', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
            ];
          } else {
            events[1] = { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tool_forbidden', name: 'Bash', input: {} } };
            events[2] = { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } };
            events[4].delta.stop_reason = 'tool_use';
          }
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        for (const event of events) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        res.end();
      });
      await new Promise<void>(yes => server.listen(0, '127.0.0.1', yes));
      const port = (server.address() as { port: number }).port;
      await writeFile(join(home, '.codex/config.toml'), `developer_instructions=${JSON.stringify(canary)}\nmodel_provider="mock"\n[model_providers.mock]\nname="Mock"\nbase_url="http://127.0.0.1:${port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[mcp_servers.evil]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([evil])}\n`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45_000);
      const proxy = await publicBotToolProxy([{ name: 'read_attachment', description: 'Only customer files', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }], controller.signal, async () => ({ type: 'text', text: 'customer data' }));
      const original: StructuredAgentOptions = { cwd: workspace, hostCwd: workspace, workspaceRoot: workspace, runtime: { kind: 'native' },
        instructions: canary, launchArgs: ['PRIVATE_LAUNCH_OVERRIDE'], bridgeMcp: { command: process.execPath, args: [evil] },
        env: { PATH: process.env.PATH!, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
          ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`, ANTHROPIC_API_KEY: 'test-local-only',
          ORKESTRAI_AGENT_TOKEN: 'PRIVATE_BRIDGE_TOKEN', ORKESTRAI_WORKSPACE_CONFIG: '/private/workspace.json' },
        session: () => 'PRIVATE_OWNER_SESSION', saveSession: async () => { throw new Error('Must not change owner session'); } };
      if (provider === 'claude' && !forcedTool) delete original.env.CLAUDE_CONFIG_DIR;
      let prepared: Awaited<ReturnType<typeof preparePublicWorker>> | undefined, driver: CodexStructuredDriver | ClaudeStructuredDriver | undefined;
      try {
        prepared = await preparePublicWorker(provider, original, proxy, 'Public role: answer product support questions only.');
        expect(prepared.options.env).not.toHaveProperty('ORKESTRAI_AGENT_TOKEN');
        expect(prepared.options.env).not.toHaveProperty('ORKESTRAI_WORKSPACE_CONFIG');
        if (provider === 'claude') {
          expect(prepared.options.env.HOME).toBe(home);
          expect(prepared.options.env.CLAUDE_CONFIG_DIR).toBe(original.env.CLAUDE_CONFIG_DIR);
        }
        expect(JSON.stringify(prepared.options.launchArgs)).not.toContain(proxy.token);
        driver = provider === 'codex' ? new CodexStructuredDriver(prepared.options) : new ClaudeStructuredDriver(prepared.options);
        let accepted = false;
        const answer = await driver.run({ prompt: 'Return PUBLIC_OK.', conversationKey: 'public', messageId: crypto.randomUUID(), signal: controller.signal, output: () => {}, accepted: () => { accepted = true; } });
        expect(answer).toBe('PUBLIC_OK'); expect(accepted).toBe(true); expect(requests.length).toBeGreaterThan(0);
        const payload = JSON.stringify(requests);
        expect(payload).not.toContain(canary); expect(payload).not.toContain('PRIVATE_BRIDGE_TOKEN'); expect(payload).not.toContain('PRIVATE_OWNER_SESSION');
        const toolNames = requests.flatMap(request => request.tools ?? []).flatMap(tool => tool.type === 'namespace' ? tool.tools.map((child: any) => `${tool.name}__${child.name}`) : [tool.name ?? tool.function?.name ?? tool.type]);
        expect(toolNames.some(name => /^mcp__p_[a-f0-9]+__read_attachment$/.test(name))).toBe(true);
        expect(toolNames.every(name => ['request_user_input', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource'].includes(name) || /^mcp__p_[a-f0-9]+__read_attachment$/.test(name))).toBe(true);
        expect(await access(started).then(() => true, () => false)).toBe(false);
        const files = await readdir(prepared.options.hostCwd);
        expect(files.some(file => /context|auth|credential/.test(file))).toBe(false);
      } finally {
        clearTimeout(timer); await driver?.close(); await prepared?.close(); proxy.close();
        server.closeAllConnections(); await new Promise<void>(yes => server.close(() => yes()));
      }
    }, 60_000);
  }
});
