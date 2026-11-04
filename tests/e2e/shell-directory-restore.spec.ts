import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const mode of ['canvas', 'terminal']) test(`${mode}: persists OSC 9 cwd and restores the next Shell process there`, async ({ page, request }) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'orkestrai-shell-location-')));
  const child = join(root, 'work folder'); await mkdir(child);
  const marker = join(root, 'launched.json'); const script = join(root, 'shell.mjs');
  await writeFile(script, `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(marker)},JSON.stringify({cwd:process.cwd()}));process.stdout.write('\\x1b]9;9;'+${JSON.stringify(child)}+'\\x07');process.stdin.resume();`);
  let workspaceId: string | undefined;
  try {
    const response = await request.post('/api/agent-room/workspaces', { data: { name: `Shell cwd ${mode}`, workingDir: root, codeIntelligenceMode: 'disabled' } });
    expect(response.ok()).toBeTruthy();workspaceId = (await response.json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const created = await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Directory fixture', x: 50, y: 60, width: 600, height: 400, payload: { command: process.execPath, args: [script] } } });
    expect(created.ok()).toBeTruthy();const node = (await created.json()).data;
    const url = `/${mode}?workspace=${workspaceId}&node=${node.id}`;
    await page.goto(url);
    const get = async () => (await (await request.get(`${base}/nodes/${node.id}`)).json()).data;
    await expect.poll(async () => (await get()).payload.currentWorkingDir).toBe(child);
    const saved = await get();expect(saved.payload.sessionId).toBeTruthy();
    await page.goto('/settings');
    await page.evaluate(sessionId => new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/agent-room/pty`);
      const timer = setTimeout(() => {socket.close();reject(new Error('PTY kill timed out'));},5000);
      socket.onopen = () => socket.send(JSON.stringify({type:'kill',sessionId}));
      socket.onmessage = event => {if(JSON.parse(event.data).type==='killed'){clearTimeout(timer);socket.close();resolve();}};
    }), saved.payload.sessionId);
    const patch = await request.patch(`${base}/nodes/${node.id}`, { data: { payload: { ...saved.payload, sessionId: null } } });expect(patch.ok()).toBeTruthy();
    await page.goto(url);
    await expect.poll(async () => { const fs = await import('node:fs/promises'); return JSON.parse(await fs.readFile(marker,'utf8')).cwd; }).toBe(child);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await rm(root,{recursive:true,force:true});
  }
});
