import { expect, test } from '@playwright/test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Chat', () => {
  test('owner talks to the team and answers a question an agent asked', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-chat-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E chat ${Date.now()}`, workingDir: dir } })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    try {
      const make = async (data: Record<string, unknown>) => (await (await request.post(`${base}/nodes`, { data })).json()).data;
      const leader = await make({ type: 'terminal', title: 'Lead', x: 80, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [], maestro: true } });
      const qa = await make({ type: 'terminal', title: 'QA Upload', x: 640, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [] } });

      await page.goto(`/chat?workspace=${workspace.id}`);
      await expect(page.getByRole('link', { name: 'Conversa', exact: true })).toHaveAttribute('aria-current', 'page');
      const input = page.locator('#chat-composer-input');
      await input.fill('Como está o upload?');
      await input.press('Enter');
      await expect(page.getByTestId('chat-message').filter({ hasText: 'Como está o upload?' })).toBeVisible();

      // An agent asks the owner through the bridge; the question waits in Chat and in Needs you.
      const token = JSON.parse(await readFile(join(dir, '.orkestrai', 'workspace.json'), 'utf8')).token as string;
      const asked = await request.post('/api/agent-room/bridge/ask-owner', { data: { token, from: 'QA Upload', question: 'Posso instalar o sharp?', options: ['Sim', 'Não'] } });
      expect(asked.status()).toBe(201);
      await expect(page.getByTestId('needs-you-list')).toContainText('Posso instalar o sharp?');

      await page.getByRole('button', { name: /QA Upload/ }).first().click();
      const question = page.getByTestId('chat-question');
      await expect(question).toContainText('Posso instalar o sharp?');
      await question.getByRole('button', { name: 'Sim', exact: true }).click();
      await expect(question).toContainText('Respondida');
      await expect(page.getByTestId('needs-you-list')).toHaveCount(0);

      const messages = (await (await request.get(`${base}/channels/${encodeURIComponent(`dm:${qa.id}`)}/messages`)).json()).data as Array<{ kind: string; body: string }>;
      expect(messages.some((message) => message.kind === 'answer' && message.body === 'Sim')).toBe(true);
      expect(leader.id).toBeTruthy();
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
