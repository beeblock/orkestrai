import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('Design delivery', () => {
  test('imports code, generates a protected artifact, and opens it in Monaco', async ({ page, request }) => {
    test.setTimeout(120_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-design-delivery-e2e-'));
    const originalSettings = (await (await request.get('/api/agent-room/settings')).json()).data as Record<string, string>;
    const workspace = (await (await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E design delivery ${Date.now()}`, workingDir: dir },
    })).json()).data as { id: string };
    const node = (await (await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: { type: 'design', title: 'Delivery studio', x: 120, y: 120, width: 720, height: 520, payload: {} },
    })).json()).data as { id: string };
    const initial = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
      revision: number;
      activePageId: string;
    };
    const sourceId = randomUUID();
    const labelId = randomUUID();
    const seeded = (await (await request.patch(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`, {
      data: {
        baseRevision: initial.revision,
        operations: [
          { kind: 'create', element: { id: sourceId, pageId: initial.activePageId, parentId: null, type: 'frame', name: 'Hero card', x: 80, y: 80, width: 360, height: 220, fill: '#f8fafc' } },
          { kind: 'create', element: { id: labelId, pageId: initial.activePageId, parentId: sourceId, type: 'text', name: 'Headline', x: 112, y: 112, width: 260, height: 44, text: 'Build together', fontSize: 28, fontWeight: 700 } },
        ],
        summary: 'Seed delivery source',
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    })).json()).data as { revision: number };
    const reactImport = await request.post(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}/delivery/import`, {
      data: {
        baseRevision: seeded.revision,
        format: 'react',
        name: 'Imported React plan',
        markup: 'export function Plan(): JSX.Element { return <main className={`grid grid-cols-2 gap-4`}><h2>Pro</h2><UI.Copy>Ready</UI.Copy></main> }',
        css: '',
        parentId: null,
        actor: { kind: 'user', id: null, name: null, taskId: null },
      },
    });
    expect(reactImport.status()).toBe(200);
    expect(((await reactImport.json()).data.operations as unknown[]).length).toBeGreaterThan(2);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      await request.put('/api/agent-room/settings', { data: { ...originalSettings, uiLanguage: 'en' } });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/canvas?workspace=${workspace.id}&node=${node.id}&design=1`);
      const editor = page.locator('[data-testid="canvas-design-mode"]');
      const sidebar = editor.getByTestId('design-right-panel');
      await expect(editor).toBeVisible();
      await sidebar.getByRole('button', { name: 'Inspect', exact: true }).click();
      await sidebar.getByRole('button', { name: 'Code', exact: true }).click();
      const delivery = sidebar.locator('[data-design-delivery]');
      await expect(delivery).toBeVisible();

      await delivery.getByRole('button', { name: 'Import code', exact: true }).click();
      await delivery.getByLabel('Frame name').fill('Imported account card');
      await delivery.getByLabel('Markup').fill('<article class="flex flex-col gap-3 rounded-lg bg-white p-6"><h2 class="text-2xl font-bold text-slate-900">Account</h2><p class="text-sm text-slate-600">Ready for review</p></article>');
      await delivery.getByLabel('CSS (optional)').fill('article { width: 360px; min-height: 180px; }');
      const imported = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/designs/${node.id}`));
      await delivery.getByRole('button', { name: 'Import native layers', exact: true }).click();
      expect((await imported).status()).toBe(200);
      const afterUiImport = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        elements: Array<{ name: string }>;
      };
      expect(afterUiImport.elements).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported account card' })]));

      await delivery.getByRole('button', { name: 'Generate', exact: true }).click();
      await delivery.getByLabel('Component name').fill('AccountCard');
      await delivery.getByLabel('Workspace output path').fill('src/lib/components/generated/AccountCard.svelte');
      const previewed = page.waitForResponse((response) => response.url().endsWith(`/designs/${node.id}/delivery/preview`));
      await delivery.getByRole('button', { name: 'Preview code', exact: true }).click();
      expect((await (await previewed).json()).data.content).toContain('Account');
      await expect(delivery.getByText('New file', { exact: true })).toBeVisible();

      const artifactSaved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith(`/designs/${node.id}`));
      await delivery.getByRole('button', { name: 'Write to workspace', exact: true }).click();
      await artifactSaved;
      await expect(delivery.getByText('src/lib/components/generated/AccountCard.svelte', { exact: true }).last()).toBeVisible();
      const output = join(dir, 'src/lib/components/generated/AccountCard.svelte');
      expect(existsSync(output)).toBe(true);
      expect(readFileSync(output, 'utf8')).toContain('Account');

      const document = (await (await request.get(`/api/agent-room/workspaces/${workspace.id}/designs/${node.id}`)).json()).data as {
        codeArtifacts: Array<{ path: string }>;
        elements: unknown[];
      };
      expect(document.elements.length).toBeGreaterThan(4);
      expect(document.codeArtifacts).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'src/lib/components/generated/AccountCard.svelte' }),
      ]));

      await page.setViewportSize({ width: 980, height: 720 });
      await expect(delivery).toBeVisible();
      const overflow = await delivery.evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);

      await delivery.getByRole('button', { name: 'Open in Monaco', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}`));
      await expect(page.locator('[data-testid="workbench-file-view"]')).toBeVisible({ timeout: 20_000 });
      expect(pageErrors).toEqual([]);
    } finally {
      if (!page.isClosed()) await page.goto('about:blank');
      await request.put('/api/agent-room/settings', { data: originalSettings });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
