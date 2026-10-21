import { expect, test } from '@playwright/test';

const ITEM = '01a14a44-5d87-7d1c-90e7-7b697f79bf77';
const QUESTION = '01a14a44-5d87-7d1c-90e7-7b697f79bf78';

function snapshot() {
  return {
    shareId: 'share', revision: 3, workspace: { name: 'Moedex', icon: null },
    nodes: [], edges: [], columns: [], tasks: [], agents: [], conversations: [], huddles: [], floors: [], roles: [], reviews: [], designs: [], usage: [], activity: [],
    attention: [
      { id: ITEM, title: 'deploy · production', body: 'Production deploy requires approval.', nodeTitle: 'Ops', severity: 'error', decision: 'gate', options: [], question: false, createdAt: '2026-10-17T12:00:00.000Z' },
      { id: QUESTION, title: 'Posso instalar o sharp?', body: 'Sim · Não', nodeTitle: 'QA Upload', severity: 'warning', decision: null, options: ['Sim', 'Não'], question: true, createdAt: '2026-10-17T12:01:00.000Z' },
    ],
    generatedAt: '2026-10-17T12:02:00.000Z',
  };
}

test('a phone guest answers and decides what needs the owner', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const commands: Array<Record<string, unknown>> = [];
  await page.route('**/api/collaboration/remote/commands', async (route) => {
    commands.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ json: { data: { commandId: 'c', accepted: true, revision: 4, result: {}, errorCode: null } } });
  });
  await page.route('**/api/collaboration/remote', (route) => route.fulfill({ json: { data: {
    status: 'connected', shareId: 'share', hostDeviceId: 'host', deviceId: 'phone', displayName: 'Phone', role: 'operator',
    scopes: ['workspace.view', 'activity.view', 'tasks.view', 'approvals.view', 'approvals.decide'], revision: 3, snapshot: snapshot(), errorCode: null,
  } } }));

  // The remote client runs inside the desktop app.
  await page.addInitScript(() => { (window as unknown as { orkestraiDesktop: unknown }).orkestraiDesktop = { platform: 'darwin' }; });
  await page.goto('/remote');
  await page.getByRole('button', { name: /Precisa de você/ }).first().click();
  const panel = page.getByTestId('remote-needs-you');
  await expect(panel).toContainText('Production deploy requires approval.');
  await page.screenshot({ path: test.info().outputPath('remote-needs-you-phone.png') });
  await panel.getByRole('button', { name: 'Permitir' }).click();
  await panel.getByRole('button', { name: 'Sim', exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[0]).toMatchObject({ type: 'attention.decide', itemId: ITEM, decision: 'approve' });
  expect(commands[1]).toMatchObject({ type: 'attention.answer', itemId: QUESTION, text: 'Sim' });
});
