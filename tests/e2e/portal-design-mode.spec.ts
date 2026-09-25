import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Portal Design Mode', () => {
  test('keeps browser fallback explicit instead of silently exposing a broken inspector', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-portal-design-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E Portal Design ${Date.now()}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const portalResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'portal', title: 'Design preview', x: 120, y: 120, width: 720, height: 520,
        payload: { url: 'http://127.0.0.1:5199/docs' },
      },
    });
    const portal = (await portalResponse.json()).data as { id: string };

    try {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, uiLanguage: 'en', appTheme: 'orkestrai-light' },
      });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${portal.id}`);
      const portalNode = page.locator('.canvas-portal');
      await expect(portalNode).toBeVisible();
      await expect(portalNode.locator('.portal-navigation')).toHaveCSS('background-color', 'rgb(242, 244, 245)');
      await expect(portalNode.locator('.portal-address')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(portalNode.locator('.portal-body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(portalNode.locator('.portal-name')).toHaveText('Design preview');
      await expect(portalNode.locator('.portal-address')).toHaveValue('http://127.0.0.1:5199/docs');
      await portalNode.locator('.portal-control-chip').click();
      const settings = page.getByRole('dialog', { name: 'Managed browser' });
      await expect(settings.getByRole('button').filter({ hasText: 'Read and interact' })).toBeVisible();
      const agentAccess = settings.getByRole('button', { name: 'All workspace agents', exact: true });
      await expect(agentAccess).toBeVisible();
      await agentAccess.click();
      await page.getByRole('option', { name: 'Selected agents only', exact: true }).click();
      await settings.getByRole('button', { name: 'Selected agents only', exact: true }).click();
      await page.getByRole('option', { name: 'All workspace agents', exact: true }).click();
      const savedAccess = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/nodes/${portal.id}`));
      await settings.screenshot({ path: test.info().outputPath('portal-team-access.png') });
      await settings.getByRole('button', { name: 'Save changes', exact: true }).click();
      const savedPayload = await (await savedAccess).json();
      expect(savedPayload.data.payload).toMatchObject({ portalControl: 'interact', portalAgentAccess: 'workspace' });
      await expect(settings).not.toBeVisible();
      await portalNode.getByRole('button', { name: 'Rename portal' }).click();
      const nameInput = portalNode.getByRole('textbox', { name: 'Portal name' });
      await nameInput.fill('Checkout QA');
      const renamed = page.waitForResponse((response) =>
        response.request().method() === 'PATCH' && response.url().endsWith(`/nodes/${portal.id}`)
      );
      await nameInput.press('Enter');
      await renamed;
      await expect(portalNode.locator('.portal-name')).toHaveText('Checkout QA');
      await portalNode.getByRole('button', { name: 'Design inspection is available in the installed desktop app.' }).click();
      await expect(page.getByLabel('Notifications').getByText('Design inspection is available in the installed desktop app.')).toBeVisible();

      await portalNode.getByRole('button', { name: 'Test responsiveness' }).click();
      const toolbar = portalNode.getByTestId('portal-viewport-toolbar');
      const stage = portalNode.locator('.portal-stage');
      await expect(toolbar).toBeVisible();
      const [toolbarBox, stageBox] = await Promise.all([toolbar.boundingBox(), stage.boundingBox()]);
      expect(toolbarBox).not.toBeNull();
      expect(stageBox).not.toBeNull();
      expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(stageBox!.y + 1);

      await toolbar.getByRole('button', { name: 'Device' }).click();
      await page.getByRole('option', { name: /Laptop/ }).click();
      await expect(toolbar.getByRole('button', { name: 'Viewport dimensions: 1366 by 768 pixels' })).toBeVisible();
      const scrollState = await portalNode.locator('.portal-scroll').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }));
      expect(scrollState.scrollWidth).toBeGreaterThan(scrollState.clientWidth);

      await toolbar.getByRole('button', { name: 'Viewport dimensions: 1366 by 768 pixels' }).click();
      await expect(page.getByText('Viewport width', { exact: true })).toBeVisible();
      await expect(page.getByText('Viewport height', { exact: true })).toBeVisible();
    } finally {
      await page.goto('about:blank').catch(() => undefined);
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
