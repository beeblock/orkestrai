import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers';

test.describe('quadro de tarefas (kanban)', () => {
  test('cria, arrasta entre colunas, edita e remove tarefas', async ({ page, request }) => {
    const workspaceName = `E2E kanban ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    // Creation already opens the workspace; wait for that load before drawing.
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    await createNodeOnCanvas(page, 'Tarefas');
    await expect(page.locator('.canvas-tasks')).toHaveCount(1);

    // Adiciona duas tarefas pelo composer (abre, preenche, Enter — fecha e reabre)
    const board = page.locator('.canvas-tasks');
    for (const title of ['Revisar PR do auth', 'Escrever testes do parser']) {
      await board.locator('.tb-add-open').click();
      const input = board.locator('.tb-composer input');
      await input.fill(title);
      await input.press('Enter');
      await expect(board.locator('.tb-composer')).toHaveCount(0);
    }
    await expect(board.locator('.tb-card')).toHaveCount(2);
    await expect(board.locator('.tb-column').first()).toContainText('A fazer');

    // Arrasta a primeira tarefa para "Fazendo" (drag and drop)
    const firstCard = board.locator('.tb-card').first();
    const doingColumn = board.locator('.tb-column').nth(1);
    await firstCard.dragTo(doingColumn);
    await expect(doingColumn.locator('.tb-card')).toHaveCount(1);

    // Edita o titulo com duplo-clique
    await board.locator('.tb-card .tb-title').first().dblclick();
    await board.locator('.tb-edit').fill('Revisar PR do auth (urgente)');
    await page.keyboard.press('Enter');
    await expect(board.locator('.tb-card .tb-title').first()).toHaveText('Revisar PR do auth (urgente)');

    // Persistiu no backend?
    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    const tasksResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/tasks`);
    const tasks = (await tasksResponse.json()).data as Array<{ title: string; status: string }>;
    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.status).sort()).toEqual(['doing', 'todo']);

    // Remove uma tarefa pela acao nomeada (outros icones podem vir antes dela).
    await board.locator('.tb-card').first().getByRole('button', { name: 'Remover tarefa' }).click();
    await expect(board.locator('.tb-card')).toHaveCount(1);

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });
});
