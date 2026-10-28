import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import WebSocket from 'ws';

test('confirms a missed automatic native Claude paste without retyping its text', async ({ request }) => {
  test.skip(process.platform === 'win32', 'ConPTY has its separate submit retry policy.');
  test.setTimeout(45_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-paste-submit-'));
  const script = join(root, 'claude-fixture.mjs');
  const state = join(root, 'submissions.json');
  const conversation = crypto.randomUUID();
  const marker = `recover-existing-paste-${crypto.randomUUID()}`;
  await writeFile(script, String.raw`
    import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { homedir } from 'node:os';
    const directory=join(homedir(),'.claude','projects',process.cwd().replace(/[^a-zA-Z0-9]/g,'-'));
    mkdirSync(directory,{recursive:true});
    const transcript=join(directory,process.argv[2]+'.jsonl'), state=join(process.cwd(),'submissions.json');
    const old=new Date(Date.now()-60000).toISOString();
    const record=event=>appendFileSync(transcript,JSON.stringify(event)+'\n');
    record({type:'user',timestamp:old,message:{content:'Previous task'}});
    record({type:'api-request',timestamp:old});
    record({type:'assistant',timestamp:old,message:{stop_reason:'end_turn',content:[{type:'text',text:'Previous task completed.'}]}});
    record({type:'system',subtype:'turn_duration',timestamp:old});
    let stream='',draft='',missed=false,enters=0;const accepted=[];
    const save=()=>writeFileSync(state,JSON.stringify({enters,accepted}));
    const paint=text=>process.stdout.write('\x1b[2J\x1b[H❯ '+text+'\r\nbypass permissions on');
    process.stdin.setRawMode(true);process.stdin.resume();save();
    process.stdout.write('\x1b[?2004h');paint('');
    process.stdin.on('data',data=>{
      stream+=data.toString();
      while(stream.length){
        if(stream[0]==='\x1b'){if(stream.length<6)return;stream=stream.slice(6);continue;}
        const char=stream[0];stream=stream.slice(1);
        if(char!=='\r'&&char!=='\n'){draft+=char;continue;}
        enters++;
        if(!missed){missed=true;paint('[Pasted text #1]');save();continue;}
        if(draft){
          const now=new Date().toISOString();accepted.push(draft);
          record({type:'user',timestamp:now,message:{content:draft}});
          record({type:'api-request',timestamp:now});
          record({type:'assistant',timestamp:now,message:{stop_reason:'end_turn',content:[{type:'text',text:'Accepted the existing automatic paste.'}]}});
          record({type:'system',subtype:'turn_duration',timestamp:now});draft='';
        }
        paint('');save();
      }
    });
  `);
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Automatic paste recovery', workingDir: root, codeIntelligenceMode: 'manual' } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const node = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Paste receiver', payload: { provider: 'claude', command: process.execPath, args: [script, conversation], maestro: false, agentSessionId: conversation } } })).json()).data;
    const sessionId = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Fixture PTY creation timed out')), 10_000);
      socket.on('message', raw => { const frame = JSON.parse(raw.toString()); if (frame.type === 'created' && frame.session.nodeId === node.id) { clearTimeout(timer); resolve(frame.session.id); } });
      socket.send(JSON.stringify({ type: 'create', command: process.execPath, args: [script, conversation], conversationArgs: [script, conversation], agentSessionId: conversation, provider: 'claude', cwd: root, workspaceId: workspace.id, workspaceRoot: root, nodeId: node.id, stream: false }));
    });
    expect((await request.patch(`${base}/nodes/${node.id}`, { data: { payload: { ...node.payload, sessionId, agentSessionId: conversation } } })).ok()).toBe(true);
    expect((await request.post(`${base}/channels/${encodeURIComponent(`dm:${node.id}`)}/messages`, { data: { body: marker } })).ok()).toBe(true);
    const readState = async (): Promise<{ enters: number; accepted: string[] }> => {
      try { return JSON.parse(await readFile(state, 'utf8')); }
      catch { return { enters: 0, accepted: [] }; }
    };
    await expect.poll(async () => (await readState()).enters, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => {
      return (await readState()).accepted.filter(text => text.includes(marker)).length;
    }, { timeout: 18_000 }).toBe(1);
    const saved = await readState();
    expect(saved.enters).toBe(2);
    expect(saved.accepted).toHaveLength(1);
  } finally { socket.close(); await request.delete(base); await rm(root, { recursive: true, force: true }); }
});

test('restores busy terminal views promptly across SPA Chat/Canvas switches without accumulating renderer heaps', async ({ page, request }) => {
  test.skip(process.platform === 'win32', 'Native Windows transport and Portal lifecycle run in the Windows CI job.');
  test.setTimeout(180_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-spa-terminal-'));
  const script = join(root, 'tui.mjs');
  await writeFile(script, `
    const id=process.argv[2];let frame=0,last='',draft='';
    process.stdin.setRawMode(true);process.stdin.resume();
    process.stdout.write('\\x1b[?1049h'+('retained TUI history\\r\\n'.repeat(18000)));
    const render=()=>process.stdout.write('\\x1b[2J\\x1b[HFRAME-'+id+'-'+(++frame)+'\\r\\n'+last);
    process.stdin.on('data',data=>{for(const char of data.toString()){if(char==='\\r'||char==='\\n'){last=draft;draft='';render();}else draft+=char;}});
    render();setInterval(render,25);
  `);
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: 'E2E SPA terminal lifecycle', workingDir: root, codeIntelligenceMode: 'manual' },
  })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const socket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const terminals = [];
    for (let i = 0; i < 8; i++) {
      const node = (await (await request.post(`${base}/nodes`, { data: {
        type: 'terminal', title: `Lifecycle TUI ${i}`, x: 80 + (i % 4) * 700, y: 80 + Math.floor(i / 4) * 450,
        width: 640, height: 380, payload: { command: process.execPath, args: [script, String(i)] },
      } })).json()).data;
      const sessionId = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Fixture PTY creation timed out')); }, 10_000);
        const receive = (raw: WebSocket.RawData) => {
          const frame = JSON.parse(raw.toString());
          if (frame.type === 'created' && frame.session.nodeId === node.id) {
            clearTimeout(timer); socket.off('message', receive); resolve(frame.session.id);
          }
        };
        socket.on('message', receive);
        socket.send(JSON.stringify({ type: 'create', command: process.execPath, args: [script, String(i)], cwd: root,
          workspaceId: workspace.id, workspaceRoot: root, nodeId: node.id, cols: 100, rows: 30, stream: false }));
      });
      await request.patch(`${base}/nodes/${node.id}`, { data: { payload: { ...node.payload, sessionId } } });
      terminals.push({ ...node, sessionId });
    }
    const current = terminals[0];
    await page.goto(`/canvas?workspace=${workspace.id}&node=${current.id}`);
    const terminal = page.locator(`.svelte-flow__node[data-id="${current.id}"]`);
    await expect(terminal.locator('.xterm-rows')).toContainText('FRAME-0-', { timeout: 15_000 });
    const realm = await page.evaluate(() => ((window as any).__lifecycleRealm = crypto.randomUUID()));
    await page.getByRole('link', { name: 'Conversa', exact: true }).click();
    await expect(page).toHaveURL(/\/chat/);
    await page.getByRole('link', { name: 'Canvas', exact: true }).click();
    await expect(terminal.locator('.xterm-rows')).toContainText('FRAME-0-');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const before = await cdp.send('Runtime.getHeapUsage');
    const latencies: number[] = [];
    const heaps: number[] = [];
    // A warm board must paint even while list revalidation is slow.
    await page.route('**/api/agent-room/workspaces', async route => {
      if (route.request().method() === 'GET') await new Promise(resolve => setTimeout(resolve, 3000));
      await route.continue();
    });
    for (let round = 0; round < 36; round++) {
      await page.getByRole('link', { name: 'Conversa', exact: true }).click();
      await expect(page).toHaveURL(/\/chat/);
      const start = performance.now();
      await page.getByRole('link', { name: 'Canvas', exact: true }).click();
      await expect(terminal.locator('.xterm-rows')).toContainText('FRAME-0-', { timeout: 2000 });
      latencies.push(performance.now() - start);
      const marker = `owner-${round}-works`;
      await terminal.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type(marker); await page.keyboard.press('Enter');
      await expect(terminal.locator('.xterm-rows')).toContainText(marker, { timeout: 2000 });
      expect(await page.evaluate(() => (window as any).__lifecycleRealm)).toBe(realm);
      const nodes = (await (await request.get(`${base}/nodes`)).json()).data;
      for (const expected of terminals) expect(nodes.find((node: any) => node.id === expected.id).payload.sessionId).toBe(expected.sessionId);
      if ((round + 1) % 12 === 0) {
        await cdp.send('HeapProfiler.collectGarbage');
        heaps.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
      }
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const after = await cdp.send('Runtime.getHeapUsage');
    expect(after.usedSize - before.usedSize).toBeLessThan(40 * 1024 * 1024);
    expect(heaps[2] - heaps[1], 'Retained heaps must plateau after navigation warmup').toBeLessThan(8 * 1024 * 1024);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({ spaCanvasLifecycle: 'passed', terminals: 8, switches: 36,
      maxFirstPaintMs: Math.round(Math.max(...latencies)), heapBefore: before.usedSize, heaps, heapAfter: after.usedSize }));
  } finally {
    await page.goto('about:blank'); socket.close();
    await request.delete(base); await rm(root, { recursive: true, force: true });
  }
});
