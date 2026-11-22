import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openWorkspace } from './helpers.js';

type WorkspaceFixture = { id: string; name: string; directory: string; noteId: string; terminalId?: string };

async function workspace(request: APIRequestContext, name: string, shell = false): Promise<WorkspaceFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-warm-switch-'));
  const response = await request.post('/api/agent-room/workspaces', {
    data: { name, workingDir: directory, codeIntelligenceMode: 'disabled' },
  });
  expect(response.ok()).toBe(true);
  const created = (await response.json()).data as { id: string };
  const base = `/api/agent-room/workspaces/${created.id}`;
  const noteResponse = await request.post(`${base}/nodes`, { data: {
    type: 'note', title: `${name} briefing`, x: 70, y: 110, width: 320, height: 240,
    payload: { content: `${name} retained briefing` },
  } });
  expect(noteResponse.ok()).toBe(true);
  const note = (await noteResponse.json()).data as { id: string };
  let terminalId: string | undefined;
  if (shell) {
    const terminalResponse = await request.post(`${base}/nodes`, { data: {
      type: 'terminal', title: `${name} shell`, x: 440, y: 110, width: 620, height: 360,
      payload: { command: '/bin/cat', args: [] },
    } });
    expect(terminalResponse.ok()).toBe(true);
    terminalId = (await terminalResponse.json()).data.id;
  }
  return { ...created, name, directory, noteId: note.id, terminalId };
}

async function mockProviders(page: Page) {
  const requests = new Map<string, number>();
  await page.route('**/api/agent-room/status**', async route => {
    const id = new URL(route.request().url()).searchParams.get('workspaceId') ?? 'unscoped';
    requests.set(id, (requests.get(id) ?? 0) + 1);
    // No model/CLI discovery or inference is needed for metadata-only notes
    // and the literal /bin/cat shells used by these fixtures.
    await route.fulfill({ json: { data: { providers: [], runtime: { kind: 'native' } } } });
  });
  return requests;
}

async function sessionId(request: APIRequestContext, fixture: WorkspaceFixture): Promise<string | null> {
  const response = await request.get(`/api/agent-room/workspaces/${fixture.id}/nodes`);
  const nodes = (await response.json()).data as Array<{ id: string; payload: { sessionId?: string } }>;
  return nodes.find(node => node.id === fixture.terminalId)?.payload.sessionId ?? null;
}

async function holdNextLoad(page: Page, id: string) {
  let release!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const state = { entered: false, released: false };
  const pattern = `**/api/agent-room/workspaces/${id}/load`;
  const handler = async (route: Route) => {
    if (route.request().method() === 'POST') { state.entered = true; await released; }
    await route.continue();
  };
  await page.route(pattern, handler);
  return { state, release: () => { state.released = true; release(); } };
}

async function cleanup(page: Page, request: APIRequestContext, fixtures: WorkspaceFixture[], release?: () => void) {
  release?.();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('about:blank');
  for (const fixture of fixtures) {
    await request.delete(`/api/agent-room/workspaces/${fixture.id}`);
    await rm(fixture.directory, { recursive: true, force: true });
  }
}

test.describe('warm workspace switching', () => {
  test('paints an open workspace after a minute before load returns, without restarting its shell on revalidation', async ({ page, request }) => {
    test.skip(process.platform === 'win32', 'This focused browser fixture uses literal /bin/cat; ConPTY has separate transport coverage.');
    test.setTimeout(60000);
    const fixtures: WorkspaceFixture[] = [];
    let gate: Awaited<ReturnType<typeof holdNextLoad>> | undefined;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const providerRequests = await mockProviders(page);
    await page.addInitScript(() => {
      const originalNow = Date.now.bind(Date);
      (window as any).__workspaceClockOffset = 0;
      Date.now = () => originalNow() + (window as any).__workspaceClockOffset;
    });
    try {
      const a = await workspace(request, 'Warm switch A', true); fixtures.push(a);
      const b = await workspace(request, 'Warm switch B', true); fixtures.push(b);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/canvas?workspace=${a.id}`);
      const aNode = page.locator(`.svelte-flow__node[data-id="${a.terminalId}"]`);
      await expect(aNode.locator('.xterm-helper-textarea')).toBeAttached();
      await expect.poll(() => sessionId(request, a)).toBeTruthy();
      const originalSession = await sessionId(request, a);
      await expect.poll(() => providerRequests.get(a.id) ?? 0).toBe(1);
      // Confirm the initial shell is usable before testing its later retention.
      await aNode.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('warm-switch-marker');
      await page.keyboard.press('Enter');
      await expect(aNode.locator('.xterm-rows')).toContainText('warm-switch-marker');
      // The original graph predates PTY creation. A structural WS refresh
      // records the live session identity in the raw metadata cache before B.
      const cacheRefresh = await request.post(`/api/agent-room/workspaces/${a.id}/nodes`, { data: {
        type: 'note', title: 'Cache identity refresh', x: 70, y: 420, width: 320, height: 200,
        payload: { content: 'Refresh raw cached metadata after the shell starts.' },
      } });
      expect(cacheRefresh.ok()).toBe(true);
      const refreshedNote = (await cacheRefresh.json()).data as { id: string };
      await expect(page.locator(`.svelte-flow__node[data-id="${refreshedNote.id}"]`)).toBeAttached();

      await openWorkspace(page, b.name);
      await expect(page.locator(`.svelte-flow__node[data-id="${b.terminalId}"] .xterm-helper-textarea`)).toBeAttached();
      await expect(page.locator(`.svelte-flow__node[data-id="${a.terminalId}"]`)).toHaveCount(0);
      await expect.poll(() => providerRequests.get(b.id) ?? 0).toBe(1);
      await page.waitForURL(url => url.searchParams.get('workspace') === b.id);

      // Age only the frontend cache clock. Do not advance timers, WebSockets,
      // server time, or the actual PTY processes.
      await page.evaluate(() => { (window as any).__workspaceClockOffset = 61000; });
      gate = await holdNextLoad(page, a.id);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agent-room/workspaces/${a.id}/nodes`
        && response.request().method() === 'GET' && response.ok());
      const loadReturned = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agent-room/workspaces/${a.id}/load`
        && response.request().method() === 'POST' && response.ok());
      void refreshed.catch(() => {}); void loadReturned.catch(() => {});
      const started = performance.now();
      await page.locator('.ws-tab-main').filter({ hasText: a.name }).click();
      await expect.poll(() => gate!.state.entered, { timeout: 2000 }).toBe(true);
      await expect(page.locator('.ws-tab.active')).toContainText(a.name, { timeout: 2000 });
      await expect(page.locator(`.svelte-flow__node[data-id="${a.noteId}"] textarea`)).toHaveValue(`${a.name} retained briefing`, { timeout: 2000 });
      await expect(aNode.locator('.xterm-helper-textarea')).toBeAttached({ timeout: 2000 });
      expect(gate.state.released).toBe(false);
      console.log('[workspace-warm-paint]', JSON.stringify({ milliseconds: Math.round(performance.now() - started), loadStillBlocked: true }));
      await page.evaluate(({ noteId, terminalId }) => {
        (window as any).__warmSwitchDOM = {
          note: document.querySelector(`.svelte-flow__node[data-id="${noteId}"]`),
          terminal: document.querySelector(`.svelte-flow__node[data-id="${terminalId}"]`),
          textarea: document.querySelector(`.svelte-flow__node[data-id="${terminalId}"] .xterm-helper-textarea`),
        };
      }, { noteId: a.noteId, terminalId: a.terminalId });
      gate.release();
      await loadReturned;
      const freshNodes = await refreshed; await freshNodes.finished();
      await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.evaluate(({ noteId, terminalId }) => {
        const warm = (window as any).__warmSwitchDOM;
        return warm.note === document.querySelector(`.svelte-flow__node[data-id="${noteId}"]`)
          && warm.terminal === document.querySelector(`.svelte-flow__node[data-id="${terminalId}"]`)
          && warm.textarea === document.querySelector(`.svelte-flow__node[data-id="${terminalId}"] .xterm-helper-textarea`);
      }, { noteId: a.noteId, terminalId: a.terminalId })).toBe(true);
      expect(await sessionId(request, a)).toBe(originalSession);
      await expect(aNode.locator('.xterm-rows')).toContainText('warm-switch-marker');
      // Provider metadata has its own 60s TTL: one fresh request after expiry,
      // not the duplicate boot/select requests that previously occurred.
      await expect.poll(() => providerRequests.get(a.id) ?? 0).toBe(2);
      expect(providerRequests.get(b.id)).toBe(1);
      expect(errors).toEqual([]);
    } finally { await cleanup(page, request, fixtures, gate?.release); }
  });

  test('keeps all six open workspace snapshots available before a blocked reload', async ({ page, request }) => {
    test.setTimeout(60000);
    const fixtures: WorkspaceFixture[] = [];
    let gate: Awaited<ReturnType<typeof holdNextLoad>> | undefined;
    await mockProviders(page);
    try {
      for (let index = 0; index < 6; index++) fixtures.push(await workspace(request, `Six warm tabs ${index + 1}`));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(ids => localStorage.setItem('orkestrai.workspaceTabs', JSON.stringify(ids)), fixtures.map(fixture => fixture.id));
      await page.goto(`/canvas?workspace=${fixtures[0].id}`);
      await expect(page.locator(`.svelte-flow__node[data-id="${fixtures[0].noteId}"]`)).toBeVisible();
      for (const fixture of fixtures.slice(1)) {
        await page.locator('.ws-tab-main').filter({ hasText: fixture.name }).click();
        await expect(page.locator('.ws-tab.active')).toContainText(fixture.name);
        await expect(page.locator(`.svelte-flow__node[data-id="${fixture.noteId}"]`)).toBeVisible();
        await page.waitForURL(url => url.searchParams.get('workspace') === fixture.id);
      }
      await expect(page.locator('.ws-tab-main')).toHaveCount(6);
      const first = fixtures[0];
      gate = await holdNextLoad(page, first.id);
      const loadReturned = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agent-room/workspaces/${first.id}/load`
        && response.request().method() === 'POST' && response.ok());
      void loadReturned.catch(() => {});
      await page.locator('.ws-tab-main').filter({ hasText: first.name }).click();
      await expect.poll(() => gate!.state.entered, { timeout: 2000 }).toBe(true);
      await expect(page.locator('.ws-tab.active')).toContainText(first.name, { timeout: 2000 });
      await expect(page.locator(`.svelte-flow__node[data-id="${first.noteId}"] textarea`)).toHaveValue(`${first.name} retained briefing`, { timeout: 2000 });
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1);
      expect(gate.state.released).toBe(false);
      gate.release(); await loadReturned;
      await page.waitForURL(url => url.searchParams.get('workspace') === first.id);
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1);
    } finally { await cleanup(page, request, fixtures, gate?.release); }
  });

  test('never launches a cached shell without a session identity before fresh workspace metadata is validated', async ({ page, request }) => {
    test.skip(process.platform === 'win32', 'This focused browser fixture uses literal /bin/cat; ConPTY has separate transport coverage.');
    test.setTimeout(60000);
    const fixtures: WorkspaceFixture[] = [];
    let gate: Awaited<ReturnType<typeof holdNextLoad>> | undefined;
    await mockProviders(page);
    try {
      const a = await workspace(request, 'Validated warm A', true); fixtures.push(a);
      const b = await workspace(request, 'Validated warm B', true); fixtures.push(b);
      let stripSession = true, strippedResponses = 0, createsForA = 0;
      const attachedSessions: string[] = [];
      const nodesPath = `/api/agent-room/workspaces/${a.id}/nodes`;
      await page.route(`**${nodesPath}`, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        if (stripSession) {
          strippedResponses++;
          body.data = body.data.map((node: { id: string; payload: Record<string, unknown> }) => node.id === a.terminalId
            ? { ...node, payload: { ...node.payload, sessionId: undefined } } : node);
        }
        await route.fulfill({ response, json: body });
      });
      await page.routeWebSocket('**/ws/agent-room/pty', client => {
        const server = client.connectToServer();
        client.onMessage(message => {
          try {
            const frame = JSON.parse(String(message));
            if (frame.type === 'create' && frame.nodeId === a.terminalId) createsForA++;
            if (frame.type === 'attach' && typeof frame.sessionId === 'string') attachedSessions.push(frame.sessionId);
          } catch { /* Only structured PTY commands are relevant to the assertion. */ }
          server.send(message);
        });
        server.onMessage(message => client.send(message));
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/canvas?workspace=${a.id}`);
      const aNode = page.locator(`.svelte-flow__node[data-id="${a.terminalId}"]`);
      await expect(aNode.locator('.xterm-helper-textarea')).toBeAttached();
      await expect.poll(() => sessionId(request, a)).toBeTruthy();
      const realSession = (await sessionId(request, a))!;
      await expect.poll(() => createsForA).toBe(1);
      expect(strippedResponses).toBeGreaterThan(0);
      await aNode.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('validated-session-marker'); await page.keyboard.press('Enter');
      await expect(aNode.locator('.xterm-rows')).toContainText('validated-session-marker');
      await openWorkspace(page, b.name);
      await page.waitForURL(url => url.searchParams.get('workspace') === b.id);
      const attachmentsBeforeReturn = attachedSessions.filter(id => id === realSession).length;
      gate = await holdNextLoad(page, a.id);
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === nodesPath
        && response.request().method() === 'GET' && response.ok());
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agent-room/workspaces/${a.id}/load`
        && response.request().method() === 'POST' && response.ok());
      void refreshed.catch(() => {}); void loaded.catch(() => {});
      await page.locator('.ws-tab-main').filter({ hasText: a.name }).click();
      await expect.poll(() => gate!.state.entered, { timeout: 2000 }).toBe(true);
      await expect(page.locator('.ws-tab.active')).toContainText(a.name, { timeout: 2000 });
      await expect(page.locator(`.svelte-flow__node[data-id="${a.noteId}"] textarea`)).toHaveValue(`${a.name} retained briefing`, { timeout: 2000 });
      // Flush Svelte effects and browser frames while the network admission
      // remains closed; no fake timer or fixed sleep may admit a launch.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(gate.state.released).toBe(false);
      expect(createsForA).toBe(1);
      stripSession = false;
      gate.release(); await loaded;
      const fresh = await refreshed; await fresh.finished();
      await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
      await expect(aNode.locator('.xterm-helper-textarea')).toBeAttached();
      await expect.poll(() => attachedSessions.filter(id => id === realSession).length).toBeGreaterThan(attachmentsBeforeReturn);
      expect(createsForA).toBe(1);
      expect(await sessionId(request, a)).toBe(realSession);
      await expect(aNode.locator('.xterm-rows')).toContainText('validated-session-marker');
    } finally { await cleanup(page, request, fixtures, gate?.release); }
  });

  test('keeps workspace validation live when selecting a Floor during a pending warm load', async ({ page, request }) => {
    test.skip(process.platform === 'win32', 'This focused browser fixture uses literal /bin/cat; ConPTY has separate transport coverage.');
    test.setTimeout(60000);
    const fixtures: WorkspaceFixture[] = [];
    let gate: Awaited<ReturnType<typeof holdNextLoad>> | undefined;
    await mockProviders(page);
    try {
      const a = await workspace(request, 'Pending floor A'); fixtures.push(a);
      const b = await workspace(request, 'Pending floor B'); fixtures.push(b);
      const labels = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;
      const base = `/api/agent-room/workspaces/${a.id}`;
      const timestamp = new Date().toISOString();
      const floor = { id: randomUUID(), workspaceId: a.id, name: 'Pending validation floor', branch: 'fixture-floor',
        path: a.directory, status: 'active', baseCommit: null, baseKind: 'head', landedHead: null, createdAt: timestamp };
      const floorNote = { id: randomUUID(), workspaceId: a.id, floorId: floor.id, type: 'note', title: 'Floor validation note',
        x: 70, y: 110, width: 320, height: 240, zIndex: 0, payload: { content: 'Keep the selected Floor across validation.' },
        createdAt: timestamp, updatedAt: timestamp };
      const git = { branch: 'fixture', dirty: false, changedFiles: 0, ahead: 0, behind: 0,
        lastCommitAt: null, lastCommitTitle: null, available: false };
      // Floors and their note are display DTOs only. No Git repository,
      // worktree creation, shell hook or nonexistent floor working directory.
      await page.route(`**${base}/floors`, route => route.fulfill({ json: { data: [floor] } }));
      await page.route(`**${base}/floors/overview`, route => route.fulfill({ json: { data: {
        ground: { floor: null, floorId: null, agents: [], tasks: [], git },
        floors: [{ floor, floorId: floor.id, agents: [], tasks: [], git }],
      } } }));
      await page.route(`**${base}/nodes`, async route => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json();
        await route.fulfill({ response, json: { data: [...body.data, floorNote] } });
      });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/canvas?workspace=${a.id}`);
      await expect(page.locator(`.svelte-flow__node[data-id="${a.noteId}"]`)).toBeVisible();
      await openWorkspace(page, b.name);
      await page.waitForURL(url => url.searchParams.get('workspace') === b.id);
      // A new ground-floor shell exists only in the fresh snapshot. The old
      // cached board must never launch it, nor permanently close its gate.
      const created = await request.post(`${base}/nodes`, { data: {
        type: 'terminal', title: 'Validated ground shell', x: 440, y: 110, width: 620, height: 360,
        payload: { command: '/bin/cat', args: [] },
      } });
      expect(created.ok()).toBe(true);
      a.terminalId = (await created.json()).data.id;
      expect(await sessionId(request, a)).toBeNull();
      gate = await holdNextLoad(page, a.id);
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname === `${base}/load`
        && response.request().method() === 'POST' && response.ok());
      void loaded.catch(() => {});
      await page.locator('.ws-tab-main').filter({ hasText: a.name }).click();
      await expect.poll(() => gate!.state.entered, { timeout: 2000 }).toBe(true);
      await expect(page.locator('.ws-tab.active')).toContainText(a.name, { timeout: 2000 });
      await page.locator('.toolbar [data-tool-group-trigger]').filter({ hasText: 'Workspace' }).click();
      await page.getByRole('menuitem', { name: new RegExp(labels['canvas.label_floors']) }).click();
      const panel = page.locator('.side-panel');
      await panel.getByRole('article').filter({ hasText: floor.name }).getByRole('button', { name: new RegExp(floor.name) }).click();
      await expect(page.locator(`.svelte-flow__node[data-id="${floorNote.id}"] textarea`)).toHaveValue('Keep the selected Floor across validation.');
      await expect(page.locator(`.svelte-flow__node[data-id="${a.noteId}"]`)).toHaveCount(0);
      expect(gate.state.released).toBe(false);
      expect(await sessionId(request, a)).toBeNull();
      gate.release(); await loaded;
      await page.waitForURL(url => url.searchParams.get('workspace') === a.id);
      await expect(page.locator(`.svelte-flow__node[data-id="${floorNote.id}"]`)).toBeVisible();
      await panel.getByRole('article').filter({ hasText: labels['floor.ground'] })
        .getByRole('button', { name: new RegExp(labels['floor.ground']) }).click();
      const shell = page.locator(`.svelte-flow__node[data-id="${a.terminalId}"]`);
      await expect(shell.locator('.xterm-helper-textarea')).toBeAttached();
      await expect.poll(() => sessionId(request, a)).toBeTruthy();
      await page.locator('.svelte-flow__controls-fitview').click();
      await shell.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('floor-gate-open'); await page.keyboard.press('Enter');
      await expect(shell.locator('.xterm-rows')).toContainText('floor-gate-open');
    } finally { await cleanup(page, request, fixtures, gate?.release); }
  });
});
