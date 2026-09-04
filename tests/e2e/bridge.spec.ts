import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers';

/**
 * A CLI `orkestrai` autentica com `Authorization: Bearer <token>` e NAO envia
 * token no corpo — todos os endpoints da ponte precisam aceitar isso
 * (regressao: bridgeAskSchema exigia token no corpo e o ask falhava com
 * "The given data was invalid").
 */
test.describe('ponte CLI (bridge)', () => {
  test('endpoints aceitam token apenas no header Authorization', async ({ request }) => {
    const workspaceName = `E2E bridge ${Date.now()}`;
    const wsResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: '/tmp' },
    });
    const workspace = (await wsResponse.json()).data as { id: string };

    const tokenResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/bridge-token`);
    const { token } = (await tokenResponse.json()).data as { token: string };
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    // notify: nao depende de PTY — precisa passar na validacao e resolver o workspace
    const notify = await request.post('/api/agent-room/bridge/notify', { headers, data: { message: 'oi da bridge' } });
    expect(notify.status(), await notify.text()).toBe(200);

    // nota: escreve conteudo via bridge sem token no corpo
    const noteResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'note', title: 'Nota bridge', x: 0, y: 0, width: 300, height: 200, payload: { content: 'v1' } },
    });
    const note = (await noteResponse.json()).data as { id: string };
    const writeNote = await request.put(`/api/agent-room/bridge/notes/${note.id}`, { headers, data: { content: 'v2 pela bridge' } });
    expect(writeNote.status(), await writeNote.text()).toBe(200);

    // ask: sem PTY ativa o erro esperado e sobre a sessao — NAO sobre validacao/token
    const ask = await request.post('/api/agent-room/bridge/ask', { headers, data: { to: 'Shell', message: 'oi' } });
    const askPayload = await ask.json();
    expect(askPayload.error ?? '').not.toMatch(/invalid|token/i);

    // sem token nenhum: precisa falhar de forma clara
    const noAuth = await request.post('/api/agent-room/bridge/notify', { data: { message: 'x' } });
    expect(noAuth.status()).toBeGreaterThanOrEqual(400);

    // quadro de tarefas via bridge (lider distribui trabalho)
    const created = await request.post('/api/agent-room/bridge/tasks', { headers, data: { title: 'Tarefa do lider', from: 'Lider' } });
    expect(created.status(), await created.text()).toBe(201);
    const task = (await created.json()).data as { id: string; status: string };
    expect(task.status).toBe('todo');
    const taskList = await request.get('/api/agent-room/bridge/tasks', { headers });
    const board = (await taskList.json()).data as Array<{ id: string; title: string }>;
    expect(board.some((item) => item.title === 'Tarefa do lider')).toBe(true);
    const done = await request.patch(`/api/agent-room/bridge/tasks/${task.id}`, { headers, data: { status: 'done' } });
    expect(done.status()).toBe(200);

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('andares via bridge: criar, listar, preview e land', async ({ request }) => {
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFileSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-bfloor-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'e2e@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# x\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });

    const workspaceName = `E2E bfloor ${Date.now()}`;
    const wsResponse = await request.post('/api/agent-room/workspaces', { data: { name: workspaceName, workingDir: dir } });
    const workspace = (await wsResponse.json()).data as { id: string };
    try {
      // Provisioning intentionally writes tracked agent integration files. A
      // Floor starts from a clean, committed main checkout just like production.
      execFileSync('git', ['add', '-A'], { cwd: dir });
      if (execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }).trim()) {
        execFileSync('git', ['commit', '-m', 'provision agent bridge'], { cwd: dir });
      }

      const tokenResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/bridge-token`);
      const { token } = (await tokenResponse.json()).data as { token: string };
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

      // lider cria o andar via bridge
      const created = await request.post('/api/agent-room/bridge/floors', { headers, data: { name: 'feature-auth' } });
      expect(created.status(), await created.text()).toBe(201);
      const floor = (await created.json()).data as { id: string; branch: string };
      expect(floor.branch).toContain('feature-auth');

      const list = await request.get('/api/agent-room/bridge/floors', { headers });
      const floors = (await list.json()).data as Array<{ id: string; name: string }>;
      expect(floors.some((item) => item.name === 'feature-auth')).toBe(true);

      // commit no andar para a aterrissagem ter conteudo
      const floorDir = join(dir, '.orkestrai', 'floors', 'feature-auth');
      writeFileSync(join(floorDir, 'feature.txt'), 'nova feature\n');
      execFileSync('git', ['add', '.'], { cwd: floorDir });
      execFileSync('git', ['commit', '-m', 'feature'], { cwd: floorDir });

      const preview = await request.get(`/api/agent-room/bridge/floors/${floor.id}/preview`, { headers });
      expect(preview.status()).toBe(200);
      const previewData = (await preview.json()).data as { conflicts: string[] };
      expect(previewData.conflicts).toEqual([]);

      const land = await request.post(`/api/agent-room/bridge/floors/${floor.id}/land`, { headers, data: {} });
      expect(land.status(), await land.text()).toBe(200);
      execFileSync('git', ['show', 'main:feature.txt'], { cwd: dir }); // existe na main apos o merge
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('edge entre terminais acende (talking) durante um ask da bridge', async ({ page, request }) => {
    const workspaceName = `E2E talking ${Date.now()}`;
    await page.setViewportSize({ width: 1600, height: 900 });

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName, { timeout: 15_000 });

    // Dois shells vivos (o PTY so nasce com o no montado no canvas).
    // Posicoes sem sobreposicao: terminais tem 560px — vizinho cobre o handle.
    await createNodeOnCanvas(page, 'Shell', { x: 300, y: 300 });
    await expect(page.locator('.canvas-terminal')).toHaveCount(1);
    await createNodeOnCanvas(page, 'Shell', { x: 900, y: 300 });
    await expect(page.locator('.canvas-terminal')).toHaveCount(2);

    // Conecta os dois arrastando do handle.
    const sourceHandle = page.locator('.canvas-terminal').first().locator('.svelte-flow__handle').first();
    const targetHandle = page.locator('.canvas-terminal').nth(1).locator('.svelte-flow__handle').first();
    const sourceBox = await sourceHandle.boundingBox();
    const targetBox = await targetHandle.boundingBox();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator('.svelte-flow__edge')).toHaveCount(1);

    // Titulos distintos para o findAgent da bridge.
    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`);
    const canvasNodes = (await nodesResponse.json()).data as Array<{ id: string; title: string }>;
    await request.patch(`/api/agent-room/workspaces/${workspace.id}/nodes/${canvasNodes[1].id}`, { data: { title: 'Beta' } });

    const tokenResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/bridge-token`);
    const { token } = (await tokenResponse.json()).data as { token: string };

    // Aguarda as sessoes PTY subirem e dispara o ask sem await (leva ~6s).
    await page.waitForTimeout(2_500);
    const askPromise = request.post('/api/agent-room/bridge/ask', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { to: 'Beta', from: canvasNodes[0].title, message: 'sleep 3; echo oi-beta', timeoutMs: 20_000 },
    });

    // Durante a conversa a edge fica verde/animada; depois volta ao normal.
    await expect(page.locator('.orkestrai-edge.talking')).toHaveCount(1, { timeout: 10_000 });
    const askResponse = await askPromise;
    expect(askResponse.status()).toBe(200);
    await expect(page.locator('.orkestrai-edge.talking')).toHaveCount(0, { timeout: 10_000 });

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('canvas atualiza sozinho quando a bridge cria conteudo (live refresh)', async ({ page, request }) => {
    const workspaceName = `E2E live ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    // A selecao tambem detecta os providers locais. Esperar apenas "zero notas"
    // aceitava falsamente a tela vazia enquanto o workspace ainda carregava.
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.canvas-note')).toHaveCount(0);

    // Cria uma nota via bridge (como um agente faz) — precisa aparecer sozinha.
    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    const tokenResponse = await request.get(`/api/agent-room/workspaces/${workspace.id}/bridge-token`);
    const { token } = (await tokenResponse.json()).data as { token: string };
    const created = await request.post('/api/agent-room/bridge/notes', {
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      data: { title: 'Nota da bridge', content: 'apareci sem reload' },
    });
    expect(created.status()).toBe(201);

    await expect(page.locator('.canvas-note')).toHaveCount(1, { timeout: 5_000 });
    await expect(page.locator('.canvas-note')).toContainText('Nota da bridge');

    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });
});
