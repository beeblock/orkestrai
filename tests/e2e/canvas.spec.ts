import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers.js';

test.describe('canvas de workspaces', () => {
  test('ignora atalhos globais cujo alvo não é um elemento', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto('/canvas');
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
    });

    expect(pageErrors).toEqual([]);
  });

  test('aceita ferramenta e arquivo soltos sobre o painel do workspace vazio', async ({ page, request }) => {
    const created = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E blank drop ${Date.now()}`, workingDir: '/tmp' },
    });
    const workspace = (await created.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const blank = page.locator('.blank-card');
      await expect(blank).toBeVisible();

      // Regressão: o painel fica no centro, por cima do fundo do canvas; soltar
      // uma ferramenta do dock ali tem que criar o nó como no resto do canvas.
      await page.getByRole('button', { name: 'Nota markdown compartilhada com os agentes (specs, briefings)' }).dragTo(blank);
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1);
      await expect(blank).toBeHidden();

      await request.delete(`/api/agent-room/workspaces/${workspace.id}/nodes/${(await page.locator('.svelte-flow__node').getAttribute('data-id'))}`);
      await page.reload();
      await expect(blank).toBeVisible();

      // Arquivo local solto no mesmo ponto vira um documento no canvas.
      const dataTransfer = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(['# Brief\n\nCheckout review.'], 'brief.md', { type: 'text/markdown' }));
        return transfer;
      });
      await blank.dispatchEvent('drop', { dataTransfer });
      await expect(page.locator('.svelte-flow__node')).toHaveCount(1, { timeout: 15_000 });
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('mantém ações do terminal clicáveis quando um cliente de API sobrepõe sua borda', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const workspaceName = `E2E API overlap ${Date.now()}`;
    const created = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: '/tmp' },
    });
    const workspace = (await created.json()).data as { id: string };

    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'terminal', title: 'Overlapped shell', x: 80, y: 80, width: 560, height: 340,
        zIndex: 5, payload: { command: '/bin/zsh', args: [] },
      },
    });
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'apiClient', title: 'Overlapping API', x: 600, y: 80, width: 820, height: 560,
        zIndex: 0, payload: { requests: [], selectedRequestId: null, variables: {} },
      },
    });

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const terminal = page.locator('.canvas-terminal');
      await expect(terminal).toBeVisible();
      const apiClient = page.locator('.canvas-api-client');
      await expect(apiClient).toBeVisible();

      // Regressão exata: depois de criar uma request, o foco do input do
      // cliente não pode elevar a área invisível inteira acima dos vizinhos.
      await apiClient.locator('button[aria-label="Adicionar item à coleção"]').click();
      await page.getByRole('menuitem', { name: 'Adicionar request' }).click();
      await expect(apiClient.getByRole('textbox', { name: 'Nome do request' })).toBeVisible();

      // A região esquerda continua acessível e seleciona o terminal; o menu
      // fica justamente na faixa em que os dois nodes se sobrepõem.
      await terminal.locator('.node-header').click({ position: { x: 48, y: 12 } });
      await expect(page.locator('.svelte-flow__node-terminal')).toHaveClass(/selected/);
      await terminal.getByTestId('terminal-actions-menu').click();
      await expect(page.getByRole('menuitem', { name: 'Comandos salvos' })).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('organiza requests em pastas sem arrastar o node e salva runners independentes', async ({ page, request }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const created = await request.post('/api/agent-room/workspaces', { data: { name: `E2E API tree ${Date.now()}`, workingDir: '/tmp' } });
    const workspace = (await created.json()).data as { id: string };
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'apiClient', title: 'Project API', x: 120, y: 90, width: 820, height: 560, payload: { requests: [], variables: {} } },
    });
    const apiNode = (await nodeResponse.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const client = page.locator('.canvas-api-client');
      await expect(client).toBeVisible();
      const canvasNode = page.locator('.svelte-flow__node-apiClient');
      const originalBox = await canvasNode.boundingBox();

      await client.getByRole('button', { name: 'Adicionar item à coleção' }).click();
      await page.getByRole('menuitem', { name: 'Adicionar pasta' }).click();
      const folderDialog = page.getByTestId('api-client-folder-dialog');
      await folderDialog.getByRole('textbox').fill('Users');
      await folderDialog.getByRole('button', { name: 'Criar pasta' }).click();

      await client.getByRole('button', { name: 'Adicionar item à coleção' }).click();
      await page.getByRole('menuitem', { name: 'Adicionar request' }).click();

      await client.getByRole('textbox', { name: 'URL' }).fill('http://127.0.0.1:5199/api/admin/health');
      await client.getByRole('tab', { name: 'Body' }).click();
      await client.getByRole('button', { name: 'JSON', exact: true }).click();
      const bodyEditor = client.locator('.cm-editor').first();
      await expect(bodyEditor).toBeVisible();
      await bodyEditor.locator('.cm-content').click();
      await page.keyboard.insertText('{"hello":"world"}');
      await client.getByRole('button', { name: 'Formatar código' }).click();
      await expect(bodyEditor.locator('.cm-content')).toContainText('hello');
      await client.getByRole('button', { name: 'Nenhum', exact: true }).click();

      await client.getByRole('tab', { name: 'Scripts' }).click();
      await expect(client.locator('.cm-editor')).toHaveCount(2);
      await client.getByRole('button', { name: 'Enviar', exact: true }).click();
      const responseTab = client.getByRole('tab', { name: 'Resposta', exact: true });
      await expect(responseTab).toHaveAttribute('data-state', 'active');
      await expect(client.getByRole('tree', { name: 'Resposta estruturada' })).toBeVisible();

      const nodesBeforeDrag = await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json();
      const beforePayload = (nodesBeforeDrag.data as Array<{ id: string; payload: any }>).find((node) => node.id === apiNode.id)!.payload;
      const folderId = beforePayload.folders[0].id as string;
      const requestId = beforePayload.requests[0].id as string;
      await client.getByTestId(`api-request-drag-${requestId}`).dragTo(client.getByTestId(`api-folder-${folderId}`));
      await expect.poll(async () => {
        const result = await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json();
        return (result.data as Array<{ id: string; payload: any }>).find((node) => node.id === apiNode.id)!.payload.requests[0].folderId;
      }).toBe(folderId);

      const movedBox = await canvasNode.boundingBox();
      expect(movedBox?.x).toBeCloseTo(originalBox?.x ?? 0, 0);
      expect(movedBox?.y).toBeCloseTo(originalBox?.y ?? 0, 0);

      await client.getByTestId(`api-folder-${folderId}`).click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Adicionar request' }).click();
      const nodesWithSecondRequest = await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json();
      const requestsInFolder = (nodesWithSecondRequest.data as Array<{ id: string; payload: any }>)
        .find((node) => node.id === apiNode.id)!.payload.requests
        .filter((item: { folderId?: string }) => item.folderId === folderId);
      const secondRequestId = requestsInFolder.find((item: { id: string }) => item.id !== requestId).id as string;
      const dragHandle = client.getByTestId(`api-request-drag-${requestId}`);
      const dropTarget = client.getByTestId(`api-request-${secondRequestId}`);
      const dragBox = await dragHandle.boundingBox();
      const targetBox = await dropTarget.boundingBox();
      if (!dragBox || !targetBox) throw new Error('Request drag geometry is unavailable');
      await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height - 2, { steps: 8 });
      await expect(client.getByTestId(`api-drop-after-${secondRequestId}`)).toBeVisible();
      await page.mouse.up();
      await expect.poll(async () => {
        const result = await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json();
        return (result.data as Array<{ id: string; payload: any }>).find((node) => node.id === apiNode.id)!.payload.requests
          .filter((item: { folderId?: string }) => item.folderId === folderId)
          .sort((a: { sequence: number }, b: { sequence: number }) => a.sequence - b.sequence)
          .map((item: { id: string }) => item.id);
      }).toEqual([secondRequestId, requestId]);

      await client.getByRole('button', { name: 'Runners da coleção' }).click();
      const runnerDialog = page.getByTestId('api-client-runner-dialog');
      await runnerDialog.getByRole('button', { name: 'Adicionar runner' }).click();
      const runnerFooter = runnerDialog.getByTestId('api-client-runner-footer');
      await expect(runnerFooter).toBeVisible();
      await expect(runnerFooter.getByRole('button', { name: 'Duplicar' })).toBeVisible();
      await expect(runnerFooter.getByRole('button', { name: 'Excluir' })).toBeVisible();
      await expect(runnerFooter.getByRole('button', { name: 'Executar runner' })).toBeVisible();
      const dialogBox = await runnerDialog.boundingBox();
      const footerBox = await runnerFooter.boundingBox();
      expect((footerBox?.y ?? 0) + (footerBox?.height ?? 0)).toBeLessThanOrEqual((dialogBox?.y ?? 0) + (dialogBox?.height ?? 0) + 1);
      expect((footerBox?.y ?? 0) + (footerBox?.height ?? 0)).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
      await runnerDialog.getByRole('button', { name: 'Salvar runners' }).click();
      const runnerOrder = async () => {
        const result = await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json();
        return ((result.data as Array<{ id: string; payload: any }>).find((node) => node.id === apiNode.id)!.payload.runners ?? [])
          .map((runner: { requestIds: string[] }) => runner.requestIds);
      };
      await expect.poll(async () => (await runnerOrder()).length).toBe(1);
      const [initialOrder] = await runnerOrder();
      expect(initialOrder).toHaveLength(2);

      // Arrastar o puxador do primeiro request sobre o segundo inverte a ordem salva.
      await client.getByRole('button', { name: 'Runners da coleção' }).click();
      const runnerRows = runnerDialog.locator('.runner-request');
      await expect(runnerRows).toHaveCount(2);
      // A lista rola dentro do painel do runner, sem ficar presa sob o rodapé.
      await runnerRows.nth(1).scrollIntoViewIfNeeded();
      const gripBox = await runnerRows.nth(0).getByRole('button', { name: 'Arraste para reordenar o request' }).boundingBox();
      const secondRowBox = await runnerRows.nth(1).boundingBox();
      if (!gripBox || !secondRowBox) throw new Error('Runner drag geometry is unavailable');
      await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(secondRowBox.x + secondRowBox.width / 2, secondRowBox.y + secondRowBox.height / 2, { steps: 8 });
      await page.mouse.up();
      await runnerDialog.getByRole('button', { name: 'Salvar runners' }).click();
      await expect.poll(runnerOrder).toEqual([[initialOrder[1], initialOrder[0]]]);

      await client.getByTestId(`api-folder-${folderId}`).click({ button: 'right' });
      await expect(page.getByRole('menuitem', { name: 'Executar pasta' })).toBeVisible();
      await page.keyboard.press('Escape');
      await client.getByRole('button', { name: 'Importar coleção' }).click();
      await page.getByRole('menuitem', { name: 'Importar coleção' }).hover();
      await expect(page.getByRole('menuitem', { name: 'Importar coleção do Orkestrai' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Importar OpenAPI / Swagger' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Importar OpenCollection YAML' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Importar ambiente do Postman' })).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await page.getByRole('menuitem', { name: 'Exportar' }).hover();
      await expect(page.getByRole('menuitem', { name: 'Exportar coleção Bruno' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Exportar OpenAPI 3.1 YAML' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Exportar OpenCollection YAML' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Exportar coleção Orkestrai' })).toBeVisible();
      expect(pageErrors).toEqual([]);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('cria no de fluxo pela toolbar e persiste apos reload', async ({ page, request }) => {
    const workspaceName = `E2E flow ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    await createNodeOnCanvas(page, 'Fluxo');
    await expect(page.locator('.canvas-flow')).toBeVisible();

    await page.reload();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.canvas-flow')).toBeVisible();

    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName);
    if (created) await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });

  test('apagar nó pelo teclado pede confirmação (modal) e cancelar preserva', async ({ page, request }) => {
    const workspaceName = `E2E delete ${Date.now()}`;

    const created = await request.post('/api/agent-room/workspaces', { data: { name: workspaceName, workingDir: '/tmp' } });
    const workspace = ((await created.json()).data as { id: string });
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'note', title: 'Nota', x: 300, y: 200, width: 320, height: 220, payload: { content: '' } },
    });

    await page.goto('/canvas');
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    const note = page.locator('.canvas-note');
    await expect(note).toBeVisible({ timeout: 10_000 });

    // Seleciona o nó PELO CABEÇALHO (clicar no corpo foca o textarea e o
    // Delete vira edicao de texto) e aperta Delete: tem que ABRIR A MODAL
    await note.locator('.node-header').click();
    await page.keyboard.press('Delete');
    const dialog = page.locator('[role="alertdialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Apagar 1 nó');
    // Cancelar: o nó continua no canvas
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(note).toBeVisible();

    // De novo, agora confirmando: o nó some
    await note.locator('.node-header').click();
    await page.keyboard.press('Delete');
    await dialog.getByRole('button', { name: 'Apagar' }).click();
    await expect(note).toHaveCount(0);

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('cria workspace, adiciona nota e terminal, e persiste apos reload', async ({ page, request }) => {
    const workspaceName = `E2E ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();

    // Workspace ativo na sidebar
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    // Adiciona uma nota e escreve nela
    await createNodeOnCanvas(page, 'Nota');
    const note = page.locator('.canvas-note');
    await expect(note).toBeVisible();
    await note.locator('textarea').fill('# tarefa e2e');

    // Adiciona um terminal shell
    await createNodeOnCanvas(page, 'Shell', { x: 700, y: 600 });
    await expect(page.locator('.canvas-terminal')).toBeVisible();
    await expect(page.locator('.canvas-terminal .xterm')).toBeVisible({ timeout: 10_000 });

    // Aguarda o debounce da nota (600ms) + persistencia
    await page.waitForTimeout(1_200);

    // Recarrega: nota e terminal voltam do banco com conteudo
    await page.reload();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);
    await expect(page.locator('.canvas-note textarea')).toHaveValue('# tarefa e2e');
    await expect(page.locator('.canvas-terminal')).toBeVisible();

    // Limpeza: apaga o workspace pela API
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName);
    if (created) await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });

  test('renderiza e persiste aresta entre dois nos', async ({ page, request }) => {
    const workspaceName = `E2E edges ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    await createNodeOnCanvas(page, 'Nota');
    await createNodeOnCanvas(page, 'Nota', { x: 900, y: 300 });
    await expect(page.locator('.canvas-note')).toHaveCount(2);

    // Cria a conexao pela API (o drag entre handles e coberto pela biblioteca;
    // aqui validamos renderizacao + persistencia, que e a nossa parte).
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName)!;

    const nodesResponse = await request.get(`/api/agent-room/workspaces/${created.id}/nodes`);
    const canvasNodes = (await nodesResponse.json()).data as Array<{ id: string }>;
    await request.post(`/api/agent-room/workspaces/${created.id}/edges`, {
      data: { sourceNodeId: canvasNodes[0].id, targetNodeId: canvasNodes[1].id },
    });

    await page.goto(`/canvas?workspace=${created.id}`);
    await expect(page.locator('.canvas-note')).toHaveCount(2);
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

    // Ao apagar um no, a aresta some junto
    await request.delete(`/api/agent-room/workspaces/${created.id}/nodes/${canvasNodes[0].id}`);
    await page.goto(`/canvas?workspace=${created.id}`);
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(0);

    await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });

  test('conecta dois nos arrastando do handle (regressao: handles clicaveis)', async ({ page, request }) => {
    const workspaceName = `E2E drag ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    await createNodeOnCanvas(page, 'Nota', { x: 450, y: 300 });
    await createNodeOnCanvas(page, 'Nota', { x: 850, y: 480 });
    await expect(page.locator('.canvas-note')).toHaveCount(2);

    // Arrasto real do handle do primeiro no ate o handle do segundo —
    // cobre hit-test do handle (overflow/z-index do shell).
    const sourceHandle = page.locator('.canvas-note').first().locator('.svelte-flow__handle').first();
    const targetHandle = page.locator('.canvas-note').nth(1).locator('.svelte-flow__handle').first();
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
    await page.mouse.up();

    await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

    // Persistiu no backend?
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName)!;
    const edgesResponse = await request.get(`/api/agent-room/workspaces/${created.id}/edges`);
    expect(((await edgesResponse.json()).data as unknown[]).length).toBe(1);

    // Clica num ponto livre do traco (fora do handle e do X) para fixar o X
    await expect(page.locator('.orkestrai-edge path.edge-line')).toHaveCount(1);
    await page.waitForTimeout(2500); // espera a corda assentar (fisica)
    const ropePoint = await page.evaluate(() => {
      const path = document.querySelector<SVGPathElement>('.orkestrai-edge path.edge-line')!;
      const ctm = path.getScreenCTM()!;
      for (const fraction of [0.3, 0.4, 0.5, 0.6, 0.7, 0.25, 0.75]) {
        const point = path.getPointAtLength(path.getTotalLength() * fraction);
        const x = ctm.a * point.x + ctm.c * point.y + ctm.e;
        const y = ctm.b * point.x + ctm.d * point.y + ctm.f;
        const top = document.elementFromPoint(x, y);
        if (top === path || (top instanceof SVGPathElement && top.getAttribute('stroke') === 'transparent')) {
          return { x, y };
        }
      }
      throw new Error('Nenhum ponto livre encontrado na corda');
    });
    await page.mouse.click(ropePoint.x, ropePoint.y);
    await expect(page.locator('.edge-delete.pinned')).toHaveCount(1);
    await page.locator('.edge-delete.pinned').click();
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(0);

    await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });

  test('renomeia um no com duplo-clique no titulo e persiste', async ({ page, request }) => {
    const workspaceName = `E2E rename ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);
    await expect(page.locator('.svelte-flow__pane')).toBeVisible();

    await createNodeOnCanvas(page, 'Nota');
    await expect(page.locator('.canvas-note')).toHaveCount(1);

    await page.locator('.canvas-note .node-title').dblclick();
    await page.locator('.node-title-input').fill('Backlog do time');
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-note .node-title')).toHaveText('Backlog do time');

    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`);
    const canvasNodes = (await nodesResponse.json()).data as Array<{ title: string }>;
    expect(canvasNodes[0].title).toBe('Backlog do time');

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('edita nome e instrucoes do workspace', async ({ page, request }) => {
    const workspaceName = `E2E edit ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    await page.locator('.workspace-list li.active').getByRole('button', { name: 'Editar workspace' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Nome', { exact: true }).fill(`${workspaceName} renomeado`);
    await dialog.locator('textarea').fill('Sempre responda em pt-BR.');
    await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.locator('.workspace-list li.active')).toContainText('renomeado');

    // Instrucoes gravadas em AGENTS.md no diretorio de trabalho
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string; instructions: string | null }>;
    const created = workspaces.find((workspace) => workspace.name.includes(workspaceName))!;
    expect(created.instructions).toBe('Sempre responda em pt-BR.');

    await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });

  test('excluir o workspace ativo com PTY troca a rota sem derrubar a janela', async ({ page, request }) => {
    const fallbackResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E delete fallback ${Date.now()}`, workingDir: '/tmp' },
    });
    const fallback = (await fallbackResponse.json()).data as { id: string };
    const disposableResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E delete active ${Date.now()}`, workingDir: '/tmp' },
    });
    const disposable = (await disposableResponse.json()).data as { id: string };
    const terminalResponse = await request.post(`/api/agent-room/workspaces/${disposable.id}/nodes`, {
      data: {
        type: 'terminal',
        title: 'Shell descartavel',
        x: 120,
        y: 100,
        width: 560,
        height: 360,
        payload: { command: '/bin/sh', args: [] },
      },
    });
    const terminal = (await terminalResponse.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${disposable.id}&node=${terminal.id}`);
      await expect(page.locator('.canvas-terminal .xterm-helper-textarea')).toBeAttached({ timeout: 15_000 });

      await page.locator('.workspace-list li.active').getByRole('button', { name: 'Apagar workspace' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar' }).click();

      await expect.poll(() => new URL(page.url()).searchParams.get('workspace')).not.toBe(disposable.id);
      await expect(page).toHaveURL(/\/canvas\?workspace=/);
      await expect(page.locator('.workspace-list li.active')).toHaveCount(1);
      await expect(page.locator('.canvas-page')).toBeVisible();
    } finally {
      await request.delete(`/api/agent-room/workspaces/${fallback.id}`);
      await request.delete(`/api/agent-room/workspaces/${disposable.id}`).catch(() => undefined);
    }
  });
});
