import { expect, test } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the phone page answers what needs the owner and talks to the team', async ({ page, request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-phone-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E phone ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Lead', x: 0, y: 0, width: 480, height: 320, payload: { provider: 'claude', args: [], maestro: true } } });
    await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'QA Upload', x: 600, y: 0, width: 480, height: 320, payload: { provider: 'claude', args: [] } } });
    const token = JSON.parse(await readFile(join(dir, '.orkestrai', 'workspace.json'), 'utf8')).token as string;
    const asked = (await (await request.post('/api/agent-room/bridge/ask-owner', { data: { token, from: 'QA Upload', question: 'Posso rodar o e2e agora?', options: ['Pode', 'Espere'] } })).json()).data;
    // The leader brings it to the owner; only then it waits on the phone.
    await request.post('/api/agent-room/bridge/escalate-question', { data: { token, from: 'Lead', questionId: asked.questionId, note: 'O dono decide quando rodar' } });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((id) => { try { localStorage.setItem('orkestrai.mobile.workspace', id); } catch { /* ignore */ } }, workspace.id);
    await page.goto('/m');
    const card = page.getByTestId('phone-needs-card').filter({ hasText: 'Posso rodar o e2e agora?' });
    await expect(card).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('phone-needs.png') });
    await card.getByRole('button', { name: 'Pode', exact: true }).click();
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: /Conversa/ }).click();
    await page.getByRole('button', { name: /#equipe/ }).click();
    await page.getByRole('textbox').fill('Bom dia, equipe');
    await page.getByRole('textbox').press('Enter');
    await expect(page.locator('.bubble').filter({ hasText: 'Bom dia, equipe' })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('phone-chat.png') });
  } finally {
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});
