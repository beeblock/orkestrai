import { expect, test } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const platform of ['Win32', 'Linux x86_64', 'MacIntel']) {
  test(`keeps the team and unsent prompt after Design navigation (${platform})`, async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-design-return-'));
    await page.addInitScript((value) => Object.defineProperty(navigator, 'platform', { get: () => value }), platform);
    const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `Design return ${Date.now()}`, workingDir: dir },
    })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    const ids: string[] = [];
    try {
      await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en' } });
      for (let i = 0; i < 4; i++) {
        const result = await request.post(`${base}/nodes`, { data: {
          type: 'terminal', title: i === 0 ? 'Design Lead' : `Specialist ${i}`,
          x: 80 + (i % 2) * 600, y: 80 + Math.floor(i / 2) * 400,
          width: 480, height: 300,
          payload: { provider: 'claude', agentRuntimeMode: 'on_demand', args: [], maestro: i === 0 },
        } });
        expect(result.ok()).toBe(true);
        ids.push((await result.json()).data.id);
      }
      for (const targetNodeId of ids.slice(1)) {
        const linked = await request.post(`${base}/edges`, { data: { sourceNodeId: ids[0], targetNodeId } });
        expect(linked.ok()).toBe(true);
      }
      await page.goto(`/canvas?workspace=${workspace.id}`);
      await expect(page.locator('.svelte-flow__node-terminal')).toHaveCount(4);
      await expect(page.locator('.svelte-flow__node-terminal').first()).toBeInViewport();
      await expect(page.locator('.svelte-flow__edge')).toHaveCount(3);
      const input = page.locator('#canvas-composer-input');
      await input.fill('Keep this unsent implementation plan for the leader.');
      await page.getByRole('button', { name: 'Design options', exact: true }).click();
      await page.getByRole('menuitem', { name: /Blank design/ }).click();
      // Blank Design is a drawing tool: place a document on the empty board.
      const pane = page.locator('.svelte-flow__pane');
      const point = await pane.evaluate((element) => {
        const box = element.getBoundingClientRect();
        for (let y = box.top + 100; y < box.bottom - 100; y += 40) {
          for (let x = box.left + 100; x < box.right - 100; x += 40) {
            if (document.elementFromPoint(x, y) === element) return { x, y };
          }
        }
        throw new Error('No empty pane position to place the design');
      });
      await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId('canvas-design-mode')).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL((url) => url.pathname === '/canvas' && url.searchParams.get('workspace') === workspace.id);
      await expect(page.getByTestId('canvas-design-mode')).toHaveCount(0);
      await expect(page.locator('.svelte-flow__node-terminal')).toHaveCount(4);
      await expect(page.locator('.svelte-flow__node-terminal').first()).toBeInViewport();
      await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');
      const links = (await (await request.get(`${base}/edges`)).json()).data;
      expect(links).toHaveLength(3);
      const saved = (await (await request.get(`${base}/nodes`)).json()).data;
      expect(saved.filter((node: { id: string }) => ids.includes(node.id))).toHaveLength(4);

      // The editor's own Back button has the same behavior as browser Back.
      await page.locator('.svelte-flow__node-design').getByRole('button', { name: 'Edit design', exact: true }).first().click();
      await expect(page.getByTestId('canvas-design-mode')).toBeVisible();
      await page.getByRole('button', { name: 'Back to Canvas', exact: true }).click();
      await expect(page.getByTestId('canvas-design-mode')).toHaveCount(0);
      await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');

      // Also cover leaving the route, rather than merely closing the editor.
      await page.getByRole('link', { name: 'Chat', exact: true }).click();
      await page.getByRole('link', { name: 'Canvas', exact: true }).click();
      await expect(page.locator('.svelte-flow__node-terminal')).toHaveCount(4);
      await expect(page.locator('.svelte-flow__node-terminal').first()).toBeInViewport();
      await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');
      await mkdir(join(dir, 'other'));
      const other = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Independent draft', workingDir: join(dir, 'other') } })).json()).data;
      try {
        await page.goto(`/canvas?workspace=${other.id}`);
        await expect(input).toHaveValue('');
        await input.fill('A different workspace draft');
        await page.goto(`/canvas?workspace=${workspace.id}`);
        await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');
      } finally {
        await request.delete(`/api/agent-room/workspaces/${other.id}`);
      }
      await page.reload();
      await expect(page.locator('.svelte-flow__node-terminal')).toHaveCount(4);
      await expect(page.locator('.svelte-flow__node-terminal').first()).toBeInViewport();
      await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');

      // A stored send may complete after both the composer and its field remount.
      const responseGate = Promise.withResolvers<void>();
      const received = Promise.withResolvers<void>();
      await page.route(`**${base}/channels/*/messages`, async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        received.resolve();
        await responseGate.promise;
        await route.fulfill({ json: { data: { message: { id: '01900000-0000-7000-8000-000000000073' }, delivered: [{ ok: true }] } } });
      });
      await input.press('Enter');
      await received.promise;
      await page.getByRole('link', { name: 'Chat', exact: true }).click();
      await page.getByRole('link', { name: 'Canvas', exact: true }).click();
      await expect(input).toHaveValue('Keep this unsent implementation plan for the leader.');
      const send = page.locator('.composer-wrap').getByRole('button', { name: 'Send', exact: true });
      await expect(send).toBeDisabled();
      await input.fill('A newer unsent plan');
      responseGate.resolve();
      await expect(send).toBeEnabled();
      await expect(input).toHaveValue('A newer unsent plan');
      await page.unroute(`**${base}/channels/*/messages`);
      await page.route(`**${base}/channels/*/messages`, (route) => route.request().method() === 'POST'
        ? route.fulfill({ status: 500, json: { error: 'Storage unavailable' } })
        : route.continue());
      const failed = page.waitForResponse((response) => response.status() === 500 && response.url().includes(`${base}/channels/`));
      await input.press('Enter');
      await failed;
      await page.reload();
      await expect(input).toHaveValue('A newer unsent plan');
    } finally {
      await page.goto('about:blank').catch(() => undefined);
      await request.put('/api/agent-room/settings', { data: settings }).catch(() => undefined);
      await request.delete(base).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
}
