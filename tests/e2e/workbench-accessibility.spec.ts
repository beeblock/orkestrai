import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('workbench accessibility', () => {
  test('shows complete agent names and roles in the explorer and vertical tabs', async ({ page, request }) => {
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, string>;
    const title = 'Engenheiro de integrações e experiência multiplataforma';
    const role = 'Engenheiro de frontend Svelar especializado em acessibilidade';
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E readable agents ${Date.now()}`, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'terminal',
        title,
        x: 100,
        y: 100,
        width: 480,
        height: 320,
        payload: { command: '/bin/cat', args: [], role },
      },
    });
    const node = (await nodeResponse.json()).data as { id: string };

    try {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, workbenchTabPlacement: 'vertical' },
      });
      await page.goto(`/terminal?workspace=${workspace.id}&node=${node.id}`);

      const agent = page.getByTestId('workbench-agent-item').filter({ hasText: title });
      const name = agent.getByTestId('workbench-agent-name');
      const roleLabel = agent.getByTestId('workbench-agent-role');
      const verticalTab = page.getByTestId('workbench-vertical-tab-name').filter({ hasText: title });
      await expect(name).toHaveText(title);
      await expect(roleLabel).toHaveText(role);
      await expect(verticalTab).toHaveText(title);

      for (const label of [name, roleLabel, verticalTab]) {
        const layout = await label.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            whiteSpace: style.whiteSpace,
            textOverflow: style.textOverflow,
            fitsWidth: element.scrollWidth <= element.clientWidth,
          };
        });
        expect(layout.whiteSpace).not.toBe('nowrap');
        expect(layout.textOverflow).not.toBe('ellipsis');
        expect(layout.fitsWidth).toBe(true);
      }
    } finally {
      await page.goto('about:blank').catch(() => undefined);
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, workbenchTabPlacement: originalSettings.workbenchTabPlacement ?? 'vertical' },
      });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('has no serious accessibility violations in light or dark themes', async ({ page, request }) => {
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, string>;

    try {
      for (const appTheme of ['orkestrai-light', 'orkestrai-dark']) {
        await request.put('/api/agent-room/settings', {
          data: { ...originalSettings, appTheme, workbenchTabPlacement: 'vertical' },
        });
        await page.goto('/terminal');
        await expect(page.getByTestId('workbench-shell')).toBeVisible();

        const results = await new AxeBuilder({ page })
          .include('[data-testid="workbench-shell"]')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const serious = results.violations.filter((violation) => (
          violation.impact === 'serious' || violation.impact === 'critical'
        ));
        expect(serious, `${appTheme}: ${serious.map((item) => item.id).join(', ')}`).toEqual([]);
      }
    } finally {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, workbenchTabPlacement: originalSettings.workbenchTabPlacement ?? 'vertical' },
      });
    }
  });

  test('does not overflow the viewport at supported desktop sizes', async ({ page }) => {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/terminal');
      const shell = page.getByTestId('workbench-shell');
      await expect(shell).toBeVisible();
      const dimensions = await shell.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
        };
      });
      expect(dimensions.left).toBeGreaterThanOrEqual(0);
      expect(dimensions.top).toBeGreaterThanOrEqual(0);
      expect(dimensions.right).toBeLessThanOrEqual(viewport.width);
      expect(dimensions.bottom).toBeLessThanOrEqual(viewport.height);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(viewport.width);
      expect(dimensions.scrollHeight).toBeLessThanOrEqual(viewport.height);
    }
  });
});
