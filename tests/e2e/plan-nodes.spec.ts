import { expect, test } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('two screens editing one checklist keep each other’s items', async ({ browser, request }) => {
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-plan-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E plan ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  const checklist = (await (await request.post(`${base}/nodes`, { data: {
    type: 'checklist', title: 'Lançamento', x: 80, y: 80, width: 320, height: 360, zIndex: 1,
    payload: { items: [{ id: 'first', text: 'Revisar a página', done: false }] },
  } })).json()).data;
  const context = await browser.newContext({ storageState: 'tests/e2e/storage-state.json', viewport: { width: 1440, height: 900 } });
  try {
    const [first, second] = [await context.newPage(), await context.newPage()];
    for (const page of [first, second]) {
      await page.goto(`/canvas?workspace=${workspace.id}`);
      await expect(page.getByTestId('checklist-node')).toContainText('Revisar a página');
    }

    // The second screen adds an item; the first one, opened earlier, shows it too.
    await second.getByRole('textbox', { name: 'Adicionar um objetivo' }).fill('Gravar o vídeo');
    await second.getByRole('textbox', { name: 'Adicionar um objetivo' }).press('Enter');
    await expect(first.getByTestId('checklist-node')).toContainText('Gravar o vídeo', { timeout: 10_000 });

    // The first screen checks its item; the second screen's item survives.
    await first.getByRole('checkbox', { name: 'Revisar a página' }).click();
    await expect(first.getByRole('checkbox', { name: 'Revisar a página' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => {
      const stored = (await (await request.get(`${base}/nodes/${checklist.id}/checklist`)).json()).data;
      return stored.items.map((item: { text: string; done: boolean }) => `${item.text}:${item.done}`);
    }).toEqual(['Revisar a página:true', 'Gravar o vídeo:false']);
    await expect(second.getByRole('checkbox', { name: 'Revisar a página' })).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
  } finally {
    await context.close();
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});
