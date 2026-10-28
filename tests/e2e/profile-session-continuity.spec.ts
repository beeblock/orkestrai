import { expect, test } from '@playwright/test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// A real production server, browser, PTY and filesystem; no paid provider calls.
test('switches Claude accounts in the canvas and resumes the exact conversation in both directions', async ({ page, request }) => {
  test.skip(process.platform === 'win32', 'POSIX PTY fixture; WSL paths are covered by service contracts.');
  test.setTimeout(90_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orkestrai-account-continuity-')));
  const home = resolve('test-runtime/home');
  const shim = join(home, '.local/bin/claude');
  const a = join(root, 'account-a'), b = join(root, 'account-b');
  const id = randomUUID(), project = join('projects', root.replace(/[^a-zA-Z0-9]/g, '-'));
  const transcript = (dir: string) => join(dir, project, `${id}.jsonl`);
  const profileIds: string[] = []; let workspaceId = '';
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  try {
    await Promise.all([mkdir(join(home, '.local/bin'), { recursive: true }), mkdir(join(a, project), { recursive: true }), mkdir(b)]);
    await writeFile(join(a, '.credentials.json'), 'fixture-a'); await writeFile(join(b, '.credentials.json'), 'fixture-b');
    await writeFile(transcript(a), JSON.stringify({ type: 'user', uuid: randomUUID(), isSidechain: false, sessionId: id, cwd: root,
      timestamp: new Date().toISOString(), message: { role: 'user', content: 'Retain CONTEXT_SENTINEL from the current delivery' } }) + '\n');
    // The fixture never invokes a provider. It proves which profile/history the resumed process reads.
    await writeFile(shim, `#!${process.execPath}\n` + String.raw`
import fs from 'node:fs'; import path from 'node:path'; import { randomUUID } from 'node:crypto';
if (process.argv.includes('--version')) { console.log('fixture-1.0'); process.exit(0); }
const args = process.argv.slice(2), i = args.indexOf('--resume');
const sid = i >= 0 ? args[i + 1] : args[args.indexOf('--session-id') + 1];
const root = process.env.CLAUDE_CONFIG_DIR;
const file = path.join(root, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'), sid + '.jsonl');
const history = fs.readFileSync(file, 'utf8');
process.stdout.write('\r\nACTIVE_ACCOUNT:' + path.basename(root) + ' CONTEXT:' + history.includes('CONTEXT_SENTINEL') + '\r\n❯ \r\n');
process.stdin.setRawMode?.(true); process.stdin.resume();
let line = '';
process.stdin.on('data', chunk => {
  for (const c of chunk.toString()) {
    if (c === '\r' || c === '\n') {
      const text = line.replace(/\x1b\[20[01]~/g, ''); line = '';
      if (!text) continue;
      fs.appendFileSync(file, JSON.stringify({ type: 'user', uuid: randomUUID(), sessionId: sid, isSidechain: false,
        cwd: process.cwd(), timestamp: new Date().toISOString(), message: { role: 'user', content: text } }) + '\n');
      process.stdout.write('\r\nSAVED:' + path.basename(root) + ':' + text + '\r\n❯ \r\n');
    } else if (c === '\u0003') process.exit(0); else line += c;
  }
});
` , { flag: 'wx' });
    await chmod(shim, 0o700);
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'en' } });
    async function profile(name: string, configDir: string) {
      const response = await request.post('/api/agent-room/provider-profiles', { data: { providerId: 'claude', name, configDir } });
      expect(response.ok(), await response.text()).toBe(true);
      const p = (await response.json()).data; profileIds.push(p.id); return p;
    }
    const pa = await profile('Continuity A', a), pb = await profile('Continuity B', b);
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Account continuity E2E', workingDir: root } })).json()).data;
    workspaceId = workspace.id;
    const nodesPath = `/api/agent-room/workspaces/${workspaceId}/nodes`;
    const response = await request.post(nodesPath, { data: { type: 'terminal', title: 'Continuity leader', x: 150, y: 150, width: 700, height: 500,
      payload: { provider: 'claude', command: 'claude', args: [], profileId: pa.id, agentSessionId: id, maestro: true,
        env: { PATH: `${join(home, '.local/bin')}:${process.env.PATH}` } } } });
    expect(response.ok(), await response.text()).toBe(true);
    const node = (await response.json()).data;
    await page.goto(`/canvas?workspace=${workspaceId}`);
    await expect(page.locator('.xterm-screen')).toContainText('ACTIVE_ACCOUNT:account-a CONTEXT:true', { timeout: 30_000 });
    await page.getByTestId('terminal-actions-menu').click();
    const switchAccount = page.getByRole('menuitem', { name: /Switch account|Switch profile/ });
    await switchAccount.hover();
    await expect(page.getByText(/Keeps the saved conversation/)).toBeVisible();
    await page.getByRole('menuitemradio', { name: 'Continuity B', exact: true }).click();
    await expect(page.locator('.xterm-screen')).toContainText('ACTIVE_ACCOUNT:account-b CONTEXT:true', { timeout: 30_000 });
    const saved = (await (await request.get(nodesPath)).json()).data.find((n: { id: string }) => n.id === node.id);
    expect(saved.payload).toMatchObject({ profileId: pb.id, agentSessionId: id });
    expect(await readFile(transcript(b), 'utf8')).toBe(await readFile(transcript(a), 'utf8'));
    // An advanced B history must be copied back, not replaced by A's older prefix.
    await page.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('FOLLOW_UP_SENTINEL'); await page.keyboard.press('Enter');
    await expect.poll(() => readFile(transcript(b), 'utf8')).toContain('FOLLOW_UP_SENTINEL');
    const back = await request.put(`${nodesPath}/${node.id}/provider`, { data: { provider: 'claude', profileId: pa.id } });
    expect(back.ok(), await back.text()).toBe(true);
    await expect.poll(() => readFile(transcript(a), 'utf8')).toContain('FOLLOW_UP_SENTINEL');
    expect(await readFile(join(a, '.credentials.json'), 'utf8')).toBe('fixture-a');
    expect(await readFile(join(b, '.credentials.json'), 'utf8')).toBe('fixture-b');
  } finally {
    await page.goto('about:blank');
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    for (const profileId of profileIds) await request.delete(`/api/agent-room/provider-profiles/${profileId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(shim, { force: true }); await rm(root, { recursive: true, force: true });
  }
});
