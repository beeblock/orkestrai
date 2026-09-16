import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB1sAAAAASUVORK5CYII=';

async function transfer(page: Page, names: string[]) {
  return page.evaluateHandle(({ names, png }) => {
    const data = new DataTransfer();
    for (const name of names) data.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], name, { type: 'image/png' }));
    return data;
  }, { names, png });
}

test('external images become separate Canvas references or agent attachments according to drop target', async ({ page, request }) => {
  const workingDir = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-image-drop-'));
  let workspaceId = '';
  try {
    const response = await request.post('/api/agent-room/workspaces', { data: { name: 'E2E external image drop', workingDir } });
    expect(response.ok()).toBe(true);
    workspaceId = (await response.json()).data.id;
    await page.goto(`/canvas?workspace=${workspaceId}`);
    const pane = page.locator('.svelte-flow__pane');
    await expect(pane).toBeVisible();
    const rect = await pane.boundingBox();
    expect(rect).not.toBeNull();
    const accepted = await pane.evaluate(element => {
      const data = new DataTransfer();
      Object.defineProperty(data, 'types', { value: ['Files'] });
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data });
      element.dispatchEvent(event);
      return { prevented: event.defaultPrevented, protectedFiles: data.files.length };
    });
    expect(accepted).toEqual({ prevented: true, protectedFiles: 0 });
    const images = await transfer(page, ['reference-one.png', 'reference-two.png']);
    await pane.dispatchEvent('drop', { dataTransfer: images, clientX: rect!.x + 160, clientY: rect!.y + 120 });
    await expect(page.locator('.canvas-image img')).toHaveCount(2);
    await expect.poll(() => page.locator('.canvas-image img').evaluateAll(images => images.every(image => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    const list = async () => (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/nodes`)).json()).data;
    const nodes = await list();
    expect(nodes.map((node: { title: string }) => node.title).sort()).toEqual(['reference-one.png', 'reference-two.png']);
    expect(nodes[0].x !== nodes[1].x || nodes[0].y !== nodes[1].y).toBe(true);
    for (const node of nodes) expect(readFileSync(join(workingDir, node.payload.path))).toEqual(Buffer.from(png, 'base64'));
    await page.reload();
    await expect(page.locator('.canvas-image img')).toHaveCount(2);
    const single = await transfer(page, ['single-reference.png']);
    await pane.dispatchEvent('drop', { dataTransfer: single, clientX: rect!.x + 500, clientY: rect!.y + 300 });
    await expect(page.locator('.canvas-image img')).toHaveCount(3);
    await single.dispose();

    const agent = await request.post(`/api/agent-room/workspaces/${workspaceId}/nodes`, {
      data: { type: 'terminal', title: 'Drop references here', x: 800, y: 100, width: 520, height: 360, payload: {} },
    });
    const agentId = (await agent.json()).data.id;
    await page.reload();
    const terminal = page.locator(`[data-id="${agentId}"] .terminal-body`);
    await expect(terminal).toBeVisible();
    expect(await terminal.evaluate(element => {
      const data = new DataTransfer();
      Object.defineProperty(data, 'types', { value: ['Files'] });
      const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    })).toBe(true);
    const refs = await transfer(page, ['agent-one.png', 'agent-two.png']);
    await page.getByTestId('terminal-quick-prompt').fill('Keep this draft.');
    await terminal.dispatchEvent('drop', { dataTransfer: refs });
    const prompt = page.getByTestId('terminal-quick-prompt');
    await expect(prompt).toHaveValue(/agent-one\.png.*agent-two\.png/);
    await expect(prompt).toHaveValue(/\.orkestrai\/attachments\//);
    await expect(prompt).toHaveValue(/^Keep this draft\./);
    const headerRef = await transfer(page, ['header-reference.png']);
    await page.locator(`[data-id="${agentId}"] .node-header`).dispatchEvent('drop', { dataTransfer: headerRef });
    await expect(prompt).toHaveValue(/agent-one\.png.*agent-two\.png.*header-reference\.png/);
    expect((await list()).filter((node: { type: string }) => node.type === 'image')).toHaveLength(3);
    await headerRef.dispose();
    await images.dispose();
    await refs.dispose();
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('an image upload stays in its original workspace when the user switches during import', async ({ page, request }) => {
  const root = mkdtempSync(join(tmpdir(), 'orkestrai-e2e-drop-switch-'));
  const ids: string[] = [];
  let releaseUpload = () => {};
  const uploadGate = new Promise<void>(resolve => { releaseUpload = resolve; });
  let uploadStarted = false;
  try {
    for (const name of ['Drop source', 'Drop destination']) {
      const workingDir = join(root, name);
      mkdirSync(workingDir);
      const response = await request.post('/api/agent-room/workspaces', { data: { name, workingDir } });
      expect(response.ok()).toBe(true);
      ids.push((await response.json()).data.id);
    }
    const [source, destination] = ids;
    await page.route(`**/workspaces/${source}/attachments`, async route => {
      uploadStarted = true;
      await uploadGate;
      await route.continue();
    });
    await page.goto(`/canvas?workspace=${source}`);
    const pane = page.locator('.svelte-flow__pane');
    await expect(pane).toBeVisible();
    const files = await transfer(page, ['stays-at-source.png']);
    await pane.dispatchEvent('drop', { dataTransfer: files, clientX: 600, clientY: 300 });
    await expect.poll(() => uploadStarted).toBe(true);
    await page.getByRole('button', { name: 'Drop destination', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Workbench', exact: true })).toHaveAttribute('href', new RegExp(destination));
    releaseUpload();
    const list = async (id: string) => (await (await request.get(`/api/agent-room/workspaces/${id}/nodes`)).json()).data;
    await expect.poll(async () => (await list(source)).length).toBe(1);
    expect(await list(destination)).toHaveLength(0);
    const sourceImage = (await list(source))[0];
    expect(readFileSync(join(root, 'Drop source', sourceImage.payload.path))).toEqual(Buffer.from(png, 'base64'));
    expect(existsSync(join(root, 'Drop destination', sourceImage.payload.path))).toBe(false);
    await expect(page.locator('.canvas-image')).toHaveCount(0);
    await files.dispose();
  } finally {
    releaseUpload();
    await page.unrouteAll({ behavior: 'wait' });
    for (const id of ids) await request.delete(`/api/agent-room/workspaces/${id}`);
    rmSync(root, { recursive: true, force: true });
  }
});
