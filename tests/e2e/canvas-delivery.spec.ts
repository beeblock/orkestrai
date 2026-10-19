import { expect, test, type Page } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type LiveMessage = { id: string; authorKind: string; authorNodeId: string | null; createdAt: string; body: string; meta: Record<string, unknown> };

// The Canvas relays live channel frames as this window event; the test plays the server's part.
async function relay(page: Page, channel: string, message: LiveMessage) {
  await page.evaluate(({ channel, message }) => {
    window.dispatchEvent(new CustomEvent('orkestrai:channel-message', { detail: { channel, message } }));
  }, { channel, message });
}

test('shows the whole agent notice and follows a message from the queue to the reply', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const dir = await mkdtemp(join(tmpdir(), 'orkestrai-delivery-'));
  const workspace = (await (await request.post('/api/agent-room/workspaces', { data: { name: `E2E entrega ${Date.now()}`, workingDir: dir } })).json()).data;
  const base = `/api/agent-room/workspaces/${workspace.id}`;
  try {
    const lead = (await (await request.post(`${base}/nodes`, { data: { type: 'terminal', title: 'Lead', x: 80, y: 80, width: 640, height: 420, payload: { provider: 'claude', args: [], command: '/bin/cat', maestro: true } } })).json()).data;
    const longTitle = `Marca e nome aplicados; aguardando o dono nas decisões DEC-02 a DEC-12 do pacote F0 e no aceite. ${'Cada decisão tem contexto, impacto e prazo próprios. '.repeat(5)}Fim do aviso.`;
    const now = new Date().toISOString();
    await page.route('**/api/agent-room/attention?*', (route) => route.fulfill({ json: { data: [{
      id: '018f0000-0000-7000-8000-0000000b0001', workspaceId: workspace.id, nodeId: lead.id, nodeTitle: 'Lead', taskId: null,
      category: 'agent', severity: 'info', status: 'open', title: longTitle, body: null, sourceType: 'agent_state', sourceId: lead.id,
      action: { target: 'node', workspaceId: workspace.id, nodeId: lead.id, taskId: null }, createdAt: now, updatedAt: now,
    }] } }));
    // The server's answer to a send: stored and queued for the agent.
    await page.route('**/api/agent-room/workspaces/*/channels/*/messages', (route) => (route.request().method() === 'POST'
      ? route.fulfill({ json: { data: { message: { id: 'msg-e2e' }, delivered: [{ nodeId: lead.id, ok: true }] } } })
      : route.fallback()));

    await page.goto(`/canvas?workspace=${workspace.id}`);
    const node = page.locator(`.svelte-flow__node[data-id="${lead.id}"]`);
    const banner = node.getByTestId('node-attention-banner');
    await expect(banner).toBeVisible();

    // The notice opens whole in place, and See all opens the agent in Focus.
    const copy = banner.locator('button.copy');
    const collapsed = (await copy.boundingBox())?.height ?? 0;
    await copy.click();
    await expect(copy).toHaveAttribute('aria-expanded', 'true');
    expect((await copy.boundingBox())?.height ?? 0).toBeGreaterThan(collapsed + 20);
    await expect(copy).toContainText('Fim do aviso.');
    const seeAll = banner.getByRole('link', { name: /Ver tudo|See all/ });
    await expect(seeAll).toHaveAttribute('href', `/terminal?workspace=${workspace.id}&node=${lead.id}`);

    // Sent from the Canvas bar: queued while the agent finishes its turn.
    const bar = page.locator('#canvas-composer-input');
    await bar.fill('A mensagem chegou?');
    await bar.press('Enter');
    const sent = page.getByTestId('composer-sent');
    await expect(sent).toHaveAttribute('data-state', 'queued');
    await expect(sent).toContainText(/Na fila|Queued/);
    await expect(sent).toContainText('A mensagem chegou?');

    // The agent in terminal mode shows the queued message too.
    const queued: LiveMessage = { id: 'msg-e2e', authorKind: 'owner', authorNodeId: null, createdAt: new Date().toISOString(), body: 'A mensagem chegou?', meta: { deliverTo: [lead.id] } };
    await relay(page, `dm:${lead.id}`, queued);
    const chip = node.getByTestId('terminal-inbox-chip');
    await expect(chip).toContainText(/na fila|queued/i);

    await relay(page, `dm:${lead.id}`, { ...queued, meta: { deliverTo: [lead.id], deliveredAt: new Date().toISOString() } });
    await expect(sent).toHaveAttribute('data-state', 'delivered');
    await expect(sent).toContainText(/Entregue a Lead|Delivered to Lead/);
    await expect(chip).toContainText(/entregue|delivered/i);

    await relay(page, `dm:${lead.id}`, { id: 'reply-e2e', authorKind: 'agent', authorNodeId: lead.id, createdAt: new Date(Date.now() + 1000).toISOString(), body: 'Chegou sim.', meta: {} });
    await expect(sent).toHaveAttribute('data-state', 'replied');
    await sent.getByRole('button', { name: /Ver resposta|See reply/ }).click();
    await expect(page.getByTestId('canvas-thread')).toBeVisible();
    await expect(sent).toHaveCount(0);
  } finally {
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
  }
});
