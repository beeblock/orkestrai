import { expect, test } from '@playwright/test';

test.describe('Focus agent panel', () => {
  test('shows the open agent in the header, beside its panel, and scopes the explorer', async ({ page, request }) => {
    const runId = Date.now();
    const created: string[] = [];
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    await request.put('/api/agent-room/settings', { data: { ...originalSettings, workbenchTabPlacement: 'horizontal' } });
    try {
      const [first, second] = await Promise.all([`E2E foco A ${runId}`, `E2E foco B ${runId}`].map(async (name) => {
        const response = await request.post('/api/agent-room/workspaces', { data: { name, workingDir: '/tmp' } });
        const workspace = (await response.json()).data as { id: string; name: string };
        created.push(workspace.id);
        return workspace;
      }));
      const agentTitle = `Revisor E2E ${runId}`;
      const nodeResponse = await request.post(`/api/agent-room/workspaces/${first.id}/nodes`, {
        data: {
          type: 'terminal',
          title: agentTitle,
          x: 120,
          y: 140,
          width: 560,
          height: 360,
          payload: { command: '/bin/sh', args: [], role: 'Revisão de código' },
        },
      });
      const agent = (await nodeResponse.json()).data as { id: string };

      await page.goto(`/terminal?workspace=${first.id}&node=${agent.id}`);
      const header = page.getByTestId('terminal-workspace-header');
      await expect(header).toContainText(agentTitle);
      await expect(header).toContainText('Revisão de código');
      await expect(page.getByRole('tab', { name: agentTitle })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('workbench-vertical-tabs')).toHaveCount(0);

      // The explorer stays on the open workspace until every workspace is asked for.
      const tree = page.getByTestId('terminal-workspace-tree');
      await expect(tree).toContainText(first.name);
      await expect(tree).not.toContainText(second.name);
      await page.getByTestId('focus-all-workspaces').click();
      await expect(tree).toContainText(second.name);
      await page.getByTestId('focus-all-workspaces').click();
      await expect(tree).not.toContainText(second.name);

      const toggle = page.getByTestId('focus-agent-inspector-toggle');
      const panel = page.getByTestId('focus-agent-inspector');
      if (!(await panel.isVisible())) await toggle.click();
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(agentTitle);
      await expect(panel).toContainText('Conversa direta');
      await expect(panel.getByTestId('agent-chat-face')).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Mensagem de voz' })).toBeVisible();
      await panel.getByRole('textbox', { name: `Mensagem para ${agentTitle}` }).fill('oi');
      await expect(panel.getByRole('button', { name: 'Enviar' })).toBeEnabled();

      await page.reload();
      await expect(page.getByTestId('focus-agent-inspector')).toBeVisible();
      await page.getByTestId('focus-agent-inspector-toggle').click();
      await expect(page.getByTestId('focus-agent-inspector')).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('terminal-workspace-header')).toContainText(agentTitle);
      await expect(page.getByTestId('focus-agent-inspector')).toHaveCount(0);
    } finally {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, workbenchTabPlacement: originalSettings.workbenchTabPlacement ?? 'horizontal' } });
      for (const id of created) await request.delete(`/api/agent-room/workspaces/${id}`);
    }
  });
});
