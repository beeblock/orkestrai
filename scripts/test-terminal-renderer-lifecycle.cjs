const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const assert = require('node:assert/strict');

const profile = process.env.ORKESTRAI_TEST_USER_DATA ?? mkdtempSync(join(tmpdir(), 'orkestrai-terminal-renderer-'));
app.setPath('userData', profile);
let window, server;
const watchdog = setTimeout(() => finish(1, new Error('Terminal renderer lifecycle timed out')), 120_000);
let ending = false;
async function finish(code, error) {
  if (ending) return;
  ending = true;
  clearTimeout(watchdog);
  if (error) console.error(error);
  try {
    window?.destroy(); server?.close();
    if (!process.env.ORKESTRAI_TEST_USER_DATA) rmSync(profile, { recursive: true, force: true });
  } catch (cleanupError) { console.error(cleanupError); code = 1; }
  finally { app.exit(code); }
}

const html = String.raw`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/xterm.css">
<style>body{margin:0;background:#111}.grid{display:grid;grid-template-columns:640px 640px}.term{height:240px}</style>
<script src="/xterm.js"></script><div class="grid" id="root"></div>
<script type="module">
import {createTerminalOutputBuffer} from '/output.js';
let instances=[];
const history='\x1b[?1049h'+('old colorful history\r\n'.repeat(14000)).slice(-256*1024);
window.disposeTerminals=()=>{for(const {buffer,term} of instances){buffer.dispose();term.dispose();}instances=[];document.getElementById('root').replaceChildren();};
window.runTerminalRound=async()=>{
 window.disposeTerminals();
 const root=document.getElementById('root');
 let hiddenWrites=0,queued=0,peakQueued=0,snapshots=0,parsed=0;
 let hidden=true;
 for(let i=0;i<8;i++){
  const el=document.createElement('div');el.className='term';root.append(el);
  const term=new window.Terminal({cols:80,rows:24,scrollback:5000,cursorBlink:false});term.open(el);
  const write=(text,done)=>{if(hidden)hiddenWrites++;queued+=text.length;peakQueued=Math.max(peakQueued,queued);term.write(text,()=>{queued-=text.length;done?.();});};
  let buffer;
  buffer=createTerminalOutputBuffer(write,{requestSnapshot:()=>{snapshots++;queueMicrotask(()=>buffer.replaceSnapshot('\x1bc\x1b[?1049h\x1b[2J\x1b[HFINAL-'+i,()=>parsed++));return true;}});
  buffer.setVisible(false);
  if(buffer.replaceSnapshot)buffer.replaceSnapshot('\x1bc'+history);
  else write('\x1bc'+history);
  instances.push({term,buffer});
 }
 for(let frame=0;frame<600;frame++)for(let i=0;i<instances.length;i++)instances[i].buffer.write('\x1b[Hframe-'+frame+'-'+i+' '+('x'.repeat(2048)));
 const hiddenPending=instances.reduce((sum,v)=>sum+(v.buffer.pendingCharacters??0),0);
 if(hiddenWrites)return {hiddenWrites,peakQueued,hiddenPending,firstPaintMs:null};
 hidden=false;
 const start=performance.now();
 for(const item of instances)item.buffer.setVisible(true);
 while(parsed<instances.length&&performance.now()-start<2500)await new Promise(resolve=>setTimeout(resolve,5));
 const firstPaintMs=performance.now()-start;
 const final=instances.map(({term})=>term.buffer.active.getLine(0)?.translateToString(true));
 return {hiddenWrites,peakQueued,hiddenPending,firstPaintMs,snapshots,parsed,final};
};
window.ready=true;
</script>`;

app.whenReady().then(async () => {
  app.dock?.hide();
  const baseline = process.argv.includes('--baseline');
  const source = baseline
    ? execFileSync('git', ['show', '91b3af3a:src/lib/components/agent-room/terminal-output-buffer.ts'], { encoding: 'utf8' })
    : readFileSync(join(__dirname, '../src/lib/components/agent-room/terminal-output-buffer.ts'), 'utf8');
  const module = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const assets = { '/xterm.js': readFileSync(require.resolve('@xterm/xterm')), '/xterm.css': readFileSync(join(require.resolve('@xterm/xterm'), '../../css/xterm.css')), '/output.js': module };
  server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': req.url === '/xterm.css' ? 'text/css' : req.url === '/' ? 'text/html' : 'text/javascript' });
    res.end(req.url === '/' ? html : assets[req.url] ?? '');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  window = new BrowserWindow({ show: false, width: 1400, height: 1100, paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
  for (let i=0;i<100&&!await window.webContents.executeJavaScript('!!window.ready');i++) await new Promise(resolve=>setTimeout(resolve,20));
  window.webContents.debugger.attach('1.3');
  const run = () => window.webContents.executeJavaScript('window.runTerminalRound()');
  const warmup = await run();
  console.log(JSON.stringify({ baseline, round: 'warmup', ...warmup }));
  assert.equal(warmup.hiddenWrites, 0, 'Invisible terminal histories bypass paint eligibility and flood xterm');
  assert.equal(warmup.parsed, 8);
  assert.ok(warmup.firstPaintMs < 2000, 'Fresh terminal screens must arrive within 2 s');
  assert.deepEqual(warmup.final, Array.from({ length: 8 }, (_, i) => `FINAL-${i}`));
  await window.webContents.executeJavaScript('window.disposeTerminals()');
  await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const before = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
  let worstPaint = warmup.firstPaintMs;
  for(let round=0;round<20;round++) {
    const result = await run();
    assert.equal(result.hiddenWrites,0);assert.equal(result.parsed,8);
    assert.ok(result.peakQueued<=8*32*1024,'Only bounded parser chunks may be retained in xterm');
    assert.deepEqual(result.final,Array.from({length:8},(_,i)=>`FINAL-${i}`));
    worstPaint=Math.max(worstPaint,result.firstPaintMs);
  }
  await window.webContents.executeJavaScript('window.disposeTerminals()');
  await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  const after = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
  assert.ok(after.usedSize-before.usedSize<20*1024*1024,'Disposed terminal renderers must not accumulate retained heaps');
  console.log(JSON.stringify({terminalRendererLifecycle:'passed',rounds:21,terminalMounts:168,trafficBytes:21*8*600*2048,
    hiddenDomWrites:0,worstFirstPaintMs:Math.round(worstPaint),heapBefore:before.usedSize,heapAfter:after.usedSize}));
}).then(()=>finish(0),error=>finish(1,error));
