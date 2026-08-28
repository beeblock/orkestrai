import { expect, test } from '@playwright/test';

test.describe('native image workflows', () => {
  test('updates and persists the native Codex ImageGen contract', async ({ page, request }) => {
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E image workflow ${Date.now()}`, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const workflowResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'imageWorkflow',
        title: 'Character Variants',
        x: 540,
        y: 100,
        width: 440,
        height: 560,
        payload: {
          schemaVersion: 1,
          prompt: 'Create a consistent character pose.',
          transparentBackground: true,
          count: 2,
          outputDirectory: 'generated/images',
          filePrefix: 'character',
          status: 'idle',
          history: [],
        },
      },
    });
    const workflow = (await workflowResponse.json()).data as { id: string };
    const noteResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'note', title: 'Visual Brief', x: 80, y: 100, width: 320, height: 220, payload: { content: '# Palette\nRed, white, black.' } },
    });
    const note = (await noteResponse.json()).data as { id: string };
    const referenceResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'image', title: 'Character Reference', x: 80, y: 380, width: 280, height: 240, payload: { path: 'references/character.png' } },
    });
    const reference = (await referenceResponse.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const node = page.locator('.canvas-image-workflow');
      await expect(node).toBeVisible();
      await expect(node).toContainText('0 notas de contexto');
      await expect(node).toContainText('0 referências');

      await request.post(`/api/agent-room/workspaces/${workspace.id}/edges`, {
        data: { sourceNodeId: note.id, targetNodeId: workflow.id },
      });
      await request.post(`/api/agent-room/workspaces/${workspace.id}/edges`, {
        data: { sourceNodeId: reference.id, targetNodeId: workflow.id },
      });

      await expect(node).toContainText('1 notas de contexto');
      await expect(node).toContainText('1 referências');
      await expect(node.getByRole('button', { name: 'Conexões' })).toContainText('2');

      await node.getByRole('combobox', { name: 'Resultados' }).selectOption('10');
      await node.getByRole('switch').click();
      await expect(node.getByRole('switch')).not.toBeChecked();
      await node.getByRole('textbox', { name: 'Pasta do workspace' }).fill('assets/generated');
      await node.getByRole('textbox', { name: 'Pasta do workspace' }).blur();

      await page.reload();
      const restored = page.locator('.canvas-image-workflow');
      await expect(restored.getByRole('combobox', { name: 'Resultados' })).toHaveValue('10');
      await expect(restored.getByRole('switch')).not.toBeChecked();
      await expect(restored.getByRole('textbox', { name: 'Pasta do workspace' })).toHaveValue('assets/generated');

      await page.goto(`/terminal?workspace=${workspace.id}&node=${workflow.id}`);
      const workbenchNode = page.locator('.canvas-image-workflow');
      await expect(workbenchNode).toBeVisible();
      await expect(workbenchNode).toContainText('Codex ImageGen');
      await expect(workbenchNode.getByRole('textbox', { name: 'Pasta do workspace' })).toHaveValue('assets/generated');
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
