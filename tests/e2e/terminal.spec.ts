import { expect, test } from '@playwright/test';
import { rmSync } from 'node:fs';
import { selectAgentTool } from './helpers.js';

test.describe('terminais PTY', () => {
  test('salva comandos locais e globais e autoexecuta apenas uma vez ao retomar o shell', async ({ page, request }) => {
    test.setTimeout(90_000);
    test.skip(process.platform === 'win32', 'A prova de autoexec usa sintaxe POSIX; PowerShell e WSL são cobertos no domínio');
    const runId = Date.now();
    const workspaceName = `E2E comandos salvos ${runId}`;
    const counterFile = `/tmp/orkestrai-command-auto-${runId}`;
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, string>;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const terminalResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
      data: {
        type: 'terminal',
        title: 'Shell com atalhos',
        x: 120,
        y: 100,
        width: 640,
        height: 380,
        payload: { command: '/bin/sh', args: [] },
      },
    });
    const terminalNode = (await terminalResponse.json()).data as { id: string };

    try {
      await request.put('/api/agent-room/settings', {
        data: { terminalGlobalCommands: '[]' },
      });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const terminal = page.locator('.canvas-terminal');
      await expect(terminal.locator('.xterm-helper-textarea')).toBeAttached({ timeout: 15_000 });

      await terminal.getByTestId('terminal-actions-menu').click();
      await page.getByRole('menuitem', { name: /Comandos salvos/ }).hover();
      await page.getByRole('menuitem', { name: 'Criar e gerenciar comandos…' }).click();
      const dialog = page.getByTestId('terminal-commands-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Nome', { exact: true }).fill('Preparar ambiente');
      await dialog.getByLabel('Comando', { exact: true }).fill(
        `n=$(cat ${counterFile} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${counterFile}; echo ORKESTRAI_AUTO_COUNT_$n`,
      );
      await dialog.getByRole('switch', { name: 'Executar ao retomar' }).click();
      await dialog.getByRole('button', { name: 'Salvar comando' }).click();

      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes/${terminalNode.id}`);
        const node = (await response.json()).data as { payload?: { savedCommands?: Array<{ name: string; runOnResume: boolean }> } };
        return node.payload?.savedCommands?.[0];
      }).toEqual({
        id: expect.any(String),
        name: 'Preparar ambiente',
        command: expect.stringContaining('ORKESTRAI_AUTO_COUNT_'),
        runOnResume: true,
      });

      await dialog.getByRole('tab', { name: 'Globais' }).click();
      await dialog.getByLabel('Nome', { exact: true }).fill('Diagnóstico global');
      await dialog.getByLabel('Comando', { exact: true }).fill(`echo GLOBAL_COMMAND_${runId}`);
      await dialog.getByRole('button', { name: 'Salvar comando' }).click();
      await expect.poll(async () => {
        const response = await request.get('/api/agent-room/settings');
        const settings = (await response.json()).data as Record<string, string>;
        return JSON.parse(settings.terminalGlobalCommands) as Array<{ name: string }>;
      }).toEqual([
        expect.objectContaining({ name: 'Diagnóstico global' }),
      ]);

      await dialog.getByRole('button', { name: 'Executar', exact: true }).click();
      await expect(terminal.locator('.terminal-container')).toContainText(`GLOBAL_COMMAND_${runId}`, { timeout: 10_000 });

      await page.reload();
      await expect(terminal.locator('.terminal-container')).toContainText('ORKESTRAI_AUTO_COUNT_1', { timeout: 15_000 });
      await page.reload();
      await expect(terminal.locator('.xterm-helper-textarea')).toBeAttached({ timeout: 15_000 });
      await page.waitForTimeout(1_000);
      await expect(terminal.locator('.terminal-container')).not.toContainText('ORKESTRAI_AUTO_COUNT_2');
    } finally {
      rmSync(counterFile, { force: true });
      await request.put('/api/agent-room/settings', {
        data: { terminalGlobalCommands: originalSettings.terminalGlobalCommands ?? '[]' },
      });
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('entrega Escape a TUIs sem perder o foco do terminal no Canvas', async ({ page, request }) => {
    test.skip(process.platform === 'win32', 'O probe raw usa o runtime POSIX do runner');
    const workspaceName = `E2E terminal Escape ${Date.now()}`;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: workspaceName, workingDir: '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };

    try {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: {
          type: 'terminal',
          title: 'Shell Escape',
          x: 120,
          y: 100,
          width: 640,
          height: 380,
          payload: { command: '/bin/sh', args: [] },
        },
      });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const terminal = page.locator('.canvas-terminal');
      const input = terminal.locator('.xterm-helper-textarea');
      await expect(input).toBeAttached({ timeout: 15_000 });
      await terminal.locator('.terminal-container').click();
      await input.focus();
      await expect.poll(() => input.evaluate((element) => document.activeElement === element)).toBe(true);
      await expect(terminal).toHaveClass(/selected/);

      const rawEscapeProbe = `node -e "const i=process.stdin;i.setRawMode(true);i.resume();i.once('data',d=>{i.setRawMode(false);console.log(d.toString('hex')==='1b'?'ESCAPE_OK':'ESCAPE_BAD_'+d.toString('hex'));process.exit(0)})"`;
      await page.keyboard.type(rawEscapeProbe);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');

      await expect(terminal.locator('.terminal-container')).toContainText('ESCAPE_OK', { timeout: 10_000 });
      await expect.poll(() => input.evaluate((element) => document.activeElement === element)).toBe(true);
      await expect(terminal).toHaveClass(/selected/);

      await page.keyboard.type('echo AFTER_ESCAPE_OK');
      await page.keyboard.press('Enter');
      await expect(terminal.locator('.terminal-container')).toContainText('AFTER_ESCAPE_OK', { timeout: 10_000 });
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('copia a selecao e cola texto com os atalhos nativos do Windows', async ({ page, request, context }) => {
    const runId = Date.now();
    const marker = `ORKESTRAI_COPY_${runId}`;
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E terminal copy ${runId}`, workingDir: process.platform === 'win32' ? process.cwd() : '/tmp' },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Win32' });
    });

    try {
      await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: {
          type: 'terminal',
          title: 'Shell copy',
          x: 120,
          y: 100,
          width: 640,
          height: 380,
          payload: { command: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh', args: [] },
        },
      });
      await page.goto(`/canvas?workspace=${workspace.id}`);
      const terminal = page.locator('.canvas-terminal');
      const input = terminal.locator('.xterm-helper-textarea');
      await expect(input).toBeAttached({ timeout: 15_000 });
      await input.focus();
      await page.keyboard.type(`echo ${marker}`);
      await page.keyboard.press('Enter');
      const output = terminal.locator('.xterm-rows span').filter({ hasText: marker }).last();
      await expect(output).toBeVisible({ timeout: 10_000 });

      await output.dblclick({ force: true });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+C' : 'Control+C');
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(marker);

      await page.evaluate(() => navigator.clipboard.writeText(''));
      await output.dblclick({ force: true });
      await output.click({ button: 'right', force: true });
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(marker);

      const pasteMarker = `ORKESTRAI_PASTE_${runId}`;
      await page.evaluate((text) => navigator.clipboard.writeText(text), `echo ${pasteMarker}`);
      await input.focus();
      await page.keyboard.press('Control+V');
      await page.keyboard.press('Enter');
      await expect(terminal.locator('.terminal-container')).toContainText(pasteMarker, { timeout: 10_000 });
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('troca de workspace antes de abrir ao lado e nao mistura artefatos', async ({ page, request }) => {
    const runId = Date.now();
    const firstName = `E2E Workbench A ${runId}`;
    const secondName = `E2E Workbench B ${runId}`;
    const firstResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: firstName, workingDir: '/tmp' },
    });
    const secondResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: secondName, workingDir: '/tmp' },
    });
    const first = (await firstResponse.json()).data as { id: string };
    const second = (await secondResponse.json()).data as { id: string };

    try {
      const firstNoteResponse = await request.post(`/api/agent-room/workspaces/${first.id}/nodes`, {
        data: { type: 'note', title: `Note A ${runId}`, x: 100, y: 100, width: 360, height: 260, payload: { content: 'Workspace A' } },
      });
      const secondNoteTitle = `Note B ${runId}`;
      await request.post(`/api/agent-room/workspaces/${second.id}/nodes`, {
        data: { type: 'note', title: secondNoteTitle, x: 100, y: 100, width: 360, height: 260, payload: { content: 'Workspace B' } },
      });
      const firstNote = (await firstNoteResponse.json()).data as { id: string };

      await page.goto(`/terminal?workspace=${first.id}&node=${firstNote.id}`);
      const tree = page.getByTestId('terminal-workspace-tree');
      await tree.locator('button', { hasText: secondName }).click();
      await tree.getByRole('button', { name: `Abrir ${secondNoteTitle} à direita` }).click();

      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${second.id}.*node=`));
      await expect(page.getByTestId('workbench-pane-secondary')).toHaveCount(0);
      await expect(page.getByTestId('workbench-pane-primary').locator('.canvas-note textarea')).toHaveValue('Workspace B');
    } finally {
      await request.delete(`/api/agent-room/workspaces/${first.id}`);
      await request.delete(`/api/agent-room/workspaces/${second.id}`);
    }
  });

  test('navega pelos artefatos persistidos e preserva a selecao ao voltar ao canvas', async ({ page, request }) => {
    test.setTimeout(75_000);
    const runId = Date.now();
    const workspaceName = `E2E modo terminais ${runId}`;
    const noteTitle = `Briefing E2E ${runId}`;
    const shellTitle = `Shell E2E ${runId}`;
    const leaderTitle = `Lider de voz E2E ${runId}`;
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, string>;
    let workspace: { id: string; name: string } | undefined;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list')).toContainText(workspaceName);

    const list = await request.get('/api/agent-room/workspaces');
    workspace = ((await list.json()).data as Array<{ id: string; name: string }>).find(
      (item) => item.name === workspaceName
    );
    if (!workspace) throw new Error(`Workspace ${workspaceName} was not persisted`);

    try {
      const noteResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: {
          type: 'note',
          title: noteTitle,
          x: 100,
          y: 100,
          width: 360,
          height: 260,
          payload: { content: '# Briefing persistido' },
        },
      });
      const note = (await noteResponse.json()).data as { id: string };

      const shellResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: {
          type: 'terminal',
          title: shellTitle,
          x: 520,
          y: 100,
          width: 480,
          height: 320,
          payload: { command: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh', args: [] },
        },
      });
      const shell = (await shellResponse.json()).data as { id: string };
      const leaderResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: {
          type: 'terminal',
          title: leaderTitle,
          x: 520,
          y: 460,
          width: 480,
          height: 320,
          payload: {
            command: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
            args: [],
            maestro: true,
          },
        },
      });
      const leader = (await leaderResponse.json()).data as { id: string };

      await page.goto(`/terminal?workspace=${workspace.id}&node=${note.id}`);
      const tree = page.getByTestId('terminal-workspace-tree');
      await expect(tree).toContainText(workspaceName);
      await expect(page.getByTestId('workbench-vertical-tabs')).toBeVisible();
      await expect(page.locator('.canvas-note textarea')).toHaveValue('# Briefing persistido');

      const search = page.getByTestId('terminal-workspace-search');
      await search.fill(shellTitle);
      await expect(tree).toContainText(shellTitle);
      await expect(tree).not.toContainText(noteTitle);
      await tree.getByRole('button', { name: `Abrir ${shellTitle} à direita` }).click();
      await expect(page.getByTestId('workbench-pane-primary').locator('.canvas-note textarea')).toHaveValue('# Briefing persistido');
      await expect(page.getByTestId('workbench-pane-secondary')).toBeVisible();

      const terminal = page.getByTestId('workbench-pane-secondary').locator('.canvas-terminal');
      await expect(terminal.locator('.xterm')).toBeVisible({ timeout: 15_000 });
      const marker = `e2e-${Date.now()}`;
      const terminalInput = terminal.locator('.xterm-helper-textarea');
      await page.waitForTimeout(300);
      await terminalInput.evaluate((element) => (element as HTMLTextAreaElement).focus());
      await expect.poll(() => terminalInput.evaluate((element) => document.activeElement === element)).toBe(true);
      await page.keyboard.type(`echo ${marker}`);
      await page.keyboard.press('Enter');
      await expect(terminal.locator('.terminal-container')).toContainText(marker, { timeout: 10_000 });

      await page.getByTestId('terminal-open-canvas').click();
      await expect(page).toHaveURL(new RegExp(`/canvas\\?workspace=${workspace.id}&node=${shell.id}`));
      await expect(page.locator('.canvas-terminal').filter({ hasText: shellTitle })).toBeVisible();
      await page.getByRole('link', { name: 'Workbench' }).click();
      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}.*node=`));
      await expect(page.getByTestId('workbench-pane-secondary')).toBeVisible();

      const restoredTerminal = page.locator('.canvas-terminal');
      await expect(restoredTerminal.locator('.xterm')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('workbench-close-pane').click();
      await expect(page.getByTestId('workbench-pane-secondary')).toHaveCount(0);
      await restoredTerminal.locator('.terminal-container').click();
      await page.keyboard.type('stty size');
      await page.keyboard.press('Enter');
      await expect.poll(async () => {
        const rows = await restoredTerminal.locator('.xterm-rows > div').allTextContents();
        const size = rows.map((row) => row.trim()).filter((row) => /^\d+ \d+$/.test(row)).at(-1);
        return size ? Number(size.split(' ')[1]) : 0;
      }).toBeGreaterThan(80);

      await tree.getByRole('button', { name: `Abrir ${noteTitle} à direita` }).click();
      await expect(page.getByTestId('workbench-pane-secondary').locator('.canvas-note textarea')).toHaveValue('# Briefing persistido');

      const fallbackHandled = await page.evaluate(() => {
        const detail = { handled: false };
        window.dispatchEvent(new CustomEvent('orkestrai:text-dictation-fallback', { detail }));
        return detail.handled;
      });
      expect(fallbackHandled).toBe(true);
      await expect(page).toHaveURL(new RegExp(`/terminal\\?workspace=${workspace.id}.*node=${leader.id}`));
      await expect(page.getByTestId('terminal-workspace-header')).toContainText(leaderTitle);

      const cancelVoiceDownload = page.getByRole('button', { name: 'Agora não' });
      if (await cancelVoiceDownload.isVisible()) await cancelVoiceDownload.click();

      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, workbenchTabPlacement: 'horizontal' },
      });
      await page.reload();
      await expect(page.getByTestId('workbench-vertical-tabs')).toHaveCount(0);
      await expect(page.getByRole('tablist')).toHaveCount(2);
      await expect(page.getByRole('tab', { name: leaderTitle })).toHaveAttribute('aria-selected', 'true');

      const openCanvas = page.getByTestId('terminal-open-canvas');
      await expect(openCanvas.locator('svg')).toHaveCount(1);
      await openCanvas.click();
      await expect(page).toHaveURL(new RegExp(`/canvas\\?workspace=${workspace.id}&node=${leader.id}`));
      await expect(page.locator('.canvas-terminal').filter({ hasText: leaderTitle })).toBeVisible();
    } finally {
      await request.put('/api/agent-room/settings', {
        data: { ...originalSettings, workbenchTabPlacement: originalSettings.workbenchTabPlacement ?? 'vertical' },
      });
      if (workspace) await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    }
  });

  test('botao de agente no canvas cria terminal com o comando do agente (nao shell puro)', async ({ page, request }) => {
    const workspaceName = `E2E agente ${Date.now()}`;

    await page.goto('/canvas');
    await page.getByRole('button', { name: 'Novo workspace' }).click();
    await page.getByPlaceholder('Nome', { exact: true }).fill(workspaceName);
    await page.getByPlaceholder('Diretório de trabalho').fill('/tmp');
    await page.getByRole('button', { name: 'Criar' }).click();
    await expect(page.locator('.workspace-list li.active')).toContainText(workspaceName);

    // Arma a ferramenta do agente e clica no canvas (tamanho padrao); o
    // dialogo de criacao abre — confirma com o nome padrao.
    await selectAgentTool(page, 'Claude');
    await page.locator('.svelte-flow__pane').click({ position: { x: 700, y: 400 } });
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Criar agente' }).click();
    await expect(page.locator('.canvas-terminal')).toHaveCount(1);

    // O no precisa carregar o comando do agente, nao o shell do sistema.
    const list = await request.get('/api/agent-room/workspaces');
    const workspaces = (await list.json()).data as Array<{ id: string; name: string }>;
    const created = workspaces.find((workspace) => workspace.name === workspaceName)!;
    const nodesResponse = await request.get(`/api/agent-room/workspaces/${created.id}/nodes`);
    const canvasNodes = (await nodesResponse.json()).data as Array<{ title: string; payload: { command?: string; provider?: string } }>;
    expect(canvasNodes[0].title).toBe('Claude');
    expect(canvasNodes[0].payload.command).toBe('claude');
    expect(canvasNodes[0].payload.provider).toBe('claude');

    await request.delete(`/api/agent-room/workspaces/${created.id}`);
  });
});
