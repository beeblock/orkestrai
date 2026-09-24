import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { selectCanvasTool } from './helpers.js';

test.describe('Council', () => {
  test('opens from a task with an accessible, bounded comparison form', async ({ page, request }) => {
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, unknown>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E council ${Date.now()}`, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string; name: string };
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'tasks', title: 'Decision Board', x: 420, y: 180, width: 720, height: 480, payload: {} },
    });
    const taskResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/tasks`, {
      data: {
        title: 'Choose the synchronization architecture',
        description: 'Compare recovery guarantees and delivery risk before implementation.',
        status: 'todo',
      },
    });
    const task = (await taskResponse.json()).data as { id: string; title: string; description: string };
    const agents = [
      { id: '00000000-0000-4000-8000-000000000011', title: 'Architecture Lead', provider: 'claude', model: 'opus', role: 'Architecture', maestro: true },
      { id: '00000000-0000-4000-8000-000000000012', title: 'Reliability Reviewer', provider: 'codex', model: 'gpt-5.6-codex', role: 'Reliability', maestro: false },
    ];

    try {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, appTheme: 'orkestrai-dark', uiLanguage: 'en' },
      });
      await page.route(`**/api/agent-room/workspaces/${workspace.id}/councils`, (route) => route.fulfill({
        json: { data: { councils: [], agents, tasks: [task], usage: [] } },
      }));
      await page.goto('/canvas');
      await page.getByRole('button', { name: workspace.name }).click();
      await selectCanvasTool(page, 'Council');

      const directDialog = page.getByTestId('council-dialog');
      await expect(directDialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(directDialog).toBeHidden();

      await page.getByRole('button', { name: 'Ask for perspectives' }).click();

      const dialog = page.getByTestId('council-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('textbox', { name: 'Decision title' })).toHaveValue(`Council: ${task.title}`);
      await expect(dialog.getByRole('textbox', { name: 'Objective and constraints' }))
        .toHaveValue(`${task.title}\n\n${task.description}`);

      await dialog.getByRole('checkbox', { name: 'Select Architecture Lead' }).check();
      await dialog.getByRole('checkbox', { name: 'Select Reliability Reviewer' }).check();
      await expect(dialog.getByText('Execution limit: 3')).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Start council' })).toBeEnabled();

      const results = await new AxeBuilder({ page })
        .include('[data-testid="council-dialog"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = results.violations.filter((violation) => (
        violation.impact === 'serious' || violation.impact === 'critical'
      ));
      expect(serious, serious.map((item) => item.id).join(', ')).toEqual([]);
    } finally {
      // After a timeout the page may already be closed; settings must still be restored.
      await page.goto('about:blank').catch(() => undefined);
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
