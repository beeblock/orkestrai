import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// "New agent" lets the owner pick the CLI instead of always opening the first one.
test('new agent offers a CLI choice and follows it', async ({ page, request, playwright, baseURL }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-cli-choice-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E cli choice ${Date.now()}`, workingDir: dir } })).json()).data;
  try {
    await page.route('**/api/agent-room/status**', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const providers = (body.data?.providers ?? []).map((provider: { id: string }) => (
        provider.id === 'claude' || provider.id === 'codex' ? { ...provider, installed: true } : provider
      ));
      await route.fulfill({ response, json: { ...body, data: { ...body.data, providers } } });
    });
    await page.goto(`/canvas?workspace=${workspace.id}`);
    // Wait until the detected CLIs are known (the blank board offers them).
    await expect(page.getByRole('button', { name: 'Novo terminal (Codex)' })).toBeVisible();
    await page.getByRole('toolbar', { name: /Ações rápidas/ }).getByRole('button', { name: 'Novo agente' }).click();
    const dialog = page.getByRole('dialog');
    const cli = dialog.getByTestId('agent-cli-select');
    await expect(cli).toBeVisible();
    const name = dialog.getByRole('textbox', { name: 'Nome' });
    const before = await name.inputValue();
    await cli.getByRole('combobox', { name: 'CLI' }).click();
    const other = before === 'Claude' ? 'Codex' : 'Claude';
    await page.getByRole('option', { name: other }).click();
    await expect(name).toHaveValue(other);
    await expect(dialog.getByRole('heading')).toContainText(other);
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    const cleanup = await playwright.request.newContext({ baseURL });
    try { await cleanup.delete(`/api/agent-room/workspaces/${workspace.id}`); }
    finally { await cleanup.dispose(); await rm(dir, { recursive: true, force: true }); }
  }
});
