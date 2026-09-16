import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const mode of ['canvas', 'terminal']) {
test(`${mode}: cancels delayed startup and transcription without reopening the mic or sending old text`, async ({ page, request }) => {
  test.setTimeout(60_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-dictation-recovery-'));
  const response = await request.post('/api/agent-room/workspaces', {
    data: { name: 'E2E dictation recovery', workingDir: root, codeIntelligenceMode: 'manual' },
  });
  const workspace = (await response.json()).data;
  try {
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'terminal', title: 'Dictation test', x: 40, y: 40, width: 650, height: 400,
        payload: { command: process.execPath, args: ['-e', 'process.stdin.on("data",b=>process.stdout.write(b))'], maestro: true } },
    });
    const node = (await nodeResponse.json()).data;
    await page.addInitScript(() => {
      const state = { opened: 0, stopped: 0 };
      (window as any).__captureTest = state;
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        state.opened++;
        let stopped = false;
        return { getTracks: () => [{ stop: () => { if (!stopped) { stopped = true; state.stopped++; } } }] };
      } });
      const node = () => ({ connect() {}, disconnect() {} });
      (window as any).AudioContext = class {
        sampleRate = 16_000;
        state = 'running';
        destination = {};
        audioWorklet = { addModule: async () => {} };
        createMediaStreamSource = node;
        createGain = () => ({ ...node(), gain: { value: 0 } });
        async close() { this.state = 'closed'; }
      };
      (window as any).AudioWorkletNode = class {
        connect() {}
        disconnect() {}
        port = {
          onmessage: null as any,
          postMessage: () => {
            this.port.onmessage?.({ data: { type: 'samples', samples: Float32Array.from({ length: 16_000 }, (_, i) => Math.sin(i / 10) * 0.2) } });
            this.port.onmessage?.({ data: { type: 'flushed' } });
          },
        };
      };
    });
    let releaseModels!: () => void;
    const models = new Promise<void>((resolve) => { releaseModels = resolve; });
    let modelRequests = 0;
    await page.route('**/api/agent-room/voice/models', async (route) => {
      modelRequests++;
      await models;
      await route.fulfill({ json: { data: { ready: true } } }).catch(() => {});
    });
    await page.goto(`/${mode}?workspace=${workspace.id}&node=${node.id}`);
    const terminal = page.locator('.canvas-terminal');
    await expect(terminal.locator('.xterm-helper-textarea')).toBeAttached();
    const mic = terminal.getByRole('button', { name: /Ditar \(/ });
    await mic.click();
    await expect.poll(() => modelRequests).toBeGreaterThan(0);
    await terminal.getByRole('button', { name: 'Cancelar ditado' }).click();
    releaseModels();
    await expect(mic).toBeVisible();
    expect(await page.evaluate(() => (window as any).__captureTest.opened)).toBe(0);

    let releaseTranscript!: () => void;
    const transcript = new Promise<void>((resolve) => { releaseTranscript = resolve; });
    let transcriptionRequests = 0;
    await page.route('**/api/agent-room/voice/transcribe', async (route) => {
      transcriptionRequests++;
      await transcript;
      await route.fulfill({ json: { data: { text: 'SHOULD_NOT_REACH_TERMINAL' } } }).catch(() => {});
    });
    await mic.click();
    await expect(terminal.locator('.dictate-rec')).toBeVisible();
    await terminal.getByRole('button', { name: /Parar ditado/ }).click();
    await expect.poll(() => transcriptionRequests).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__captureTest.stopped)).toBe(1);
    await page.locator('.dictation-trigger').click();
    releaseTranscript();
    await expect(mic).toBeVisible();
    await expect(terminal).not.toContainText('SHOULD_NOT_REACH_TERMINAL');

    await mic.click();
    await expect(terminal.locator('.dictate-rec')).toBeVisible();
    await terminal.getByRole('button', { name: /Parar ditado/ }).click();
    await expect(mic).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as any).__captureTest.stopped)).toBe(2);

    let releaseFieldTranscript!: () => void;
    const fieldTranscript = new Promise<void>((resolve) => { releaseFieldTranscript = resolve; });
    let fieldRequests = 0;
    await page.route('**/api/agent-room/voice/transcribe', async (route) => {
      fieldRequests++;
      await fieldTranscript;
      await route.fulfill({ json: { data: { text: 'OLD_FIELD_TEXT' } } }).catch(() => {});
    });
    const draft = page.getByTestId('terminal-quick-prompt');
    await draft.fill('Existing draft');
    const orb = page.locator('.dictation-trigger');
    await orb.click();
    await expect(orb).toHaveAttribute('aria-pressed', 'true');
    await orb.click();
    await expect.poll(() => fieldRequests).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__captureTest.stopped)).toBe(3);
    await expect(orb).toHaveAttribute('aria-label', /Cancelar ditado/);
    await orb.click();
    releaseFieldTranscript();
    await expect(orb).not.toHaveAttribute('aria-label', /Cancelar ditado/);
    await expect(draft).toHaveValue('Existing draft');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    await rm(root, { recursive: true, force: true });
  }
});
}
