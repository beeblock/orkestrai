import { expect, test, type APIRequestContext } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TOURS_PT } from '../../src/lib/components/agent-room/tours/catalog/pt-BR';

async function completeImageWorkflowFixture(
  request: APIRequestContext,
  workspaceId: string,
  title: string,
): Promise<void> {
  const list = await request.get(`/api/agent-room/workspaces/${workspaceId}/nodes`);
  expect(list.ok(), await list.text()).toBe(true);
  const nodes = (await list.json()).data as Array<{
    id: string;
    type: string;
    title: string | null;
    payload: Record<string, unknown>;
  }>;
  const workflow = nodes.find((node) => node.type === 'imageWorkflow' && node.title === title);
  expect(workflow, `image workflow ${title} not found`).toBeTruthy();
  const count = Math.max(1, Number(workflow!.payload.count ?? 1));

  for (let index = 0; index < count; index += 1) {
    const output = await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
      data: {
        type: 'image',
        title: `${title} ${index + 1}`,
        x: 80 + index * 300,
        y: 1_400,
        width: 280,
        height: 240,
        payload: {
          path: `.orkestrai/e2e/${workflow!.id}-${index}.png`,
          generatedBy: { workflowNodeId: workflow!.id, runId: 'e2e-image-run', outputIndex: index },
        },
      },
    });
    expect(output.status(), await output.text()).toBe(201);
  }

  const updated = await request.patch(`/api/agent-room/workspaces/${workspaceId}/nodes/${workflow!.id}`, {
    data: {
      payload: {
        ...workflow!.payload,
        status: 'succeeded',
        activeRunId: null,
        activeRun: null,
        lastError: null,
      },
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
}

/**
 * Auditoria dos tours: UM teste por tour — cada "Fazer por mim" precisa
 * funcionar, nenhum passo pode travar e todo tour precisa concluir.
 * Um workspace por teste + unload ao final (mata as sessoes PTY dos agentes
 * criados — sem isso elas se acumulam e derrubam o browser).
 */
for (const tour of TOURS_PT) {
  test(`tour ${tour.id} completa sem travar`, async ({ page, request }) => {
    test.setTimeout(300_000);

    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-tour-'));
    execSync('git init -q && git config user.email tour@test.dev && git config user.name tour && touch README.md && git add -A && git commit -qm init', { cwd: dir });

    const workspaceName = `E2E tour-${tour.id} ${Date.now()}`;
    const created = await request.post('/api/agent-room/workspaces', { data: { name: workspaceName, workingDir: dir } });
    const workspace = (await created.json()).data as { id: string };

    if (tour.id === 'creative-image-workflow') {
      // The native workflow contract is exercised elsewhere. This catalog
      // audit replaces only the authenticated external ImageGen execution.
      await page.route('**/api/agent-room/workspaces/*/image-workflows/*', async (route) => {
        if (route.request().method() === 'POST') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { queued: true } }) });
          return;
        }
        await route.continue();
      });
    }

    try {
      await page.goto('/canvas');
      await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
      await expect(page.locator('.svelte-flow__pane')).toBeVisible();

      await page.goto('/canvas?onboarding=1');
      const dialog = page.locator('[role="dialog"]');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Português (Brasil)' }).click();
      await dialog.getByRole('button', { name: 'Já tenho workspace — pular' }).click();
      await dialog.locator('.tour-card', { hasText: tour.title }).first().click();
      await dialog.getByRole('button', { name: 'Começar o tour guiado' }).click();
      const panel = page.locator('.tour-panel');
      await expect(panel).toBeVisible({ timeout: 10_000 });

      for (let guard = 0; guard < 30; guard += 1) {
        if (await panel.getByText('Tour concluído!').isVisible().catch(() => false)) break;
        const errorText = await panel.locator('.tour-error').textContent({ timeout: 300 }).catch(() => null);
        expect(errorText, `erro na acao do passo: ${errorText}`).toBeFalsy();
        const titleBefore = (await panel.locator('.tour-title').textContent().catch(() => null)) ?? '';
        const doForMe = panel.getByRole('button', { name: /Fazer por mim/ });
        const doneStep = panel.getByRole('button', { name: /Concluir passo/ });
        const next = panel.getByRole('button', { name: /Próximo passo/ });
        if (await doForMe.count()) {
          await doForMe.click();
          if (tour.id === 'creative-image-workflow') {
            const currentStep = tour.steps.find((step) => step.title === titleBefore);
            const actions = currentStep?.action ? (Array.isArray(currentStep.action) ? currentStep.action : [currentStep.action]) : [];
            const run = actions.find((action) => action.kind === 'runImageWorkflow');
            if (run?.kind === 'runImageWorkflow') {
              await completeImageWorkflowFixture(request, workspace.id, run.title);
            }
          }
        }
        else if (await doneStep.count()) await doneStep.click();
        else if (await next.count()) await next.click();
        // Espera o passo AVANCAR (titulo muda) ou o tour concluir — passos com
        // check avancam no poll de 3s; CLIs reais spawnando deixam tudo lento.
        await expect
          .poll(
            async () =>
              (await panel.getByText('Tour concluído!').isVisible().catch(() => false)) ||
              ((await panel.locator('.tour-title').textContent().catch(() => null)) ?? '') !== titleBefore,
            { timeout: 45_000, intervals: [500, 1000, 2000] }
          )
          .toBe(true);
      }
      await expect(panel.getByText('Tour concluído!')).toBeVisible({ timeout: 15_000 });
    } finally {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/unload`).catch(() => {});
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`).catch(() => {});
    }
  });
}
