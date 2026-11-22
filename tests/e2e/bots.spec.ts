import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const labels = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;

test('repair a legacy file reply without starting a model', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'bot-files-ui-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'File repair', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const bot = (await (await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'File helper', provider: 'codex', instructions: 'Return reports.' } } })).json()).data;
    const sourceId = '01955555-1111-7111-8111-111111111111', oldId = '01955555-2222-7222-8222-222222222222';
    const old = { id: oldId, workspaceId: workspace.id, channel: `dm:${bot.id}`, authorKind: 'agent', authorNodeId: bot.id,
      kind: 'text', body: `[Report](<${root}/report.pdf>)`, replyToId: sourceId, answeredAt: null, createdAt: new Date().toISOString(), meta: { bindingId: '01955555-3333-7333-8333-333333333333' } };
    await page.route(`**/channels/dm*${bot.id}*/messages*`, route => route.fulfill({ json: { data: [old] } }));
    let repairs = 0, prompts = 0;
    await page.route(`**/workspaces/${workspace.id}/bots`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      expect(route.request().postDataJSON()).toEqual({ command: 'repair_artifact_delivery', nodeId: bot.id, messageId: old.id }); repairs++;
      (old.meta as Record<string, unknown>).artifactRepairQueued = true;
      return route.fulfill({ json: { data: { ...old, id: '01955555-4444-7444-8444-444444444444', body: '[Report](report.pdf)', meta: { artifacts: [] } } } });
    });
    page.on('request', req => { if (req.method() === 'POST' && req.url().includes('/messages')) prompts++; });
    await page.goto(`/bots?workspace=${workspace.id}`);
    await page.locator('.bot-row').filter({ hasText: 'File helper' }).click();
    const action = page.getByRole('button', { name: labels['bots.repair_files'], exact: true });
    await expect(action).toBeVisible(); await action.click();
    await expect(action).toHaveCount(0); expect(repairs).toBe(1); expect(prompts).toBe(0);
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('delete and clear bot history in two tabs without starting a model', async ({ page, request, context }) => {
  const root = await mkdtemp(join(tmpdir(), 'bot-history-browser-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'History browser', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const peer = await context.newPage();
  try {
    const botResponse = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'History helper', provider: 'codex', instructions: 'Return reports.' } } });
    expect(botResponse.ok(), await botResponse.text()).toBe(true);
    const { token } = JSON.parse(await readFile(join(root, '.orkestrai/workspace.json'), 'utf8'));
    const post = async (message: string) => {
      const response = await request.post('/api/agent-room/bridge/channel', { data: { token, from: 'History helper', message, channel: 'owner' } });
      expect(response.ok(), await response.text()).toBe(true);
    };
    await post('FIRST_TO_DELETE'); await post('KEEP_UNTIL_CLEAR');
    for (const tab of [page, peer]) {
      await tab.goto(`/bots?workspace=${workspace.id}`);
      await tab.locator('.bot-row').filter({ hasText: 'History helper' }).click();
      await expect(tab.getByTestId('agent-chat-face').getByText('FIRST_TO_DELETE', { exact: true })).toBeVisible();
    }
    await page.getByTestId('agent-chat-face').locator('.bubble').filter({ hasText: 'FIRST_TO_DELETE' }).getByRole('button', { name: labels['bots.history_delete'], exact: true }).click();
    const dialog = page.getByRole('alertdialog'); await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: labels['bots.history_delete'], exact: true }).click();
    for (const tab of [page, peer]) {
      await expect(tab.getByTestId('agent-chat-face').getByText('FIRST_TO_DELETE', { exact: true })).toHaveCount(0);
      await expect(tab.getByTestId('agent-chat-face').getByText('KEEP_UNTIL_CLEAR', { exact: true })).toBeVisible();
    }
    await page.getByTestId('agent-chat-face').getByRole('button', { name: labels['bots.history_clear'], exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: labels['bots.history_clear'], exact: true }).click();
    for (const tab of [page, peer]) await expect(tab.getByTestId('agent-chat-face').getByText('KEEP_UNTIL_CLEAR', { exact: true })).toHaveCount(0);
    await post('NEW_AFTER_CLEAR');
    for (const tab of [page, peer]) await expect(tab.getByTestId('agent-chat-face').getByText('NEW_AFTER_CLEAR', { exact: true })).toBeVisible();
  } finally { await peer.close(); await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('create a native bot, collaborate in a group and keep the development conversation separate', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bots-browser-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Personal bots browser QA', workingDir: root } });
  expect(created.ok(), await created.text()).toBe(true);
  const workspace = (await created.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    let metadataRequests = 0;
    await page.route(`**${base}/bots?providerId=*`, route => {
      metadataRequests++;
      return route.fulfill({ json: { data: { installed: true, models: [{ value: 'fixture-model', label: 'Fixture model' }], efforts: ['low', 'medium', 'high'] } } });
    });
    const developer = await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Existing developer', payload: { provider: 'codex', maestro: true, command: '/bin/cat', args: [] } } });
    expect(developer.ok()).toBe(true);
    await page.goto(`/bots?workspace=${workspace.id}`);
    await expect(page.getByTestId('bots-mode')).toBeVisible();
    await page.getByRole('button', { name: labels['bots.create'], exact: true }).first().click();
    const editor = page.getByTestId('bot-editor');
    await expect(editor.getByRole('combobox', { name: labels['bots.effort'], exact: true })).toHaveCount(0);
    await editor.locator('input[name=title]').fill('Personal helper');
    await editor.locator('textarea[name=instructions]').fill('Help with reports. Keep conversations private.');
    const catalog = (await (await request.get(`${base}/bots`)).json()).data.providers;
    await editor.getByRole('combobox', { name: labels['bots.provider'], exact: true }).click();
    await page.getByRole('option', { name: catalog.find((item: any) => item.id === 'codex').displayName, exact: true }).click();
    await editor.getByRole('button', { name: labels['bots.save'], exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(page.locator('.chat-heading')).toContainText('Personal helper');
    await expect(page.locator('.bot-row').filter({ hasText: 'Personal helper' })).toContainText(labels['agent_runtime.sleeping']);
    await expect(page.locator('.bot-instructions')).toBeVisible();
    await expect(page.getByRole('button', { name: labels['chat.profile_close'], exact: true })).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Conversa', exact: true })).toHaveAttribute('href', `/chat?workspace=${workspace.id}`);
    const bot = (await (await request.get(`${base}/bots`)).json()).data.bots.find((item: any) => item.title === 'Personal helper');
    expect(bot.transport).toBe('structured');
    expect(bot.safety.publicInstructions).toContain('Help with reports. Keep conversations private.');
    expect(bot.safety.publicInstructions).toBe(bot.instructions);

    // The UI/backend runs the real native transport against an isolated local
    // JSON-RPC fixture: no owner credentials or provider inference is used.
    const bin = join(root, 'fixture-bin'); await mkdir(bin);
    await writeFile(join(root, 'report.pdf'), '%PDF-1.4 generated report');
    const executable = join(bin, 'codex');
    await writeFile(executable, `#!/usr/bin/env node
      import readline from 'node:readline'; import {randomUUID} from 'node:crypto';
      if(process.argv.includes('--version')){console.log('codex-cli 0.169.0');process.exit(0);}
      const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
      for await(const line of readline.createInterface({input:process.stdin})){
        const m=JSON.parse(line); if(!m.id)continue;
        if(m.method==='initialize')send({id:m.id,result:{}});
        else if(m.method==='thread/start'||m.method==='thread/resume')send({id:m.id,result:{thread:{id:m.params.threadId||randomUUID()}}});
        else if(m.method==='turn/start'){
          const turnId=randomUUID(),threadId=m.params.threadId;send({id:m.id,result:{turn:{id:turnId}}});
          send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',phase:'final_answer',text:'BOT_UI_GROUP_OK\\n\\n[Report](report.pdf)'}}});
          send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
        }else send({id:m.id,result:{}});
      }`);
    await chmod(executable, 0o755);
    const nodes = (await (await request.get(`${base}/nodes`)).json()).data;
    const stored = nodes.find((item: any) => item.id === bot.id);
    const patched = await request.patch(`${base}/nodes/${bot.id}`, { data: { payload: { ...stored.payload, env: { PATH: `${bin}:${process.env.PATH}` } } } });
    expect(patched.ok(), await patched.text()).toBe(true);
    const directChat = page.getByTestId('agent-chat-face');
    await directChat.getByRole('textbox').fill('Prepare my direct report.');
    await directChat.getByRole('button', { name: labels['composer.send'], exact: true }).click();
    await expect(directChat).toContainText('BOT_UI_GROUP_OK', { timeout: 20_000 });
    await expect(directChat.getByRole('link', { name: 'Report', exact: true })).toHaveAttribute('href', `${base}/fs/raw?path=report.pdf`);
    const beforeRename = (await (await request.get(`${base}/nodes`)).json()).data.find((item: any) => item.id === bot.id);
    expect(beforeRename.payload.sessionId).toBeTruthy();
    await page.getByRole('button', { name: labels['bots.edit'], exact: true }).click();
    await expect(editor.getByRole('button', { name: labels['bots.save'], exact: true })).toBeEnabled();
    const metadataBeforeRename = metadataRequests;
    await editor.locator('input[name=title]').fill('Personal helper renamed');
    const renameResponse = page.waitForResponse(response => response.url().endsWith(`${base}/bots`) && response.request().method() === 'POST', { timeout: 5000 });
    await editor.getByRole('button', { name: labels['bots.save'], exact: true }).click();
    const renamed = await renameResponse;
    expect(renamed.ok(), JSON.stringify({ submitted: renamed.request().postDataJSON(), response: await renamed.text() })).toBe(true);
    await expect(editor).not.toBeVisible();
    await expect(page.locator('.chat-heading')).toContainText('Personal helper renamed');
    expect(metadataRequests).toBe(metadataBeforeRename);
    const afterRename = (await (await request.get(`${base}/nodes`)).json()).data.find((item: any) => item.id === bot.id);
    expect(afterRename.payload).toEqual(beforeRename.payload);
    await expect(directChat).toContainText('BOT_UI_GROUP_OK');
    const peerResponse = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'Report reviewer', provider: 'codex', instructions: 'Review reports', transport: 'structured' } } });
    expect(peerResponse.ok(), await peerResponse.text()).toBe(true);
    await expect(page.locator('.bot-row').filter({ hasText: 'Report reviewer' })).toBeVisible();
    await page.getByRole('button', { name: labels['bots.create_group'], exact: true }).click();
    const groupEditor = page.getByRole('dialog');
    await groupEditor.getByLabel(labels['bots.name'], { exact: true }).fill('Reporting group');
    await groupEditor.locator('label').filter({ hasText: 'Personal helper' }).getByRole('checkbox').click();
    await groupEditor.locator('label').filter({ hasText: 'Report reviewer' }).getByRole('checkbox').click();
    await groupEditor.getByRole('button', { name: labels['bots.save'], exact: true }).click();
    await expect(groupEditor).not.toBeVisible();
    const groupChat = page.getByTestId('bot-group-chat');
    await groupChat.getByRole('textbox', { name: labels['bots.message'] }).fill('Prepare a concise report.');
    const background = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'Background helper', provider: 'codex', instructions: 'Keep drafts intact' } } });
    expect(background.ok(), await background.text()).toBe(true);
    await expect(page.locator('.bot-row').filter({ hasText: 'Background helper' })).toBeVisible();
    await expect(groupChat.getByRole('textbox', { name: labels['bots.message'] })).toHaveValue('Prepare a concise report.');
    await groupChat.getByRole('button', { name: labels['bots.send'], exact: true }).click();
    await expect(groupChat).toContainText('BOT_UI_GROUP_OK', { timeout: 20_000 });
    await expect(groupChat.getByText('BOT_UI_GROUP_OK', { exact: true })).toHaveCount(1);
    await page.reload(); await expect(page.getByTestId('bots-mode')).toBeVisible();
    await page.locator('.bot-row').filter({ hasText: 'Reporting group' }).click();
    await expect(page.getByTestId('bot-group-chat')).toContainText('BOT_UI_GROUP_OK');
    await page.getByRole('link', { name: 'Conversa', exact: true }).click();
    const channels = page.getByRole('navigation', { name: 'Canais e mensagens diretas' });
    await expect(channels).toContainText('Existing developer');
    await expect(channels).not.toContainText('Personal helper');
    await expect(channels).not.toContainText('Report reviewer');
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('bot groups keep attachments and expose the microphone separately from Send', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-group-files-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Bot attachments QA', workingDir: root } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const bot = (await (await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'File helper', provider: 'codex', instructions: 'Help with files' } } })).json()).data;
    const group = (await (await request.post(`${base}/bots`, { data: { command: 'group_create', settings: { title: 'File group', memberIds: [bot.id], coordinatorId: bot.id } } })).json()).data;
    let posted: any;
    await page.route(`**${base}/bots`, async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.command === 'group_send') {
        posted = route.request().postDataJSON(); return route.fulfill({ json: { data: { id: 'fixture-message' } } });
      }
      return route.continue();
    });
    await page.goto(`/bots?workspace=${workspace.id}`);
    await page.locator('.bot-row').filter({ hasText: 'File group' }).click();
    const chat = page.getByTestId('bot-group-chat');
    await chat.locator('input[type=file]').setInputFiles({ name: 'details.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    await expect(chat).toContainText('details.pdf');
    await expect(chat.getByRole('button', { name: labels['composer.voice_label'] })).toBeVisible();
    await chat.getByRole('textbox', { name: labels['bots.message'] }).fill('Read the PDF');
    await chat.getByRole('button', { name: labels['bots.send'], exact: true }).click();
    await expect.poll(() => posted?.attachments?.length).toBe(1);
    expect(posted.groupId).toBe(group.id); expect(posted.attachments[0].name).toBe('details.pdf');
    await expect(chat.getByRole('textbox', { name: labels['bots.message'] })).toHaveValue('');
    await expect(chat.getByRole('button', { name: labels['composer.voice_label'] })).toBeVisible();
  } finally { await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('bot channel setup stays inside the viewport and opens Telegram setup directly', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bot-setup-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Bot setup layout QA', workingDir: root } });
  expect(created.ok()).toBe(true);
  const workspace = (await created.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const bot = await request.post(`${base}/bots`, { data: { command: 'create', settings: { title: 'Setup helper', provider: 'codex', instructions: 'Help with support.', transport: 'structured' } } });
    expect(bot.ok(), await bot.text()).toBe(true);
    await page.goto(`/bots?workspace=${workspace.id}`);
    const profile = page.locator('.bot-profile');
    await expect(profile).toBeVisible();
    await profile.getByRole('button', { name: labels['bots.setup_title'].replace('{provider}', 'Telegram'), exact: true }).click();
    const setup = page.getByRole('dialog');
    await expect(setup.getByTestId('bot-channel-setup')).toContainText('BotFather');
    await expect(setup.getByRole('link', { name: labels['bots.setup_open_provider'].replace('{provider}', 'Telegram'), exact: true })).toHaveAttribute('href', 'https://t.me/BotFather');
    await expect(setup).toContainText(labels['integrations.credential']);
    await setup.getByRole('button', { name: labels['automation.cancel'], exact: true }).click();
    await expect(setup).not.toBeVisible();
    await page.evaluate(() => { (window as any).orkestraiDesktop = { saveAutomationSecret: async () => ({ stored: true }) }; });
    let connected: any = null;
    let submitted: any = null;
    await page.route(`**${base}/integrations`, async route => {
      if (route.request().method() === 'POST') {
        submitted = route.request().postDataJSON();
        connected = { ...submitted, id: '00000000-0000-7000-8000-000000000001', status: 'connected', error: null };
        return route.fulfill({ status: 201, json: { data: connected } });
      }
      const response = await route.fetch();
      const payload = await response.json();
      if (connected) payload.data.integrations.push(connected);
      return route.fulfill({ response, json: payload });
    });
    await page.route(`**${base}/bots`, route => route.request().method() === 'POST' && route.request().postDataJSON().command === 'channel_targets'
      ? route.fulfill({ json: { data: [{ id: '100001', name: 'Test owner' }] } }) : route.continue());
    await profile.getByRole('button', { name: labels['bots.setup_title'].replace('{provider}', 'Telegram'), exact: true }).click();
    await expect(setup.getByTestId('bot-channel-setup')).toBeVisible();
    await setup.locator('input[type=password]').fill('TEST_ONLY_NOT_A_REAL_TOKEN');
    await setup.getByRole('button', { name: labels['integrations.connect'], exact: true }).click();
    await expect(setup).not.toBeVisible();
    expect(submitted.permissions).toContain('telegram.read_updates');
    expect(submitted.permissions).toContain('telegram.send_message');
    expect(JSON.stringify(submitted)).not.toContain('TEST_ONLY_NOT_A_REAL_TOKEN');
    await expect(profile.getByRole('button', { name: labels['bots.find_chats'], exact: true })).toBeVisible();
    await profile.getByRole('combobox', { name: labels['always_on.chat'], exact: true }).click();
    await page.getByRole('option', { name: 'Test owner', exact: true }).click();
    await expect(profile.getByRole('textbox', { name: labels['always_on.chat'], exact: true })).toHaveValue('100001');
    await expect(profile.getByRole('textbox', { name: labels['bots.prefixes'], exact: true })).toHaveValue('@Setuphelper');
    for (const [width, height] of [[1280, 800], [960, 600], [560, 480]]) {
      await page.setViewportSize({ width, height });
      await profile.getByRole('button', { name: labels['bots.automations'], exact: true }).click();
      const dialog = page.getByTestId('bot-automations-dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      const panel = dialog.getByTestId('automation-workspace');
      const bounds = await panel.boundingBox();
      expect(bounds!.width).toBeGreaterThan(box!.width - 4);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(box!.x + box!.width + 1);
      for (const name of [labels['automation.integrations'], labels['autonomy.title'], labels['automation.overview']]) {
        await dialog.getByRole('tab', { name, exact: true }).click();
        await expect(dialog.getByRole('tablist').first().getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
      }
      await dialog.getByRole('button', { name: labels['ui.close'], exact: true }).click();
      await expect(dialog).not.toBeVisible();
    }
  } finally {
    await request.delete(base);
    await rm(root, { recursive: true, force: true });
  }
});
