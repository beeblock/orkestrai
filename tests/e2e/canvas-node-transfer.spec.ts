import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const mode of ['copy', 'move'] as const) {
  test(`${mode} 59 selected Canvas nodes through the transfer dialog`, async ({ page, request, playwright, baseURL }) => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-e2e-transfer-'));
    const workspaceIds: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      for (const name of ['Transfer source', 'Transfer destination']) {
        const response = await request.post('/api/agent-room/workspaces', { data: { name, workingDir: root } });
        expect(response.ok()).toBe(true);
        workspaceIds.push((await response.json()).data.id);
      }
      const [source, destination] = workspaceIds;
      const nodeIds: string[] = [];
      for (let index = 0; index < 59; index++) {
        const response = await request.post(`/api/agent-room/workspaces/${source}/nodes`, {
          data: { type: 'shape', title: `Item ${index}`, x: 100 + index % 10 * 100, y: 100 + Math.floor(index / 10) * 80, width: 70, height: 50, payload: { shape: 'rect', text: String(index) } },
        });
        expect(response.ok()).toBe(true);
        nodeIds.push((await response.json()).data.id);
        if (index) {
          const edge = await request.post(`/api/agent-room/workspaces/${source}/edges`, { data: { sourceNodeId: nodeIds[index - 1], targetNodeId: nodeIds[index] } });
          expect(edge.ok()).toBe(true);
        }
      }
      await page.goto(`/canvas?workspace=${source}`);
      const nodes = page.locator('.svelte-flow__node-shape');
      await expect(nodes).toHaveCount(59);
      await expect(nodes.first()).toBeVisible();
      await page.keyboard.press('ControlOrMeta+=');
      await expect.poll(async () => {
        const pane = await page.locator('.svelte-flow__pane').boundingBox();
        if (!pane) return false;
        return nodes.evaluateAll((elements, area) => elements.every(element => {
          const rect = element.getBoundingClientRect();
          return rect.left > area.x + 10 && rect.top > area.y + 10 && rect.right < area.x + area.width - 10 && rect.bottom < area.y + area.height - 10;
        }), pane);
      }).toBe(true);
      await nodes.first().click({ trial: true });
      const bounds = await nodes.evaluateAll(elements => {
        const rects = elements.map(element => element.getBoundingClientRect());
        return { left: Math.min(...rects.map(rect => rect.left)), top: Math.min(...rects.map(rect => rect.top)), right: Math.max(...rects.map(rect => rect.right)), bottom: Math.max(...rects.map(rect => rect.bottom)) };
      });
      await page.keyboard.down('Shift');
      await page.mouse.move(bounds.left - 8, bounds.top - 8);
      await page.mouse.down();
      await page.mouse.move(bounds.right + 8, bounds.bottom + 8, { steps: 12 });
      await page.mouse.up();
      await page.keyboard.up('Shift');
      await expect(page.getByText('59 selecionados', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Mover ou copiar seleção', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Transfira 59 nós selecionados para outro workspace.')).toBeVisible();
      await dialog.getByRole('button', { name: 'Workspace de destino', exact: true }).click();
      await page.getByRole('option', { name: 'Transfer destination', exact: true }).click();
      if (mode === 'move') await dialog.getByRole('tab', { name: 'Mover', exact: true }).click();
      const responsePromise = page.waitForResponse(response => response.url().endsWith(`/workspaces/${source}/nodes/transfer`) && response.request().method() === 'POST');
      await dialog.getByRole('button', { name: mode === 'copy' ? 'Copiar nós' : 'Mover nós', exact: true }).click();
      expect((await responsePromise).status()).toBe(201);
      await expect(dialog).not.toBeVisible();
      const destinationNodes = (await (await request.get(`/api/agent-room/workspaces/${destination}/nodes`)).json()).data;
      expect(destinationNodes).toHaveLength(59);
      expect((await (await request.get(`/api/agent-room/workspaces/${destination}/edges`)).json()).data).toHaveLength(58);
      const sourceNodes = (await (await request.get(`/api/agent-room/workspaces/${source}/nodes`)).json()).data;
      expect(sourceNodes).toHaveLength(mode === 'copy' ? 59 : 0);
      expect(errors).toEqual([]);
    } finally {
      const cleanup = await playwright.request.newContext({ baseURL });
      try {
        for (const id of workspaceIds) await cleanup.delete(`/api/agent-room/workspaces/${id}`);
      } finally {
        await cleanup.dispose();
        await rm(root, { recursive: true, force: true });
      }
    }
  });
}
