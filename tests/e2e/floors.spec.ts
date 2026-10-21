import { expect, test } from '@playwright/test';
import { createNodeOnCanvas, selectCanvasTool } from './helpers.js';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    await page.locator('.toolbar [data-tool-group-trigger]').filter({ hasText: 'Workspace' }).click();
    await page.getByRole('menuitem', { name: /Andares/ }).click();
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

    // Refuses local files and shows the error without dropping the floor.
    const draftPath = join(dir, '.orkestrai', 'floors', 'feature-x', 'draft.txt');
    writeFileSync(draftPath, 'preserve this draft');
    await featureFloor.getByRole('button', { name: /feature-x/ }).click();
    await featureFloor.getByRole('button', { name: 'Excluir (manter branch)' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir (manter branch)' }).click();
    await expect(panel.getByRole('alert')).toContainText('local_changes');
    expect(existsSync(draftPath)).toBe(true);
    await expect(featureFloor).toBeVisible();

    // Remove only this test-owned draft, then confirm the clean worktree cleanup.
    rmSync(draftPath);
    await featureFloor.getByRole('button', { name: 'Excluir (manter branch)' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Excluir (manter branch)' }).click();
    await expect(featureFloor).toHaveCount(0);

    await cleanup(request, workspaceName);
    rmSync(dir, { recursive: true, force: true });
  });

  test('o terreo mostra o time inteiro, inclusive os agentes dos andares', async ({ page, request }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-team-floor-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E team floor ${Date.now()}`, workingDir: dir } })).json()).data as { id: string };
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    const make = async (data: Record<string, unknown>) => (await (await request.post(`${base}/nodes`, { data })).json()).data as { id: string };
    try {
      await make({ type: 'terminal', title: 'Maestro E2E', x: 0, y: 0, width: 640, height: 420, payload: { provider: 'claude', args: [], command: '/bin/cat', maestro: true } });
      // Laid out while the floor had its own view: it sits on top of the leader.
      const dev = await make({ type: 'terminal', title: 'Dev Frente B', x: 40, y: 200, width: 500, height: 360, payload: { provider: 'claude', args: [], command: '/bin/cat' } });
      const note = await make({ type: 'note', title: 'Rascunho do andar', x: 900, y: 0, width: 320, height: 220, payload: { content: 'só no andar' } });
      await make({ type: 'orchestrator', title: 'Painel do líder', x: 1300, y: 0, width: 380, height: 560, payload: {} });

      // A real floor needs a git worktree and free disk; the view only needs the floor and its nodes.
      const floorId = '018f0000-0000-7000-8000-00000000f100';
      await page.route(`**${base}/floors`, (route) => route.fulfill({ json: { data: [{ id: floorId, workspaceId: workspace.id, name: 'frente-b', branch: 'orkestrai/frente-b', path: dir, status: 'active' }] } }));
      await page.route(`**${base}/nodes`, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        const response = await route.fetch();
        const body = await response.json() as { data: Array<{ id: string; floorId: string | null }> };
        for (const node of body.data) if (node.id === dev.id || node.id === note.id) node.floorId = floorId;
        await route.fulfill({ response, json: body });
      });

      await page.goto(`/canvas?workspace=${workspace.id}`);
      const devNode = page.locator('.svelte-flow__node-terminal').filter({ hasText: 'Dev Frente B' });
      await expect(devNode).toBeVisible();
      await expect(page.locator('.svelte-flow__node-terminal').filter({ hasText: 'Maestro E2E' })).toBeVisible();
      await expect(page.locator('.canvas-note')).toHaveCount(0);
      const panel = page.locator('.svelte-flow__node-orchestrator');
      await expect(panel).toContainText('Maestro E2E');
      await expect(panel).toContainText('Dev Frente B');

      // The agent moved off the leader, and the move was saved.
      await expect.poll(async () => {
        const nodes = (await (await request.get(`${base}/nodes`)).json()).data as Array<{ id: string; y: number }>;
        return nodes.find((node) => node.id === dev.id)?.y ?? 0;
      }).toBeGreaterThanOrEqual(420);

      // The chip opens the floor, which shows only what belongs to it.
      await devNode.getByRole('button', { name: 'Trabalha no andar frente-b. Abrir o andar' }).click();
      await expect(page.locator('.canvas-note')).toHaveCount(1);
      await expect(page.locator('.svelte-flow__node-terminal').filter({ hasText: 'Maestro E2E' })).toHaveCount(0);
      await expect(devNode).toBeVisible();
      await expect(devNode.getByRole('button', { name: /Trabalha no andar/ })).toHaveCount(0);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
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
