import { expect, test } from '@playwright/test';
import { selectAgentTool, selectCanvasTool } from './helpers.js';

test.describe('dialogo de criacao de agente', () => {
  test('desenhar terminal abre dialogo com nome/modelo/esforco/lider', async ({ page, request }) => {
    const workspaceName = `E2E dialog ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName, { timeout: 15_000 });

    // Desenha um Claude no canvas: o dialogo precisa abrir ANTES de criar.
    await selectAgentTool(page, 'Claude');
    await page.locator('.svelte-flow__pane').click({ position: { x: 600, y: 350 } });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Novo agente — Claude');
    await expect(page.locator('.canvas-terminal')).toHaveCount(0);

    // Nome + modelo + esforco. Lider: o checkbox JA vem marcado por padrao
    // (primeiro agente do workspace = lider, fluxo zero-config) — so confere.
    await dialog.locator('input').first().fill('Arquiteto');
    await dialog.locator('button[role="combobox"], [data-slot="select-trigger"]').first().click();
    await page.locator('[role="option"]').nth(1).click();
    const effortTrigger = dialog.locator('button[role="combobox"], [data-slot="select-trigger"]').nth(1);
    if (await effortTrigger.count()) {
      await effortTrigger.click();
      await page.locator('[role="option"]').nth(1).click();
    }
    await expect(dialog.locator('[role="checkbox"]')).toHaveAttribute('data-state', 'checked');
    const createAgent = dialog.getByRole('button', { name: 'Criar agente' });
    await expect(createAgent).toBeEnabled();
    await createAgent.click();

    await expect(page.locator('.canvas-terminal')).toHaveCount(1);

    // Payload persistido: titulo custom, args com --model, maestro true
    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`);
    const canvasNodes = (await nodesResponse.json()).data as Array<{ title: string; payload: { provider?: string; maestro?: boolean; args?: string[] } }>;
    expect(canvasNodes).toHaveLength(1);
    expect(canvasNodes[0].title).toBe('Arquiteto');
    expect(canvasNodes[0].payload.provider).toBe('claude');
    expect(canvasNodes[0].payload.maestro).toBe(true);
    expect(canvasNodes[0].payload.args).toContain('--model');

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('cancelar o dialogo nao cria o no', async ({ page, request }) => {
    const workspaceName = `E2E cancel ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName, { timeout: 15_000 });

    await selectCanvasTool(page, 'Shell');
    await page.locator('.svelte-flow__pane').click({ position: { x: 600, y: 350 } });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.canvas-terminal')).toHaveCount(0);

    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });
});
