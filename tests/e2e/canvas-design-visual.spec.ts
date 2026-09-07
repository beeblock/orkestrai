/*
 * Baseline visual do Canvas e do editor de Design nativo.
 *
 * Para atualizar deliberadamente os PNGs de referencia depois de uma mudanca
 * visual revisada:
 *
 *   npx playwright test tests/e2e/canvas-design-visual.spec.ts --update-snapshots
 *
 * Os arquivos em tests/e2e/canvas-design-visual.spec.ts-snapshots/ devem ser
 * revisados a olho e commitados junto com a mudanca visual.
 */

import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const THEMES = ['orkestrai-dark', 'orkestrai-light'];
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
// Linux e macOS rasterizam a mesma fonte empacotada de formas diferentes.
const MAX_DIFF_PIXEL_RATIO = process.env.CI ? 0.03 : 0.01;

test.describe('Canvas and design visual baseline', () => {
  test('canvas matches the supported viewport and theme matrix', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-canvas-visual-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E canvas visual ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };

    // Geometria fixa: o canvas roda fitView({ maxZoom: 1 }) sobre a bounding
    // box dos nos, entao qualquer coordenada variavel moveria a cena inteira.
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'note',
        title: 'Campaign brief',
        x: 0,
        y: 0,
        width: 420,
        height: 260,
        zIndex: 1,
        payload: { content: '# Launch checklist\n\n- Positioning approved\n- Landing page review\n- Final assets' },
      },
    });
    // Quadro sem tarefas de proposito: cada card renderiza fmtWhen(updatedAt).
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'tasks', title: 'Delivery board', x: 460, y: 0, width: 640, height: 380, zIndex: 1, payload: {} },
    });
    await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Landing page', x: 0, y: 300, width: 420, height: 300, zIndex: 1, payload: {} },
    });

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const theme of THEMES) {
        await request.put('/api/agent-room/settings', {
          data: {
            ...originalSettings,
            appTheme: theme,
            uiLanguage: 'en',
            // Os agentes fixados na toolbar sao filtrados por provider.installed:
            // sem zerar a lista, a barra depende das CLIs da maquina.
            pinnedAgentProviders: '[]',
            showMinimap: 'true',
            showControls: 'true',
          },
        });
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page.goto(`/canvas?workspace=${workspace.id}`);
          await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);

          const canvas = page.locator('.canvas-area');
          await expect(canvas).toBeVisible();
          // O fitView do xyflow so roda depois que os 3 nos sao medidos.
          await expect(page.locator('.svelte-flow__node')).toHaveCount(3);
          await expect(page.locator('.canvas-note')).toBeVisible();
          await expect(page.locator('.canvas-design')).toBeVisible();
          const board = page.locator('.canvas-tasks');
          await expect(board).toBeVisible();
          await expect(board.locator('.tb-column')).toHaveCount(3);

          await expect(canvas).toHaveScreenshot(
            `canvas-${theme}-${viewport.width}x${viewport.height}.png`,
            {
              animations: 'disabled',
              caret: 'hide',
              mask: [
                // Miolo do no de design: carrega o documento por fetch, pede o
                // thumbnail (que responde 404 enquanto ninguem abriu o editor e
                // entra em retry com backoff) e imprime contagens + revisao.
                page.locator('.canvas-design .node-body'),
                // Botao de compartilhamento: faz poll do /collaboration a cada
                // 5s e ganha bolinha/contador conforme peers e dispositivos.
                page.locator('[data-tour="workspace-sharing"]'),
                // Microfone flutuante: posicao vem do localStorage e a presenca
                // depende do suporte de midia da maquina.
                page.locator('[data-dictation-trigger]'),
                // Toasts pintam acima de tudo e somem por timer.
                page.locator('[data-sonner-toast]'),
              ],
              maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
            },
          );
        }
      }
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('design editor matches the supported viewport and theme matrix', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-visual-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design visual ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Campaign landing', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
    };
    // POST /quality e o handler `maintain` do DesignDocumentController: o
    // template gera o documento inteiro em uma unica revisao conhecida.
    const seed = await request.post(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/quality`, {
      data: { action: 'apply-template', templateId: 'marketing', baseRevision: initial.revision },
    });
    expect(seed.ok()).toBeTruthy();
    const seeded = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      elements: Array<{ id: string; name: string }>;
    };
    const rootFrame = seeded.elements.find((element) => element.name === 'Campaign landing page');
    expect(rootFrame).toBeTruthy();

    // A camera do editor (zoom + scroll) e persistida por workspace+node em
    // localStorage. Sem limpar, o segundo viewport restauraria o enquadramento
    // calculado para o primeiro em vez de refazer o fit.
    await page.addInitScript(() => {
      try {
        const stale = Object.keys(localStorage).filter((key) => key.startsWith('orkestrai.design.editor.'));
        for (const key of stale) localStorage.removeItem(key);
      } catch {
        // Storage indisponivel: o editor ja cai no fit padrao.
      }
    });

    try {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const theme of THEMES) {
        await request.put('/api/agent-room/settings', {
          data: { ...originalSettings, appTheme: theme, uiLanguage: 'en' },
        });
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
          await expect(page.locator('html')).toHaveAttribute('data-app-theme', theme);

          const editor = page.getByTestId('canvas-design-mode');
          await expect(editor).toBeVisible();
          const toolbar = page.getByTestId('design-toolbar');
          await expect(page.getByTestId('design-left-panel')).toBeVisible();
          await expect(page.getByTestId('design-right-panel')).toBeVisible();
          await expect(page.getByTestId('design-file-panel').getByRole('button', { name: 'Campaign landing page', exact: true })).toBeVisible();
          // O SVG so ganha [data-design-element] depois que o documento carrega
          // e o fitPage() roda; antes disso o viewport mostra o placeholder.
          await expect(page.getByTestId('design-viewport').locator(`[data-design-element="${rootFrame!.id}"]`)).toBeVisible();

          await expect(editor).toHaveScreenshot(
            `design-editor-${theme}-${viewport.width}x${viewport.height}.png`,
            {
              animations: 'disabled',
              caret: 'hide',
              mask: [
                // Contador de revisao: muda a cada operacao aplicada no seed.
                toolbar.locator('span').filter({ hasText: /^Revision \d+$/ }),
                // Zoom do fit: derivado do tamanho medido do viewport.
                toolbar.locator('span.tabular-nums').last(),
                // Badge do drawer de colaboracao: soma presencas vivas (poll de
                // 3s), comentarios abertos e propostas pendentes.
                toolbar.getByRole('button', { name: 'Open agents and reviews' }),
                // Toasts pintam acima do overlay de foco (z-index maximo).
                page.locator('[data-sonner-toast]'),
              ],
              maxDiffPixelRatio: MAX_DIFF_PIXEL_RATIO,
            },
          );
        }
      }
    } finally {
      await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
