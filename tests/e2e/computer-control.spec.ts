import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Computer remains usable in Canvas and Workbench, with honest permissions and live agent evidence', async ({ page, request }) => {
  test.setTimeout(60_000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-computer-ui-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const created = await request.post('/api/agent-room/workspaces', { data: { name: `Computer QA ${Date.now()}`, workingDir: dir } });
  expect(created.ok()).toBe(true);
  const workspace = (await created.json()).data;
  const root = `/api/agent-room/workspaces/${workspace.id}`;
  const node = (await (await request.post(`${root}/nodes`, { data: { type: 'computer', title: 'Computer QA', width: 640, height: 820, payload: { computerConfig: { enabled: false, allowedApplications: ['COM.APPLE.CALCULATOR'], allowedDisplays: [], evidenceRetentionDays: 14 } } } })).json()).data;
  let permitted = false;
  let focused = true;
  let windowTitle = 'Calculator';
  let evidence: string | null = null;
  let polls = 0;
  const commands: unknown[] = [];
  const snapshot = () => ({ platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: permitted ? 'granted' : 'denied', screenRecording: 'unknown' }, displays: [], windows: permitted ? [{ id: '123:0', appId: 'com.apple.calculator', appName: 'Calculator', title: windowTitle, bounds: { x: 10, y: 10, width: 300, height: 500 }, focused }] : [], focusedWindowId: permitted && focused ? '123:0' : null });
  await page.route(`**${root}/computers/evidence/*`, (route) => route.fulfill({ contentType: 'image/png', body: readFileSync('electron/resources/icon.png') }));
  // Only the native OS boundary is simulated; node/config persistence uses the real server.
  await page.route(`**${root}/computers`, async (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      await route.fulfill({ json: { data: { kind: 'action', completed: true, snapshot: snapshot() } } });
      return;
    }
    polls++;
    const nodes = (await (await request.get(`${root}/nodes`)).json()).data;
    const config = nodes.find((item: { id: string }) => item.id === node.id).payload.computerConfig;
    await route.fulfill({ json: { data: { nodeId: node.id, config, snapshot: snapshot(), lastEvidence: evidence } } });
  });
  try {
    for (const [theme, path] of [['orkestrai-light', '/terminal'], ['orkestrai-dark', '/canvas']]) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: theme } });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${path}?workspace=${workspace.id}&node=${node.id}`);
      await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);
      const panel = page.getByTestId('computer-workbench').filter({ visible: true }).first();
      await expect(panel).toBeVisible();
      // A closed allowed app must remain visible, revocable, and launchable after enabling.
      const app = panel.getByRole('button', { name: /Open or focus application com.apple.calculator/i });
      await expect(app).toBeVisible();
      await expect(app).toBeDisabled();
      await expect(panel.locator('header').getByText('Disabled', { exact: true })).toBeVisible();
      await panel.getByRole('switch').click();
      await expect(panel.locator('header').getByText('Permission required', { exact: true })).toBeVisible();
      permitted = true;
      await expect(panel.locator('header').getByText('Ready', { exact: true })).toBeVisible({ timeout: 15_000 });
      await panel.getByRole('button', { name: 'Open or focus application Calculator', exact: true }).click();
      expect(commands.at(-1)).toEqual({ command: 'launch', applicationId: 'com.apple.calculator' });
      windowTitle = '1387 - verified result';
      evidence = '.orkestrai/computer/evidence/11111111-1111-4111-8111-111111111111.png';
      await expect(panel.getByRole('button', { name: /Calculator.*1387/ })).toBeVisible({ timeout: 15_000 });
      await expect(panel.locator('img')).toBeVisible();
      await expect.poll(() => panel.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      const target = panel.getByRole('button', { name: /Calculator.*1387/ });
      await target.click();
      await expect(target).toHaveAttribute('aria-pressed', 'true');
      await expect(panel.getByRole('checkbox')).toHaveCount(1);
      focused = false;
      await expect(target.locator('span').first()).toHaveClass(/app-border-strong/);
      const textInput = panel.getByRole('textbox', { name: 'Select an allowed window to type' });
      await textInput.scrollIntoViewIfNeeded();
      await expect(textInput).toBeInViewport();
      await textInput.fill('73*19');
      await panel.getByRole('button', { name: 'Type text', exact: true }).click();
      expect(commands.at(-1)).toEqual({ command: 'type', text: '73*19', targetId: '123:0' });
      await panel.locator('header').scrollIntoViewIfNeeded();
      expect(polls).toBeGreaterThan(1);
      const overflow = await panel.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await panel.screenshot({ path: `test-results/computer-${theme}.png` });
      await panel.getByRole('switch').click();
      await expect(panel.locator('header').getByText('Disabled', { exact: true })).toBeVisible();
      permitted = false;
      focused = true;
      evidence = null;
      windowTitle = 'Calculator';
    }
  } finally {
    await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`${root}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
