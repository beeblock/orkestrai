// Isolated native A/B for connection rasterization, not a whole-app benchmark.
// Run: env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron scripts/test-canvas-raster.cjs
const { app, BrowserWindow } = require('electron');
const { compile } = require('svelte/compiler');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'orkestrai-canvas-raster-'));
app.setPath('userData', profile);
let window;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const watchdog = setTimeout(() => finish(Error('Native canvas raster comparison timed out')), 90000);
async function finish(error) {
  clearTimeout(watchdog);
  window?.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  if (error) console.error(error.stack);
  app.exit(error ? 1 : 0);
}

async function main() {
  await app.whenReady();
  app.dock?.hide();
  const source = fs.readFileSync(path.resolve('src/lib/components/agent-room/canvas/OrkestraiEdge.svelte'), 'utf8');
  const css = compile(source, { filename: 'OrkestraiEdge.svelte', cssHash: () => 'svelte-native-raster' }).css.code;
  const nodes = Array.from({ length: 408 }, (_, i) => ({ x: i % 24 * 440, y: Math.floor(i / 24) * 460 }));
  const edges = Array.from({ length: 236 }, (_, i) => {
    const a = nodes[i % nodes.length], b = nodes[(i * 13 + 127) % nodes.length];
    const ax = a.x + 195, ay = a.y + 17, bx = b.x + 195, by = b.y + 17;
    const sag = Math.min(42, Math.max(12, Math.hypot(bx - ax, by - ay) * .06));
    return `<svg class="edge"><g class="orkestrai-edge"><path class="edge-line svelte-native-raster" fill="none" stroke="#989bb0" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="7 5" d="M ${ax},${ay} Q ${(ax + bx) / 2},${(ay + by) / 2 + sag} ${bx},${by}"/></g></svg>`;
  }).join('');
  const cards = nodes.map((node, i) => `<div class="card" style="left:${node.x}px;top:${node.y}px"><header>Fixture ${i}<span>${'<svg viewBox="0 0 24 24"><path d="M3 12h18M12 3v18" stroke="#b8bbc9"/></svg>'.repeat(6)}</span></header></div>`).join('');
  window = new BrowserWindow({ width: 1440, height: 900, show: false,
    webPreferences: { sandbox: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;overflow:hidden;background:#171723;color:#bcc0d1;font:13px system-ui}
    .svelte-flow{position:absolute;inset:0;overflow:hidden}.viewport{transform-origin:0 0;position:absolute;inset:0}
    .edge{position:absolute;width:100%;height:100%;overflow:visible;pointer-events:none}
    .card{position:absolute;width:390px;height:420px;border:1px solid #555768;border-radius:10px;background:#242435;box-shadow:0 3px 10px #0003}
    header{height:34px;padding:0 10px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #555768}
    header span{display:flex;gap:6px}header svg{width:18px;height:18px}
    ${css}
    .legacy .edge-line{stroke-dasharray:7 5!important}
  </style><div class="svelte-flow" data-canvas-navigating="true"><div class="viewport" style="transform:translate(40px,40px) scale(.1)">${edges}${cards}</div></div>
  <script>
    window.originalEdges=[...document.querySelectorAll('.edge-line')];
    window.originalCards=[...document.querySelectorAll('.card')];
    window.pan={x:40,y:40};let start;
    document.addEventListener('pointerdown',event=>{start={x:event.clientX,y:event.clientY,px:pan.x,py:pan.y}});
    document.addEventListener('pointermove',event=>{if(!start)return;pan.x=start.px+event.clientX-start.x;pan.y=start.py+event.clientY-start.y;document.querySelector('.viewport').style.transform='translate('+pan.x+'px,'+pan.y+'px) scale(.1)'});
    document.addEventListener('pointerup',()=>start=null);
  </script>`));
  window.showInactive();
  window.webContents.debugger.attach('1.3');
  await window.webContents.debugger.sendCommand('Performance.enable');
  const evaluate = code => window.webContents.executeJavaScript(code);
  const metrics = async () => Object.fromEntries((await window.webContents.debugger.sendCommand('Performance.getMetrics')).metrics.map(entry => [entry.name, entry.value]));
  const trials = [];
  async function trial(legacy, recorded) {
    await evaluate(`document.querySelector('.svelte-flow').classList.toggle('legacy',${legacy});pan.x=40;pan.y=40;document.querySelector('.viewport').style.transform='translate(40px,40px) scale(.1)'`);
    await pause(300);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.edge-line')).strokeDasharray`), legacy ? '7px, 5px' : 'none');
    await evaluate(`window.gaps=[];window.last=performance.now();window.recordFrames=true;function tick(now){if(!recordFrames)return;gaps.push(now-last);last=now;requestAnimationFrame(tick)};requestAnimationFrame(tick)`);
    app.getAppMetrics();
    const cpuSamples = [];
    const timer = setInterval(() => cpuSamples.push(app.getAppMetrics().filter(entry => ['Tab', 'GPU'].includes(entry.type)).map(entry => ({ type: entry.type, cpu: entry.cpu.percentCPUUsage }))), 250);
    const before = await metrics();
    const started = performance.now();
    const point = (type, x, y) => window.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
    point('mouseMove', 20, 500);
    point('mouseDown', 20, 500);
    for (let i = 0; i < 90; i++) {
      point('mouseMove', 20 + Math.round(Math.sin(i * Math.PI / 45) * 180), 500 + Math.round(Math.sin(i * Math.PI / 30) * 80));
      await pause(16);
    }
    point('mouseUp', 20, 500);
    const elapsed = performance.now() - started;
    const after = await metrics();
    clearInterval(timer);
    const state = await evaluate(`recordFrames=false;({gaps:gaps.slice(1),edges:originalEdges.every((edge,i)=>edge===document.querySelectorAll('.edge-line')[i]),cards:originalCards.every((card,i)=>card===document.querySelectorAll('.card')[i])})`);
    assert.equal(state.edges, true); assert.equal(state.cards, true);
    const gaps = state.gaps.sort((a, b) => a - b);
    assert.ok(gaps.length > 5);
    const average = type => {
      const values = cpuSamples.flat().filter(entry => entry.type === type).map(entry => entry.cpu);
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    };
    if (recorded) trials.push({ legacy, elapsedMs: Math.round(elapsed), taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
      frames: gaps.length, p95FrameMs: Math.round(gaps[Math.floor(gaps.length * .95)]), maxFrameMs: Math.round(gaps.at(-1)), rendererCpu: average('Tab'), gpuProcessCpu: average('GPU') });
  }
  await trial(true, false); await trial(false, false);
  for (const legacy of [true, false, false, true, true, false]) await trial(legacy, true);
  console.log(JSON.stringify({ electron: process.versions.electron, nodes: nodes.length, edges: 236, scope: 'isolated native dash rasterization; not whole-app CPU', trials }));
  await finish();
}
main().catch(finish);
