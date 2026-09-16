import { expect, test } from '@playwright/test';

test.describe('onboarding guiado', () => {
  test('sempre abre nas boas-vindas e guia para criar workspace novo', async ({ page, request }) => {
    const workspaceName = `E2E onboarding ${Date.now()}`;
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });

    // Cria e seleciona um workspace — o wizard NAO pode pular direto pros tours
    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.svelte-flow__pane')).toBeVisible();

    await page.goto('/canvas?onboarding=1');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    // Etapa 1: idioma; a escolha e salva antes de qualquer outra configuracao.
    await expect(dialog.getByText('Escolha seu idioma')).toBeVisible();
    await dialog.getByRole('button', { name: 'Português (Brasil)' }).click();
    const settings = await request.get('/api/agent-room/settings');
    expect((await settings.json()).data.uiLanguage).toBe('pt-BR');
    // Etapa 2: boas-vindas (com workspace ativo, antes pulava direto pros tours)
    await expect(dialog.getByText('Bem-vindo ao Orkestrai')).toBeVisible();
    // Etapa 3: criação de workspace
    await dialog.getByRole('button', { name: 'Criar e continuar' }).click();
    await expect(dialog.getByPlaceholder('/caminho/do/projeto')).toBeVisible();
    // E com workspace ativo, o atalho "usar atual" existe na etapa de criacao
    await expect(dialog.getByRole('button', { name: 'Usar o workspace atual' })).toBeVisible();

    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('Fazer por mim cria o agente e ele aparece no canvas SEM recarregar', async ({ page, request }) => {
    const workspaceName = `E2E tour-live ${Date.now()}`;
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.svelte-flow__pane')).toBeVisible();

    // Abre o wizard, pula pros tours usando o workspace atual
    await page.goto('/canvas?onboarding=1');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByRole('button', { name: 'Português (Brasil)' }).click();
    await dialog.getByRole('button', { name: 'Já tenho workspace — pular' }).click();
    await dialog.locator('.tour-card', { hasText: 'Time com líder (zero-config)' }).click();
    await dialog.getByRole('button', { name: 'Começar o tour guiado' }).click();

    // Painel do tour: "Fazer por mim" no passo 1 (cria o líder)
    await expect(page.locator('.tour-panel')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Fazer por mim/ }).click();

    // O nó do líder aparece no canvas SEM sair/recarregar (live refresh)
    await expect(page.locator('.svelte-flow__node').first()).toBeVisible({ timeout: 10_000 });
    // E o tour avança sozinho para o passo 2
    await expect(page.locator('.tour-title')).not.toHaveText('Crie o líder do time', { timeout: 10_000 });

    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  });

  test('salva inglês e continua aberto quando a troca de locale remonta a página', async ({ page, request }) => {
    // O runtime nasce em ingles, mas settings pt-BR LENTAS provocam um remount
    // depois do mount. Escolher ingles provoca outro; o wizard deve continuar.
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });
    await page.route('**/api/agent-room/settings', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });

    await page.goto('/canvas?onboarding=1');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    // Espera as settings chegarem (remount) — o seletor precisa continuar aberto.
    await page.waitForTimeout(3_000);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Escolha seu idioma')).toBeVisible();
    await dialog.getByRole('button', { name: 'English' }).click();
    await expect(dialog.getByText('Welcome to Orkestrai')).toBeVisible({ timeout: 20_000 });

    const settings = await request.get('/api/agent-room/settings');
    expect((await settings.json()).data.uiLanguage).toBe('en');

    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });
  });

  test('tour de pesquisa: 4 passos com Fazer por mim, 2 conexões e conclusão', async ({ page, request }) => {
    test.setTimeout(90_000);
    const workspaceName = `E2E tour-pesquisa ${Date.now()}`;
    await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);
    await expect(page.locator('.svelte-flow__pane')).toBeVisible();

    const list = await request.get('/api/agent-room/workspaces');
    const workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find((item) => item.name === workspaceName)!;
    try {
      await page.goto(`/canvas?workspace=${workspace.id}&onboarding=1`);
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Português (Brasil)' }).click();
      await dialog.getByRole('button', { name: 'Já tenho workspace — pular' }).click();
      await dialog.locator('.tour-card', { hasText: 'Pesquisa automatizada' }).click();
      await dialog.getByRole('button', { name: 'Começar o tour guiado' }).click();

      const panel = page.locator('.tour-panel');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      // 4 passos com "Fazer por mim": nota, portal, agente, conexões.
      for (let i = 0; i < 4; i += 1) {
        const titleBefore = await panel.locator('.tour-title').textContent();
        await panel.getByRole('button', { name: /Fazer por mim/ }).click();
        await expect.poll(async () =>
          (await panel.getByText('Tour concluído!').isVisible().catch(() => false))
          || (await panel.locator('.tour-title').textContent()) !== titleBefore,
        { timeout: 15_000 }).toBe(true);
      }

      await expect(panel.getByText('Tour concluído!')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.canvas-note')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.canvas-portal')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('.canvas-terminal').filter({ hasText: 'Pesquisador' })).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/edges`);
        return ((await response.json()).data as unknown[]).length;
      }).toBe(2);
    } finally {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/unload`).catch(() => {});
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`).catch(() => {});
    }
  });
});
