import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { PassThrough } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPortFree, run } from '../../packages/orkestrai-cli/src/cli.js';

/**
 * Testa a CLI `orkestrai` contra um servidor HTTP falso que emula a bridge.
 */
describe('orkestrai CLI', () => {
  let server;
  let apiUrl;
  let cwd;
  const requests = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        requests.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : undefined, auth: req.headers.authorization });
        res.setHeader('content-type', 'application/json');
        if (req.url?.startsWith('/api/agent-room/bridge/notes') && req.method === 'GET' && !req.url.includes('/n9')) {
          res.end(JSON.stringify({ data: [] }));
        } else if (req.url?.includes('/api1/runners/smoke/execute')) {
          res.end(JSON.stringify({ data: { runnerName: 'Smoke', passed: true, executions: 2, stopReason: null, runs: [] } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/api-clients/') && req.url.endsWith('/execute')) {
          res.end(JSON.stringify({ data: { status: 200, statusText: 'OK', durationMs: 12, size: 11, ok: true, body: '{"ok":true}' } }));
        } else if (req.url?.endsWith('/api1/export')) {
          res.end(JSON.stringify({ data: { kind: 'postman', path: '/workspace/exports/project.postman_collection.json', files: 1 } }));
        } else if (req.url === '/api/agent-room/bridge/api-clients/import' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { nodeId: 'api3', title: 'Repository API', repository: { linked: true, kind: 'bruno', path: 'tests/api' } } }));
        } else if (req.url === '/api/agent-room/bridge/api-clients/api1/sync' && req.method === 'POST') {
          const request = JSON.parse(body || '{}');
          res.end(JSON.stringify({ data: request.action === 'status'
            ? { linked: true, sourceKind: 'bruno', sourceChanged: false, localChanged: false, conflict: false }
            : { status: 'complete', direction: request.action } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/api-clients/api1?')) {
          res.end(JSON.stringify({ data: { nodeId: 'api1', title: 'Project API', fingerprint: 'a'.repeat(64), collection: { requests: [] } } }));
        } else if (req.url === '/api/agent-room/bridge/api-clients/api1' && req.method === 'PUT') {
          res.end(JSON.stringify({ data: { nodeId: 'api1', title: 'Project API', fingerprint: 'b'.repeat(64), collection: { requests: [] } } }));
        } else if (req.url === '/api/agent-room/bridge/api-clients' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { nodeId: 'api2', title: 'Agent API', fingerprint: 'a'.repeat(64), collection: { requests: [] } } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/api-clients')) {
          res.end(JSON.stringify({ data: [{ nodeId: 'api1', title: 'Project API', requests: [{ requestId: 'r1', method: 'GET', name: 'Health', url: 'https://example.test/health', authType: 'bearer' }] }] }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows' && req.method === 'GET') {
          res.end(JSON.stringify({ data: [{ nodeId: 'img1', title: 'Character poses', status: 'idle', references: [{ nodeId: 'ref1' }], outputs: [] }] }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { nodeId: 'img2', title: 'Instagram carousel', status: 'idle', references: [], outputs: [] } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1' && req.method === 'GET') {
          res.end(JSON.stringify({ data: { nodeId: 'img1', title: 'Character poses', status: 'idle', config: { prompt: 'Create a pose' } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1' && req.method === 'PATCH') {
          res.end(JSON.stringify({ data: { nodeId: 'img1', title: 'Carousel directions', status: 'idle', config: { count: 10 } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { runId: '00000000-0000-7000-8000-000000000001', outputPaths: Array.from({ length: 10 }, (_, index) => `generated/images/pose-${index + 1}.png`) } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/connections' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { edgeId: 'edge-image', workflow: { nodeId: 'img1' } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/connections' && req.method === 'DELETE') {
          res.end(JSON.stringify({ data: { disconnected: true, edgeId: 'edge-image', workflow: { nodeId: 'img1' } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/references' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { reference: { nodeId: 'ref2', title: 'Character', path: 'references/character.png' }, workflow: { nodeId: 'img1' } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/complete' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { outputPaths: ['generated/images/pose-1.png', 'generated/images/pose-2.png'], outputNodeIds: ['out1', 'out2'] } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/validate' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { path: 'generated/images/pose-1.png', valid: true, errorCode: null, repair: null } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/fail' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { run: { id: '00000000-0000-7000-8000-000000000001', status: 'failed' } } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1' && req.method === 'DELETE') {
          res.end(JSON.stringify({ data: { cancelled: true, runId: 'run1' } }));
        } else if (req.url === '/api/agent-room/bridge/image-workflows/img1/remove' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { deleted: true, nodeId: 'img1' } }));
        } else if (req.url === '/api/agent-room/bridge/code-graph' && req.method === 'GET') {
          res.end(JSON.stringify({ data: { projects: [{ id: '00000000-0000-7000-8000-000000000020', name: 'Web', status: 'ready', stats: { files: 12, symbols: 80, edges: 140 } }], totals: { files: 12, symbols: 80, edges: 140 }, indexing: false } }));
        } else if (req.url === '/api/agent-room/bridge/code-graph' && req.method === 'POST') {
          res.end(JSON.stringify({ data: { projects: [], stats: { files: 12, symbols: 80, edges: 140 } } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/code-graph/search?')) {
          res.end(JSON.stringify({ data: [{ id: '00000000-0000-7000-8000-000000000010', kind: 'class', qualifiedName: 'src/order::OrderService', projectName: 'Web', path: 'src/order.ts', startLine: 4 }] }));
        } else if (req.url === '/api/agent-room/bridge/code-graph/symbols/00000000-0000-7000-8000-000000000010') {
          res.end(JSON.stringify({ data: { id: '00000000-0000-7000-8000-000000000010', kind: 'class', qualifiedName: 'src/order::OrderService' } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/code-graph/symbols/00000000-0000-7000-8000-000000000010/graph?')) {
          res.end(JSON.stringify({ data: { nodes: [{ id: '00000000-0000-7000-8000-000000000010', kind: 'class', qualifiedName: 'src/order::OrderService' }], edges: [], truncated: false } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/agents')) {
          const identified = req.url.includes('agentNodeId=n1');
          res.end(JSON.stringify({ data: {
            workspace: { id: 'w1', name: 'Teste' },
            agents: [{ nodeId: 'n1', title: 'Claude', provider: 'claude', sessionAlive: true }],
            notes: [],
            portals: [{ id: 'p1', title: 'Checkout', url: 'http://localhost:5173', connected: identified }],
          } }));
        } else if (req.url === '/api/agent-room/bridge/usage') {
          res.end(JSON.stringify({ data: {
            providers: [
              { provider: 'claude', plan: 'Pro', windows: [{ kind: '5h', label: '5 hours', usedPercent: 96, resetsAt: null }], error: null, fetchedAt: new Date(0).toISOString(), status: 'near_limit', monitoredUsedPercent: 96 },
              { provider: 'codex', plan: null, windows: [{ kind: '5h', label: '5 hours', usedPercent: 18, resetsAt: null }], error: null, fetchedAt: new Date(0).toISOString(), status: 'available', monitoredUsedPercent: 18 },
            ],
            policy: { enabled: true, sourceProvider: 'claude', fallbackProvider: 'codex', windowKind: '5h', thresholdPercent: 90 },
            shouldFallback: true,
            recommendedProvider: 'codex',
          } }));
        } else if (req.url === '/api/agent-room/bridge/huddles') {
          res.end(JSON.stringify({ data: { huddles: [{ id: 'h1', title: 'Release room', status: 'active', turnCount: 2 }] } }));
        } else if (req.url === '/api/agent-room/bridge/huddles/h1/turns') {
          res.end(JSON.stringify({ data: { id: 'h1', title: 'Release room', status: 'active' } }));
        } else if (req.url?.startsWith('/api/agent-room/bridge/memory') && req.method === 'GET') {
          res.end(JSON.stringify({ data: [{ id: 'm1', title: 'Architecture', kind: 'decision', revision: 1 }] }));
        } else if (req.url === '/api/agent-room/bridge/memory' && req.method === 'POST') {
          const request = JSON.parse(body || '{}');
          res.end(JSON.stringify({ data: { ...request, id: 'm1', revision: 1 } }));
        } else if (req.url === '/api/agent-room/bridge/memory/m1' && req.method === 'PATCH') {
          const request = JSON.parse(body || '{}');
          res.end(JSON.stringify({ data: { ...request, id: 'm2', revision: 2 } }));
        } else if (req.url === '/api/agent-room/bridge/memory/m1' && req.method === 'DELETE') {
          res.end(JSON.stringify({ data: { id: 'm1', title: 'Architecture' } }));
        } else if (req.url === '/api/agent-room/bridge/ask') {
          const request = JSON.parse(body || '{}');
          const timedOut = request.to === 'SemResposta';
          res.end(JSON.stringify({ data: {
            to: request.to,
            reply: timedOut ? '' : 'resposta do claude',
            delivered: true,
            replyConfirmed: !timedOut,
            timedOut,
          } }));
        } else if (req.url === '/api/agent-room/bridge/task-columns') {
          res.end(JSON.stringify({ data: [{ key: 'review', name: 'Revisão', color: '#9675ff' }] }));
        } else if (req.url === '/api/agent-room/bridge/portal/create') {
          const request = JSON.parse(body || '{}');
          res.statusCode = 201;
          res.end(JSON.stringify({ data: {
            nodeId: 'p2',
            title: request.title ?? 'Portal',
            url: request.url,
            connectedTo: 'Claude',
            reused: false,
          } }));
        } else if (req.url === '/api/agent-room/bridge/portal' && JSON.parse(body || '{}').nodeId === 'broken') {
          res.statusCode = 400;
          res.end(JSON.stringify({ data: { ok: false, error: 'Portal indisponível: servidor ainda não respondeu.' } }));
        } else if (req.url === '/api/agent-room/bridge/notes/n9' && req.method === 'GET') {
          res.end(JSON.stringify({ data: { nodeId: 'n9', title: 'nota', content: 'conteudo da nota' } }));
        } else if (req.url?.endsWith('/delivery/preview')) {
          res.end(JSON.stringify({ data: { path: 'src/lib/Card.svelte', content: '<article>Card</article>', status: 'create', existingHash: null } }));
        } else if (req.url?.endsWith('/delivery/apply')) {
          res.end(JSON.stringify({ data: { path: 'src/lib/Card.svelte', status: 'create', revision: 5 } }));
        } else if (req.url?.endsWith('/delivery/import')) {
          res.end(JSON.stringify({ data: { elements: [{ id: 'e1' }], rootIds: ['e1'], revision: 5 } }));
        } else {
          res.end(JSON.stringify({ data: { ok: true } }));
        }
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    apiUrl = `http://127.0.0.1:${server.address().port}`;

    cwd = mkdtempSync(join(tmpdir(), 'orkestrai-cli-'));
    mkdirSync(join(cwd, '.orkestrai'));
    writeFileSync(join(cwd, '.orkestrai', 'workspace.json'), JSON.stringify({ token: 'tok123', apiUrl }));
  });

  afterAll(() => server.close());

  function capture() {
    const lines = [];
    return { lines, out: (line) => lines.push(String(line)) };
  }

  it('list mostra agentes do workspace', async () => {
    const { lines, out } = capture();
    const code = await run(['list'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Claude');
    expect(requests.at(-1).auth).toBe('Bearer tok123');
  });

  it('list usa a identidade automatica e diferencia portais conectados', async () => {
    const { lines, out } = capture();
    const code = await run(['list'], { cwd, out, env: { ORKESTRAI_NODE_ID: 'n1' } });
    expect(code).toBe(0);
    expect(requests.at(-1).url).toContain('agentNodeId=n1');
    expect(lines.join('\n')).toContain('Portal [conectado a este agente]: Checkout');
  });

  it('consulta e registra memoria com fonte explicita', async () => {
    const listed = capture();
    expect(await run(['memory', 'list', 'architecture', '--json'], { cwd, out: listed.out, env: {} })).toBe(0);
    expect(JSON.parse(listed.lines.join('\n'))[0].id).toBe('m1');

    const added = capture();
    expect(await run(['memory', 'add', 'Architecture', '--content', 'Use repositories', '--kind', 'decision', '--source-label', 'User direction'], { cwd, out: added.out, env: { ORKESTRAI_NODE_ID: '00000000-0000-7000-8000-000000000001' } })).toBe(0);
    const request = requests.findLast((item) => item.url === '/api/agent-room/bridge/memory' && item.method === 'POST');
    expect(request.body).toMatchObject({ title: 'Architecture', kind: 'decision', createdByNodeId: '00000000-0000-7000-8000-000000000001', sources: [{ type: 'user', label: 'User direction' }] });
  });

  it('ask envia mensagem e imprime a resposta', async () => {
    const { lines, out } = capture();
    const code = await run(['ask', 'Claude', 'como vai?'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('resposta do claude');
    expect(requests.at(-1).body).toMatchObject({ to: 'Claude', message: 'como vai?' });
  });

  it('ask preserva mensagens sem aspas e falha quando a resposta nao e confirmada', async () => {
    const { lines, out } = capture();
    const ok = await run(['ask', 'Claude', 'revise', 'este', 'diff'], { cwd, out, env: {} });
    expect(ok).toBe(0);
    expect(requests.at(-1).body.message).toBe('revise este diff');
    expect(lines.join('\n')).toContain('Resposta confirmada de Claude');

    const timedOut = await run(['ask', 'SemResposta', 'ping'], { cwd, out, env: {} });
    expect(timedOut).toBe(2);
    expect(lines.join('\n')).toContain('Resposta nao confirmada');
  });

  it('usage mostra status e recomendacao de roteamento', async () => {
    const { lines, out } = capture();
    const code = await run(['usage'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('claude');
    expect(lines.join('\n')).toContain('codex');
    expect(lines.join('\n')).toContain('codex');
    expect(requests.at(-1).url).toBe('/api/agent-room/bridge/usage');
  });

  it('consulta e percorre o mesmo grafo de codigo exposto no canvas', async () => {
    const { lines, out } = capture();
    const symbolId = '00000000-0000-7000-8000-000000000010';
    const projectId = '00000000-0000-7000-8000-000000000020';

    expect(await run(['graph', 'status'], { cwd, out, env: {} })).toBe(0);
    expect(lines.join('\n')).toContain('Web: ready');
    expect(await run(['graph', 'index', '--project', projectId, '--force'], { cwd, out, env: {} })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/code-graph', body: { projectIds: [projectId], force: true } });
    expect(await run(['graph', 'search', 'OrderService', '--kinds', 'class'], { cwd, out, env: {} })).toBe(0);
    expect(lines.join('\n')).toContain('src/order::OrderService');
    expect(await run(['graph', 'symbol', symbolId], { cwd, out, env: {} })).toBe(0);
    expect(await run(['graph', 'neighbors', symbolId, '--direction', 'incoming', '--depth', '3'], { cwd, out, env: {} })).toBe(0);
    expect(requests.at(-1).url).toContain('/graph?direction=incoming&depth=3');
  });

  it('huddle lista sessoes e registra a fala do agente identificado', async () => {
    const listed = capture();
    expect(await run(['huddle', 'list'], { cwd, out: listed.out, env: {} })).toBe(0);
    expect(listed.lines.join('\n')).toContain('Release room');

    const spoken = capture();
    expect(
      await run(['huddle', 'say', 'h1', 'Release', 'approved'], {
        cwd,
        out: spoken.out,
        env: { ORKESTRAI_NODE_ID: 'n1' },
      }),
    ).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/agent-room/bridge/huddles/h1/turns',
      body: { from: 'n1', text: 'Release approved' },
    });
  });

  it('device encaminha comandos estruturados para a sessao do workspace', async () => {
    const { out } = capture();
    const code = await run(['device', 'attach', 'simulator-1', '--platform', 'ios'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/agent-room/bridge/devices',
      body: { command: 'start', platform: 'ios', deviceId: 'simulator-1' },
    });

    await run(['device', 'swipe', '0.1', '0.2', '0.8', '0.7', '--duration', '450'], { cwd, out, env: {} });
    expect(requests.at(-1).body).toEqual({
      command: 'swipe',
      fromX: 0.1,
      fromY: 0.2,
      toX: 0.8,
      toY: 0.7,
      durationMs: 450,
    });
  });

  it('portal preserva o detalhe retornado pela ponte em erros HTTP 400', async () => {
    await expect(run(['portal', 'broken', 'dom'], { cwd, out: () => {}, env: {} })).rejects.toThrow(
      'Portal indisponível: servidor ainda não respondeu.'
    );
  });

  it('portal create exige intencao explicita para encaminhar forceNew', async () => {
    const { lines, out } = capture();
    expect(await run(['portal', 'create', 'localhost:4173', '--title', 'QA', '--force-new'], {
      cwd,
      out,
      env: { ORKESTRAI_NODE_ID: 'n1' },
    })).toBe(0);
    expect(requests.at(-1).body).toMatchObject({ from: 'n1', title: 'QA', forceNew: true });
    expect(lines.join('\n')).toContain('Portal criado: "QA"');
  });

  it('note read imprime o conteudo da nota', async () => {
    const { lines, out } = capture();
    const code = await run(['note', 'read', 'n9'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('conteudo da nota');
  });

  it('note write envia o conteudo via PUT', async () => {
    const { out } = capture();
    const code = await run(['note', 'write', 'n9', 'novo', 'texto'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(requests.at(-1).method).toBe('PUT');
    expect(requests.at(-1).body.content).toBe('novo texto');
  });

  it('note create repassa content e connect (parseFlags generico)', async () => {
    const { out } = capture();
    await run(['note', 'create', 'Minha nota', '--content', 'corpo da nota', '--connect', 'Claude'], { env: {}, cwd, out });
    const request = requests.find((entry) => entry.url === '/api/agent-room/bridge/notes' && entry.method === 'POST');
    expect(request.body.title).toBe('Minha nota');
    expect(request.body.content).toBe('corpo da nota');
    expect(request.body.connect).toBe('Claude');
  });

  it('note create conecta por padrao ao time inteiro', async () => {
    const { out } = capture();
    await run(['note', 'create', 'Spec X'], { env: { ORKESTRAI_NODE_ID: 'n1' }, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/notes' && entry.method === 'POST').at(-1);
    expect(request.body.connect).toBe('all');
  });

  it('design apply envia operacoes e revisao sem editar o arquivo diretamente', async () => {
    const { out } = capture();
    await run([
      'design',
      'apply',
      'design-1',
      JSON.stringify({ kind: 'update', elementId: 'element-1', changes: { x: 80 } }),
      '--revision',
      '4',
      '--summary',
      'Move heading',
      '--task',
      '00000000-0000-7000-8000-000000000003',
    ], { env: { ORKESTRAI_NODE_ID: 'designer-1' }, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/designs/design-1').at(-1);
    expect(request.method).toBe('PATCH');
    expect(request.body).toMatchObject({
      baseRevision: 4,
      summary: 'Move heading',
      from: 'designer-1',
      taskId: '00000000-0000-7000-8000-000000000003',
      operations: [{ kind: 'update', elementId: 'element-1', changes: { x: 80 } }],
    });
  });

  it('design import-code le arquivos e registra a importacao pela bridge', async () => {
    writeFileSync(join(cwd, 'card.html'), '<article class="p-4">Card</article>');
    writeFileSync(join(cwd, 'card.css'), 'article { color: red; }');
    const { out } = capture();
    await run([
      'design', 'import-code', 'design-1', 'card.html', '--format', 'html', '--name', 'Card',
      '--revision', '4', '--css', 'card.css', '--task', '00000000-0000-7000-8000-000000000003',
    ], { env: { ORKESTRAI_NODE_ID: 'designer-1' }, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/designs/design-1/delivery/import').at(-1);
    expect(request.body).toMatchObject({
      baseRevision: 4,
      format: 'html',
      name: 'Card',
      markup: '<article class="p-4">Card</article>',
      css: 'article { color: red; }',
      from: 'designer-1',
    });
  });

  it('design generate sempre faz preview e so escreve com hash e revisao', async () => {
    const { out } = capture();
    const elementIds = JSON.stringify(['00000000-0000-7000-8000-000000000001']);
    await run([
      'design', 'generate', 'design-1', elementIds, '--framework', 'svelar', '--output', 'src/lib/Card.svelte',
      '--name', 'Card', '--write', '--revision', '4',
    ], { env: { ORKESTRAI_NODE_ID: 'designer-1' }, cwd, out });
    const calls = requests.filter((entry) => entry.url?.includes('/api/agent-room/bridge/designs/design-1/delivery/'));
    expect(calls.at(-2)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/designs/design-1/delivery/preview' });
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/agent-room/bridge/designs/design-1/delivery/apply',
      body: { baseRevision: 4, expectedExistingHash: null, from: 'designer-1' },
    });
  });

  it('task assign usa o flag --assign', async () => {
    const { out } = capture();
    await run(['task', 'add', 'Revisar PR', '--assign', 'Claude'], { env: {}, cwd, out });
    const request = requests.find((entry) => entry.url === '/api/agent-room/bridge/tasks' && entry.method === 'POST');
    expect(request.body.assignee).toBe('Claude');
  });

  it('task done envia a identidade e mostra o handoff ao lider', async () => {
    const { lines, out } = capture();
    await run(['task', 'done', 't1'], { env: { ORKESTRAI_NODE_ID: 'codex-node' }, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/tasks/t1' && entry.method === 'PATCH').at(-1);
    expect(request.body).toEqual({ status: 'done', from: 'codex-node' });
    expect(lines.join('\n')).toContain('Tarefa marcada como concluida');
  });

  it('notify classifica atencao e conclusao de projeto sem ambiguidade', async () => {
    const { out } = capture();
    await run(['notify', 'Preciso de aprovacao', '--kind', 'attention', '--title', 'Checkout'], { env: {}, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/notify').at(-1);
    expect(request.body).toEqual({ message: 'Preciso de aprovacao', kind: 'attention', title: 'Checkout' });
  });

  it('task columns lista etapas e task add/move usam a etapa escolhida', async () => {
    const { lines, out } = capture();
    await run(['task', 'columns'], { env: {}, cwd, out });
    expect(lines.join('\n')).toContain('Revisão [review]');

    await run(['task', 'add', 'Revisar campanha', '--column', 'Revisão'], { env: {}, cwd, out });
    let request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/tasks' && entry.method === 'POST').at(-1);
    expect(request.body.status).toBe('Revisão');

    await run(['task', 'move', 't1', 'Revisão'], { env: {}, cwd, out });
    request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/tasks/t1' && entry.method === 'PATCH').at(-1);
    expect(request.body).toEqual({ status: 'Revisão' });
  });

  it('sem token retorna erro claro', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'orkestrai-cli-empty-'));
    await expect(run(['list'], {
      cwd: emptyDir,
      out: () => {},
      env: { ORKESTRAI_TOKEN: '', ORKESTRAI_RUNTIME_FILE: '' },
    })).rejects.toThrow('Token');
  });

  it('MCP completa o handshake mesmo fora de um workspace Orkestrai', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'orkestrai-mcp-empty-'));
    const input = new PassThrough();
    const chunks: string[] = [];
    const done = run(['mcp'], {
      cwd: emptyDir,
      env: { ORKESTRAI_RUNTIME_FILE: '' },
      input,
      write: (chunk: string) => chunks.push(chunk),
    });
    input.end(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {} },
    })}\n`);
    await done;

    const response = chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line))[0];
    expect(response.result.serverInfo.name).toBe('orkestrai');
  });

  it('env ORKESTRAI_TOKEN tem precedencia sobre arquivo', async () => {
    const { lines, out } = capture();
    await run(['list'], { cwd, out, env: { ORKESTRAI_TOKEN: 'env-tok', ORKESTRAI_API_URL: apiUrl } });
    expect(requests.at(-1).auth).toBe('Bearer env-tok');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('recruit usa ORKESTRAI_NODE_ID como --from padrao', async () => {
    const { out } = capture();
    await run(['recruit', 'Dev Frontend', '--provider', 'claude', '--model', 'opus', '--effort', 'high', '--floor', 'floor-1'], { env: { ORKESTRAI_NODE_ID: 'n1' }, cwd, out });
    const request = requests.find((entry) => entry.url === '/api/agent-room/bridge/recruit');
    expect(request.body.from).toBe('n1');
    expect(request.body.floorId).toBe('floor-1');
    expect(request.body.model).toBe('opus');
    expect(request.body.effort).toBe('high');
  });

  it('recruit rejeita --profile sem --provider antes de chamar a bridge', async () => {
    const before = requests.length;
    await expect(run(['recruit', 'QA', '--profile', 'Work'], {
      env: { ORKESTRAI_NODE_ID: 'n1' },
      cwd,
      out: () => undefined,
    })).rejects.toThrow('--profile exige --provider');
    expect(requests).toHaveLength(before);
  });

  it('flag --from explicito tem precedencia sobre o env', async () => {
    const { out } = capture();
    await run(['recruit', 'QA', '--from', 'Outro'], { env: { ORKESTRAI_NODE_ID: 'n1' }, cwd, out });
    const request = requests.filter((entry) => entry.url === '/api/agent-room/bridge/recruit').at(-1);
    expect(request.body.from).toBe('Outro');
  });

  it('list usa ORKESTRAI_NODE_ID como --agent padrao', async () => {
    const { out } = capture();
    await run(['list'], { env: { ORKESTRAI_NODE_ID: 'n1' }, cwd, out });
    expect(requests.at(-1).url).toContain('agentNodeId=n1');
  });

  it('runtime.json tem precedencia sobre o apiUrl do workspace.json', async () => {
    // workspace.json com porta obsoleta; runtime.json aponta o servidor atual.
    const staleDir = mkdtempSync(join(tmpdir(), 'orkestrai-cli-stale-'));
    mkdirSync(join(staleDir, '.orkestrai'));
    writeFileSync(join(staleDir, '.orkestrai', 'workspace.json'), JSON.stringify({ token: 'tok123', apiUrl: 'http://127.0.0.1:1' }));
    const runtimeFile = join(staleDir, 'runtime.json');
    writeFileSync(runtimeFile, JSON.stringify({ apiUrl }));

    const { lines, out } = capture();
    const code = await run(['list'], { cwd: staleDir, out, env: { ORKESTRAI_RUNTIME_FILE: runtimeFile } });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('Claude');
  });

  it('fs read busca o arquivo via bridge (path encodado)', async () => {
    const { out } = capture();
    const code = await run(['fs', 'read', 'src/app.ts'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(requests.at(-1).url).toBe('/api/agent-room/bridge/fs/read?path=src%2Fapp.ts');
  });

  it('fs search passa o termo e o flag --content', async () => {
    const { out } = capture();
    await run(['fs', 'search', 'hello world', '--content'], { cwd, out, env: {} });
    expect(requests.at(-1).url).toBe('/api/agent-room/bridge/fs/search?q=hello%20world&content=1');
  });

  it('say posta o texto na bridge', async () => {
    const { out } = capture();
    await run(['say', 'terminei a tarefa'], { cwd, out, env: {} });
    expect(requests.at(-1).url).toBe('/api/agent-room/bridge/say');
    expect(requests.at(-1).body).toMatchObject({ text: 'terminei a tarefa' });
  });

  it('run re-despacha a tarefa para o responsavel', async () => {
    const { out } = capture();
    const code = await run(['run', 't1'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(requests.at(-1).url).toBe('/api/agent-room/bridge/tasks/t1/dispatch');
    expect(requests.at(-1).method).toBe('POST');
  });

  it('notes lista vazia cai na mensagem amigavel', async () => {
    const { lines, out } = capture();
    const code = await run(['notes'], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.join('\n')).toContain('(sem notas)');
  });

  it('api lista e executa requests salvos com variaveis', async () => {
    const { lines, out } = capture();
    expect(await run(['api', 'list'], { cwd, out, env: { ORKESTRAI_NODE_ID: 'n1' } })).toBe(0);
    expect(lines.join('\n')).toContain('GET Health');
    expect(requests.at(-1).url).toContain('agentNodeId=n1');

    expect(await run(['api', 'run', 'api1', 'r1', '--variables', '{"baseUrl":"https://example.test"}'], { cwd, out, env: { ORKESTRAI_NODE_ID: 'n1' } })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/agent-room/bridge/api-clients/api1/execute',
      body: { requestId: 'r1', variables: { baseUrl: 'https://example.test' }, from: 'n1' },
    });
  });

  it('api importa, sincroniza, cria, le, substitui e exporta colecoes completas pela mesma bridge do MCP', async () => {
    const collectionPath = join(cwd, 'agent-api.json');
    writeFileSync(collectionPath, JSON.stringify({ requests: [], folders: [], runners: [], scriptDialect: 'bruno' }));
    const { lines, out } = capture();
    const env = { ORKESTRAI_NODE_ID: 'n1' };

    expect(await run(['api', 'reference'], { cwd, out, env: {} })).toBe(0);
    expect(lines.join('\n')).toContain('api_client_replace');
    expect(await run(['api', 'read', 'api1'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1).url).toContain('/api-clients/api1?agentNodeId=n1');
    expect(await run(['api', 'import', 'tests/api', '--kind', 'bruno'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/api-clients/import', body: { path: 'tests/api', kind: 'bruno', syncMode: 'watch', from: 'n1' } });
    expect(await run(['api', 'create', 'Agent API', '--file', 'agent-api.json'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', body: { title: 'Agent API', from: 'n1' } });
    expect(await run(['api', 'replace', 'api1', '--file', 'agent-api.json', '--fingerprint', 'a'.repeat(64)], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'PUT', body: { baseFingerprint: 'a'.repeat(64), syncToSource: true, from: 'n1' } });
    expect(await run(['api', 'sync-status', 'api1'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/api-clients/api1/sync', body: { action: 'status', from: 'n1' } });
    expect(await run(['api', 'pull', 'api1'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1).body).toMatchObject({ action: 'pull', from: 'n1' });
    expect(await run(['api', 'push', 'api1', '--force'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1).body).toMatchObject({ action: 'push', resolution: 'orkestrai', from: 'n1' });
    expect(await run(['api', 'export', 'api1', 'postman', '--path', 'exports'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/api-clients/api1/export', body: { kind: 'postman', path: 'exports', from: 'n1' } });
    expect(await run(['api', 'run-runner', 'api1', 'smoke', '--max-executions', '20'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/api-clients/api1/runners/smoke/execute', body: { variables: {}, maxExecutions: 20, from: 'n1' } });
  });

  it('controla integralmente fluxos nativos de imagem pela ponte', async () => {
    const { lines, out } = capture();
    const env = { ORKESTRAI_NODE_ID: 'n1' };
    const targetNodeId = '00000000-0000-7000-8000-000000000021';

    expect(await run(['image', 'list'], { cwd, out, env })).toBe(0);
    expect(lines.join('\n')).toContain('Character poses');
    expect(await run(['image', 'read', 'img1'], { cwd, out, env })).toBe(0);
    expect(lines.join('\n')).toContain('Create a pose');
    expect(await run(['image', 'create', '--title', 'Instagram carousel', '--count', '10'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows',
      body: { title: 'Instagram carousel', count: '10', from: 'n1' },
    });
    expect(await run(['image', 'update', 'img1', '--title', 'Carousel directions', '--count', '10', '--opaque'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'PATCH', url: '/api/agent-room/bridge/image-workflows/img1',
      body: { title: 'Carousel directions', count: '10', transparentBackground: false, from: 'n1' },
    });
    expect(await run(['image', 'connect', 'img1', targetNodeId, '--order', '0'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/connections',
      body: { targetNodeId, order: '0', from: 'n1' },
    });
    expect(await run(['image', 'disconnect', 'img1', targetNodeId], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'DELETE', url: '/api/agent-room/bridge/image-workflows/img1/connections', body: { targetNodeId, from: 'n1' },
    });
    expect(await run(['image', 'reference', 'img1', 'references/character.png', '--title', 'Character'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/references',
      body: { path: 'references/character.png', title: 'Character', from: 'n1' },
    });
    expect(await run(['image', 'run', 'img1', '--prompt', 'Create a complete carousel', '--transparent', '--count', '10'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/agent-room/bridge/image-workflows/img1',
      body: { prompt: 'Create a complete carousel', transparentBackground: true, count: '10', from: 'n1' },
    });
    const runId = '00000000-0000-7000-8000-000000000001';
    expect(await run(['image', 'validate', 'img1', runId, 'generated/images/pose-1.png'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/validate',
      body: { runId, outputPath: 'generated/images/pose-1.png', from: 'n1' },
    });
    expect(await run(['image', 'complete', 'img1', runId, 'generated/images/pose-1.png', 'generated/images/pose-2.png'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/complete',
      body: { runId, outputPaths: ['generated/images/pose-1.png', 'generated/images/pose-2.png'], from: 'n1' },
    });
    expect(await run(['image', 'fail', 'img1', runId, '--error', 'image_gen_output_missing'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({
      method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/fail',
      body: { runId, errorCode: 'image_gen_output_missing', from: 'n1' },
    });
    expect(await run(['image', 'cancel', 'img1'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/agent-room/bridge/image-workflows/img1', body: { from: 'n1' } });
    expect(await run(['image', 'delete', 'img1'], { cwd, out, env })).toBe(0);
    expect(requests.at(-1)).toMatchObject({ method: 'POST', url: '/api/agent-room/bridge/image-workflows/img1/remove', body: { from: 'n1' } });
  });

  it('port devolve uma porta livre (sem precisar de workspace.json)', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'orkestrai-cli-port-'));
    const { lines, out } = capture();
    const code = await run(['port'], { cwd: emptyDir, out, env: {} });
    expect(code).toBe(0);
    const port = Number(lines.at(-1));
    expect(Number.isInteger(port)).toBe(true);
    expect(port).toBeGreaterThan(1023);
    expect(port).toBeLessThanOrEqual(65535);
    expect(await isPortFree(port)).toBe(true);
  });

  it('port --check distingue porta ocupada de livre', async () => {
    const blocker = createNetServer();
    await new Promise<void>((resolvePromise) => blocker.listen(0, '127.0.0.1', resolvePromise));
    const busy = (blocker.address() as { port: number }).port;
    try {
      const { lines, out } = capture();
      const code = await run(['port', '--check', String(busy)], { cwd, out, env: {} });
      expect(code).toBe(1);
      expect(lines.at(-1)).toBe(`${busy} ocupada`);
    } finally {
      await new Promise((resolvePromise) => blocker.close(resolvePromise));
    }
    const { lines, out } = capture();
    const code = await run(['port', '--check', String(busy)], { cwd, out, env: {} });
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe(`${busy} livre`);
  });
});
