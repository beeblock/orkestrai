import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../packages/orkestrai-cli/src/cli.js';

const VIEW = {
  position: { difficulty: 'normal', act: 2, stage: 4 },
  gold: 1200,
  chests: { white: 2, blue: 1 },
  soulstones: 0,
  coins: 1,
  cubeLevel: 2,
  settings: {},
  inventory: { items: 7, capacity: 50 },
  heroes: [
    { id: 'h-lead', name: 'Amadeus', classId: 'maestro', level: 12, paragon: 0, agent: 'Lead', yours: false, leader: true, deployed: true, power: 300, outfit: 1, freeSkillPoints: 0, autoGear: true, autoSkills: true },
    { id: 'h-web', name: 'Lunara', classId: 'sorceress', level: 9, paragon: 0, agent: 'Web', yours: true, leader: false, deployed: true, power: 210, outfit: 1, freeSkillPoints: 2, autoGear: true, autoSkills: false },
  ],
  you: { heroId: 'h-web', gear: [], actives: ['sorceress.meteor'], learnedActives: ['sorceress.meteor'], skills: {} },
};

describe('orkestrai adventure', () => {
  let server: Server;
  let cwd: string;
  const requests: Array<{ method?: string; url?: string; body?: any }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        requests.push({ method: req.method, url: req.url, body });
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/api/agent-room/bridge/adventure/actions')) res.end(JSON.stringify({ data: { result: 2, view: VIEW } }));
        else if (req.url?.startsWith('/api/agent-room/bridge/adventure')) res.end(JSON.stringify({ data: VIEW }));
        else res.end(JSON.stringify({ data: {} }));
      });
    });
    await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', () => resolvePromise()));
    cwd = mkdtempSync(join(tmpdir(), 'orkestrai-cli-adventure-'));
    mkdirSync(join(cwd, '.orkestrai'));
    writeFileSync(join(cwd, '.orkestrai', 'workspace.json'), JSON.stringify({ token: 'tok', apiUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });

  afterAll(() => {
    server.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  function capture() {
    const out: string[] = [];
    return { out, options: { cwd, out: (line: string) => out.push(String(line)), err: () => undefined, env: { ORKESTRAI_NODE_ID: 'web' } } };
  }

  it('shows the guild and the calling agent\'s own hero', async () => {
    const io = capture();
    expect(await run(['adventure'], io.options)).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'GET', url: '/api/agent-room/bridge/adventure?from=web' });
    expect(io.out.join('\n')).toContain('normal 2-4');
    expect(io.out.join('\n')).toContain('* Lunara — sorceress nv 9');
    expect(io.out.join('\n')).toContain('2 pontos livres');
  });

  it('puts the best gear on its own hero and runs a camp action as itself', async () => {
    const io = capture();
    expect(await run(['adventure', 'equip-best'], io.options)).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/adventure/actions', body: { action: { type: 'auto-equip', heroId: 'h-web' }, from: 'web' } });
    const action = { type: 'raise-skill', heroId: 'h-web', skillId: 'sorceress.focus' };
    expect(await run(['adventure', 'act', JSON.stringify(action)], capture().options)).toBe(0);
    expect(requests.at(-1)).toMatchObject({ body: { action, from: 'web' } });
  });
});
