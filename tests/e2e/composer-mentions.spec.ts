import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Typing @ (not only the @ button) offers the teammates to mention.
test('typing @ opens mentions in the Canvas message bar, the leader panel and Chat', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-mentions-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E mentions ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const make = async (data: Record<string, unknown>) => (await (await request.post(`${base}/nodes`, { data })).json()).data;
    await make({ type: 'terminal', title: 'Lead', x: 80, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [], command: '/bin/cat', maestro: true } });
    await make({ type: 'terminal', title: 'QA Upload', x: 640, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [], command: '/bin/cat' } });
    await make({ type: 'orchestrator', title: 'Painel do líder', x: 1200, y: 80, width: 380, height: 520, payload: {} });

    await page.goto(`/chat?workspace=${workspace.id}`);
    const chat = page.locator('#chat-composer-input');
    await chat.click();
    await page.keyboard.type('@Le');
    await expect(page.getByRole('listbox').getByRole('option', { name: /Lead/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(chat).toHaveValue('@Lead ');

    await page.goto(`/canvas?workspace=${workspace.id}`);
    const bar = page.locator('#canvas-composer-input');
    await bar.click();
    await page.keyboard.type('@QA');
    await expect(page.getByRole('listbox', { name: /Citar|Mention/ }).getByRole('option', { name: /QA Upload/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(bar).toHaveValue('@QA Upload ');

    const panelInput = page.getByTestId('orchestrator-node').getByRole('textbox');
    await panelInput.click();
    await page.keyboard.type('fala @q');
    await expect(page.getByTestId('orchestrator-node').getByRole('option', { name: /QA Upload/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(panelInput).toHaveValue('fala @QA Upload ');

  } finally {
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});

// Coming back to the Canvas from Chat shows the board (or that it is opening), never the start screen.
test('returning to the Canvas never flashes the start screen', async ({ page, request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-return-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E return ${Date.now()}`, workingDir: dir } })).json()).data;
  try {
    for (let index = 0; index < 40; index += 1) {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'note', title: `Nota ${index}`, x: (index % 8) * 340, y: Math.floor(index / 8) * 260, width: 300, height: 220, payload: { content: `# ${index}` } } });
    }
    await page.addInitScript(() => {
      const seen = { hero: false };
      (window as unknown as { __startScreen: typeof seen }).__startScreen = seen;
      new MutationObserver(() => {
        if (document.querySelector('.empty-hero')) seen.hero = true;
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    await expect(page.locator('.svelte-flow__node-note')).toHaveCount(40);
    await page.getByRole('link', { name: 'Conversa', exact: true }).click();
    await expect(page).toHaveURL(/\/chat/);
    await page.getByRole('link', { name: 'Canvas', exact: true }).click();
    await expect(page.locator('.svelte-flow__node-note')).toHaveCount(40);
    expect(await page.evaluate(() => (window as unknown as { __startScreen: { hero: boolean } }).__startScreen.hero)).toBe(false);
  } finally {
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});
