import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('restauracao de sessao', () => {
  test('terminal com sessao morta respawna ao recarregar', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-respawn-'));
    const workspaceName = `E2E respawn ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill(dir);
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName, { timeout: 15_000 });

    await createNodeOnCanvas(page, 'Shell');
    await expect(page.locator('.canvas-terminal .xterm')).toBeVisible({ timeout: 10_000 });

    // Simula restart do app: corrompe o sessionId como se a sessao tivesse morrido
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${created.id}/nodes`);
    const nodes = (await nodesResponse.json()).data as Array<{ id: string; payload: Record<string, unknown> }>;
    const terminal = nodes[0];
    await request.fetch(`/api/agent-room/workspaces/${created.id}/nodes/${terminal.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      data: { payload: { ...terminal.payload, sessionId: 'sessao-morta-123' } },
    });

    // Recarrega: o terminal deve respawnar (nova sessao), nao mostrar erro
    await page.reload();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName, { timeout: 15_000 });
    await expect(page.locator('.canvas-terminal .xterm')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.canvas-terminal')).not.toContainText(/Sess[aã]o PTY n[aã]o encontrada/i);

    await expect.poll(async () => {
      const refreshed = await request.get(`/api/agent-room/workspaces/${created.id}/nodes`);
      const currentNodes = (await refreshed.json()).data as Array<{ id: string; payload: Record<string, unknown> }>;
      return currentNodes.find((node) => node.id === terminal.id)?.payload.sessionId;
    }, { timeout: 15_000 }).not.toBe('sessao-morta-123');

    // Nova sessao funcional: recebe input
    const marker = `respawn-${Date.now()}`;
    await page.locator('.canvas-terminal .terminal-container').click();
    await page.keyboard.type(`echo ${marker}`);
    await page.keyboard.press('Enter');
    await expect(page.locator('.canvas-terminal .terminal-container')).toContainText(marker, { timeout: 10_000 });

    await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });
});
