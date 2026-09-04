import { expect, test } from '@playwright/test';

const USAGE_FIXTURE = [
  {
    provider: 'claude',
    plan: null,
    windows: [
      { kind: '5h', label: '5 hours', usedPercent: 42, resetsAt: null },
      { kind: 'weekly', label: 'Weekly', usedPercent: 68, resetsAt: null },
    ],
    error: null,
    fetchedAt: '2026-08-12T12:00:00.000Z',
  },
  {
    provider: 'codex',
    plan: 'Plus',
    windows: [
      { kind: '5h', label: '5 hours', usedPercent: 81, resetsAt: null },
      { kind: 'weekly', label: 'Weekly', usedPercent: 27, resetsAt: null },
    ],
    error: null,
    fetchedAt: '2026-08-12T12:00:00.000Z',
  },
  {
    provider: 'kimi',
    plan: null,
    windows: [{ kind: 'monthly', label: 'Monthly', usedPercent: 16, resetsAt: null }],
    error: null,
    fetchedAt: '2026-08-12T12:00:00.000Z',
  },
];

test.describe('Workbench visual baseline', () => {
  test('matches the supported desktop viewport and theme matrix', async ({ page, request }) => {
    const settingsResponse = await request.get('/api/agent-room/settings');
    const originalSettings = (await settingsResponse.json()).data as Record<string, string>;
    const workspace = {
      id: '00000000-0000-4000-8000-000000000101',
      name: 'Product launch',
      workingDir: '/tmp/product-launch',
      icon: null,
      instructions: null,
      syncAgentInstructionFiles: false,
      hooks: {},
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z',
    };
    const note = {
      id: '00000000-0000-4000-8000-000000000102',
      workspaceId: workspace.id,
      type: 'note',
      title: 'Campaign brief',
      x: 100,
      y: 100,
      width: 520,
      height: 360,
      zIndex: 1,
      payload: {
        content: '# Launch checklist\n\n- Positioning approved\n- Landing page review\n- Final assets',
      },
      floorId: null,
      parentNodeId: null,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
    const files = [
      { name: 'assets', path: `${workspace.workingDir}/assets`, type: 'directory', size: 0 },
      { name: 'brief.md', path: `${workspace.workingDir}/brief.md`, type: 'file', size: 180 },
      { name: 'launch-plan.ts', path: `${workspace.workingDir}/launch-plan.ts`, type: 'file', size: 640 },
    ];

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/agent-room/usage*', (route) => route.fulfill({ json: { data: USAGE_FIXTURE } }));
    await page.route('**/api/agent-room/workspaces', (route) => route.fulfill({ json: { data: [workspace] } }));
    await page.route(`**/api/agent-room/workspaces/${workspace.id}/load`, (route) => route.fulfill({ json: { data: workspace } }));
    await page.route(`**/api/agent-room/workspaces/${workspace.id}/nodes`, (route) => route.fulfill({ json: { data: [note] } }));
    await page.route(`**/api/agent-room/workspaces/${workspace.id}/edges`, (route) => route.fulfill({ json: { data: [] } }));
    await page.route(`**/api/agent-room/workspaces/${workspace.id}/floors`, (route) => route.fulfill({ json: { data: [] } }));
    await page.route(`**/api/agent-room/workspaces/${workspace.id}/fs/list*`, (route) => route.fulfill({ json: { data: files } }));

    try {
      for (const theme of ['orkestrai-light', 'orkestrai-dark']) {
        await request.put('/api/agent-room/settings', {
          data: { ...originalSettings, appTheme: theme, workbenchTabPlacement: 'vertical', uiLanguage: 'en' },
        });
        for (const viewport of [
          { width: 1280, height: 720 },
          { width: 1440, height: 900 },
          { width: 1920, height: 1080 },
        ]) {
          await page.setViewportSize(viewport);
          await page.goto(`/terminal?workspace=${workspace.id}&node=${note.id}`);
          const shell = page.getByTestId('workbench-shell');
          await expect(shell).toBeVisible();
          const fileExplorer = page.getByTestId('workbench-file-explorer');
          await expect(fileExplorer).toBeVisible();
          await expect(fileExplorer.getByRole('button', { name: 'brief.md', exact: true })).toBeVisible();
          await expect(shell).toHaveScreenshot(
            `workbench-${theme}-${viewport.width}x${viewport.height}.png`,
            {
              animations: 'disabled',
              caret: 'hide',
              // Linux and macOS rasterize the same bundled font differently.
              maxDiffPixelRatio: process.env.CI ? 0.03 : 0.01,
            },
          );
        }
      }
    } finally {
      await request.put('/api/agent-room/settings', { data: originalSettings });
    }
  });
});
