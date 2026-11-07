import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import { run } from '../../packages/orkestrai-cli/src/cli.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, lstat, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { externalMessages } from '../../packages/orkestrai-cli/src/external-messages.js';
import { bridgeAskSchema, bridgeMessageResultSchema } from '$lib/modules/agent-room/contracts/schemas/bridgeSchemas.js';

const cleanup: string[] = [];
afterEach(async () => { for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true }); });
async function home() { const path = await mkdtemp(join(tmpdir(), 'ork-external-')); cleanup.push(path); return path; }
async function receiptFiles(path: string) {
  const scopes = await readdir(join(path, '.orkestrai/external-messages'));
  return Promise.all(scopes.flatMap(scope => [join(path, '.orkestrai/external-messages', scope)]).map(async dir =>
    (await readdir(dir)).map(file => join(dir, file)))).then(files => files.flat());
}

describe('private external bridge receipts', () => {
  it('persists only its return secret, uses no Canvas identity, and reads a late answer after a client restart', async () => {
    const path = await home(); let credential: unknown; let reply = '';
    const call = vi.fn(async (_method, url, body) => {
      if (url.endsWith('/ask')) { expect(bridgeAskSchema.safeParse(body).success).toBe(true); credential = body.external;
        expect(body.from).toBeNull(); return { messageId: 'message-1', externalReply: true, replyConfirmed: false, deliveryState: 'queued' }; }
      expect(bridgeMessageResultSchema.safeParse(body).success).toBe(true); expect(body.external).toEqual(credential);
      return { messageId: 'message-1', replyConfirmed: Boolean(reply), reply };
    });
    const first = externalMessages({ home: path, token: 'workspace-secret', call });
    const asked = await first.ask({ to: 'Codex', message: 'Unpersisted prompt contents' });
    expect(asked.nextAction).toContain('message_wait');
    expect(JSON.stringify(asked)).not.toContain((credential as any).receipt);
    const files = await receiptFiles(path); expect(files).toHaveLength(1);
    const saved = await readFile(files[0], 'utf8');
    expect(saved).not.toContain('workspace-secret'); expect(saved).not.toContain('Unpersisted prompt contents');
    if (process.platform !== 'win32') expect((await lstat(files[0])).mode & 0o777).toBe(0o600);
    reply = 'Answer from Codex';
    const restarted = externalMessages({ home: path, token: 'workspace-secret', call });
    expect(await restarted.result(asked.receiptId, 25_000)).toMatchObject({ replyConfirmed: true, reply });
    expect(call.mock.calls.filter(([, url]) => url.endsWith('/ask'))).toHaveLength(1);
  });

  it('retries an uncertain request with the same return identity and secret', async () => {
    const path = await home(); const sent: any[] = [];
    const client = externalMessages({ home: path, token: 'scope', call: async (_m, _p, body) => {
      sent.push(body); if (sent.length === 1) throw new Error('connection lost');
      return { messageId: 'one-message', externalReply: true, replyConfirmed: false };
    } });
    await expect(client.ask({ to: 'Codex', message: 'Same original ask' })).rejects.toThrow('receiptId');
    const saved = JSON.parse(await readFile((await receiptFiles(path))[0], 'utf8'));
    await client.ask({ to: 'Codex', message: 'Same original ask', receiptId: saved.requestId });
    expect(sent[1]).toEqual(sent[0]); expect(await receiptFiles(path)).toHaveLength(1);
  });

  it('does not expose private receipts across workspaces or follow project-controlled links', async () => {
    const path = await home(); const call = vi.fn(async () => ({ externalReply: true, messageId: 'id' }));
    const a = externalMessages({ home: path, token: 'workspace-a', call });
    const asked = await a.ask({ to: 'Codex', message: 'question' });
    const b = externalMessages({ home: path, token: 'workspace-b', call });
    await expect(b.result(asked.receiptId)).rejects.toThrow();
    await expect(a.result('../workspace.json')).rejects.toThrow('receiptId');
    const files = await receiptFiles(path); const original = files[0];
    const outside = join(path, 'owner-data'); await writeFile(outside, 'private owner file');
    await rm(original); await symlink(outside, original);
    await expect(a.result(asked.receiptId)).rejects.toThrow('Invalid external');
    expect(await readFile(outside, 'utf8')).toBe('private owner file');
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('refuses an external-messages directory symlink before creating any return secret', async () => {
    const path = await home(); const outside = await home();
    await mkdir(join(path, '.orkestrai')); await symlink(outside, join(path, '.orkestrai/external-messages'));
    const client = externalMessages({ home: path, token: 'scope', call: vi.fn() });
    await expect(client.ask({ to: 'Codex', message: 'question' })).rejects.toThrow('private directory');
    expect(await readdir(outside)).toEqual([]);
  });

  it('rejects combined identities and keeps read authorization explicit', () => {
    const external = { clientId: '1'.repeat(32), requestId: '2'.repeat(32), receipt: '3'.repeat(64) };
    expect(bridgeAskSchema.safeParse({ to: 'Codex', message: 'x', external, from: 'Leader' }).success).toBe(false);
    expect(bridgeAskSchema.safeParse({ to: 'Codex', message: 'x', external, raw: true }).success).toBe(false);
    expect(bridgeMessageResultSchema.safeParse({}).success).toBe(false);
    expect(bridgeMessageResultSchema.safeParse({ external, waitMs: 25_001 }).success).toBe(false);
  });
});

it('carries an external MCP ask and reply through real stdio/HTTP, then reconnects using only its receiptId', async () => {
  const path = await home(); const posted: any[] = []; let answer = ''; let requestIdentity: any;
  const server = createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      posted.push({ url: req.url, body }); res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/agent-room/bridge/ask') { requestIdentity = body.external;
        res.end(JSON.stringify({ data: { messageId: 'saved-message', externalReply: true, replyConfirmed: false, deliveryState: 'queued' } })); }
      else if (req.url === '/api/agent-room/bridge/messages/result') {
        expect(body.external).toEqual(requestIdentity);
        res.end(JSON.stringify({ data: { messageId: 'saved-message', replyConfirmed: Boolean(answer), reply: answer, deliveryState: answer ? 'replied' : 'queued' } }));
      } else res.end(JSON.stringify({ data: { ok: true } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { HOME: path, USERPROFILE: path, ORKESTRAI_TOKEN: 'only-test-token', ORKESTRAI_API_URL: `http://127.0.0.1:${(server.address() as any).port}` };
  function connect() {
    const input = new PassThrough(); let output = ''; let seq = 0;
    const done = run(['mcp'], { env, cwd: path, input, write: chunk => { output += chunk; } });
    return { close: async () => { input.end(); await done; }, call: async (name: string, args: any = {}) => {
      const id = ++seq; input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
      let response: any;
      await vi.waitFor(() => { response = output.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(value => value.id === id); expect(response).toBeTruthy(); });
      expect(response.result.isError).not.toBe(true); return JSON.parse(response.result.content[0].text);
    } };
  }
  let current = connect();
  try {
    const asked = await current.call('ask', { agent: 'Codex', message: 'Answer me outside Canvas' });
    expect(asked.receiptId).toMatch(/^[a-f0-9]{32}$/); expect(posted[0].body.from).toBeNull();
    await current.close(); current = connect(); answer = 'Durable external reply';
    expect(await current.call('message_wait', { messageId: asked.receiptId })).toMatchObject({ replyConfirmed: true, reply: answer });
    expect(posted.at(-1).body.waitMs).toBe(25_000);
    expect(posted.filter(value => value.url.endsWith('/ask'))).toHaveLength(1);
    const lines: string[] = [];
    expect(await run(['ask', 'Codex', 'CLI question', '--json'], { env, cwd: path, out: value => lines.push(value) })).toBe(0);
    const cliReceipt = JSON.parse(lines[0]).receiptId;
    lines.length = 0;
    expect(await run(['message', 'read', cliReceipt], { env, cwd: path, out: value => lines.push(value) })).toBe(0);
    expect(JSON.parse(lines[0])).toMatchObject({ replyConfirmed: true, reply: answer });
  } finally { await current.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
