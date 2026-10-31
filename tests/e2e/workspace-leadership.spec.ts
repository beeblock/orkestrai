import { expect, test } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('transfers leadership from an existing agent menu and keeps review pending in the Kanban', async ({ page, request }) => {
  test.setTimeout(90_000);
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-leadership-e2e-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  const ws = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Leadership QA', workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${ws.id}`;
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en' } });
    const agents: Array<{ id: string; title: string }> = [];
    for (const [index, name] of ['Claude Primary', 'Codex Successor'].entries()) {
      const response = await request.post(`${base}/nodes`, { data: { type: 'terminal', title: name, x: 80 + index * 540, y: 80, width: 480, height: 300,
        payload: { provider: index ? 'codex' : 'claude', command: 'true', args: [], agentRuntimeMode: 'on_demand', maestro: index === 0 } } });
      expect(response.ok()).toBe(true); agents.push((await response.json()).data);
    }
    await request.post(`${base}/nodes`, { data: { type: 'tasks', title: 'Tasks', x: 80, y: 440, width: 900, height: 400, payload: {} } });
    await page.goto(`/canvas?workspace=${ws.id}`);
    await expect(page.locator('.svelte-flow__node-terminal')).toHaveCount(2);
    await page.getByTestId('terminal-actions-menu').first().click();
    await page.getByRole('menuitem', { name: 'Team leadership', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Team leadership' })).toBeVisible();
    await dialog.locator('#leadership-primary').click();
    await page.getByRole('option', { name: /Codex Successor/ }).click();
    await dialog.locator('#leadership-deputy').click();
    await page.getByRole('option', { name: /Claude Primary/ }).click();
    await dialog.getByRole('button', { name: 'Apply leadership' }).click();
    await expect(dialog).toHaveCount(0);
    const configuration = (await (await request.get(`${base}/leadership`)).json()).data.configuration;
    expect(configuration).toMatchObject({ leaderNodeId: agents[1].id, deputyNodeId: agents[0].id });
    const nodes = (await (await request.get(`${base}/nodes`)).json()).data;
    expect(nodes.find((node: { id: string }) => node.id === agents[0].id).payload).toMatchObject({ maestro: false, deputy: true });
    expect(nodes.find((node: { id: string }) => node.id === agents[1].id).payload).toMatchObject({ maestro: true, deputy: false });
    await writeFile(join(dir, 'feature.ts'), 'export const feature = true;');
    const card = (await (await request.post(`${base}/tasks`, { data: { title: 'Review this feature', status: 'doing' } })).json()).data;
    const completion = (await (await request.patch(`${base}/tasks/${card.id}`, { data: { status: 'done' } })).json()).data;
    expect(completion.status).toBe('doing');
    expect(completion.completionReview.status).toBe('collecting');
    const prepared = await request.post(`${base}/leadership`, { data: { command: 'review_prepare', taskId: card.id, artifacts: [{ kind: 'file', path: 'feature.ts' }] } });
    expect(prepared.ok()).toBe(true);
    const review = (await prepared.json()).data;
    // The owner can request and read review, but cannot cast either agent's vote.
    const spoof = await request.post(`${base}/leadership`, { data: { command: 'review_decide', reviewId: review.id, expectedRevision: review.revision, decision: 'approve', evidence: ['Test'], findings: [] } });
    expect(spoof.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Joint review', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Joint review', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Delivery review', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Has not reviewed yet', { exact: true })).toHaveCount(2);
    await expect(page.getByRole('dialog').getByText('feature.ts', { exact: true })).toBeVisible();
  } finally {
    await request.delete(base);
    await request.put('/api/agent-room/settings', { data: settings });
    await rm(dir, { recursive: true, force: true });
  }
});
