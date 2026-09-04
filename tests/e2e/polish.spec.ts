import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function createWorkspaceIn(page: import('@playwright/test').Page, name: string) {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-polish-'));
  await page.goto('/canvas');
  await page.getByRole('button', { name: 'Novo workspace' }).click();
  await page.getByPlaceholder('Nome', { exact: true }).fill(name);
  await page.getByPlaceholder('Diretório de trabalho').fill(dir);
  await page.getByRole('button', { name: 'Criar' }).click();
  await page.locator('.workspace-list .workspace-item', { hasText: name }).click();
  await expect(page.locator('.workspace-list li.active')).toContainText(name, { timeout: 15_000 });
}

async function cleanup(request: import('@playwright/test').APIRequestContext, name: string) {
  const list = await request.get('/api/agent-room/workspaces');
  const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
  const created = workspaces.find((workspace) => workspace.name === name);
  if (created) await request.delete(`/api/agent-room/workspaces/${created.id}`);
}

test.describe('polimento do canvas', () => {
  test('paleta de comandos abre com Cmd+P e executa acao', async ({ page, request }) => {
    const workspaceName = `E2E palette ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName);

    await page.keyboard.press('Control+p');
    const palette = page.getByTestId('canvas-command-palette');
    await expect(palette).toBeVisible();

    await palette.locator('input').fill('Nova nota');
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-note')).toHaveCount(1);

    // Paleta tambem pula para um no existente
    await page.keyboard.press('Control+p');
    await palette.locator('input').fill('Nota');
    await page.keyboard.press('Enter');
    await expect(palette).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Huddles', exact: true }).click();
    const huddle = page.getByTestId('huddle-dialog');
    await expect(huddle).toBeVisible();

    await page.keyboard.press('Control+p');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(huddle).toBeVisible();

    await page.keyboard.press('Control+p');
    await expect(palette).toBeVisible();
    const paletteOverlay = page.locator('[data-dialog-overlay]').last();
    await paletteOverlay.click({ position: { x: 2, y: 2 } });
    await expect(palette).toHaveCount(0);
    await expect(huddle).toBeVisible();
    await huddle.getByRole('button', { name: /Fechar Huddles|Close Huddles|Cerrar Huddles/ }).click();
    await expect(huddle).toHaveCount(0);

    await cleanup(request, workspaceName);
  });

  test('portal abre URL em iframe', async ({ page, request }) => {
    const workspaceName = `E2E portal ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName);

    await createNodeOnCanvas(page, 'Portal');
    const portal = page.locator('.canvas-portal');
    await expect(portal).toBeVisible();

    await portal.locator('.portal-address').fill('localhost:5199/api/agent-room/status');
    await page.keyboard.press('Enter');
    await expect(portal.locator('iframe')).toBeVisible();

    // URL persistida
    await page.reload();
    await expect(page.locator('.canvas-portal iframe')).toBeVisible();

    await cleanup(request, workspaceName);
  });

  test('menu compacto do terminal escolhe e persiste um tema', async ({ page, request }) => {
    const workspaceName = `E2E theme ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName);

    await createNodeOnCanvas(page, 'Shell');
    const terminal = page.locator('.canvas-terminal');
    await expect(terminal).toBeVisible();

    await terminal.getByRole('button', { name: /Opções do terminal|Terminal options|Opciones de la terminal/ }).click();
    await page.getByRole('menuitem', { name: /Tema do terminal|Terminal theme|Tema de la terminal/ }).hover();
    await page.getByRole('menuitemradio', { name: 'Tokyo Night' }).click();

    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${created.id}/nodes`);
    const nodes = (await nodesResponse.json()).data as Array<{ payload: { theme?: string } }>;
    expect(nodes[0].payload.theme).toBe('tokyo-night');

    await cleanup(request, workspaceName);
  });

  test('no loop renderiza com configuracao', async ({ page, request }) => {
    const workspaceName = `E2E loop ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName);

    await createNodeOnCanvas(page, 'Loop');
    const loop = page.locator('.canvas-loop');
    await expect(loop).toBeVisible();
    await expect(loop.locator('textarea')).toBeVisible();
    await loop.locator('textarea').fill('objetivo de teste');
    await expect(loop.getByRole('button', { name: 'Rodar' })).toBeEnabled();

    await cleanup(request, workspaceName);
  });
});
