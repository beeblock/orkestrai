import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../packages/orkestrai-cli/src/cli.js';
import { executeMcpTool, MCP_TOOLS } from '../../packages/orkestrai-cli/src/mcp.js';

describe('personal bot CLI/MCP parity', () => {
  let server: Server, cwd: string;
  const requests: any[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => { let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      requests.push({ method: req.method, path: req.url, body: raw ? JSON.parse(raw) : null, identity: req.headers['x-orkestrai-agent-token'] });
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: { ok: true } }));
    }); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cwd = mkdtempSync(join(tmpdir(), 'orkestrai-bot-cli-')); mkdirSync(join(cwd, '.orkestrai'));
    writeFileSync(join(cwd, '.orkestrai/workspace.json'), JSON.stringify({ token: 'workspace-test', apiUrl: `http://127.0.0.1:${(server.address() as any).port}` }));
  });
  afterAll(() => { server.close(); rmSync(cwd, { recursive: true, force: true }); });
  const options = () => ({ cwd, out: () => {}, err: () => {}, env: { ORKESTRAI_AGENT_TOKEN: 'private-test-identity' } });
  it('lists bots through both clients without moving to the legacy team API', async () => {
    expect(await run(['bot', 'list'], options())).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'GET', path: '/api/agent-room/bridge/bots', identity: 'private-test-identity' });
    const bridge = vi.fn().mockResolvedValue({});
    await executeMcpTool({ bridge, findFreePort: async () => 0, selfAgent: null }, 'bot_list');
    expect(bridge).toHaveBeenCalledWith('GET', '/api/agent-room/bridge/bots');
    expect(MCP_TOOLS.some(tool => tool.name === 'bot_command')).toBe(true);
  });
  it('uses the same strict command input and active task on CLI/MCP', async () => {
    const settings = { title: 'Helper', instructions: 'Owner rules', provider: 'codex', transport: 'structured' };
    expect(await run(['bot', 'create', '--task', 'task-id', '--input', JSON.stringify({ settings })], options())).toBe(0);
    const body = requests.at(-1).body;
    expect(body).toEqual({ taskId: 'task-id', input: { command: 'create', settings } });
    const bridge = vi.fn().mockResolvedValue({});
    await executeMcpTool({ bridge, findFreePort: async () => 0, selfAgent: null }, 'bot_command', body);
    expect(bridge).toHaveBeenCalledWith('POST', '/api/agent-room/bridge/bots', body);
  });
  it('reads the localized preset catalog through CLI and MCP without a configuration task', async () => {
    expect(await run(['bot', 'preset_list'], options())).toBe(0);
    expect(requests.at(-1).body).toEqual({ input: { command: 'preset_list' } });
    expect(await run(['bot', 'preset_list', '--input', JSON.stringify({ locale: 'pt-BR' })], options())).toBe(0);
    const body = requests.at(-1).body;
    expect(body).toEqual({ input: { command: 'preset_list', locale: 'pt-BR' } });
    const bridge = vi.fn().mockResolvedValue([]);
    await executeMcpTool({ bridge, findFreePort: async () => 0, selfAgent: null }, 'bot_command', body);
    expect(bridge).toHaveBeenCalledWith('POST', '/api/agent-room/bridge/bots', body);
  });
  it('posts an authenticated group reply without inventing an owner task', async () => {
    const input = { groupId: 'group-id', body: 'Answer' };
    expect(await run(['bot', 'group_post', '--input', JSON.stringify(input)], options())).toBe(0);
    expect(requests.at(-1).body).toEqual({ input: { command: 'group_post', ...input } });
    expect(await run(['bot', 'group_send', '--input', JSON.stringify(input)], options())).toBe(0);
    expect(requests.at(-1).body).toEqual({ input: { command: 'group_send', ...input } });
  });
  it('exposes guided setup discovery and prefix rules through the same agent bridge', async () => {
    expect(await run(['bot', 'slack_manifest', '--task', 'task-id', '--input', '{}'], options())).toBe(0);
    expect(requests.at(-1).body).toEqual({ taskId: 'task-id', input: { command: 'slack_manifest' } });
    const input = { binding: { nodeId: 'bot-id', integrationId: 'account-id', externalChatId: 'chat-id', allowedSenders: [], replyPrefixes: ['@Helper', '#Helper'] } };
    expect(await run(['bot', 'connect', '--task', 'task-id', '--input', JSON.stringify(input)], options())).toBe(0);
    expect(requests.at(-1).body.input.binding.replyPrefixes).toEqual(['@Helper', '#Helper']);
    const edit = { bindingId: 'binding-id', enabled: true, allowedSenders: ['5511999999999@s.whatsapp.net'], replyPrefixes: ['@Support'] };
    expect(await run(['bot', 'set_binding', '--task', 'task-id', '--input', JSON.stringify(edit)], options())).toBe(0);
    expect(requests.at(-1).body.input).toEqual({ command: 'set_binding', ...edit });
    const bridge = vi.fn().mockResolvedValue([]);
    await executeMcpTool({ bridge, findFreePort: async () => 0, selfAgent: null }, 'bot_command', { taskId: 'task-id', input: { command: 'channel_targets', nodeId: 'bot-id', integrationId: 'account-id' } });
    expect(bridge).toHaveBeenCalledWith('POST', '/api/agent-room/bridge/bots', expect.objectContaining({ input: expect.objectContaining({ command: 'channel_targets' }) }));
  });

});
