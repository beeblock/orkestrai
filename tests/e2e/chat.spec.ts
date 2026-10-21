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
      // With a leader in the team, the question goes to the leader first.
      const { questionId, routedTo } = (await asked.json()).data;
      expect(routedTo).toBe('leader');
      await expect(page.getByTestId('needs-you-list')).toHaveCount(0);
      expect(questionId).toBeTruthy();
      // Only the leader's live terminal may bring it to the owner; the shared workspace token cannot.
      const spoofed = await request.post('/api/agent-room/bridge/escalate-question', { data: { token, from: 'Lead', questionId, note: 'Instalar dependência nova é do dono' } });
      expect(spoofed.status()).toBe(403);

      // The leader's own question goes straight to the owner.
      const own = await request.post('/api/agent-room/bridge/ask-owner', { data: { token, from: 'Lead', question: 'Posso instalar o sharp?', options: ['Sim', 'Não'] } });
      expect((await own.json()).data.routedTo).toBe('owner');
      await expect(page.getByTestId('needs-you-list')).toContainText('Posso instalar o sharp?');

      await page.getByRole('button', { name: /Lead/ }).first().click();
      const question = page.getByTestId('chat-question');
      await expect(question).toContainText('Posso instalar o sharp?');
      await question.getByRole('button', { name: 'Sim', exact: true }).click();
      await expect(question).toContainText('Respondida');
      await expect(page.getByTestId('needs-you-list')).toHaveCount(0);

      const messages = (await (await request.get(`${base}/channels/${encodeURIComponent(`dm:${leader.id}`)}/messages`)).json()).data as Array<{ kind: string; body: string }>;
      expect(messages.some((message) => message.kind === 'answer' && message.body === 'Sim')).toBe(true);
      expect(qa.id).toBeTruthy();
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('shows every waiting request whole, keeps its button readable and offers the microphone', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-chat-requests-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E pedidos ${Date.now()}`, workingDir: dir } })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    try {
      const leader = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Lead', x: 80, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [], maestro: true } } })).json()).data;
      const now = new Date().toISOString();
      const longTitle = 'Ler a caixa de entrada entre etapas e antes do task done; mudanças de critério chegam por mensagem durante o card';
      const items = Array.from({ length: 12 }, (_, index) => ({
        id: `018f0000-0000-7000-8000-0000000a${String(index).padStart(4, '0')}`,
        workspaceId: workspace.id,
        nodeId: leader.id,
        nodeTitle: 'Lead',
        category: 'agent',
        severity: 'info',
        status: 'open',
        title: index === 0 ? longTitle : `Lição ${index}`,
        body: `Corpo da lição ${index}. ${'Detalhe importante. '.repeat(8)}`,
        sourceType: 'learning_pending',
        sourceId: `lesson-${index}`,
        action: { target: 'node', decision: 'learning', entryId: `lesson-${index}` },
        createdAt: now,
        updatedAt: new Date(Date.now() - index * 1000).toISOString(),
      }));
      await page.route('**/api/agent-room/attention?*', (route) => route.fulfill({ json: { data: items } }));

      await page.goto(`/chat?workspace=${workspace.id}`);
      const cards = page.getByTestId('chat-request-card');
      await expect(cards).toHaveCount(12);
      // The timeline scrolls instead of squeezing the cards into stripes.
      for (const card of await cards.all()) expect((await card.boundingBox())?.height ?? 0).toBeGreaterThan(90);
      const title = cards.first().locator('header b');
      await expect(title).toHaveText(longTitle);
      expect(await title.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);

      const keep = cards.first().getByRole('button', { name: 'Guardar lição' });
      await keep.scrollIntoViewIfNeeded();
      await keep.hover();
      const contrast = await keep.evaluate((element) => {
        const pixel = (value: string) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!;
          context.fillStyle = value;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => {
            const linear = channel / 255;
            return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
          });
        };
        const luminance = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const style = getComputedStyle(element);
        const [a, b] = [luminance(pixel(style.color)), luminance(pixel(style.backgroundColor))].sort((x, y) => y - x);
        return (a + 0.05) / (b + 0.05);
      });
      expect(contrast).toBeGreaterThan(4.5);

      // Opening a request from Needs you keeps the conversation and brings the whole card into view.
      await page.getByTestId('needs-you-list').getByRole('button', { name: /Lição 2/ }).click();
      await expect(page).toHaveURL(/\/chat/);
      const opened = cards.filter({ hasText: 'Lição 2' });
      await expect(opened).toHaveClass(/highlighted/);
      await expect(opened).toBeInViewport();

      const composer = page.locator('#chat-composer-input');
      await expect(page.getByRole('button', { name: 'Mensagem de voz' })).toBeEnabled();
      await composer.fill('oi');
      await expect(page.getByRole('button', { name: 'Mensagem de voz' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeEnabled();
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('switching from the Canvas to Chat keeps the selected agent, and a non-agent opens the team', async ({ page, request }) => {
    const dir = await mkdtemp(join(tmpdir(), 'orkestrai-chat-switch-'));
    const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E chat switch ${Date.now()}`, workingDir: dir } })).json()).data;
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    try {
      const make = async (data: Record<string, unknown>) => (await (await request.post(`${base}/nodes`, { data })).json()).data;
      const qa = await make({ type: 'terminal', title: 'QA Upload', x: 80, y: 80, width: 480, height: 320, payload: { provider: 'claude', args: [] } });
      const note = await make({ type: 'note', title: 'Plano', x: 640, y: 80, width: 320, height: 240, payload: { content: 'x' } });

      await page.goto(`/canvas?workspace=${workspace.id}&node=${qa.id}`);
      const chatLink = page.getByRole('link', { name: 'Conversa', exact: true });
      // Once the Canvas has loaded, the switch carries the agent shown.
      await expect(chatLink).toHaveAttribute('href', new RegExp(`channel=dm%3A${qa.id}`));
      await chatLink.click();
      await expect(page).toHaveURL(new RegExp(`channel=dm%3A${qa.id}`));
      const channels = page.getByRole('navigation', { name: 'Canais e mensagens diretas' });
      await expect(channels.getByRole('button', { name: /QA Upload/ })).toHaveAttribute('aria-current', 'page');

      await page.goto(`/chat?workspace=${workspace.id}&channel=${encodeURIComponent(`dm:${note.id}`)}`);
      await expect(page).not.toHaveURL(/channel=/);
      await expect(channels.getByRole('button', { name: /equipe/ })).toHaveAttribute('aria-current', 'page');
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });
});
