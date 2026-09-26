import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import WebSocket from 'ws';

test('drops real videos as playable, persistent native workflow references without contacting providers', async ({ page, request }) => {
  test.setTimeout(90000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-video-drop-'));
  const root = '/api/agent-room/workspaces';
  const workspace = (await (await request.post(root, { data: { name: 'E2E video drop', workingDir: dir } })).json()).data;
  let paidRequests = 0;
  let agentSocket: WebSocket | undefined, agentSessionId: string | undefined;
  page.on('request', req => { if (/fal\.ai|higgsfield|byteplus/.test(req.url())) paidRequests++; });
  try {
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.blank-canvas, .svelte-flow__pane').first()).toBeVisible();
    const encoded = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 120;
      const ctx = canvas.getContext('2d')!;
      const stream = canvas.captureStream(10);
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      recorder.ondataavailable = event => chunks.push(event.data);
      const finished = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
      recorder.start();
      for (const color of ['#168766', '#e36550', '#168766']) {
        ctx.fillStyle = color; ctx.fillRect(0, 0, 160, 120);
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      recorder.stop(); await finished; stream.getTracks().forEach(track => track.stop());
      return btoa(String.fromCharCode(...new Uint8Array(await new Blob(chunks).arrayBuffer())));
    });
    const transfer = await page.evaluateHandle(encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], 'Beach reference.webm', { type: 'video/webm' }));
      data.items.add(new File([bytes], 'Second angle.WEBM')); // Explorer may omit MIME.
      data.items.add(new File(['# Direction\nPreserve the original character.'], 'Direction.md', { type: 'text/markdown' }));
      return data;
    }, encoded);
    await page.locator('.blank-canvas, .svelte-flow__pane').first().dispatchEvent('drop', { dataTransfer: transfer, clientX: 600, clientY: 260 });
    await transfer.dispose();
    let nodes: any[] = [];
    await expect.poll(async () => {
      nodes = (await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data;
      return nodes.filter(node => node.type === 'video').length;
    }).toBe(2);
    await expect.poll(async () => (await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data.filter((node: any) => node.type === 'document').length).toBe(1);
    const videos = nodes.filter(node => node.type === 'video');
    expect(new Set(videos.map(node => `${node.x}:${node.y}`)).size).toBe(2);
    for (const node of videos) expect(readFileSync(join(dir, node.payload.path))).toEqual(Buffer.from(encoded, 'base64'));
    await page.goto(`/terminal?workspace=${workspace.id}&node=${videos[0].id}`);
    const player = page.locator('video').first();
    await expect(player).toBeVisible();
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, height: element.videoHeight, error: element.error?.code ?? null }))).toEqual({ width: 160, height: 120, error: null });
    await player.evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
    await expect.poll(() => player.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await page.reload();
    await expect(player).toBeVisible();
    const inputs = (await (await request.get(`${root}/${workspace.id}/creative-media`)).json()).data.inputs;
    expect(inputs.filter((node: any) => node.type === 'video').map((node: any) => node.title).sort()).toEqual(['Beach reference.webm', 'Second angle.WEBM']);
    const modelId = 'fal-ai/test/video-to-video';
    const model = { id: modelId, name: 'Video reference fixture', category: 'video-to-video', status: 'active', documentationUrl: 'https://fal.ai/models/test' };
    await page.route(`**/workspaces/${workspace.id}/creative-media/models?*`, route => route.fulfill({ json: { data: new URL(route.request().url()).searchParams.has('endpoint') ? {
      ...model, digest: 'a'.repeat(64), outputSchema: {}, schema: { type: 'object', properties: { prompt: { type: 'string' }, video_url: { type: 'string' } } },
    } : { models: [model], total: 1, nextOffset: null } } }));
    const draftResponse = await request.post(`${root}/${workspace.id}/creative-media`, {
      headers: { origin: 'http://127.0.0.1:5199' },
      data: { title: 'Continue the imported clip', config: { modelId, mediaBindings: [{ pointer: '/video_url', nodeId: videos[0].id }] } },
    });
    expect(draftResponse.ok()).toBe(true);
    const draft = (await draftResponse.json()).data;
    await page.goto(`/terminal?workspace=${workspace.id}&node=${draft.nodeId}`);
    const references = page.getByTestId('creative-media-inputs');
    await expect(references.getByRole('combobox').nth(1)).toContainText('Beach reference.webm');
    await references.getByTestId('creative-media-preview').getByRole('button').click();
    const referencePlayer = page.getByRole('dialog').locator('video');
    await expect.poll(() => referencePlayer.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(160);
    await page.screenshot({ path: '/tmp/orkestrai-imported-video-reference.png' });
    await page.keyboard.press('Escape');
    // A disguised HTML file must not become a document or an executable video.
    await page.goto(`/canvas?workspace=${workspace.id}`);
    const invalid = await page.evaluateHandle(() => {
      const data = new DataTransfer(); data.items.add(new File(['<html>' + 'not a movie'.repeat(10)], 'bad.mp4', { type: 'video/mp4' })); return data;
    });
    const failed = page.waitForResponse(response => response.url().endsWith('/creative-media/videos') && response.status() === 422);
    await page.locator('.svelte-flow__pane').dispatchEvent('drop', { dataTransfer: invalid, clientX: 700, clientY: 300 });
    await failed; await invalid.dispose();
    await expect(page.getByText(/bad\.mp4/)).toBeVisible();
    expect((await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data).toHaveLength(4);
    // Exercise the real PTY identity -> CLI -> authenticated bridge -> Canvas path.
    // This Node process is a deterministic agent stand-in, not a paid model.
    await page.goto('about:blank');
    mkdirSync(join(dir, 'renders'));
    writeFileSync(join(dir, 'renders/final.webm'), Buffer.from(encoded, 'base64'));
    const agentResponse = await request.post(`${root}/${workspace.id}/nodes`, { data: { type: 'terminal', title: 'Local editor fixture', x: 50, y: 50, width: 520, height: 400, payload: { provider: 'claude', command: process.execPath, args: [] } } });
    expect(agentResponse.ok()).toBe(true);
    const agent = (await agentResponse.json()).data;
    const script = `
      import { run } from ${JSON.stringify(pathToFileURL(join(process.cwd(), 'packages/orkestrai-cli/src/cli.js')).href)};
      setInterval(() => {}, 60000);
      await run(['task', 'add', 'Deliver local edit', '--assign', process.env.ORKESTRAI_NODE_ID]);
      let tasks;
      await run(['task', 'list', '--json'], { out: value => { tasks = JSON.parse(value); } });
      const task = tasks.find(item => item.title === 'Deliver local edit');
      const args = ['video', 'import', '--task', task.id, '--input', JSON.stringify({path:'renders/final.webm',title:'Edited final'})];
      await run(args);
      await run(args);
      console.log('E2E_IMPORT_FINISHED');
    `;
    agentSocket = new WebSocket('ws://127.0.0.1:5199/ws/agent-room/pty', { origin: 'http://127.0.0.1:5199' });
    let output = '', socketError = '';
    agentSocket.on('message', bytes => {
      const message = JSON.parse(bytes.toString());
      if (message.type === 'created') agentSessionId = message.session.id;
      if (message.type === 'output') output += message.data;
      if (message.type === 'error') socketError = message.message;
    });
    await new Promise<void>((resolve, reject) => { agentSocket!.once('open', resolve); agentSocket!.once('error', reject); });
    agentSocket.send(JSON.stringify({ type: 'create', command: process.execPath, args: ['--input-type=module', '-e', script], cwd: dir, workspaceId: workspace.id, nodeId: agent.id, provider: 'claude', env: { ORKESTRAI_NODE_ID: agent.id, ORKESTRAI_WORKSPACE_CONFIG: join(dir, '.orkestrai/workspace.json'), ORKESTRAI_API_URL: 'http://127.0.0.1:5199' } }));
    await expect.poll(() => socketError || output, { timeout: 20000 }).toContain('E2E_IMPORT_FINISHED');
    const delivered = (await (await request.get(`${root}/${workspace.id}/nodes`)).json()).data.filter((node: any) => node.type === 'video' && node.payload.path === 'renders/final.webm');
    expect(delivered).toHaveLength(1);
    expect(readFileSync(join(dir, delivered[0].payload.path))).toEqual(Buffer.from(encoded, 'base64'));
    await page.goto(`/terminal?workspace=${workspace.id}&node=${delivered[0].id}`);
    await expect.poll(() => page.locator('video').first().evaluate((element: HTMLVideoElement) => ({ width: element.videoWidth, error: element.error?.code ?? null }))).toEqual({ width: 160, error: null });
    await page.locator('video').first().evaluate((element: HTMLVideoElement) => { element.muted = true; return element.play(); });
    await expect.poll(() => page.locator('video').first().evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0);
    await page.screenshot({ path: '/tmp/orkestrai-agent-imported-montage.png' });
    expect(paidRequests).toBe(0);
  } finally {
    if (agentSocket?.readyState === WebSocket.OPEN && agentSessionId) agentSocket.send(JSON.stringify({ type: 'kill', sessionId: agentSessionId }));
    agentSocket?.close();
    await page.goto('about:blank').catch(() => undefined);
    await request.delete(`${root}/${workspace.id}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
