import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

for (const selection of ['inherit', 'default', 'other', 'other-provider'] as const) {
  test(`new agent account: ${selection}`, async ({ page, request, playwright, baseURL }) => {
    const root = await mkdtemp(join(tmpdir(), 'orkestrai-account-ui-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data;
    const profileIds: string[] = []; let workspaceId = '';
    try {
      await request.put('/api/agent-room/settings', { data: { uiLanguage: 'pt-BR' } });
      async function profile(name: string) {
        const response = await request.post('/api/agent-room/provider-profiles', { data: { providerId: 'claude', name: `${name}-${Date.now()}`, configDir: join(root, name) } });
        expect(response.ok(), await response.text()).toBe(true);
        const result = (await response.json()).data; profileIds.push(result.id); return result;
      }
      const work = await profile('Work'), personal = await profile('Personal');
      const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'Profile inheritance UI', workingDir: root } })).json()).data;
      workspaceId = workspace.id;
      const nodesPath = `/api/agent-room/workspaces/${workspaceId}/nodes`;
      await request.post(nodesPath, { data: { type: 'terminal', title: 'Lead', payload: { provider: 'claude', command: 'claude', profileId: work.id, maestro: true, agentRuntimeMode: 'on_demand' } } });
      await page.addInitScript(() => localStorage.setItem('orkestrai.lastAgentProvider', 'claude'));
      await page.route('**/api/agent-room/status**', async route => {
        const response = await route.fetch(); const body = await response.json();
        body.data.providers = body.data.providers.map((p: { id: string }) => ['claude', 'codex'].includes(p.id) ? { ...p, installed: true } : p);
        await route.fulfill({ response, json: body });
      });
      let submitted: Record<string, unknown> | undefined;
      await page.route(`**${nodesPath}`, async route => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON(); submitted = body.payload;
        // Account selection uses the actual backend; keep the test agent asleep.
        body.payload.agentRuntimeMode = 'on_demand';
        await route.continue({ postData: JSON.stringify(body) });
      });
      await page.goto(`/canvas?workspace=${workspaceId}`);
      // Provider discovery completes after the board first paints.
      await page.getByTestId('agent-toolbar-menu').click();
      await expect(page.getByRole('menuitem', { name: 'Claude CLI detectada', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await page.getByRole('toolbar', { name: /Ações rápidas/ }).getByRole('button', { name: 'Novo agente', exact: true }).click();
      const dialog = page.getByRole('dialog');
      const account = dialog.getByRole('combobox', { name: 'Perfil', exact: true });
      await expect(account).toContainText(work.name);
      if (selection === 'default' || selection === 'other') {
        await account.click();
        await page.getByRole('option', { name: selection === 'default' ? 'Conta padrão' : personal.name, exact: true }).click();
      } else if (selection === 'other-provider') {
        await dialog.getByTestId('agent-cli-select').getByRole('combobox', { name: 'CLI', exact: true }).click();
        await page.getByRole('option', { name: 'Codex', exact: true }).click();
        await expect(account).toContainText('Conta padrão');
      }
      const response = page.waitForResponse(r => r.url().endsWith(nodesPath) && r.request().method() === 'POST');
      await dialog.getByRole('button', { name: 'Criar agente', exact: true }).click();
      const createdResponse = await response;
      expect(createdResponse.ok(), await createdResponse.text()).toBe(true);
      const created = (await createdResponse.json()).data;
      expect(created.payload.profileId ?? null).toBe(selection === 'inherit' ? work.id : selection === 'other' ? personal.id : null);
      if (selection === 'inherit' || selection === 'other-provider') expect(submitted).not.toHaveProperty('profileId');
      if (selection === 'default') expect(submitted).toHaveProperty('profileId', null);
      const saved = (await (await request.get(nodesPath)).json()).data.find((n: { id: string }) => n.id === created.id);
      expect(saved.payload.profileId ?? null).toBe(created.payload.profileId ?? null);
      if (selection === 'default') {
        await expect(dialog).not.toBeVisible();
        await page.getByRole('toolbar', { name: /Ações rápidas/ }).getByRole('button', { name: 'Novo agente', exact: true }).click();
        await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Perfil', exact: true })).toContainText(work.name);
        const nextResponse = page.waitForResponse(r => r.url().endsWith(nodesPath) && r.request().method() === 'POST');
        await page.getByRole('dialog').getByRole('button', { name: 'Criar agente', exact: true }).click();
        const next = await nextResponse;
        expect(next.ok(), await next.text()).toBe(true);
        expect((await next.json()).data.payload.profileId).toBe(work.id);
        expect(submitted).not.toHaveProperty('profileId');
      }
    } finally {
      const cleanup = await playwright.request.newContext({ baseURL });
      try {
        if (workspaceId) await cleanup.delete(`/api/agent-room/workspaces/${workspaceId}`);
        for (const id of profileIds) await cleanup.delete(`/api/agent-room/provider-profiles/${id}`);
        await cleanup.put('/api/agent-room/settings', { data: originalSettings });
      } finally { await cleanup.dispose(); await rm(root, { recursive: true, force: true }); }
    }
  });
}
