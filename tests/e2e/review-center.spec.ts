import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Review Center', () => {
  test('reviews a structured Git diff and persists an offline agent decision', async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-review-center-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'e2e@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Orkestrai E2E'], { cwd: dir });
    writeFileSync(join(dir, 'feature.ts'), 'export const phase = 4;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir });

    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E Review Center ${Date.now()}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const agentResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'terminal', title: 'Responsible reviewer', x: 100, y: 100, width: 480, height: 320, payload: { role: 'Reviewer' } },
    });
    const agent = (await agentResponse.json()).data as { id: string };
    writeFileSync(join(dir, 'feature.ts'), 'export const phase = 5;\n');
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, uiLanguage: 'en', appTheme: 'orkestrai-light', workbenchTabPlacement: 'vertical' },
      });
      await page.goto(`/terminal?workspace=${workspace.id}&node=workbench-review-center%3A${workspace.id}`);
      const center = page.getByTestId('review-center');
      await expect(center).toBeVisible();
      await expect(center.getByRole('button', { name: 'M feature.ts' })).toBeVisible();
      await expect(center.locator('.monaco-diff-editor')).toBeVisible({ timeout: 30_000 });
      await expect(center.locator('.monaco-editor.modified-in-monaco-diff-editor .view-lines[data-mprt="8"]')).toContainText('phase = 5');

      await center.getByRole('button', { name: 'New review' }).click();
      await page.getByRole('textbox', { name: 'Review title' }).fill('Phase 5 delivery');
      await page.getByRole('textbox', { name: 'Summary and expected outcome' }).fill('Validate the Review Center delivery.');
      await page.getByRole('textbox', { name: 'Tests and checks' }).fill('Production build passed');
      await page.getByRole('combobox', { name: 'Responsible agent' }).selectOption(agent.id);
      await page.getByRole('button', { name: 'Create review' }).click();
      await expect(center).toContainText('Phase 5 delivery');

      await center.getByRole('button', { name: 'Comment' }).click();
      await center.getByPlaceholder('Describe what should be checked or changed...').fill('Keep the migration backward compatible.');
      await center.getByRole('button', { name: 'Add comment' }).click();
      await expect(center).toContainText('Keep the migration backward compatible.');

      await center.getByPlaceholder('Decision note or requested outcome...').fill('Add a regression test before merge.');
      await center.getByRole('button', { name: 'Changes', exact: true }).click();
      await expect(center).toContainText('Changes requested');
      await expect(center).toContainText('Add a regression test before merge.');

      await page.setViewportSize({ width: 820, height: 900 });
      await expect(center).toBeVisible();
      await page.setViewportSize({ width: 1440, height: 900 });
      await center.getByRole('button', { name: 'Refresh source control' }).click();
      expect(pageErrors).toEqual([]);
    } finally {
      await page.goto('about:blank').catch(() => undefined);
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
