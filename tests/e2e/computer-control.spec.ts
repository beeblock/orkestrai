import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

test('Computer remains usable in Canvas and Workbench, with honest permissions and live agent evidence', async ({ page, request }) => {
  test.setTimeout(120_000);
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
  const errors: string[] = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('[computer-ui]', error.message); });
  const snapshot = () => ({ platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: permitted ? 'granted' : 'denied', screenRecording: 'unknown' }, displays: [], windows: permitted ? [{ id: '123:0', appId: 'com.apple.calculator', appName: 'Calculator', title: windowTitle, bounds: { x: 10, y: 10, width: 300, height: 500 }, focused }] : [], focusedWindowId: permitted && focused ? '123:0' : null });
  await page.route(`**${root}/computers/evidence/*`, (route) => route.fulfill({ contentType: 'image/png', body: readFileSync('electron/resources/icon.png') }));
  // Only the native OS boundary is simulated; node/config persistence uses the real server.
  await page.route(`**${root}/computers`, async (route) => {
    if (route.request().method() === 'POST') {
      commands.push(route.request().postDataJSON());
      if (route.request().postDataJSON().command === 'capabilities' || route.request().postDataJSON().command.startsWith('memory_')) {
        const response = await request.post(`${root}/computers`, { data: route.request().postDataJSON() });
        return route.fulfill({ response });
      }
      await route.fulfill({ json: { data: { kind: 'action', completed: true, snapshot: snapshot() } } });
      return;
    }
    polls++;
    const nodes = (await (await request.get(`${root}/nodes`)).json()).data;
    const config = nodes.find((item: { id: string }) => item.id === node.id).payload.computerConfig;
    const state = snapshot();
    // macOS can repeat an Accessibility record for the same native Finder window.
    state.windows = [...state.windows, ...state.windows];
    await route.fulfill({ json: { data: { nodeId: node.id, config, snapshot: state, lastEvidence: evidence } } });
  });
  try {
    // Exercise the real FormRequest/HTTP boundary without ever enabling OS input.
    for (const command of [
      { command: 'screenshot', target: 'window', targetId: '42:cg:9' },
      { command: 'type', text: 'Ol\u00e1 aqui \u00e9 o orkestrai', targetId: '42:cg:9' },
    ]) {
      const response = await request.post(`${root}/computers`, { data: command });
      expect(response.status()).toBe(400);
      expect((await response.json()).error).toBe('Desktop control is disabled on this Computer node.');
    }
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
      await panel.locator('header').getByRole('switch').click();
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
      await expect(target.locator('span').first()).toHaveClass(/app-border-strong/, { timeout: 15000 });
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
      const observation = panel.getByTestId('computer-observation-controls');
      await observation.scrollIntoViewIfNeeded();
      await expect(observation.getByText('Paused', { exact: true })).toBeVisible();
      await expect(observation.getByRole('switch', { name: 'Monitor', exact: true })).toBeDisabled();
      for (const track of await observation.locator('[data-slot="slider-track"]').filter({ visible: true }).all()) {
        const bounds = await track.boundingBox();
        expect(bounds?.height).toBeGreaterThan(0);
        expect(bounds?.width).toBeGreaterThan(50);
      }
      const interval = observation.getByRole('slider', { name: 'Check interval', exact: true });
      await interval.focus();
      await interval.press('ArrowRight');
      await expect(interval).toHaveAttribute('aria-valuenow', '2');
      await interval.press('ArrowLeft');
      await expect(interval).toHaveAttribute('aria-valuenow', '1');
      await expect(observation.getByText('Native text, visual fallback', { exact: true })).toBeVisible();
      await expect(observation.getByRole('switch', { name: 'Allow agent configuration', exact: true })).not.toBeChecked();
      await observation.getByRole('switch', { name: 'Allow agent configuration', exact: true }).click();
      await expect(observation.getByRole('switch', { name: 'Allow agent configuration', exact: true })).toBeChecked();
      await observation.screenshot({ path: `test-results/computer-observation-${theme}.png` });
      await observation.getByRole('switch', { name: 'Allow agent configuration', exact: true }).click();
      await expect(observation.getByRole('switch', { name: 'Allow agent configuration', exact: true })).not.toBeChecked();
      const storage = panel.getByTestId('computer-storage-controls');
      await storage.scrollIntoViewIfNeeded();
      await expect(storage.getByRole('button', { name: 'Clean expired and excess captures' })).toBeVisible();
      await storage.getByRole('button', { name: 'Clean expired and excess captures' }).click();
      expect(commands.at(-1)).toEqual({ command: 'cleanup' });
      await storage.screenshot({ path: `test-results/computer-storage-${theme}.png` });
      const replies = panel.getByTestId('computer-reply-controls');
      await replies.scrollIntoViewIfNeeded();
      await expect(replies.getByText('Automatic conversation replies', { exact: true })).toBeVisible();
      await replies.getByText('Authorize a conversation', { exact: true }).click();
      await expect(replies.getByRole('button', { name: 'Authorize this conversation', exact: true })).toBeDisabled();
      for (const select of await replies.getByRole('combobox').all()) {
        const bounds = await select.boundingBox();
        expect(bounds?.width).toBeGreaterThan(50);
        expect(bounds?.width).toBeLessThan(650);
      }
      const replyRate = replies.getByRole('slider', { name: 'Maximum replies per hour', exact: true });
      await replyRate.focus();
      await replyRate.press('ArrowRight');
      await expect(replyRate).toHaveAttribute('aria-valuenow', '61');
      await replies.screenshot({ path: `test-results/computer-replies-${theme}.png` });
      await panel.locator('header').getByRole('switch').click();
      await expect(panel.locator('header').getByText('Disabled', { exact: true })).toBeVisible();
      permitted = false;
      focused = true;
      evidence = null;
      windowTitle = 'Calculator';
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(`${root}`);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('calendar routines persist timezone and keep editor controls visible in both themes', async ({ page, request }) => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-calendar-ui-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `Calendar QA ${Date.now()}`, workingDir: dir } })).json()).data;
  const root = `/api/agent-room/workspaces/${workspace.id}`;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const theme of ['orkestrai-light', 'orkestrai-dark']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: theme } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/terminal?workspace=${workspace.id}&node=workbench-automations:${workspace.id}`);
      const panel = page.getByTestId('automation-workspace').filter({ visible: true }).first();
      await expect(panel).toBeVisible();
      await panel.getByRole('button', { name: 'New automation', exact: true }).click();
      const form = panel.locator('form');
      await form.locator('[name="automation-name"]').fill(`Calendar ${theme}`);
      await form.getByRole('button', { name: 'When this happens', exact: true }).click();
      await page.getByRole('option', { name: 'Schedule', exact: true }).click();
      await form.getByRole('button', { name: 'Schedule', exact: true }).click();
      await page.getByRole('option', { name: 'Day and time', exact: true }).click();
      const calendar = form.getByTestId('calendar-schedule-fields');
      await expect(calendar).toBeVisible();
      await calendar.locator('[name="schedule-time"]').fill('04:00');
      await calendar.getByRole('combobox', { name: 'Time zone', exact: true }).click();
      await page.getByPlaceholder('Time zone', { exact: true }).fill('America/Sao_Paulo');
      await page.getByRole('option', { name: 'America/Sao_Paulo', exact: true }).click();
      await form.getByRole('button', { name: 'Do this', exact: true }).click();
      await page.getByRole('option', { name: 'Create task', exact: true }).click();
      await form.getByRole('textbox', { name: 'Task title', exact: true }).fill('Scheduled fixture');
      await form.getByRole('button', { name: 'Save automation', exact: true }).scrollIntoViewIfNeeded();
      await form.screenshot({ path: `test-results/calendar-${theme}.png` });
      expect(await form.evaluate(e => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(1);
      await form.getByRole('button', { name: 'Save automation', exact: true }).click();
      await expect(form).toHaveCount(0);
      const article = panel.locator('article').filter({ hasText: `Calendar ${theme}` });
      await expect(article).toContainText('04:00');
      await expect(article).toContainText('America/Sao_Paulo');
      await page.reload();
      await expect(article).toBeVisible();
      await article.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(panel.locator('[name="schedule-time"]')).toHaveValue('04:00');
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(root);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('conversation memory and proactive grants are owner-visible and persist independently', async ({ page, request }) => {
  test.setTimeout(90_000);
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-memory-ui-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `Memory QA ${Date.now()}`, workingDir: dir } })).json()).data;
  const root = `/api/agent-room/workspaces/${workspace.id}`;
  const agent = (await (await request.post(`${root}/nodes`, { data: { type: 'terminal', title: 'Memory operator', payload: { command: '/bin/cat' } } })).json()).data;
  const node = (await (await request.post(`${root}/nodes`, { data: { type: 'computer', payload: { computerConfig: { enabled: false, allowedApplications: ['test.chat'] } } } })).json()).data;
  const taskResponse = await request.post(`${root}/tasks`, { data: { title: 'Continuous fixture', assigneeNodeId: agent.id } });
  expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
  const task = (await taskResponse.json()).data;
  const previous = (await (await request.get(`${root}/autonomy`)).json()).data;
  const grant = { id: randomUUID(), enabled: true, nodeId: node.id, agentId: agent.id, taskId: task.id, applicationId: 'test.chat', recipient: { id: '0.0.0', role: 'AXButton', name: 'Fixture contact' }, composer: { id: '0.0.1', role: 'AXTextArea', name: 'Compose' }, send: { id: '0.0.2', role: 'AXButton', name: 'Send' }, incomingMarker: 'Received:', maxCharacters: 2000, maxPerHour: 60, memoryEnabled: false, memoryRetentionDays: 365, allowProactive: false };
  const media = { enabled: false, open: { id: '0.0.3', role: 'AXButton', name: 'Attach file' }, send: { id: '0.0.4.1', role: 'AXButton', name: 'Send attachment' }, maxMiB: 20, contentTypes: ['application/pdf', 'audio/wav'], receive: { enabled: false, download: { id: '0.0.5.1', role: 'AXButton', name: 'Download' }, incomingMarkers: ['Incoming file:'] } };
  const configured = await request.put(`${root}/autonomy`, { data: { enabled: true, mode: 'bounded', policy: { ...previous.policy, allowedApps: ['test.chat'], capabilities: ['computer'], computerReplyGrants: [{ ...grant, media }] } } });
  expect(configured.ok()).toBe(true);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const recoveryAction = randomUUID();
  let recoveryState = 'available';
  let extraWindow = false;
  const recoveryCommands: string[] = [];
  await page.route(`**${root}/computers`, async route => {
    if (route.request().method() !== 'GET') {
      const input = route.request().postDataJSON();
      recoveryCommands.push(input.command);
      if (input.command === 'focus') return route.fulfill({ json: { data: { kind: 'action', completed: true } } });
      if (input.command === 'reply_recovery') {
        expect(input.targetId).toBe('42:cg:9');
        if (input.actionId) {
          expect(input.actionId).toBe(recoveryAction); expect(input.expectedDraftHash).toBe('b'.repeat(64)); recoveryState = 'repaired';
        }
        return route.fulfill({ json: { data: { kind: 'reply_recovery', grantId: grant.id, targetId: '42:cg:9', actionId: recoveryAction, draftHash: 'b'.repeat(64), state: recoveryState } } });
      }
      if (input.command === 'media_recovery') {
        if (input.actionId) {
          expect(input.actionId).toBe(recoveryAction); expect(input.expectedRequestDigest).toBe('a'.repeat(64)); recoveryState = 'repaired';
        }
        return route.fulfill({ json: { data: { kind: 'media_recovery', grantId: grant.id, targetId: '42:cg:9', actionId: recoveryAction, requestDigest: 'a'.repeat(64), state: recoveryState } } });
      }
      return route.continue();
    }
    await route.fulfill({ json: { data: { nodeId: node.id, config: { enabled: false, allowedApplications: ['test.chat'], allowedDisplays: [], evidenceRetentionDays: 14 }, snapshot: { platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'denied', screenRecording: 'unknown' }, displays: [], windows: [{ id: '42:cg:9', appId: 'test.chat', appName: 'Fixture', title: 'Fixture chat', bounds: null, focused: true }, ...(extraWindow ? [{ id: '42:cg:10', appId: 'test.chat', appName: 'Fixture', title: '', bounds: null, focused: false }] : [])], focusedWindowId: '42:cg:9' }, lastEvidence: null } } });
  });
  try {
    for (const theme of ['orkestrai-light', 'orkestrai-dark']) {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: theme } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/terminal?workspace=${workspace.id}&node=${node.id}`);
      const panel = page.getByTestId('computer-reply-controls').filter({ visible: true }).first();
      await panel.scrollIntoViewIfNeeded();
      await expect(panel.getByText('Fixture contact', { exact: true })).toBeVisible();
      const foreground = panel.getByRole('switch', { name: 'Temporary focus for sending (macOS)', exact: true });
      const navigation = panel.getByRole('switch', { name: 'Find and reopen this contact automatically (macOS)', exact: true });
      await expect(navigation).not.toBeChecked();
      await expect(navigation).toBeDisabled();
      await expect(foreground).not.toBeChecked();
      await foreground.click();
      await expect(foreground).toBeChecked();
      await expect(navigation).toBeEnabled();
      await navigation.click();
      await expect(navigation).toBeChecked();
      await expect.poll(async () => (await (await request.get(`${root}/autonomy`)).json()).data.policy.computerReplyGrants[0].allowConversationNavigation).toBe(true);
      await navigation.click();
      await expect(navigation).not.toBeChecked();
      await expect.poll(async () => (await (await request.get(`${root}/autonomy`)).json()).data.policy.computerReplyGrants[0].allowForegroundSend).toBe(true);
      await panel.screenshot({ path: `test-results/companion-foreground-${theme}.png` });
      await foreground.click();
      await expect(foreground).not.toBeChecked();
      await expect.poll(async () => (await (await request.get(`${root}/autonomy`)).json()).data.policy.computerReplyGrants[0].allowForegroundSend).toBe(false);
      const profile = panel.getByTestId('companion-profile');
      await profile.locator('summary').click();
      await profile.getByRole('textbox', { name: 'Companion name', exact: true }).fill('Nico');
      await profile.getByRole('textbox', { name: 'Owner instructions', exact: true }).fill('Friendly companion with dry humor. Never impersonate the owner.');
      await profile.getByRole('button', { name: 'Reply voice', exact: true }).click();
      await expect(page.getByRole('option')).toHaveCount(30);
      await page.getByRole('option', { name: 'English (United States) · M4', exact: true }).click();
      await profile.getByRole('button', { name: 'Save persona', exact: true }).click();
      await expect.poll(async () => (await (await request.get(`${root}/autonomy`)).json()).data.policy.computerReplyGrants[0].companion?.voice).toBe('en-US-m4');
      await expect(profile.getByText('Free shell: app gates do not isolate the agent from the operating system.', { exact: true })).toBeVisible();
      await profile.screenshot({ path: `test-results/companion-profile-${theme}.png` });
      await profile.locator('summary').click();
      const memory = panel.getByTestId('conversation-memory');
      const toggle = memory.getByRole('switch', { name: 'Conversation memory', exact: true });
      if (!await toggle.isChecked()) await toggle.click();
      await expect(toggle).toBeChecked();
      const proactive = panel.getByRole('switch', { name: 'Send scheduled reminders and task results to this contact', exact: true });
      if (!await proactive.isChecked()) await proactive.click();
      await expect(proactive).toBeChecked();
      recoveryState = 'available';
      recoveryCommands.length = 0;
      const replyRecovery = panel.getByTestId('conversation-recovery');
      await replyRecovery.getByRole('button', { name: 'Inspect interrupted reply' }).click();
      const replyConfirmation = page.getByRole('alertdialog');
      await expect(replyConfirmation).toBeVisible();
      await expect(replyConfirmation).toContainText('must be empty or contain only the interrupted reply');
      await replyConfirmation.getByRole('button', { name: 'Authorize draft recovery' }).click();
      await expect(replyConfirmation).toBeHidden();
      await expect(replyRecovery.getByRole('status')).toContainText('not confirmation of sending');
      expect(recoveryCommands).toEqual(['reply_recovery', 'reply_recovery']);
      extraWindow = true;
      await expect(replyRecovery.getByRole('button', { name: 'Inspect interrupted reply' })).toBeDisabled({ timeout: 15_000 });
      await replyRecovery.getByRole('button', { name: 'Target', exact: true }).click({ timeout: 10_000 });
      await expect(page.getByRole('option')).toHaveCount(2);
      await page.getByRole('option', { name: 'Fixture chat · 42:cg:9', exact: true }).click();
      await replyRecovery.screenshot({ path: `test-results/companion-recovery-windows-${theme}.png` });
      recoveryState = 'available';
      await replyRecovery.getByRole('button', { name: 'Inspect interrupted reply' }).click();
      await expect(replyConfirmation).toBeVisible();
      await replyConfirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
      extraWindow = false;
      await expect(replyRecovery.getByRole('button', { name: 'Target', exact: true })).toHaveCount(0, { timeout: 15_000 });
      const attachments = panel.getByTestId('computer-media-controls');
      await attachments.locator('summary').click();
      const mediaEnabled = attachments.getByRole('switch', { name: 'Allow attachments', exact: true });
      if (!await mediaEnabled.isChecked()) await mediaEnabled.click();
      await expect(mediaEnabled).toBeChecked();
      await expect(attachments.getByRole('checkbox')).toHaveCount(10);
      await attachments.locator('[data-slot="select-trigger"]').first().click();
      await page.getByRole('option', { name: 'Photo', exact: true }).click();
      await expect(attachments.locator('[data-slot="select-trigger"]').first()).toHaveText('Photo');
      await expect(attachments.getByRole('button', { name: 'Save attachment authorization', exact: true })).toBeDisabled();
      await attachments.locator('[data-slot="select-trigger"]').first().click();
      await page.getByRole('option', { name: 'Document', exact: true }).click();
      const maxSize = attachments.getByRole('slider', { name: 'Maximum file size', exact: true });
      await maxSize.focus(); await maxSize.press('ArrowLeft');
      const expectedLimit = Number(await maxSize.getAttribute('aria-valuenow'));
      const receiving = attachments.getByRole('switch', { name: 'Receive attachments', exact: true });
      if (!await receiving.isChecked()) await receiving.click();
      await attachments.getByRole('button', { name: 'Save attachment authorization', exact: true }).click();
      await expect.poll(async () => (await (await request.get(`${root}/autonomy`)).json()).data.policy.computerReplyGrants[0].media.maxMiB).toBe(expectedLimit);
      await expect(receiving).toBeChecked();
      recoveryState = 'available';
      recoveryCommands.length = 0;
      const recovery = attachments.getByTestId('media-recovery');
      await recovery.getByRole('button', { name: 'Inspect interrupted attachment' }).click();
      const confirmation = page.getByRole('alertdialog');
      await expect(confirmation).toBeVisible();
      await expect(confirmation).toContainText('did not send this file manually');
      await confirmation.getByRole('button', { name: 'Authorize attachment recovery' }).click();
      await expect(confirmation).toBeHidden();
      await expect(recovery.getByRole('status')).toContainText('Nothing was sent by recovery');
      expect(recoveryCommands).toEqual(['focus', 'media_recovery', 'focus', 'media_recovery']);
      recoveryState = 'uncertain';
      await recovery.getByRole('button', { name: 'Inspect interrupted attachment' }).click();
      await expect(recovery.getByRole('status')).toContainText('replay remains blocked');
      await expect(confirmation).toBeHidden();
      await attachments.screenshot({ path: `test-results/companion-media-${theme}.png` });
      await attachments.locator('summary').click();
      await memory.getByText('History and facts', { exact: true }).click();
      await expect(memory.getByText('No results', { exact: true })).toBeVisible();
      await memory.getByRole('textbox', { name: 'Search conversation', exact: true }).fill('two weeks');
      await memory.getByRole('textbox').press('Enter');
      await expect(memory.getByText('No results', { exact: true })).toBeVisible();
      await panel.screenshot({ path: `test-results/companion-memory-${theme}.png` });
      expect(await panel.evaluate(e => { const viewport = e.closest('[data-testid="computer-workbench"]')!; return viewport.scrollWidth - viewport.clientWidth; })).toBeLessThanOrEqual(1);
      await page.reload();
      await expect(toggle).toBeChecked();
      await expect(proactive).toBeChecked();
    }
    expect(errors).toEqual([]);
  } finally {
    await page.goto('about:blank').catch(() => undefined);
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(root);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compressed audio uses Chromium decoding without microphone or another window', async ({ page }) => {
  test.skip(process.platform !== 'darwin', 'AAC fixture is encoded by the macOS system tool; no production ffmpeg dependency.');
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-audio-codec-'));
  try {
    const wav = Buffer.alloc(44 + 44100 * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
    for (let i = 0; i < 44100; i++) wav.writeInt16LE(Math.round(Math.sin(i * Math.PI * 880 / 44100) * 8000), 44 + i * 2);
    writeFileSync(join(dir, 'source.wav'), wav);
    execFileSync('/usr/bin/afconvert', [join(dir, 'source.wav'), join(dir, 'recording.m4a'), '-f', 'm4af', '-d', 'aac', '-b', '64000'], { timeout: 10000 });
    const compressed = readFileSync(join(dir, 'recording.m4a')).toString('base64');
    const { decodeInRenderer } = createRequire(import.meta.url)('../../electron/audio-decoder.cjs');
    await page.goto('/docs');
    const contextsBefore = page.context().pages().length;
    const output = await page.evaluate(`(${decodeInRenderer.toString()})(${JSON.stringify(compressed)})`);
    expect(typeof output).toBe('string');
    const decoded = Buffer.from(output as string, 'base64');
    expect(decoded.toString('ascii', 8, 12)).toBe('WAVE');
    expect(decoded.readUInt32LE(24)).toBe(16000);
    expect(decoded.length).toBeGreaterThan(30000);
    expect(decoded.length).toBeLessThan(40000);
    expect(decoded.subarray(44).some(byte => byte !== 0)).toBe(true);
    expect(page.context().pages()).toHaveLength(contextsBefore);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Computer recovers from failed initial loads and keeps its content during refresh', async ({ page, request }) => {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-computer-recovery-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `Computer recovery ${Date.now()}`, workingDir: dir } })).json()).data;
  const root = `/api/agent-room/workspaces/${workspace.id}`;
  const node = (await (await request.post(`${root}/nodes`, { data: { type: 'computer', title: 'Computer recovery' } })).json()).data;
  let fail = true;
  let release = () => {};
  let waiting = false;
  let delay = false;
  await page.route(`**${root}/computers`, async (route) => {
    if (delay) await new Promise<void>((resolve) => { release = resolve; waiting = true; });
    if (fail) return route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } });
    await route.fulfill({ json: { data: { nodeId: node.id, config: { enabled: false, allowedApplications: [], allowedDisplays: [], evidenceRetentionDays: 14 }, snapshot: { platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'unknown' }, displays: [], windows: [], focusedWindowId: null }, lastEvidence: null } } });
  });
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en' } });
    await page.goto(`/terminal?workspace=${workspace.id}&node=${node.id}`);
    await expect(page.getByTestId('computer-load-error')).toBeVisible();
    await expect(page.getByTestId('computer-loading')).toHaveCount(0);
    fail = false;
    await page.getByTestId('computer-load-error').getByRole('button', { name: 'Refresh desktop state' }).click();
    const panel = page.getByTestId('computer-workbench').filter({ visible: true }).first();
    await expect(panel).toBeVisible();
    delay = true;
    await panel.getByRole('button', { name: 'Refresh desktop state' }).click();
    await expect.poll(() => waiting).toBe(true);
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('computer-loading')).toHaveCount(0);
    fail = true;
    delay = false;
    release();
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel).toBeVisible();
    fail = false;
    await panel.getByRole('button', { name: 'Refresh desktop state' }).click();
    await expect(panel.getByRole('alert')).toHaveCount(0);
  } finally {
    release();
    await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: settings });
    await request.delete(root);
    rmSync(dir, { recursive: true, force: true });
  }
});
