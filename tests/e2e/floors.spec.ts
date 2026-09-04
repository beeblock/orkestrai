import { expect, test } from '@playwright/test';
import { createNodeOnCanvas, selectCanvasTool } from './helpers.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function createWorkspaceIn(page: import('@playwright/test').Page, name: string, dir: string) {
  await page.goto('/canvas');
  await page.getByRole('button', { name: 'Novo workspace' }).click();
  await page.getByPlaceholder('Nome', { exact: true }).fill(name);
  await page.getByPlaceholder('Diretório de trabalho').fill(dir);
  await page.getByRole('button', { name: 'Criar' }).click();
  await expect(page.locator('.workspace-list li.active')).toContainText(name, { timeout: 15_000 });
}

async function cleanup(request: import('@playwright/test').APIRequestContext, name: string) {
  const list = await request.get('/api/agent-room/workspaces');
  const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
  const created = workspaces.find((workspace) => workspace.name === name);
  if (created) await request.delete(`/api/agent-room/workspaces/${created.id}`);
}

test.describe('andares e rotinas', () => {
  test('cria andar, alterna visao e exclui', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-floor-'));
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'e2e@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# x\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const workspaceName = `E2E floor ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName, dir);

    // Adiciona uma nota no terreo
    await createNodeOnCanvas(page, 'Nota');
    await expect(page.locator('.canvas-note')).toHaveCount(1);

    // Abre o painel e cria um andar
    await page.getByRole('button', { name: /Andares/ }).click();
    const panel = page.locator('.side-panel');
    await expect(panel).toBeVisible();
    await panel.getByPlaceholder('Nome do andar').fill('feature-x');
    await panel.getByRole('button', { name: 'Criar andar' }).click();
    const featureFloor = panel.getByRole('article').filter({ hasText: 'feature-x' });
    await expect(featureFloor).toBeVisible({ timeout: 10_000 });

    // Alterna para o andar: canvas vazio (layout nao clonado)
    await featureFloor.getByRole('button', { name: /feature-x/ }).click();
    await expect(page.locator('.canvas-note')).toHaveCount(0);

    // Volta ao terreo: nota reaparece
    await panel.getByRole('article').filter({ hasText: 'Térreo' }).getByRole('button', { name: /Térreo/ }).click();
    await expect(page.locator('.canvas-note')).toHaveCount(1);

    // Exclui o andar
    await featureFloor.getByRole('button', { name: /feature-x/ }).click();
    await featureFloor.getByRole('button', { name: 'Excluir (manter branch)' }).click();
    await expect(featureFloor).toHaveCount(0);

    await cleanup(request, workspaceName);
  });

  test('automacao manual dispara prompt no terminal alvo', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-routine-'));
    const workspaceName = `E2E routine ${Date.now()}`;
    await createWorkspaceIn(page, workspaceName, dir);

    // Abre um shell para ser o alvo
    await createNodeOnCanvas(page, 'Shell');
    await expect(page.locator('.canvas-terminal .xterm')).toBeVisible({ timeout: 10_000 });
    // Aguarda a sessao PTY ser criada e o payload.sessionId ser persistido
    await page.waitForTimeout(2_500);

    // Cria uma automacao manual com prompt marcador e executa agora.
    await selectCanvasTool(page, 'Automações');
    const panel = page.getByTestId('automation-workspace');
    await expect(panel).toBeVisible();
    const marker = `rotina-${Date.now()}`;
    await panel.getByRole('button', { name: 'Nova automação' }).click();
    await panel.getByLabel('Nome').fill(marker);
    await panel.getByRole('button', { name: 'Agente de destino', exact: true }).click();
    await page.locator('[data-slot="select-item"]').filter({ hasText: 'Shell' }).click();
    await panel.getByRole('textbox', { name: 'Prompt', exact: true }).fill(`echo ${marker}`);
    await panel.getByRole('button', { name: 'Salvar automação' }).click();
    const automation = panel.getByRole('article').filter({ hasText: marker });
    await expect(automation).toBeVisible();

    await automation.getByRole('button', { name: 'Executar agora' }).click();
    await expect(page.locator('.canvas-terminal .terminal-container')).toContainText(marker, { timeout: 10_000 });

    await cleanup(request, workspaceName);
  });
});
