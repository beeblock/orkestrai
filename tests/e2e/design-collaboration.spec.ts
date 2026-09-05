import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('reviews a native design through comments and versioned proposals', async ({ page, request }) => {
  const directory = mkdtempSync(join(tmpdir(), 'orkestrai-design-collaboration-e2e-'));
  const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
  const workspace = (await (await request.post('/api/agent-room/workspaces', {
    data: { name: `E2E design collaboration ${Date.now()}`, workingDir: directory },
  })).json()).data as { id: string };
  const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
    data: { type: 'design', title: 'Collaborative review', x: 120, y: 120, width: 720, height: 520, payload: {} },
  })).json()).data as { id: string };
  const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
    revision: number;
    activePageId: string;
  };
  const elementId = randomUUID();
  await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
    data: {
      baseRevision: initial.revision,
      operations: [{
        kind: 'create',
        element: {
          id: elementId, pageId: initial.activePageId, parentId: null, type: 'rectangle', name: 'Review card',
          x: 180, y: 180, width: 260, height: 160, fill: '#ffffff',
        },
      }],
      summary: 'Seed collaborative design',
      actor: { kind: 'user', id: null, name: null, taskId: null },
    },
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  try {
    await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
    await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
    const editor = page.locator('[data-testid="canvas-design-mode"]');
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: 'Review card', exact: true }).click();
    await editor.getByRole('button', { name: 'Open agents and reviews', exact: true }).click();
    const panel = page.locator('[data-testid="design-collaboration-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('You', { exact: true }).first()).toBeVisible();

    await panel.getByPlaceholder('Describe the decision or feedback. Use @name to mention someone.').fill('Increase the card emphasis.');
    const commented = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
    await panel.getByRole('button', { name: 'Comment', exact: true }).click();
    await commented;
    await expect(panel.getByText('Increase the card emphasis.', { exact: true })).toBeVisible();

    await panel.getByRole('button', { name: 'New proposal', exact: true }).click();
    await panel.getByPlaceholder('What should change?').fill('Move the review card');
    const xField = panel.locator('label').filter({ hasText: /^X$/ }).locator('input');
    await xField.fill('240');
    const proposed = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
    await panel.getByRole('button', { name: 'Submit proposal', exact: true }).click();
    await proposed;
    let document = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      elements: Array<{ id: string; x: number }>;
      proposals: Array<{ status: string }>;
    };
    expect(document.elements.find((element) => element.id === elementId)?.x).toBe(180);
    expect(document.proposals[0]?.status).toBe('pending');

    const approved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(`/designs/${node.id}`));
    await panel.getByRole('button', { name: 'Approve', exact: true }).click();
    await approved;
    document = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data;
    expect(document.elements.find((element) => element.id === elementId)?.x).toBe(240);
    expect(document.proposals[0]?.status).toBe('approved');
    expect(pageErrors).toEqual([]);
  } finally {
    if (!page.isClosed()) await page.goto('about:blank');
    await request.put('/api/agent-room/settings', { data: originalSettings });
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    rmSync(directory, { recursive: true, force: true });
  }
});
