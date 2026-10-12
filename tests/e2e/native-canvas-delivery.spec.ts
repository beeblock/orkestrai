import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';

test('Portal settings retain IPv6 and invalid input cannot silently remove a restriction', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'ork-portal-hosts-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Portal hosts', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const portal = (await (await request.post(`${base}/nodes`, { data: { type: 'portal', title: 'IPv6 fixture', x: 80, y: 80,
      // A JSON fixture, not the application's root (which embeds this Portal
      // recursively and can never complete page.goto's load event).
      payload: { url: 'http://127.0.0.1:5199/api/agent-room/workspaces', portalAllowedHosts: ['127.0.0.1'] } } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await page.getByRole('button', { name: /Configurações do navegador gerenciado/ }).click();
    await expect(page.getByRole('switch', { name: 'Permitir controle em background', exact: true })).toBeChecked();
    const hosts = page.getByLabel('Hosts permitidos', { exact: true });
    await hosts.fill('127.0.0.1\n[::1]');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    const saved = async () => (await (await request.get(`${base}/nodes/${portal.id}`)).json()).data.payload.portalAllowedHosts;
    await expect.poll(saved).toEqual(['127.0.0.1', '[::1]']);
    await page.getByRole('button', { name: /Configurações do navegador gerenciado/ }).click();
    await hosts.fill('https://wrong.example');
    await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Use hosts exatos');
    await expect(hosts).toBeFocused();
    expect(await saved()).toEqual(['127.0.0.1', '[::1]']);
  } finally {
    await page.goto('about:blank').catch(() => {});
    await request.delete(base).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Portal URL edits send only changed fields and retain newer owner grants', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'ork-portal-grants-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Portal grants', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const initialUrl = 'http://127.0.0.1:5199/api/agent-room/workspaces';
    const portal = (await (await request.post(`${base}/nodes`, { data: { type: 'portal', title: 'Grant fixture', x: 80, y: 80,
      payload: { url: initialUrl, portalAllowBackground: false, portalAllowedHosts: ['127.0.0.1'] } } })).json()).data;
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await request.patch(`${base}/nodes/${portal.id}`, { data: { payload: { portalAllowBackground: true, portalPaused: true } } });
    const savedRequest = page.waitForRequest(r => r.method() === 'PATCH' && r.url().endsWith(`/nodes/${portal.id}`) && r.postDataJSON()?.payload?.url?.includes('portal-regression'));
    const address = page.getByRole('textbox', { name: 'Endereço do portal', exact: true });
    await address.fill(initialUrl + '?portal-regression=1');
    await address.press('Enter');
    const payload = (await savedRequest).postDataJSON().payload;
    expect(payload).toEqual({ url: initialUrl + '?portal-regression=1' });
    await expect.poll(async () => (await (await request.get(`${base}/nodes/${portal.id}`)).json()).data.payload).toMatchObject({
      url: initialUrl + '?portal-regression=1', portalAllowBackground: true, portalPaused: true, portalAllowedHosts: ['127.0.0.1'],
    });
  } finally {
    await page.goto('about:blank').catch(() => {});
    await request.delete(base).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('an authenticated terminal corrects and restarts its existing Shell through the production CLI', async ({ request }) => {
  test.skip(process.platform === 'win32', 'POSIX fixture, no paid provider is launched.');
  const root = await mkdtemp(join(tmpdir(), 'ork-shell-edit-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Shell correction', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  let socket: WebSocket | undefined;
  const resultPath = join(root, 'result.json');
  const counter = join(root, 'startup.txt');
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  try {
    await request.put('/api/agent-room/settings', { data: { terminalGlobalCommands: '[]' } });
    const agent = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'CLI fixture',
      payload: { provider: 'claude', command: '/bin/sh', args: [] } } })).json()).data;
    const scriptPath = join(root, 'fixture.mjs');
    await writeFile(scriptPath, `
      import { readFile, writeFile } from 'node:fs/promises';
      import { run } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'packages/orkestrai-cli/src/cli.js')).href)};
      while (!(await readFile(${JSON.stringify(join(root, 'input.json'))}, 'utf8').catch(() => ''))) await new Promise(resolve => setTimeout(resolve, 50));
      const { taskId, portalNodeId } = JSON.parse(await readFile(${JSON.stringify(join(root, 'input.json'))}, 'utf8'));
      const output = [];
      async function command(action, input) {
        output.length = 0;
        await run(['canvas', action, '--task', taskId, '--input', JSON.stringify(input)], { cwd: ${JSON.stringify(root)}, out: value => output.push(value) });
        return JSON.parse(output.join(''));
      }
      try {
        const nodeId = ${JSON.stringify(randomUUID())};
        const created = await command('shell', { nodeId, title: 'Fix my command', startupCommand: 'echo wrong', start: false });
        const updated = await command('shell-update', { nodeId, revision: created.shell.revision, changes: { startupCommand: ${JSON.stringify(`echo corrected >> ${JSON.stringify(counter)}`)} } });
        const restarted = await command('shell-restart', { nodeId, revision: updated.shell.revision, expectedSessionId: null });
        let retryRejected = false;
        try { await command('shell-restart', { nodeId, revision: updated.shell.revision, expectedSessionId: null }); } catch { retryRejected = true; }
        output.length = 0;
        await run(['canvas', 'list'], { cwd: ${JSON.stringify(root)}, out: value => output.push(value) });
        const portal = JSON.parse(output.join('')).nodes.find(node => node.nodeId === portalNodeId).portal;
        const configured = await command('portal-hosts', { nodeId: portalNodeId, revision: portal.revision, allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
        await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ created, updated, restarted, retryRejected, configured }));
      } catch (error) { await writeFile(${JSON.stringify(resultPath)}, JSON.stringify({ error: error.message })); }
      // Keep the terminal identity alive until the assertion and cleanup.
      setInterval(() => {}, 1000);
    `);
    socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture PTY did not start')), 10_000);
      socket!.once('error', reject);
      socket!.on('open', () => socket!.send(JSON.stringify({ type: 'create', command: '/bin/sh',
        args: ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)}`], provider: 'claude',
        cwd: root, workspaceRoot: root, workspaceId: workspace.id, nodeId: agent.id,
        env: { ORKESTRAI_NODE_ID: agent.id, ORKESTRAI_WORKSPACE_CONFIG: join(root, '.orkestrai/workspace.json'), ORKESTRAI_API_URL: 'http://127.0.0.1:5199' } })));
      socket!.on('message', raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === 'created') { clearTimeout(timer); resolve(); }
        if (frame.type === 'error') { clearTimeout(timer); reject(new Error(frame.message)); }
      });
    });
    const taskResponse = await request.post(`${base}/tasks`, { data: { title: 'Correct Shell command', status: 'doing', assigneeNodeId: agent.id } });
    expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
    const task = (await taskResponse.json()).data;
    const portal = (await (await request.post(`${base}/nodes`, { data: { type: 'portal', title: 'Host configuration',
      payload: { url: 'http://127.0.0.1:3000', portalAllowedHosts: ['127.0.0.1'], portalAllowBackground: false } } })).json()).data;
    await writeFile(join(root, 'input.json'), JSON.stringify({ taskId: task.id, portalNodeId: portal.id }));
    await expect.poll(async () => Boolean(await readFile(resultPath, 'utf8').catch(() => ''))).toBe(true);
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    expect(result.error).toBeUndefined();
    expect(result.updated).toMatchObject({ updated: true, restartRequired: false });
    expect(result.restarted).toMatchObject({ startupSubmitted: true });
    expect(result.retryRejected).toBe(true);
    expect(result.configured).toMatchObject({ nodeId: portal.id, portal: { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] } });
    expect((await (await request.get(`${base}/nodes/${portal.id}`)).json()).data.payload).toMatchObject({
      url: 'http://127.0.0.1:3000', portalAllowBackground: false, portalAllowedHosts: ['localhost', '127.0.0.1', '[::1]'],
    });
    await expect.poll(async () => (await readFile(counter, 'utf8').catch(() => '')).trim()).toBe('corrected');
    expect((await (await request.get(`${base}/tasks`)).json()).data.find((item: any) => item.id === task.id).status).toBe('doing');
  } finally {
    socket?.close();
    await request.put('/api/agent-room/settings', { data: { terminalGlobalCommands: settings.terminalGlobalCommands ?? '[]' } });
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});

test('managed Shell starts off-screen and does not repeat on Canvas remount', async ({ page, request }) => {
  test.skip(process.platform === 'win32', 'POSIX smoke; PowerShell/WSL command composition is covered by domain tests.');
  const root = await mkdtemp(join(tmpdir(), 'ork-managed-shell-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E managed Shell', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const counter = join(root, 'startup-count.txt');
  let socket: WebSocket | undefined;
  try {
    await request.put('/api/agent-room/settings', { data: { terminalGlobalCommands: '[]' } });
    const node = (await (await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: 'Managed dev Shell', x: 80, y: 80, width: 560, height: 360,
      payload: { command: '/bin/sh', args: [], currentWorkingDir: root, shellStartupManaged: true,
        savedCommands: [{ id: randomUUID(), name: 'Start', command: `echo startup >> ${JSON.stringify(counter)}`, runOnResume: true }] },
    } })).json()).data;
    socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Managed Shell creation timed out')), 10_000);
      socket!.once('error', error => { clearTimeout(timer); reject(error); });
      socket!.on('open', () => socket!.send(JSON.stringify({ type: 'create', command: '/bin/sh', args: [], cwd: root,
        workspaceId: workspace.id, workspaceRoot: root, nodeId: node.id })));
      socket!.on('message', raw => {
        const frame = JSON.parse(raw.toString());
        if (frame.type === 'created') { clearTimeout(timer); resolve(); }
        if (frame.type === 'error') { clearTimeout(timer); reject(new Error(frame.message)); }
      });
    });
    // No Canvas/terminal component has mounted yet: the Core submits startup.
    const count = async () => (await readFile(counter, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length;
    await expect.poll(count).toBe(1);
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.canvas-terminal .xterm-helper-textarea')).toBeAttached();
    await page.reload();
    await expect(page.locator('.canvas-terminal .xterm-helper-textarea')).toBeAttached();
    await page.waitForTimeout(500);
    expect(await count()).toBe(1);
  } finally {
    socket?.close();
    await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: { terminalGlobalCommands: settings.terminalGlobalCommands ?? '[]' } });
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});

test('cold restoration persists confirmed terminal model and effort, not old node arguments', async ({ request }) => {
  const root = await mkdtemp(join(tmpdir(), 'ork-cold-model-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E terminal settings', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const sessionId = randomUUID();
  const codexHome = join(root, 'test-provider-home');
  try {
    await mkdir(join(codexHome, 'sessions'), { recursive: true });
    await writeFile(join(codexHome, 'sessions', `rollout-${sessionId}.jsonl`), [
      { type: 'session_meta', payload: { id: sessionId, cwd: root } },
      { type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'xhigh' } },
      { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'gpt-6.1-sol', reasoning_effort: 'high' } } },
    ].map(event => JSON.stringify(event)).join('\n'));
    const node = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Codex test',
      payload: { command: 'codex', provider: 'codex', sessionId: 'stale-process', agentSessionId: sessionId,
        args: ['--model', 'gpt-6-astra', '-c', 'model_reasoning_effort="xhigh"'], env: { CODEX_HOME: codexHome } },
    } })).json()).data;
    const restored = (await (await request.get(`${base}/nodes`)).json()).data.find((item: any) => item.id === node.id);
    expect(restored.payload.sessionId).toBeUndefined();
    expect(restored.payload.agentSessionId).toBe(sessionId);
    expect(restored.payload.args).toContain('gpt-6.1-sol');
    expect(restored.payload.args).toContain('model_reasoning_effort="high"');
    expect(restored.payload.args).not.toContain('gpt-6-astra');
    const saved = (await (await request.get(`${base}/nodes/${node.id}`)).json()).data;
    expect(saved.payload).toEqual(restored.payload);
  } finally {
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});
