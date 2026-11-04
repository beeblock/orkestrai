import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps Dictate and Send separate and appends repeated recordings in every conversation composer', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-voice-draft-'));
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId: string | undefined;
  try {
    await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en' } });
    const workspace = await request.post('/api/agent-room/workspaces', { data: { name: 'Repeated dictation QA', workingDir: root, codeIntelligenceMode: 'disabled' } });
    expect(workspace.ok()).toBeTruthy(); workspaceId = (await workspace.json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const agent = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Voice QA', x: 80, y: 80, width: 500, height: 370, payload: { provider: 'claude', maestro: true } } })).json()).data;
    await request.post(`${base}/nodes`, { data: { type: 'orchestrator', title: 'Leader panel', x: 700, y: 80, width: 380, height: 520, payload: {} } });
    await page.routeWebSocket('**/ws/agent-room/pty', socket => socket.onMessage(raw => {
      const frame = JSON.parse(String(raw));
      if (frame.type === 'ping') socket.send(JSON.stringify({ type: 'pong' }));
      if (frame.type === 'create' || frame.type === 'attach') socket.send(JSON.stringify({ type: frame.type === 'create' ? 'created' : 'attached', session: { id: 'qa-session', cols: 80, rows: 24 }, scrollback: '', streamingOutput: true }));
    }));
    await page.addInitScript(({ nodeId }) => {
      localStorage.setItem(`orkestrai.node.face.${nodeId}`, 'chat');
      const node = () => ({ connect() {}, disconnect() {} });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => ({ getTracks: () => [{ stop() {} }] }) });
      (window as any).AudioContext = class {
        sampleRate = 16_000; state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} };
        createMediaStreamSource = node; createGain = () => ({ ...node(), gain: { value: 0 } });
        createAnalyser = () => ({ ...node(), fftSize: 1024, getFloatTimeDomainData(samples: Float32Array) { samples.fill(0.2); } });
        async close() { this.state = 'closed'; }
      };
      (window as any).AudioWorkletNode = class {
        connect() {} disconnect() {}
        port = { onmessage: null as any, postMessage: () => {
          this.port.onmessage?.({ data: { type: 'samples', samples: Float32Array.from({ length: 16_000 }, (_, i) => Math.sin(i / 10) * 0.2) } });
          this.port.onmessage?.({ data: { type: 'flushed' } });
        } };
      };
    }, { nodeId: agent.id });
    await page.route('**/api/agent-room/voice/models', route => route.fulfill({ json: { data: { ready: true } } }));
    let transcriptions = 0;
    await page.route('**/api/agent-room/voice/transcribe', route => route.fulfill({ json: { data: { text: ++transcriptions % 2 ? 'first spoken part' : 'second spoken part' } } }));
    const posts: string[] = [];
    await page.route(`**${base}/channels/**/messages`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postDataJSON(); posts.push(body.body);
      await route.fulfill({ json: { data: { message: { id: `qa-${posts.length}`, workspaceId, channel: `dm:${agent.id}`, authorKind: 'owner', body: body.body, createdAt: new Date().toISOString(), meta: {} }, delivered: [{ ok: true }] } } });
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    for (const surface of ['chat', 'canvas', 'leader', 'agent']) {
      await page.goto(`/${surface === 'chat' ? 'chat' : 'canvas'}?workspace=${workspaceId}`);
      const scope = surface === 'chat' ? page.locator('footer.composer-area')
        : surface === 'canvas' ? page.locator('.composer-wrap') : surface === 'leader' ? page.getByTestId('orchestrator-node').locator('form.command') : page.locator(`[data-id="${agent.id}"] .chat-face-layer form`);
      const input = scope.getByRole('textbox');
      await input.fill('Existing draft');
      const mic = scope.getByRole('button', { name: /^(Dictate|Voice message|Talk to the team)$/ });
      await expect(mic).toBeVisible();
      const before = posts.length;
      for (const part of ['first', 'second']) {
        await mic.click();
        const voice = scope.getByTestId('composer-voice');
        await expect(voice).toHaveAttribute('data-phase', 'recording');
        await voice.getByRole('button', { name: /text|edit/i }).click();
        await expect(input).toHaveValue(part === 'first' ? 'Existing draft first spoken part' : 'Existing draft first spoken part second spoken part');
        await expect(mic).toBeVisible();
        expect(posts).toHaveLength(before);
      }
      await expect(scope.getByRole('button', { name: /^Send/ }).last()).toBeEnabled();
      if (surface === 'chat') await page.screenshot({ path: testInfo.outputPath('dictation-draft.png') });
      await scope.getByRole('button', { name: /^Send/ }).last().click();
      await expect.poll(() => posts.length).toBe(before + 1);
      expect(posts.at(-1)).toBe('Existing draft first spoken part second spoken part');
    }
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: original });
    await rm(root, { recursive: true, force: true });
  }
});
