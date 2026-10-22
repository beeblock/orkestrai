import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type CreatedNode = { id: string; payload: Record<string, unknown> };

async function fileTransfer(page: import('@playwright/test').Page, name: string, type: string, content: string) {
  return page.evaluateHandle(({ fileName, fileType, fileContent }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([fileContent], fileName, { type: fileType }));
    return transfer;
  }, { fileName: name, fileType: type, fileContent: content });
}

test.describe('workspace attachments', () => {
  test('drops files and links onto notes, agent prompts, and tasks', async ({ page, request }) => {
    const workingDir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-attachments-'));
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E attachments ${Date.now()}`, workingDir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };
    const createNode = async (type: string, title: string, payload: Record<string, unknown>) => {
      const response = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, {
        data: { type, title, x: 100, y: 100, width: 520, height: 360, payload },
      });
      return (await response.json()).data as CreatedNode;
    };
    const note = await createNode('note', 'Attachment note', { content: 'Context' });
    const agent = await createNode('terminal', 'Attachment agent', {});
    const board = await createNode('tasks', 'Attachment board', {});
    const taskResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/tasks`, {
      data: { title: 'Review attachment pipeline', description: 'Use every attached reference.' },
    });
    const task = (await taskResponse.json()).data as { id: string };

    try {
      await page.goto(`/terminal?workspace=${workspace.id}&node=${note.id}`);
      await expect(page.getByTestId('workbench-pane-primary')).toBeVisible();
      const noteTransfer = await fileTransfer(
        page,
        'reference.png',
        'image/png',
        'fake-png-content',
      );
      await page.locator('.note-content').dispatchEvent('drop', { dataTransfer: noteTransfer });
      await expect(page.getByText('reference.png', { exact: true })).toBeVisible();

      let noteAttachmentPath = '';
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes/${note.id}`);
        const refreshed = (await response.json()).data as CreatedNode;
        const attachments = refreshed.payload.attachments as Array<{ path: string }> | undefined;
        noteAttachmentPath = attachments?.[0]?.path ?? '';
        return attachments?.length ?? 0;
      }).toBe(1);
      expect(noteAttachmentPath).toMatch(/^\.orkestrai\/attachments\//);
      expect(readFileSync(join(workingDir, noteAttachmentPath), 'utf8')).toBe('fake-png-content');

      await page.getByRole('button', {
        name: /Remove reference\.png|Remover reference\.png|Eliminar reference\.png/,
      }).click();
      await expect(page.getByText('reference.png', { exact: true })).toHaveCount(0);
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/nodes/${note.id}`);
        const refreshed = (await response.json()).data as CreatedNode;
        return {
          attachments: (refreshed.payload.attachments as unknown[] | undefined)?.length ?? 0,
          containsReference: String(refreshed.payload.content ?? '').includes('reference.png'),
        };
      }).toEqual({ attachments: 0, containsReference: false });
      expect(existsSync(join(workingDir, noteAttachmentPath))).toBe(false);

      await page.goto(`/terminal?workspace=${workspace.id}&node=${agent.id}`);
      const agentTransfer = await fileTransfer(page, 'agent-context.pdf', 'application/pdf', 'PDF context');
      await page.locator('.composer').dispatchEvent('drop', { dataTransfer: agentTransfer });
      // Quick messages carry files as staged attachments, not paths inserted
      // into the text (which were wrong for agents running on Floors or WSL).
      await expect(page.locator('.staged-attachments')).toContainText('agent-context.pdf');
      await expect(page.getByTestId('terminal-quick-prompt')).toHaveValue('');
      await expect(page.locator('.staged-attachments').getByRole('link', { name: 'agent-context.pdf' })).toHaveAttribute('title', /^\.orkestrai\/attachments\//);

      await page.goto(`/terminal?workspace=${workspace.id}&node=${board.id}`);
      await expect(page.locator('article.tb-card')).toHaveCount(1);
      const linkTransfer = await page.evaluateHandle(() => {
        const transfer = new DataTransfer();
        transfer.setData('text/uri-list', 'https://example.com/product-brief');
        return transfer;
      });
      await page.locator('article.tb-card').dispatchEvent('drop', { dataTransfer: linkTransfer });
      await expect.poll(async () => {
        const response = await request.get(`/api/agent-room/workspaces/${workspace.id}/tasks`);
        const tasks = (await response.json()).data as Array<{ id: string; attachments: Array<{ url: string | null }> }>;
        return tasks.find((item) => item.id === task.id)?.attachments[0]?.url ?? null;
      }).toBe('https://example.com/product-brief');
      await expect(page.getByText('product-brief', { exact: true })).toBeVisible();
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(workingDir, { recursive: true, force: true });
    }
  });

  test('rejects attachments larger than 10 MB before writing them', async ({ request }) => {
    const workingDir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-attachment-limit-'));
    const workspaceResponse = await request.post('/api/agent-room/workspaces', {
      data: { name: `E2E attachment limit ${Date.now()}`, workingDir },
    });
    const workspace = (await workspaceResponse.json()).data as { id: string };

    try {
      const response = await request.post(`/api/agent-room/workspaces/${workspace.id}/attachments`, {
        headers: { Origin: 'http://127.0.0.1:5199' },
        multipart: {
          file: {
            name: 'oversized.bin',
            mimeType: 'application/octet-stream',
            buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
          },
        },
      });
      expect(response.status()).toBe(413);
    } finally {
      await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
      rmSync(workingDir, { recursive: true, force: true });
    }
  });
});
