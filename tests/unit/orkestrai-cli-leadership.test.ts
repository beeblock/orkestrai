import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../packages/orkestrai-cli/src/cli.js';
import { leadershipCliInput, LEADERSHIP_TOOLS, LEADERSHIP_COMMAND_SCHEMA } from '../../packages/orkestrai-cli/src/leadership-reference.js';
import { leadershipCommandSchema } from '$lib/modules/agent-room/contracts/schemas/leadership.schema.js';
import { uuidv7 } from '@beeblock/svelar/support';

describe('leadership CLI/MCP parity', () => {
  let server: Server; let cwd: string;
  const requests: Array<{ method?: string; url?: string; body: any; identity?: string | string[] }> = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''; req.on('data', (part) => (raw += part)); req.on('end', () => {
        const body = raw ? JSON.parse(raw) : null;
        requests.push({ method: req.method, url: req.url, body, identity: req.headers['x-orkestrai-agent-token'] });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ data: req.url?.includes('/tasks/') ? { status: 'doing', completionReview: { status: 'pending' } } : { configuration: { revision: 'r1' } } }));
      });
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    cwd = mkdtempSync(join(tmpdir(), 'orkestrai-leadership-cli-')); mkdirSync(join(cwd, '.orkestrai'));
    writeFileSync(join(cwd, '.orkestrai/workspace.json'), JSON.stringify({ token: 'workspace', apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });
  afterAll(() => { server.close(); rmSync(cwd, { recursive: true, force: true }); });
  const identity = uuidv7();
  const options = () => ({ cwd, env: { ORKESTRAI_NODE_ID: identity, ORKESTRAI_AGENT_TOKEN: 'live-terminal' }, out: () => undefined, err: () => undefined });
  it('reads status and forwards full revision-guarded commands as the live terminal', async () => {
    expect(await run(['leadership', 'status'], options())).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'GET', url: '/api/agent-room/bridge/leadership', identity: 'live-terminal' });
    const input = { command: 'configure', requestId: uuidv7(), expectedRevision: 'r1', leaderNodeId: identity, deputyNodeId: null, taskId: uuidv7() };
    expect(await run(['leadership', 'command', '--input', JSON.stringify(input)], options())).toBe(0);
    expect(requests.at(-1)).toMatchObject({ body: { input, from: identity }, identity: 'live-terminal' });
  });
  it('does not report a review-pending task as completed', async () => {
    const output: string[] = [];
    expect(await run(['task', 'done', uuidv7()], { ...options(), out: (line: string) => output.push(line) })).toBe(0);
    expect(output.join('\n')).toContain('task remains [doing]');
    expect(output.join('\n')).not.toContain('marcada como concluida');
  });
  it('maps every convenience command to the shared server schema, including two concrete review decisions', () => {
    const id = uuidv7();
    const cases: Array<[string[], Record<string, unknown>]> = [
      [['handoff', 'read', id], {}], [['handoff', 'brief', id, 'Saved context'], {}], [['handoff', 'ack', id], {}],
      [['review', 'read', id], {}], [['review', 'prepare', id], { file: 'src/feature.ts' }],
      [['review', 'approve', id], { revision: 'r1', evidence: 'Independent test' }],
      [['review', 'changes', id], { revision: 'r1', evidence: 'Reproduced bug', finding: 'Fix the broken flow' }],
    ];
    for (const [args, flags] of cases) expect(leadershipCommandSchema.safeParse(leadershipCliInput(args, flags)).success).toBe(true);
    expect(LEADERSHIP_COMMAND_SCHEMA.oneOf.map((variant) => variant.properties.command.const).sort())
      .toEqual(leadershipCommandSchema.options.map((variant) => variant.shape.command.value).sort());
    expect(LEADERSHIP_TOOLS.map((tool) => tool.name)).toEqual(['leadership_status', 'leadership_command']);
  });
});
