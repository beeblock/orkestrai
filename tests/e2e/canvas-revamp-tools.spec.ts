import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectCanvasTool } from './helpers';

test.describe('canvas revamp tools', () => {
  test('draws with the pen, shows an agent as a conversation and reuses a score', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-tools-'));
    const source = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E tools ${Date.now()}`, workingDir: dir } })).json()).data;
    const target = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E score target ${Date.now()}`, workingDir: dir } })).json()).data;
    const base = `/api/agent-room/workspaces/${source.id}`;
    let scoreId: string | null = null;
    try {
      const agent = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Reviewer', x: 400, y: 120, width: 520, height: 340, payload: { provider: 'claude', args: [], command: '/bin/cat', role: null } } })).json()).data;
      const note = (await (await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Checklist', x: 1000, y: 120, width: 300, height: 200, payload: { content: '- one' } } })).json()).data;
      await request.post(`${base}/edges`, { data: { sourceNodeId: agent.id, targetNodeId: note.id } });

      await page.goto(`/canvas?workspace=${source.id}`);
      await expect(page.locator('.canvas-terminal')).toHaveCount(1);

      // Conversation face: same node, the agent's direct conversation instead of the terminal.
      await page.locator('.canvas-terminal .face-toggle').click();
      await expect(page.getByTestId('agent-chat-face')).toBeVisible();
      await page.locator('.canvas-terminal .face-toggle').click();
      await expect(page.getByTestId('agent-chat-face')).toHaveCount(0);

      // Pen: a stroke on the empty canvas becomes a freehand shape.
      await selectCanvasTool(page, 'Caneta');
      await expect(page.getByRole('menu')).toHaveCount(0);
      const pane = page.locator('.svelte-flow__pane');
      const box = (await pane.boundingBox())!;
      await page.mouse.move(box.x + 420, box.y + 620);
      await page.mouse.down();
      for (let step = 1; step <= 12; step += 1) await page.mouse.move(box.x + 420 + step * 18, box.y + 620 + Math.sin(step) * 30);
      await page.mouse.up();
      await expect(page.locator('.svelte-flow__node-shape')).toHaveCount(1);

      // A score keeps the chosen nodes and their connection, and lands in another workspace.
      const saved = await request.post('/api/agent-room/presets', { data: { workspaceId: source.id, name: 'Review squad', nodeIds: [agent.id, note.id] } });
      expect(saved.status()).toBe(201);
      scoreId = (await saved.json()).data.id;
      await page.reload();
      // Scores live in the Canvas panel rail (right).
      await page.locator('[data-rail-item="scores"]').click();
      await expect(page.getByRole('region', { name: 'Partituras' })).toContainText('Review squad');
      const applied = await request.post(`/api/agent-room/presets/${scoreId}/apply`, { data: { workspaceId: target.id } });
      expect(applied.ok()).toBe(true);
      const placed = (await (await request.get(`/api/agent-room/workspaces/${target.id}/nodes`)).json()).data as Array<{ type: string; title: string }>;
      expect(placed.map((node) => node.title).sort()).toEqual(['Checklist', 'Reviewer']);
      const edges = (await (await request.get(`/api/agent-room/workspaces/${target.id}/edges`)).json()).data as unknown[];
      expect(edges).toHaveLength(1);
    } finally {
      if (scoreId) await request.delete(`/api/agent-room/presets/${scoreId}`);
      await request.delete(`/api/agent-room/workspaces/${source.id}`);
      await request.delete(`/api/agent-room/workspaces/${target.id}`);
    }
  });

  test('reopens a workspace at the zoom it was left at', async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-viewport-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E viewport ${Date.now()}`, workingDir: dir } })).json()).data;
    try {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: { type: 'note', title: 'Anchor', x: 0, y: 0, width: 300, height: 200, payload: { content: 'anchor' } } });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const zoom = page.locator('.zoom-level');
      await expect(zoom).toHaveText('100%');
      await page.locator('.svelte-flow__controls-zoomout').click();
      await page.locator('.svelte-flow__controls-zoomout').click();
      await expect(zoom).not.toHaveText('100%');
      // Let the zoom animation settle before reading where the board was left.
      await page.waitForTimeout(800);
      const left = await zoom.textContent();
      await page.reload();
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1);
      await expect(zoom).toHaveText(left!);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
