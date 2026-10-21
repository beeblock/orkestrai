import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectCanvasTool } from './helpers';

test.describe('usage dos providers', () => {
  test('endpoint retorna todos os providers com janelas ou orientação oficial', async ({ request }) => {
    const response = await request.get('/api/agent-room/usage');
    expect(response.ok()).toBe(true);
    const usages = (await response.json()).data as Array<{
      provider: string;
      windows: unknown[];
      error: string | null;
      diagnostic: string | null;
      helpUrl: string | null;
    }>;
    expect(usages.map((usage) => usage.provider).sort()).toEqual([
      'aider',
      'amp',
      'antigravity',
      'claude',
      'cline',
      'codex',
      'copilot',
      'cursor',
      'devin',
      'gemini',
      'goose',
      'kimi',
      'opencode',
      'qwen',
    ]);
    for (const usage of usages) {
      // Providers sem telemetria oficial expõem diagnóstico e documentação,
      // em vez de inventar uma porcentagem de uso.
      expect(
        usage.windows.length > 0
        || Boolean(usage.error)
        || Boolean(usage.diagnostic && usage.helpUrl)
      ).toBe(true);
    }
  });

  test('painel de usage abre no canvas e mostra cards', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-usage-'));
    const workspaceName = `E2E usage ${Date.now()}`;
    const created = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: dir },
    });
    const workspace = (await created.json()).data as { id: string };

    try {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      // Usage lives in the Canvas panel rail.
      await page.locator('[data-rail-item="usage"]').click();

      await expect(page.locator('.usage-panel h3')).toHaveText('Uso dos providers');
      await expect(page.locator('.usage-card')).toHaveCount(14, { timeout: 15_000 });
      // Cada card mostra janelas, erro ou orientação oficial do provider.
      const cards = page.locator('.usage-card');
      for (const card of await cards.all()) {
        await expect(card.locator('.window-row, .usage-error, .usage-diagnostic, .hint').first()).toBeVisible();
      }

      await page.getByRole('button', { name: /Adicionar Uso ao canvas/i }).click();
      const usageNode = page.locator('.canvas-usage');
      const usageBody = usageNode.locator('.usage-node-body');
      const routingPolicy = usageNode.locator('.routing-policy');
      const providerList = usageNode.locator('.provider-list');
      await expect(usageNode).toBeVisible();
      await expect(routingPolicy).toBeVisible();
      await expect(routingPolicy).toContainText('Roteamento');

      const defaultLayout = await usageBody.evaluate((element) => {
        const routing = element.querySelector('.routing-policy')!;
        const providers = element.querySelector('.provider-list')!;
        return {
          clientHeight: element.clientHeight,
          overflowY: getComputedStyle(element).overflowY,
          routingBeforeProviders: routing.getBoundingClientRect().top < providers.getBoundingClientRect().top,
        };
      });
      expect(defaultLayout.clientHeight).toBeGreaterThan(500);
      expect(defaultLayout.overflowY).toBe('auto');
      expect(defaultLayout.routingBeforeProviders).toBe(true);

      // Nós persistidos por versões antigas podem continuar com apenas 300px.
      // Eles precisam rolar internamente sem exigir resize nem aplicar zoom no canvas.
      await usageNode.evaluate((element) => {
        const node = element.closest('.svelte-flow__node') as HTMLElement | null;
        if (node) node.style.height = '300px';
      });
      await expect.poll(() => usageBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
      const viewportTransform = await page.locator('.svelte-flow__viewport').getAttribute('style');
      await usageBody.hover();
      await page.mouse.wheel(0, 320);
      await expect.poll(() => usageBody.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await page.locator('.svelte-flow__viewport').getAttribute('style')).toBe(viewportTransform);

      const nodes = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes`)).json()).data as Array<{ type: string; payload: Record<string, unknown> }>;
      expect(nodes.find((node) => node.type === 'usage')?.payload).toMatchObject({
        enabled: true,
        sourceProvider: 'claude',
        fallbackProvider: 'codex',
        thresholdPercent: 90,
      });
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('traduz erros coletados pelo backend para o idioma ativo', async ({ page, request }) => {
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, unknown>;
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-usage-locale-'));
    const workspaceName = `E2E usage locale ${Date.now()}`;
    const created = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: dir },
    });
    const workspace = (await created.json()).data as { id: string };

    await page.route('**/api/agent-room/usage**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{
            provider: 'claude',
            plan: null,
            windows: [],
            error: 'credentials_missing',
            diagnostic: null,
            helpUrl: null,
            fetchedAt: new Date().toISOString(),
          }],
        }),
      });
    });

    try {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, uiLanguage: 'en' },
      });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      await selectCanvasTool(page, 'Usage');
      await expect(page.locator('.usage-error')).toHaveText(
        'No local credentials were found for Claude. Open its CLI and sign in.',
      );
      await expect(page.locator('.usage-panel')).not.toContainText(/Credencial|encontrad|faça login/i);
    } finally {
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
