import { expect, test } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';

const exec = promisify(execFile);

test('keeps Core, Canvas edits and Settings responsive while polling a large asset checkout with graph disabled', async ({ page, request, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-large-assets-'));
  let workspaceId: string | null = null;
  let socket: WebSocket | null = null;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const healthTimes: number[] = [];
  const healthPids = new Set<number>();
  const gitTimes: number[] = [];
  const socketTimes: number[] = [];
  try {
    await mkdir(join(root, 'Assets'));
    await writeFile(join(root, 'README.md'), '# Large project\n');
    await exec('git', ['init', '-b', 'main'], { cwd: root });
    await exec('git', ['add', 'README.md'], { cwd: root });
    await exec('git', ['-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', 'commit', '-m', 'Initial fixture'], { cwd: root });
    // Do not allocate 50 GiB on NTFS CI. APFS/Linux sparse files occupy only
    // metadata while exercising real Git enumeration and HTTP file streaming.
    const bytesPerAsset = process.platform === 'win32' ? 1024 * 1024 : 5 * 1024 ** 3;
    for (let i = 0; i < 10; i++) {
      const file = await open(join(root, 'Assets', `asset-${i}.bin`), 'w');
      await file.truncate(bytesPerAsset);
      await file.close();
    }
    for (let batch = 0; batch < 10; batch++) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => writeFile(join(root, 'Assets', `script-${batch}-${i}.cs`), 'class Player {}\n')));
    }
    const created = await request.post('/api/agent-room/workspaces', { data: { name: 'Large Unity assets QA', workingDir: root, codeIntelligenceMode: 'disabled' } });
    expect(created.ok()).toBeTruthy();
    const workspace = (await created.json()).data;
    workspaceId = workspace.id;
    expect(workspace.codeIntelligenceMode).toBe('disabled');
    const base = `/api/agent-room/workspaces/${workspaceId}`;
    await page.goto(`/canvas?workspace=${workspaceId}`);
    await expect(page.getByTestId('canvas-git-pill')).toBeVisible();
    socket = new WebSocket(`${baseURL!.replace('http', 'ws')}/ws/agent-room/pty`, { origin: baseURL });
    socket.on('error', error => errors.push(error.message));
    await new Promise<void>((resolve, reject) => { socket!.once('open', resolve); socket!.once('error', reject); });
    const poll = async () => {
      for (let i = 0; i < 5; i++) {
        const started = performance.now();
        const statuses = await Promise.all(Array.from({ length: 3 }, () => request.get(`${base}/git/status?summary=1`)));
        for (const response of statuses) {
          expect(response.ok()).toBeTruthy();
          const data = (await response.json()).data;
          expect(data).not.toHaveProperty('revision');
          expect(data.changes.filter((change: { path: string }) => change.path.startsWith('Assets/'))).toHaveLength(1010);
        }
        gitTimes.push(performance.now() - started);
        const listing = await request.get(`${base}/fs/list?path=Assets`);
        expect(listing.ok()).toBeTruthy();
      }
    };
    const health = async () => {
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        const response = await request.get('/api/agent-room/core/health', { headers: { 'x-orkestrai-core-token': 'orkestrai-e2e-core-token' }, timeout: 2_000 });
        expect(response.ok()).toBeTruthy();
        healthPids.add((await response.json()).data.pid);
        healthTimes.push(performance.now() - started);
      }
    };
    const heartbeat = async () => {
      for (let i = 0; i < 20; i++) {
        const started = performance.now();
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { socket!.off('message', message); reject(new Error('PTY heartbeat timed out')); }, 2_000);
          const message = (data: WebSocket.RawData) => {
            if (JSON.parse(String(data)).type !== 'pong') return;
            clearTimeout(timer); socket!.off('message', message); resolve();
          };
          socket!.on('message', message);
          socket!.send(JSON.stringify({ type: 'ping' }));
        });
        socketTimes.push(performance.now() - started);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    await Promise.all([poll(), health(), heartbeat()]);
    const noteResponse = await request.post(`${base}/nodes`, { data: { type: 'note', title: 'Still editable', x: 120, y: 120, width: 320, height: 220, payload: { content: 'Core remains available' } } });
    expect(noteResponse.ok()).toBeTruthy();
    const note = (await noteResponse.json()).data;
    const node = page.locator(`.svelte-flow__node[data-id="${note.id}"]`);
    await expect(node).toBeVisible();
    await node.locator('.node-header').click();
    await page.keyboard.press('Delete');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Apagar', exact: true }).click();
    await expect(node).toHaveCount(0);

    const asset = await fetch(`${baseURL}${base}/fs/raw?path=Assets/asset-0.bin`);
    expect(asset.ok).toBeTruthy();
    expect(asset.headers.get('content-length')).toBe(String(bytesPerAsset));
    const reader = asset.body!.getReader();
    const chunk = await reader.read();
    expect(chunk.value!.byteLength).toBeGreaterThan(0);
    await reader.cancel();

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    expect((await request.get('/api/agent-room/core/health', { headers: { 'x-orkestrai-core-token': 'orkestrai-e2e-core-token' } })).ok()).toBeTruthy();
    expect(errors).toEqual([]);
    expect(Math.max(...healthTimes)).toBeLessThan(2_000);
    expect(Math.max(...socketTimes)).toBeLessThan(2_000);
    expect(healthPids.size).toBe(1);
    await testInfo.attach('large-workspace-timings', { contentType: 'application/json', body: JSON.stringify({ logicalAssetBytes: bytesPerAsset * 10, assetCount: 1010, healthTimesMs: healthTimes, gitPollTimesMs: gitTimes, ptyHeartbeatTimesMs: socketTimes }) });
  } finally {
    socket?.close();
    if (workspaceId) await request.delete(`/api/agent-room/workspaces/${workspaceId}`);
    await rm(root, { recursive: true, force: true });
  }
});
