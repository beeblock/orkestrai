import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('reveals the exact source from image and editor headers without navigating or dragging the node', async ({ page, request }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-reveal-e2e-'));
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId: string | undefined;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en' } });
    await writeFile(join(root, 'reference.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#7058e8"/></svg>');
    await writeFile(join(root, 'source.txt'), 'Source file fixture');
    const workspace = await request.post('/api/agent-room/workspaces', { data: { name: 'Reveal source QA', workingDir: root, codeIntelligenceMode: 'disabled' } });
    expect(workspace.ok()).toBeTruthy();
    workspaceId = (await workspace.json()).data.id;
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    const image = (await (await request.post(`${base}/nodes`, { data: { type: 'image', title: 'Reference image', x: 60, y: 80, width: 300, height: 260, payload: { path: 'reference.svg' } } })).json()).data;
    const editor = (await (await request.post(`${base}/nodes`, { data: { type: 'editor', title: 'Source text', x: 420, y: 80, width: 520, height: 300, payload: { path: 'source.txt' } } })).json()).data;
    const calls: Array<{ path: string; select: boolean }> = [];
    await page.route(`**${base}/fs/open-folder`, async route => {
      const body = route.request().postDataJSON();
      calls.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { opened: true, path: body.path } }) });
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/canvas?workspace=${workspaceId}`);
    for (const [node, path] of [[image, 'reference.svg'], [editor, 'source.txt']] as const) {
      const card = page.locator(`[data-id="${node.id}"]`);
      await expect(card).toBeVisible();
      await card.hover();
      await card.getByRole('button', { name: 'Show file in folder', exact: true }).click();
      await expect.poll(() => calls.some(call => call.path === path && call.select === true)).toBe(true);
    }
    await expect(page).toHaveURL(new RegExp(`workspace=${workspaceId}`));
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('source-buttons.png'), fullPage: true });
    await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    await page.reload();
    await expect(page.getByRole('button', { name: 'Show file in folder', exact: true })).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('source-buttons-light.png'), fullPage: true });
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: original });
    await rm(root, { recursive: true, force: true });
  }
});

test('hides quick prompts globally, preserves the mounted draft and leaves terminal processes alone', async ({ page, request }) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-quick-prompt-e2e-'));
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  const workspaceIds: string[] = [];
  const killFrames: string[] = [];
  page.on('websocket', socket => socket.on('framesent', frame => {
    try { if (JSON.parse(String(frame.payload)).type === 'kill') killFrames.push(String(frame.payload)); } catch {}
  }));
  const settingsPage = await page.context().newPage();
  const otherPage = await page.context().newPage();
  try {
    await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en', showTerminalQuickPrompt: 'true' } });
    for (const name of ['first', 'second']) {
      const workingDir = join(root, name);
      await mkdir(workingDir);
      const response = await request.post('/api/agent-room/workspaces', { data: { name: `Quick bar ${name}`, workingDir, codeIntelligenceMode: 'disabled' } });
      expect(response.ok()).toBeTruthy();
      const id = (await response.json()).data.id;
      workspaceIds.push(id);
      for (let i = 0; i < (name === 'first' ? 2 : 1); i++) {
        const node = await request.post(`/api/agent-room/workspaces/${id}/nodes`, { data: { type: 'terminal', title: `Quick input ${i}`, x: 60 + i * 600, y: 80, width: 560, height: 350,
          payload: { command: process.execPath, args: ['-e', 'process.stdin.resume()'] } } });
        expect(node.ok()).toBeTruthy();
      }
    }
    await page.goto(`/canvas?workspace=${workspaceIds[0]}`);
    await expect(page.getByTestId('terminal-quick-prompt')).toHaveCount(2);
    await page.getByTestId('terminal-quick-prompt').first().fill('Draft survives visibility changes');
    await settingsPage.goto('/settings#terminal');
    const toggle = settingsPage.getByRole('switch', { name: 'Quick message bar on agent nodes', exact: true });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await settingsPage.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(settingsPage.getByText('Saved!', { exact: true })).toBeVisible();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('terminal-quick-prompt')).toHaveCount(0);
    await otherPage.goto(`/canvas?workspace=${workspaceIds[1]}`);
    await expect(otherPage.locator('.svelte-flow__node')).toHaveCount(1);
    await expect(otherPage.getByTestId('terminal-quick-prompt')).toHaveCount(0);
    expect((await (await request.get('/api/agent-room/settings')).json()).data.showTerminalQuickPrompt).toBe('false');
    await toggle.click();
    await settingsPage.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByTestId('terminal-quick-prompt')).toHaveCount(2);
    await expect(page.getByTestId('terminal-quick-prompt').first()).toHaveValue('Draft survives visibility changes');
    expect(killFrames).toEqual([]);
  } finally {
    await settingsPage.close();
    await otherPage.close();
    for (const id of workspaceIds) await request.delete(`/api/agent-room/workspaces/${id}`);
    await request.put('/api/agent-room/settings', { data: original });
    await rm(root, { recursive: true, force: true });
  }
});

test('reports a failed Settings save without replacing persisted preferences or showing Saved', async ({ page, request }) => {
  const original = (await (await request.get('/api/agent-room/settings')).json()).data;
  try {
    await request.put('/api/agent-room/settings', { data: { ...original, uiLanguage: 'en', showTerminalQuickPrompt: 'true' } });
    await page.goto('/settings#terminal');
    await page.getByRole('switch', { name: 'Quick message bar on agent nodes', exact: true }).click();
    await page.route('**/api/agent-room/settings', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, json: { error: 'Fixture failure' } }) : route.continue());
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByText('Could not save settings. Try again.', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved!', { exact: true })).toHaveCount(0);
    expect((await (await request.get('/api/agent-room/settings')).json()).data.showTerminalQuickPrompt).toBe('true');
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await request.put('/api/agent-room/settings', { data: original });
  }
});
