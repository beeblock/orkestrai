import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Control Center', () => {
  test('keeps a large delivery audit compact until the owner expands it', async ({ page, request }) => {
    const labels = JSON.parse(readFileSync(new URL('../../messages/pt-BR.json', import.meta.url), 'utf8')) as Record<string, string>;
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-large-control-history-'));
    const response = await request.post('/api/agent-room/workspaces', { data: { name: 'Large delivery history', workingDir: dir } });
    expect(response.ok()).toBe(true);
    const workspace = (await response.json()).data as { id: string };
    const base = `/api/agent-room/workspaces/${workspace.id}`;
    try {
      const id = '00000000-0000-7000-8000-000000000001';
      const events = Array.from({ length: 1200 }, (_, index) => ({ id: `history-${index}`, messageId: id,
        workspaceId: workspace.id, fromNodeId: null, toNodeId: id, state: index === 1199 ? 'failed' : 'sent',
        content: '', reply: null, error: null, metadata: { kind: 'leader_supervision' }, createdAt: new Date(1790000000000 + index * 1000).toISOString() }));
      const snapshot = { workspaceId: workspace.id, counts: { starting: 0, working: 0, waiting_input: 0,
        waiting_permission: 0, blocked: 0, idle: 0, done: 0, error: 0, disconnected: 1 },
        agents: [{ nodeId: id, title: 'Leader', provider: 'codex', role: null, floorId: null, floorName: null,
          state: 'disconnected', stateSince: events[0].createdAt, lastAction: null, lastActionData: {}, currentTask: null,
          sessionAlive: false, runtimeMode: 'interactive' }], activity: [], communicationsProjection: 'compact',
        communications: [{ messageId: id, workspaceId: workspace.id, fromNodeId: null, fromTitle: null,
          toNodeId: id, toTitle: 'Leader', state: 'failed', content: 'Owner delivery retained', reply: 'Confirmed answer retained',
          error: 'Delivery failed after retries', createdAt: events[0].createdAt, updatedAt: events.at(-1)!.createdAt,
          events, eventDetailsOmitted: true }], generatedAt: events.at(-1)!.createdAt };
      await page.route(`**${base}/control-center*`, route => route.fulfill({ json: {
        data: route.request().url().includes('communications=0') ? { ...snapshot, communications: [], communicationsProjection: 'none' } : snapshot,
      } }));
      await page.goto(`/terminal?workspace=${workspace.id}&node=workbench-control-center%3A${workspace.id}`);
      const center = page.getByTestId('control-center-view');
      await expect(center).toBeVisible();
      await center.getByRole('radio', { name: new RegExp(labels['control_center.inbox']) }).click();
      await expect(center).toContainText('Owner delivery retained');
      await expect(center).toContainText('Confirmed answer retained');
      await expect(center.getByText(labels['control_center.automatic_supervisor'], { exact: false }).first()).toBeVisible();
      const history = center.getByTestId('control-center-delivery-history');
      await expect(history.locator('[data-history-event]')).toHaveCount(24);
      const started = Date.now();
      await center.getByRole('button', { name: labels['control_center.history_expand'], exact: true }).click();
      await expect(history.locator('[data-history-event]')).toHaveCount(1200);
      console.log('[control-center-history-expand]', JSON.stringify({ milliseconds: Date.now() - started, events: 1200 }));
      await center.getByRole('button', { name: labels['control_center.history_collapse'], exact: true }).click();
      await expect(history.locator('[data-history-event]')).toHaveCount(24);
      await center.getByRole('button', { name: labels['control_center.refresh'], exact: true }).click();
      await expect(center).toContainText('Owner delivery retained');
    } finally {
      await page.goto('about:blank');
      await request.delete(base);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('projects live agent state and verified message delivery in the Workbench', async ({ page, request }) => {
    test.setTimeout(45_000);
    const runId = Date.now();
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-control-center-'));
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E Control Center ${runId}`, workingDir: dir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const leaderResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'terminal',
        title: `Leader ${runId}`,
        x: 100,
        y: 100,
        width: 480,
        height: 320,
        payload: { command: '/bin/cat', args: [], maestro: true, role: 'Orchestration lead' },
      },
    });
    const leader = (await leaderResponse.json()).data as { id: string; title: string };
    const workerResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'terminal',
        title: `Reviewer ${runId}`,
        x: 620,
        y: 100,
        width: 480,
        height: 320,
        payload: { command: '/bin/cat', args: [], role: 'Product reviewer' },
      },
    });
    const worker = (await workerResponse.json()).data as { id: string; title: string };

    try {
      await page.goto(`/terminal?workspace=${workspace.id}&node=${worker.id}`);
      await expect(page.locator('.canvas-terminal .xterm')).toBeVisible({ timeout: 15_000 });
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/control-center`);
        const snapshot = (await response.json()).data as { agents: Array<{ nodeId: string; sessionAlive: boolean }> };
        return snapshot.agents.find((agent) => agent.nodeId === worker.id)?.sessionAlive ?? false;
      }).toBe(true);

      const bridge = JSON.parse(readFileSync(join(dir, '.orkestrai', 'workspace.json'), 'utf8')) as { token: string };
      const headers = { Authorization: `Bearer ${bridge.token}` };
      const message = `Confirm handoff ${runId}`;
      const askResponse = await request.post('/api/agent-room/bridge/ask', {
        headers,
        data: { from: leader.title, to: worker.title, message, timeoutMs: 7_000 },
      });
      const askPayload = await askResponse.json();
      expect(askResponse.ok(), JSON.stringify(askPayload)).toBe(true);
      const ask = askPayload.data as { replyConfirmed: boolean; deliveryState: string };
      expect(ask).toMatchObject({ replyConfirmed: true, deliveryState: 'replied' });

      await page.goto(`/terminal?workspace=${workspace.id}&node=workbench-control-center%3A${workspace.id}`);
      const center = page.getByTestId('control-center-view');
      await expect(center).toBeVisible();
      await expect(center).toContainText(message);
      await expect(center).toContainText(/Replied|Respondida|Respondido|Respondeu|Respondió/);
      // The page opens its event socket after the initial workspace projection.
      await page.waitForTimeout(750);

      const activityResponse = await request.post('/api/agent-room/bridge/activity', {
        headers,
        data: { from: worker.title, state: 'blocked', action: 'Waiting for visual approval' },
      });
      expect(activityResponse.ok()).toBe(true);

      const workerRow = center.locator('article', { hasText: worker.title }).first();
      await expect(workerRow).toContainText(/Blocked|Bloqueado/);
      await expect(workerRow).toContainText('Waiting for visual approval');
    } finally {
      await page.goto('about:blank');
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
