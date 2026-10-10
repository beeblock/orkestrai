import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { descendantPids, formatInbox, heavyOwnerGone, run, stopHeavyTree } from '../../packages/orkestrai-cli/src/cli.js';
import { runMcpServer } from '../../packages/orkestrai-cli/src/mcp.js';

const QUESTION = { messageId: '00000000-0000-7000-8000-000000000011', kind: 'ask', fromNodeId: 'lead', fromTitle: 'Lider', taskId: null, replyTo: null, content: 'Qual endpoint?', createdAt: '2026-10-09T00:00:00.000Z' };

describe('orkestrai CLI inbox, reply and heavy runs', () => {
  let server: Server;
  let cwd: string;
  let pendingInbox = 0;
  let heavyPolls = 0;
  let heartbeat: Record<string, unknown> | null = null;
  const requests: Array<{ method?: string; url?: string; body?: any; agentToken?: string | string[] }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({ method: req.method, url: req.url, body, agentToken: req.headers['x-orkestrai-agent-token'] });
        res.setHeader('content-type', 'application/json');
        if (pendingInbox > 0 && req.url !== '/api/agent-room/bridge/inbox') res.setHeader('x-orkestrai-inbox', String(pendingInbox));
        if (req.url?.startsWith('/api/agent-room/bridge/inbox')) {
          pendingInbox = 0;
          res.end(JSON.stringify({ data: { items: [QUESTION], remaining: 0 } }));
        } else if (req.url === '/api/agent-room/bridge/ask') {
          res.end(JSON.stringify({ data: { to: body.to, reply: '', delivered: false, replyConfirmed: false, timedOut: false, deliveryState: 'queued', inbox: true, messageId: 'm-1' } }));
        } else if (req.url?.endsWith('/reply')) {
          res.end(JSON.stringify({ data: { messageId: QUESTION.messageId, to: 'Lider', via: 'waiter', alreadyAnswered: false } }));
        } else if (heartbeat && req.url?.endsWith('/heartbeat')) {
          res.end(JSON.stringify({ data: heartbeat }));
        } else if (req.url === '/api/agent-room/bridge/heavy' && req.method === 'POST') {
          heavyPolls += 1;
          res.end(JSON.stringify({ data: heavyPolls === 1
            ? { granted: false, ticket: '00000000-0000-7000-8000-000000000099', position: 1, slots: 1, active: 1, reason: 'busy', detail: 'Aguardando vaga: posição 1' }
            : { granted: true, leaseId: '00000000-0000-7000-8000-000000000099', slots: 1, active: 1 } }));
        } else {
          res.end(JSON.stringify({ data: { ok: true, tasks: [] } }));
        }
      });
    });
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
    const apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    cwd = mkdtempSync(join(tmpdir(), 'orkestrai-cli-inbox-'));
    mkdirSync(join(cwd, '.orkestrai'));
    writeFileSync(join(cwd, '.orkestrai', 'workspace.json'), JSON.stringify({ token: 'tok', apiUrl }));
  });

  afterAll(() => {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, options: { cwd, out: (line: string) => out.push(String(line)), err: (line: string) => err.push(String(line)), env: { ORKESTRAI_NODE_ID: 'web', ORKESTRAI_AGENT_TOKEN: 'pty-token' } } };
  }

  it('hands pending messages over with any command, on stderr so JSON output stays parseable', async () => {
    pendingInbox = 1;
    const io = capture();
    expect(await run(['task', 'list', '--json'], io.options)).toBe(0);
    expect(io.err.join('\n')).toContain('1 mensagem(ns) nova(s)');
    expect(io.err.join('\n')).toContain(`[${QUESTION.messageId}] De Lider [pergunta]: Qual endpoint?`);
    expect(io.err.join('\n')).toContain('orkestrai reply');
    expect(requests.find((request) => request.url === '/api/agent-room/bridge/inbox')?.agentToken).toBe('pty-token');
  });

  it('treats a queued ask as handed off, not as a failure to retry', async () => {
    const io = capture();
    expect(await run(['ask', 'Lider', 'Pronto', 'para', 'revisar'], io.options)).toBe(0);
    expect(io.out.join('\n')).toContain('na caixa de entrada de Lider');
    expect(io.out.join('\n')).toContain('Nao reenvie');
  });

  it('answers a received message explicitly', async () => {
    const io = capture();
    expect(await run(['reply', QUESTION.messageId, 'Use', '/api/v2'], io.options)).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: `/api/agent-room/bridge/messages/${QUESTION.messageId}/reply`, body: { from: 'web', message: 'Use /api/v2' } });
    expect(io.out.join('\n')).toContain('entregue agora');
  });

  it('waits for a machine slot, runs the command and releases the slot', async () => {
    heavyPolls = 0;
    const io = capture();
    const code = await run(['heavy', '--label', 'unit tests', '--', process.execPath, '-e', 'process.exit(3)'], io.options);
    expect(code).toBe(3);
    expect(io.err.join('\n')).toContain('Aguardando vaga');
    expect(io.err.join('\n')).toContain('Vaga liberada: unit tests');
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/agent-room/bridge/heavy/00000000-0000-7000-8000-000000000099' });
  });

  it('formats an empty inbox as nothing to print', () => {
    expect(formatInbox([], 0)).toBe('');
  });
  it('stops a heavy run whose reservation was lost and cannot be restored', async () => {
    heavyPolls = 1;
    heartbeat = { alive: false, stop: null };
    const io = capture();
    const started = Date.now();
    try {
      const code = await run(['heavy', '--label', 'e2e', '--', process.execPath, '-e', 'setTimeout(() => {}, 30000)'], {
        ...io.options, env: { ...io.options.env, ORKESTRAI_HEAVY_HEARTBEAT_MS: '150' },
      });
      expect(code).not.toBe(0);
      expect(Date.now() - started).toBeLessThan(10_000);
      expect(io.err.join('\n')).toContain('reserva');
    } finally {
      heartbeat = null;
    }
  });
});

describe('MCP inbox hand-off', () => {
  it('appends pending messages to the tool result and exposes reply and inbox tools', async () => {
    const input = new PassThrough();
    const chunks: string[] = [];
    let digest = '--- Orkestrai: 1 mensagem(ns) nova(s) na sua caixa de entrada ---';
    const done = runMcpServer({
      input,
      write: (chunk: string) => chunks.push(chunk),
      bridge: async (method: string, path: string, body?: unknown) => ({ method, path, body }),
      drainInbox: () => {
        const value = digest;
        digest = '';
        return value;
      },
      findFreePort: async () => 1,
      selfAgent: 'web',
    });
    const call = async (id: number, name: string, args: Record<string, unknown>) => {
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })}\n`);
      for (let attempt = 0; attempt < 100; attempt++) {
        const found = chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((message) => message.id === id);
        if (found) return found;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      }
      throw new Error('no response');
    };
    try {
      const first = await call(1, 'reply', { messageId: QUESTION.messageId, message: 'ok' });
      expect(JSON.parse(first.result.content[0].text)).toMatchObject({ method: 'POST', path: `/api/agent-room/bridge/messages/${QUESTION.messageId}/reply`, body: { from: 'web', message: 'ok' } });
      expect(first.result.content[1].text).toContain('mensagem(ns) nova(s)');
      const second = await call(2, 'inbox', {});
      expect(JSON.parse(second.result.content[0].text)).toMatchObject({ method: 'GET', path: '/api/agent-room/bridge/inbox' });
      expect(second.result.content).toHaveLength(1);
    } finally {
      input.end();
      await done;
    }
  });
});

describe('orkestrai heavy owner watch', () => {
  const alive = () => true;
  const gone = () => { throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); };
  const denied = () => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); };

  it('keeps running while the agent shell that started it lives', () => {
    expect(heavyOwnerGone(4242, 4242, alive)).toBe(false);
    // Another user's live process still counts as alive.
    expect(heavyOwnerGone(4242, 4242, denied)).toBe(false);
    // Already orphaned at start (owner is init): nothing to watch.
    expect(heavyOwnerGone(1, 1, gone)).toBe(false);
  });

  it('notices when that shell dies', () => {
    expect(heavyOwnerGone(4242, 4242, gone)).toBe(true);
    if (process.platform !== 'win32') expect(heavyOwnerGone(4242, 1, alive)).toBe(true);
  });
});

describe('orkestrai heavy process tree', () => {
  it('orders descendants deepest first from a process table', () => {
    expect(descendantPids(10, ' 11 10\n 12 11\n 13 10\n 20 1\n')).toEqual([12, 11, 13]);
  });

  it.skipIf(process.platform === 'win32')('ends only the command tree, never a sibling in the same process group', async () => {
    const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
    const command = spawn('sh', ['-c', 'sleep 30 & sleep 30; wait'], { stdio: 'ignore' });
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    try {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
      const tree = descendantPids(command.pid!);
      expect(tree.length).toBeGreaterThanOrEqual(2);
      const exited = new Promise((resolvePromise) => command.on('exit', resolvePromise));
      stopHeavyTree(command);
      await exited;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
      expect(tree.filter(alive)).toEqual([]);
      expect(alive(sibling.pid!)).toBe(true);
    } finally {
      sibling.kill();
      command.kill('SIGKILL');
    }
  });
});
