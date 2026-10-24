import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('releases closed Canvas snapshots and callbacks under real garbage collection', () => {
  const fixture = fileURLToPath(new URL('../fixtures/canvas-anchor-gc.mjs', import.meta.url));
  const output = execFileSync(process.execPath, ['--expose-gc', fixture], {
    encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_OPTIONS: '' },
  });
  expect(JSON.parse(output.trim())).toEqual({ closedCanvasCollection: 'passed', callbacksAndGraphReleased: true, expiredWorkspaceReleased: true });
});
