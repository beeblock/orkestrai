import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const labels = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;

test('reuses one linked account for two bots in a group and edits their reply rules', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-group-ui-'));
  const response = await request.post('/api/agent-room/workspaces', { data: { name: 'WhatsApp group UI', workingDir: root } });
  expect(response.ok()).toBe(true);
  const workspace = (await response.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  const accountId = '00000000-0000-7000-8000-000000000001', group = '55119999999-12345@g.us';
  const bindings: any[] = [], ruleUpdates: any[] = [];
  let linkedAgain = false;
  try {
    const bots = [];
    for (const title of ['Vendas', 'Suporte']) {
      const result = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title, provider: 'codex', instructions: 'UI test only' } } });
      expect(result.ok()).toBe(true); bots.push((await result.json()).data);
    }
    // The linked phone is mocked. Real dispatch, persistence and conflict
    // detection are exercised with SQLite in whatsapp-group-routing.test.ts.
    await page.route(`**${base}/bots?connections=1`, route => route.fulfill({ json: { data: [{ id: accountId, name: 'Shared account', state: 'connected', enabled: true, error: null, chats: [{ id: group, name: 'Equipe' }] }] } }));
    await page.route(`**${base}/bots?connectionId=*`, route => route.fulfill({ json: { data: { state: 'connected', qr: null, error: null } } }));
    await page.route(`**${base}/bots`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      const input = route.request().postDataJSON();
      if (input.command === 'whatsapp_start') { linkedAgain = true; return route.abort(); }
      if (input.command !== 'connect') return route.continue();
      const binding = { ...input.binding, id: `00000000-0000-7000-8000-00000000000${bindings.length + 2}`, workspaceId: workspace.id, kind: 'whatsapp', enabled: true, lastError: null, lastInboundAt: null, createdAt: new Date().toISOString() };
      bindings.push(binding); return route.fulfill({ json: { data: binding } });
    });
    await page.route(`**${base}/channel-bindings?*`, route => {
      const nodeId = new URL(route.request().url()).searchParams.get('nodeId');
      return route.fulfill({ json: { data: bindings.filter(binding => binding.nodeId === nodeId) } });
    });
    await page.route(`**${base}/channel-bindings/*`, route => {
      const id = route.request().url().split('/').at(-1), input = route.request().postDataJSON();
      const binding = bindings.find(item => item.id === id);
      ruleUpdates.push(input);
      if (bindings.some(other => other.id !== id && other.replyPrefixes.some((prefix: string) => input.replyPrefixes?.includes(prefix)))) {
        return route.fulfill({ status: 400, json: { error: 'BOT_ROUTE_CONFLICT' } });
      }
      Object.assign(binding, input); return route.fulfill({ json: { data: binding } });
    });
    await page.goto(`/bots?workspace=${workspace.id}`);
    const profile = page.locator('.bot-profile');
    for (const bot of bots) {
      await page.locator('.bot-row').filter({ hasText: bot.title }).click();
      const whatsapp = profile.getByTestId('bot-whatsapp');
      await expect(whatsapp.getByRole('combobox', { name: labels['bots.whatsapp_account'], exact: true })).toContainText('Shared account');
      await whatsapp.getByRole('combobox', { name: labels['bots.whatsapp_chat'], exact: true }).click();
      await page.getByRole('option', { name: `Equipe · ${labels['bots.whatsapp_group']}`, exact: true }).click();
      const refresh = page.waitForResponse(response => response.url().endsWith(`${base}/bots`) && response.request().method() === 'GET');
      await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Independent Canvas update', payload: { content: 'This update must preserve the route draft.' } } });
      await refresh;
      await expect(whatsapp.getByRole('textbox', { name: labels['bots.whatsapp_chat_id'], exact: true })).toHaveValue(group);
      await expect(whatsapp.getByRole('textbox', { name: labels['bots.prefixes'], exact: true })).toHaveValue(`@${bot.title}`);
      await whatsapp.getByRole('textbox', { name: labels['bots.prefixes'], exact: true }).fill(', ,');
      await expect(whatsapp.getByRole('button', { name: labels['bots.connect'], exact: true })).toBeDisabled();
      await whatsapp.getByRole('textbox', { name: labels['bots.prefixes'], exact: true }).fill(`@${bot.title}`);
      await whatsapp.getByRole('button', { name: labels['bots.connect'], exact: true }).click();
      await expect(profile.getByRole('button', { name: labels['bots.edit_route'], exact: true })).toBeVisible();
    }
    expect(linkedAgain).toBe(false);
    expect(bindings.map(binding => [binding.nodeId, binding.integrationId, binding.externalChatId, binding.replyPrefixes])).toEqual([
      [bots[0].id, accountId, group, ['@Vendas']], [bots[1].id, accountId, group, ['@Suporte']],
    ]);
    await page.locator('.bot-row').filter({ hasText: 'Vendas' }).click();
    await profile.getByRole('button', { name: labels['bots.edit_route'], exact: true }).click();
    const editor = profile.getByRole('form', { name: labels['bots.edit_route'], exact: true });
    await editor.getByRole('textbox', { name: labels['bots.prefixes'], exact: true }).fill('@Suporte');
    await editor.getByRole('button', { name: labels['bots.save'], exact: true }).click();
    await expect(page.getByText(labels['bots.route_conflict'], { exact: true })).toBeVisible();
    await editor.getByRole('textbox', { name: labels['bots.prefixes'], exact: true }).fill('@Comercial');
    await editor.getByRole('button', { name: labels['bots.save'], exact: true }).click();
    await expect(editor).not.toBeVisible();
    expect(bindings[0].replyPrefixes).toEqual(['@Comercial']);
    expect(bindings[1].replyPrefixes).toEqual(['@Suporte']);
    expect(ruleUpdates).toHaveLength(2);
    for (const update of ruleUpdates) expect(update).not.toHaveProperty('enabled');
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('retries a failed WhatsApp link in place and refreshes its QR without recreating the account', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-qr-ui-'));
  const response = await request.post('/api/agent-room/workspaces', { data: { name: 'QR retry UI', workingDir: root } });
  expect(response.ok()).toBe(true);
  const workspace = (await response.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  const accountId = '00000000-0000-7000-8000-000000000001';
  let phase: 'error' | 'qr' | 'connected' = 'error';
  const reconnects: any[] = [], created: any[] = [];
  const qr = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1kAAAAASUVORK5CYII=';
  try {
    const result = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'QR Bot', provider: 'codex', instructions: 'UI only; no model calls' } } });
    expect(result.ok()).toBe(true);
    await page.route(`**${base}/bots?connections=1`, route => route.fulfill({ json: { data: [{ id: accountId, name: 'Existing phone', enabled: true, state: phase, error: phase === 'error' ? 'WHATSAPP_PASSKEY_REQUIRED' : null, chats: [] }] } }));
    await page.route(`**${base}/bots?connectionId=*`, route => route.fulfill({ json: { data: { state: phase, qr: phase === 'qr' ? qr : null, error: phase === 'error' ? 'WHATSAPP_PASSKEY_REQUIRED' : null } } }));
    await page.route(`**${base}/bots`, route => {
      if (route.request().method() !== 'POST') return route.continue();
      const input = route.request().postDataJSON();
      if (input.command === 'whatsapp_start') { created.push(input); return route.abort(); }
      if (input.command !== 'whatsapp_reconnect') return route.continue();
      reconnects.push(input); phase = reconnects.length === 1 ? 'qr' : 'connected';
      return route.fulfill({ json: { data: { id: accountId } } });
    });
    await page.goto(`/bots?workspace=${workspace.id}`);
    await page.locator('.bot-row').filter({ hasText: 'QR Bot' }).click();
    const whatsapp = page.getByTestId('bot-whatsapp');
    await expect(whatsapp.getByRole('alert')).toHaveText(labels['bots.whatsapp_passkey_required']);
    await whatsapp.getByRole('button', { name: labels['chat.profile_memory_retry'], exact: true }).click();
    await expect(whatsapp.getByAltText(labels['bots.whatsapp_scan'])).toHaveAttribute('src', qr);
    await expect(whatsapp.getByRole('alert')).toHaveCount(0);
    await whatsapp.getByRole('button', { name: labels['bots.whatsapp_new_qr'], exact: true }).click();
    await expect(whatsapp.getByRole('status')).toHaveText(labels['bots.connected']);
    await expect(whatsapp.getByAltText(labels['bots.whatsapp_scan'])).toHaveCount(0);
    expect(reconnects).toEqual([{ command: 'whatsapp_reconnect', connectionId: accountId }, { command: 'whatsapp_reconnect', connectionId: accountId }]);
    expect(created).toHaveLength(0);
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});
