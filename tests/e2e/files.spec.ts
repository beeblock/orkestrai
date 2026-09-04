import { expect, test } from '@playwright/test';
import { createNodeOnCanvas } from './helpers.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe('arquivos e editor do workspace', () => {
  test('abre arquivo da arvore no Workbench, edita e salva', async ({ page, request }) => {
    test.setTimeout(90_000);
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-fs-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'hello.ts'), 'export const hello = "ola";\n');
    const workspaceName = `E2E fs ${Date.now()}`;

    let workspaceId: string | undefined;

    try {
      await page.goto('/canvas');
      await page.getByRole('button', { name: 'Novo workspace' }).click();
      await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
      await page.getByPlaceholder('Diretório de trabalho').fill(dir);
      await page.getByRole('button', { name: 'Criar' }).click();
      await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
      await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

      const list = await request.get('/api/agent-room/workspaces');
      const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
      workspaceId = workspaces.find((workspace) => workspace.name === workspaceName)?.id;
      expect(workspaceId).toBeTruthy();

      // Abre a arvore de arquivos e navega ate src/hello.ts.
      await createNodeOnCanvas(page, 'Arquivos');
      const tree = page.locator('.canvas-filetree');
      await expect(tree).toBeVisible();
      await tree.getByText('src').click();
      await tree.getByText('hello.ts').dblclick();

      // Arquivos agora abrem no Monaco integrado ao Workbench.
      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspaceId}`));
      const fileView = page.getByTestId('workbench-file-view');
      await expect(fileView.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
      const editor = fileView.getByRole('textbox', { name: 'Editor content' });
      await expect(editor).toHaveValue(/export const hello = "ola";/);

      await editor.focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
      await editor.pressSequentially('// editado', { delay: 5 });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');

      await expect.poll(() => readFileSync(join(dir, 'src', 'hello.ts'), 'utf8')).toContain('// editado');

      // A aba e o arquivo aberto sobrevivem ao reload do Workbench.
      await page.reload();
      await expect(fileView.locator('.monaco-editor')).toBeVisible({ timeout: 30_000 });
      await expect(fileView.getByRole('textbox', { name: 'Editor content' })).toHaveValue(/\/\/ editado/);
    } finally {
      if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('arvore mostra branch e status git', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-git-'));
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'e2e@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# x\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    writeFileSync(join(dir, 'README.md'), '# x mudou\n');

    const workspaceName = `E2E git ${Date.now()}`;
    let workspaceId: string | undefined;
    try {
      await page.goto('/canvas');
      await page.getByRole('button', { name: 'Novo workspace' }).click();
      await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
      await page.getByPlaceholder('Diretório de trabalho').fill(dir);
      await page.getByRole('button', { name: 'Criar' }).click();
      await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();
      await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

      await createNodeOnCanvas(page, 'Arquivos');
      const tree = page.locator('.canvas-filetree');
      await expect(tree.locator('.branch-badge')).toContainText('main');
      const readme = tree.locator('.tree-entry', { hasText: 'README.md' });
      await expect(readme.locator('.entry-status')).toHaveText('M');

      const list = await request.get('/api/agent-room/workspaces');
      const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
      workspaceId = workspaces.find((workspace) => workspace.name === workspaceName)?.id;
    } finally {
      if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('diff viewer mostra alteracoes e faz stage', async ({ page, request }) => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-diff-'));
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'e2e@orkestrai.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'E2E'], { cwd: dir });
    writeFileSync(join(dir, 'app.ts'), 'const v = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    writeFileSync(join(dir, 'app.ts'), 'const v = 2;\n');

    const workspaceName = `E2E diff ${Date.now()}`;
    let workspaceId: string | undefined;
    try {
      await page.goto('/canvas');
      await page.getByRole('button', { name: 'Novo workspace' }).click();
      await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
      await page.getByPlaceholder('Diretório de trabalho').fill(dir);
      await page.getByRole('button', { name: 'Criar' }).click();
      await page.locator('.workspace-list .workspace-item', { hasText: workspaceName }).click();

      await createNodeOnCanvas(page, 'Diff');
      const diff = page.locator('.canvas-diff');
      await expect(diff).toBeVisible();
      await expect(diff.locator('.branch-badge')).toContainText('main');

      // Seleciona o arquivo alterado e ve o diff
      const appChange = diff.locator('.change-row', { hasText: 'app.ts' });
      await appChange.locator('.change-open').click();
      await expect(diff.locator('.diff-text')).toContainText('const v = 2');
      await expect(diff.locator('.diff-text')).toContainText('const v = 1');

      // Stage pelo botao e confira somente a alteracao sob teste.
      await appChange.getByRole('button', { name: 'stage' }).click();
      await expect(diff.locator('.change-row', { hasText: 'app.ts' }).locator('.change-status')).toHaveText('M*', { timeout: 10_000 });

      const list = await request.get('/api/agent-room/workspaces');
      const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
      workspaceId = workspaces.find((workspace) => workspace.name === workspaceName)?.id;
    } finally {
      if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`).catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
