import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
test.use({ actionTimeout: 10_000 });

test('imports documents, searches fresh citations, opens PDFs and navigates the knowledge graph', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const workingDir = mkdtempSync(join(tmpdir(), 'ork-knowledge-e2e-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-light' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Second Brain', workingDir } })).json()).data.id;
    const pdf = new PDFDocument({ compress: false }); const chunks: Buffer[] = [];
    const pdfBytes = new Promise<Buffer>((resolve) => { pdf.on('data', chunk => chunks.push(chunk)); pdf.on('end', () => resolve(Buffer.concat(chunks))); });
    pdf.text('Campaign deadline October 10.'); pdf.end();
    const workbook = new ExcelJS.Workbook(); workbook.addWorksheet('Budget').addRow(['Budget', 450]);
    const files = [
      { name: 'brief.pdf', type: 'application/pdf', bytes: (await pdfBytes).toString('base64') },
      { name: 'budget.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: Buffer.from(await workbook.xlsx.writeBuffer()).toString('base64') },
      { name: 'campaign.md', type: 'text/markdown', bytes: Buffer.from('# Campaign\nRead [[brief.pdf]] and [[budget.xlsx]]. #launch').toString('base64') },
    ];
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/canvas?workspace=${workspaceId}`);
    const pane = page.getByRole('region', { name: 'Canvas', exact: true }).locator('.svelte-flow__pane').first();
    await expect(pane).toBeVisible();
    const box = await pane.boundingBox();
    const transfer = await page.evaluateHandle(files => { const data = new DataTransfer(); for (const file of files) data.items.add(new File([Uint8Array.from(atob(file.bytes), c => c.charCodeAt(0))], file.name, { type: file.type })); return data; }, files);
    await pane.dispatchEvent('drop', { dataTransfer: transfer, clientX: box!.x + 180, clientY: box!.y + 140 }); await transfer.dispose();
    await expect.poll(async () => (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/nodes`)).json()).data.length).toBe(3);
    await page.getByRole('button', { name: 'Fit View', exact: true }).click();
    await expect(page.getByTestId('document-node')).toHaveCount(3);
    await expect.poll(async () => (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/knowledge?q=450`)).json()).data.items[0]?.locator).toBe('Budget!1');
    await expect(page.getByTestId('document-node').getByRole('alert')).toHaveCount(0);
    const nodes = (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/nodes`)).json()).data;
    const pdfNode = nodes.find((node: any) => node.title === 'brief.pdf');
    await page.locator(`[data-id="${pdfNode.id}"]`).getByRole('button', { name: 'Open original' }).click();
    const preview = page.getByRole('dialog');
    await expect.poll(() => preview.locator('canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(100);
    await preview.screenshot({ path: testInfo.outputPath('pdf-preview.png') });
    await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0);
    await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    const view = page.getByRole('dialog').getByTestId('knowledge-view');
    await expect(view).toBeVisible();
    expect((await page.getByRole('dialog').boundingBox())!.width).toBeGreaterThan(900);
    await view.getByRole('textbox', { name: 'Search knowledge' }).fill('450');
    await view.getByRole('button', { name: 'Search knowledge', exact: true }).click();
    await view.getByRole('button', { name: /^budget\.xlsx Document/ }).click();
    await expect(view.locator('aside')).toContainText('Budget!1');
    await expect(view.locator('aside')).toContainText('450');
    const budget = nodes.find((node: any) => node.title === 'budget.xlsx');
    workbook.getWorksheet('Budget')!.getCell('B1').value = 900;
    writeFileSync(join(workingDir, budget.payload.path), Buffer.from(await workbook.xlsx.writeBuffer()));
    await view.getByRole('textbox', { name: 'Search knowledge' }).fill('900'); await view.getByRole('button', { name: 'Search knowledge', exact: true }).click();
    await expect(view.locator('aside')).toContainText('900');
    await view.getByRole('textbox', { name: 'Search knowledge' }).fill(''); await view.getByRole('button', { name: 'Search knowledge', exact: true }).click();
    await view.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    await expect(view.getByTestId('knowledge-graph')).toHaveAttribute('data-count', '3');
    await view.getByTestId('knowledge-graph').locator('[data-graph-label]').filter({ hasText: 'campaign.md' }).click();
    await expect(view.locator('aside')).toContainText('# Campaign');
    await view.getByRole('textbox', { name: 'Tags, separated by commas', exact: true }).fill('launch, draft');
    await view.getByRole('button', { name: 'Refresh index', exact: true }).click();
    await expect(view.getByRole('button', { name: 'Refresh index', exact: true })).toBeEnabled();
    await expect(view.getByRole('textbox', { name: 'Tags, separated by commas', exact: true })).toHaveValue('launch, draft');
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('knowledge-light.png') });
    await page.keyboard.press('Escape');
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en', appTheme: 'orkestrai-dark' } });
    await page.reload(); await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('knowledge-dark.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Add to Canvas', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const embedded = page.getByTestId('knowledge-view');
    await embedded.getByRole('tab', { name: 'Knowledge graph', exact: true }).click();
    await expect(embedded.getByTestId('knowledge-graph')).toHaveAttribute('data-count', '3');
    await embedded.getByTestId('knowledge-graph').locator('[data-graph-label]').filter({ hasText: 'brief.pdf' }).click();
    await expect(embedded.locator('aside')).toContainText('October 10');
    await page.getByRole('link', { name: 'Workbench', exact: true }).click();
    await page.getByTestId('terminal-workspace-tree').getByRole('button', { name: /^budget\.xlsx Document$/ }).click();
    await expect(page.getByTestId('document-node')).toContainText('900');
    await page.screenshot({ path: testInfo.outputPath('workbench-document.png') });
    await page.getByTestId('terminal-workspace-tree').getByRole('button', { name: 'Second Brain', exact: true }).click();
    const workbenchKnowledge = page.getByTestId('knowledge-view');
    await workbenchKnowledge.getByRole('button', { name: /^budget\.xlsx Document/ }).click();
    await workbenchKnowledge.getByRole('button', { name: 'Open source', exact: true }).click();
    await expect(page.getByTestId('document-node')).toContainText('900');
    await page.getByTestId('terminal-workspace-tree').getByRole('button', { name: 'Second Brain', exact: true }).click();
    await page.getByTestId('knowledge-view').getByRole('button', { name: 'Add to Canvas', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`/api/agent-room/workspaces/${workspaceId}/nodes`)).json()).data.filter((node: any) => node.type === 'knowledge').length).toBe(2);
    await expect(page.getByTestId('knowledge-view').getByRole('button', { name: 'Add to Canvas', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    rmSync(workingDir, { recursive: true, force: true });
  }
});

test('persists agent learning modes and owner decisions without starting an AI provider', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const workingDir = mkdtempSync(join(tmpdir(), 'ork-learning-e2e-'));
  const settings = (await (await request.get('/api/agent-room/settings')).json()).data;
  let workspaceId = '';
  try {
    await request.put('/api/agent-room/settings', { data: { ...settings, uiLanguage: 'en' } });
    workspaceId = (await (await request.post('/api/agent-room/workspaces', { data: { name: 'E2E Agent learning', workingDir } })).json()).data.id;
    const root = `/api/agent-room/workspaces/${workspaceId}`;
    const node = (await (await request.post(`${root}/nodes`, { data: { type: 'terminal', title: 'Infrastructure specialist', payload: { command: process.execPath, args: ['-e', 'process.stdout.write("ready\\n"); process.stdin.on("data", () => {}); setInterval(() => {}, 1000);'] } } })).json()).data;
    const taskResponse = await request.post(`${root}/tasks`, { data: { title: 'Validate deployment DNS', assigneeNodeId: node.id } });
    expect(taskResponse.ok(), await taskResponse.text()).toBe(true);
    const task = (await taskResponse.json()).data;
    await request.patch(`${root}/tasks/${task.id}`, { data: { status: 'done' } });
    await request.patch(`${root}/nodes/${node.id}`, { data: { payload: { ...node.payload, provider: 'codex', agentRuntimeMode: 'on_demand' } } });
    await request.post(`${root}/learning`, { data: { command: 'configure', nodeId: node.id, mode: 'review' } });
    const lessonResponse = await request.post(`${root}/learning`, { data: { command: 'reflect', nodeId: node.id, taskId: task.id, title: 'Check DNS before deployment', trigger: 'Before a deployment', mistake: 'The DNS record was missing', correction: 'Confirm DNS resolution before deploying a service.', evidence: 'Controlled E2E fixture for reviewing a lesson, not an actual deployment.' } });
    expect(lessonResponse.ok(), await lessonResponse.text()).toBe(true);
    await page.goto(`/canvas?workspace=${workspaceId}`);
    await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    const view = page.getByRole('dialog');
    await view.getByRole('tab', { name: 'Agent learning', exact: true }).click();
    await expect(view.getByTestId('agent-learning')).toContainText('Check DNS before deployment');
    await expect(view.getByTestId('agent-learning')).toContainText('Needs review');
    await view.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(view.getByTestId('agent-learning')).toContainText('Active lesson');
    await view.getByRole('button', { name: 'Learning mode', exact: true }).click(); await page.getByRole('option', { name: 'Off', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${root}/learning`)).json()).data.agents[0].mode).toBe('off');
    await view.screenshot({ path: testInfo.outputPath('agent-learning.png') });
    await page.keyboard.press('Escape'); await page.reload(); await page.getByRole('button', { name: 'Second Brain', exact: true }).click();
    await page.getByRole('dialog').getByRole('tab', { name: 'Agent learning', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Learning mode', exact: true })).toContainText('Off');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => (await page.getByRole('dialog').boundingBox())!.width).toBeLessThan(390);
    const mobileDialog = await page.getByRole('dialog').boundingBox();
    expect(mobileDialog!.width).toBeLessThan(390);
    expect(mobileDialog!.x).toBeGreaterThanOrEqual(0);
    expect(mobileDialog!.y + mobileDialog!.height).toBeLessThanOrEqual(844);
    await page.getByRole('dialog').screenshot({ path: testInfo.outputPath('agent-learning-mobile.png') });
  } finally {
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await request.put('/api/agent-room/settings', { data: settings });
    rmSync(workingDir, { recursive: true, force: true });
  }
});
