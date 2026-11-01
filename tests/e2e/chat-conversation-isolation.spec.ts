import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function team(request: APIRequestContext, name: string) {
  const directory = await mkdtemp(join(tmpdir(), 'orkestrai-chat-scope-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name, workingDir: directory, codeIntelligenceMode: 'manual' } });
  expect(created.ok(), await created.text()).toBe(true);
  const workspace = (await created.json()).data as { id: string; name: string };
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  async function agent(title: string, provider: string, maestro = false) {
    const result = await request.post(`${base}/nodes`, { data: { type: 'terminal', title,
      payload: { provider, command: 'true', args: [], agentRuntimeMode: 'on_demand', maestro } } });
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).data as { id: string; title: string };
  }
  const previous = await agent('Claude Previous', 'claude', true);
  const next = await agent('Codex Successor', 'codex');
  async function promote() {
    const snapshot = (await (await request.get(`${base}/leadership`)).json()).data;
    const result = await request.post(`${base}/leadership`, { data: { command: 'configure', requestId: randomUUID(),
      expectedRevision: snapshot.configuration.revision, leaderNodeId: next.id, deputyNodeId: null } });
    expect(result.ok(), await result.text()).toBe(true);
  }
  const messagesUrl = (id: string) => `${base}/channels/${encodeURIComponent(`dm:${id}`)}/messages`;
  async function seed(id: string, body: string) {
    const result = await request.post(messagesUrl(id), { data: { body } });
    expect(result.ok(), await result.text()).toBe(true);
  }
  async function cleanup() { await request.delete(base); await rm(directory, { recursive: true, force: true }); }
  return { workspace, base, directory, previous, next, agent, promote, seed, messagesUrl, cleanup };
}

function direct(page: Page, title: string) {
  return page.getByRole('navigation', { name: 'Canais e mensagens diretas' }).locator('button.channel.dm').filter({ hasText: title });
}

async function delayedPost(page: Page, path: string, body: string, fail = false) {
  const arrived = deferred(), release = deferred(), finished = deferred();
  await page.route(`**${path}`, async route => {
    if (route.request().method() !== 'POST' || route.request().postDataJSON()?.body !== body) return route.continue();
    const response = fail ? null : await route.fetch();
    arrived.resolve();
    try {
      await release.promise;
      if (response) await route.fulfill({ response });
      else await route.fulfill({ status: 500, json: { error: 'Previous conversation send failed' } });
    } finally { finished.resolve(); }
  });
  return { arrived: arrived.promise, release: release.resolve, finished: finished.promise };
}

test('a delayed Codex send receipt never appears in the former leader conversation', async ({ page, request }) => {
  const t = await team(request, 'Delayed successor receipt');
  const body = 'Message intended only for the new Codex leader';
  const gate = await delayedPost(page, t.messagesUrl(t.next.id), body);
  try {
    await t.seed(t.previous.id, 'Previous leader history stays here');
    await t.promote();
    await page.goto(`/chat?workspace=${t.workspace.id}&channel=${encodeURIComponent(`dm:${t.next.id}`)}`);
    await expect(page.locator('.conversation-header .headline')).toHaveText(t.next.title);
    await page.locator('#chat-composer-input').fill(body);
    await page.locator('#chat-composer-input').press('Enter');
    await gate.arrived;
    await direct(page, t.previous.title).click();
    await expect(page.getByTestId('chat-message').filter({ hasText: 'Previous leader history stays here' })).toBeVisible();
    gate.release();
    await gate.finished;
    await expect(page.getByRole('button', { name: 'Mensagem de voz', exact: true })).toBeVisible();
    await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(0);
    const previousMessages = (await (await request.get(t.messagesUrl(t.previous.id))).json()).data;
    expect(previousMessages.some((message: { body: string }) => message.body === body)).toBe(false);
    const token = JSON.parse(await readFile(join(t.directory, '.orkestrai/workspace.json'), 'utf8')).token;
    const reply = await request.post('/api/agent-room/bridge/channel', { data: { token, from: t.next.title, message: 'Reply from the new leader' } });
    expect(reply.ok(), await reply.text()).toBe(true);
    await direct(page, t.next.title).click();
    await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
    await expect(page.getByTestId('chat-message').filter({ hasText: 'Reply from the new leader' })).toBeVisible();
  } finally { gate.release(); await t.cleanup(); }
});

test('leaving and returning to a conversation protects an identical new draft from the old receipt', async ({ page, request }) => {
  const t = await team(request, 'Round trip draft isolation');
  const body = 'An identical draft written after returning';
  const gate = await delayedPost(page, t.messagesUrl(t.next.id), body);
  try {
    await page.goto(`/chat?workspace=${t.workspace.id}&channel=${encodeURIComponent(`dm:${t.next.id}`)}`);
    const input = page.locator('#chat-composer-input');
    await expect(input).toBeEnabled();
    await input.fill(body); await input.press('Enter'); await gate.arrived;
    await direct(page, t.previous.title).click();
    await direct(page, t.next.title).click();
    await input.fill(body);
    gate.release(); await gate.finished;
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await expect(input).toHaveValue(body);
    await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(1);
  } finally { gate.release(); await t.cleanup(); }
});

test('a failed send from an old conversation cannot put an error on the current conversation', async ({ page, request }) => {
  const t = await team(request, 'Delayed send failure');
  const body = 'Fail only the original send';
  const gate = await delayedPost(page, t.messagesUrl(t.next.id), body, true);
  try {
    await page.goto(`/chat?workspace=${t.workspace.id}&channel=${encodeURIComponent(`dm:${t.next.id}`)}`);
    const input = page.locator('#chat-composer-input');
    await expect(input).toBeEnabled();
    await input.fill(body); await input.press('Enter'); await gate.arrived;
    await direct(page, t.previous.title).click();
    await input.fill('Current conversation draft');
    gate.release(); await gate.finished;
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await expect(page.locator('.send-error')).toHaveCount(0);
    await expect(input).toHaveValue('Current conversation draft');
  } finally { gate.release(); await t.cleanup(); }
});

test('a failed history read from the former leader cannot clear the new leader messages', async ({ page, request }) => {
  const t = await team(request, 'Delayed history failure');
  const arrived = deferred(), release = deferred(), finished = deferred();
  await page.route(`**${t.messagesUrl(t.previous.id)}?*`, async route => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.searchParams.has('questions')) return route.continue();
    arrived.resolve();
    try { await release.promise; await route.fulfill({ status: 500, json: { error: 'Old history failed' } }); }
    finally { finished.resolve(); }
  });
  try {
    await t.seed(t.next.id, 'New leader history must remain visible');
    await page.goto(`/chat?workspace=${t.workspace.id}&channel=${encodeURIComponent(`dm:${t.previous.id}`)}`);
    await arrived.promise;
    await direct(page, t.next.title).click();
    const message = page.getByTestId('chat-message').filter({ hasText: 'New leader history must remain visible' });
    await expect(message).toBeVisible();
    release.resolve(); await finished.promise;
    // A fresh, unrelated action gives the old fetch completion time to render.
    await page.locator('#chat-composer-input').fill('Keep the new history');
    await expect(message).toBeVisible();
  } finally { release.resolve(); await t.cleanup(); }
});

test('Chat follows leadership and new-agent changes live without reloading or moving an explicit direct conversation', async ({ page, request }) => {
  const t = await team(request, 'Live conversation leadership');
  try {
    await page.goto(`/chat?workspace=${t.workspace.id}`);
    await expect(page.locator('aside.profile h2')).toHaveText(t.previous.title);
    await t.promote();
    await expect(page.locator('aside.profile h2')).toHaveText(t.next.title);
    await expect(page.locator('#chat-composer-input')).toHaveAttribute('placeholder', new RegExp(t.next.title));
    const specialist = await t.agent('New specialist', 'codex');
    await expect(direct(page, specialist.title)).toBeVisible();
    await direct(page, t.previous.title).click();
    const snapshot = (await (await request.get(`${t.base}/leadership`)).json()).data;
    const demote = await request.post(`${t.base}/leadership`, { data: { command: 'configure', requestId: randomUUID(),
      expectedRevision: snapshot.configuration.revision, leaderNodeId: t.next.id, deputyNodeId: t.previous.id } });
    expect(demote.ok(), await demote.text()).toBe(true);
    await expect(direct(page, t.previous.title)).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('.conversation-header .headline')).toHaveText(t.previous.title);
  } finally { await t.cleanup(); }
});

test('a delayed send cannot enter another workspace or clear its draft', async ({ page, request }) => {
  const source = await team(request, 'Source workspace scope');
  const destination = await team(request, 'Destination workspace scope');
  const body = 'Send belongs to the source workspace';
  const gate = await delayedPost(page, source.messagesUrl(source.next.id), body);
  try {
    await page.goto(`/chat?workspace=${source.workspace.id}&channel=${encodeURIComponent(`dm:${source.next.id}`)}`);
    const input = page.locator('#chat-composer-input');
    await expect(input).toBeEnabled();
    await input.fill(body); await input.press('Enter'); await gate.arrived;
    await page.getByTestId('workspace-switcher').click();
    await page.getByRole('menuitem').filter({ hasText: destination.workspace.name }).click();
    await expect(page).toHaveURL(new RegExp(destination.workspace.id));
    await input.fill(body);
    gate.release(); await gate.finished;
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    await expect(page.getByTestId('chat-message').filter({ hasText: body })).toHaveCount(0);
    await expect(input).toHaveValue(body);
  } finally { gate.release(); await source.cleanup(); await destination.cleanup(); }
});

test('an older workspace snapshot cannot restore the former leader or discard pending workspace details', async ({ page, request }) => {
  const t = await team(request, 'Out of order leadership metadata');
  const arrived = deferred(), release = deferred();
  let promoted = false;
  let nodeReads = 0;
  await page.route(`**${t.base}/nodes`, async route => {
    if (route.request().method() !== 'GET') return route.continue();
    nodeReads += 1;
    const old = !promoted;
    const response = await route.fetch();
    if (old) { arrived.resolve(); await release.promise; }
    await route.fulfill({ response });
  });
  await page.route(`**${t.base}/channel-bindings`, route => route.fulfill({ json: { data: [{ id: randomUUID(), enabled: true, kind: 'telegram' }] } }));
  try {
    await page.goto(`/chat?workspace=${t.workspace.id}`);
    await arrived.promise;
    promoted = true;
    await t.promote();
    await expect(page.locator('aside.profile h2')).toHaveText(t.next.title);
    release.resolve();
    await expect(page.locator('.also-on')).toContainText('Telegram');
    await expect(page.locator('aside.profile h2')).toHaveText(t.next.title);
    const readsBeforeMessages = nodeReads;
    const token = JSON.parse(await readFile(join(t.directory, '.orkestrai/workspace.json'), 'utf8')).token;
    for (let index = 0; index < 3; index++) {
      const posted = await request.post('/api/agent-room/bridge/channel', { data: { token, from: t.next.title, channel: 'team', message: `Live reply ${index}` } });
      expect(posted.ok(), await posted.text()).toBe(true);
    }
    await expect(page.getByTestId('chat-message').filter({ hasText: 'Live reply 2' })).toBeVisible();
    expect(nodeReads).toBe(readsBeforeMessages);
  } finally { release.resolve(); await t.cleanup(); }
});
