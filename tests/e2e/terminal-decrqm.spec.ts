import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('production xterm answers the synchronized-output mode query without a ReferenceError', async ({ page, request }) => {
  const dir = mkdtempSync(join(tmpdir(), 'orkestrai-decrqm-'));
  const proof = join(dir, 'mode-response.json');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const created = await request.post('/api/agent-room/workspaces', { data: { name: 'DECRQM production regression', workingDir: dir } });
  expect(created.ok()).toBe(true);
  const workspace = (await created.json()).data as { id: string };
  try {
    const script = `const fs=require('node:fs');process.stdin.setRawMode(true);let received='';
      process.stdin.on('data',chunk=>{received+=chunk.toString();if(received.includes('\\x1b[?2026;2$y')){
        fs.writeFileSync(${JSON.stringify(proof)},JSON.stringify({response:'\\x1b[?2026;2$y'}));process.exit(0);}});
      process.stdout.write('\\x1b[?2026$p');setTimeout(()=>process.exit(2),15000);`;
    const nodeResponse = await request.post(`/api/agent-room/workspaces/${workspace.id}/nodes`, { data: {
      type: 'terminal', title: 'DECRQM probe', x: 0, y: 0, width: 640, height: 400,
      payload: { command: process.execPath, args: ['-e', script] },
    } });
    expect(nodeResponse.ok()).toBe(true);
    const node = (await nodeResponse.json()).data as { id: string };
    await page.goto(`/terminal?workspace=${workspace.id}&node=${node.id}`);
    await expect(page.locator('.canvas-terminal .xterm')).toBeVisible();
    await expect.poll(() => existsSync(proof), { timeout: 12000 }).toBe(true);
    expect(JSON.parse(readFileSync(proof, 'utf8')).response).toBe('\x1b[?2026;2$y');
    expect(errors.filter(error => /ReferenceError|is not defined/.test(error))).toEqual([]);
  } finally {
    await page.goto('about:blank');
    await request.delete(`/api/agent-room/workspaces/${workspace.id}`);
    rmSync(dir, { recursive: true, force: true });
  }
});
