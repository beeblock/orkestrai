import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const labels = JSON.parse(await readFile(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;

test('create a native bot, collaborate in a group and keep the development conversation separate', async ({ page, request }) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-bots-browser-'));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Personal bots browser QA', workingDir: root } });
  expect(created.ok(), await created.text()).toBe(true);
  const workspace = (await created.json()).data, base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    await page.route(`**${base}/bots?providerId=*`, route => route.fulfill({ json: { data: { installed: true, models: [{ value: 'fixture-model', label: 'Fixture model' }], efforts: ['low', 'medium', 'high'] } } }));
    const developer = await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Existing developer', payload: { provider: 'codex', maestro: true, command: '/bin/cat', args: [] } } });
    expect(developer.ok()).toBe(true);
    await page.goto(`/bots?workspace=${workspace.id}`);
    await expect(page.getByTestId('bots-mode')).toBeVisible();
    await page.getByRole('button', { name: labels['bots.create'], exact: true }).first().click();
    const editor = page.getByTestId('bot-editor');
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
