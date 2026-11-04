import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPackagedUiAssets } from '../fixtures/packaged-ui-assets.mjs';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'orkestrai-ui-assets-'));
  for (const directory of ['entry', 'nodes', 'chunks', 'workers']) {
    const path = join(root, 'build/client/_app/immutable', directory);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'test.js'), 'export const ready = true;');
  }
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const script = () => new Response('export const ready = true;', { headers: { 'content-type': 'application/javascript' } });

describe('packaged UI resources', () => {
  it('checks entry points, lazy pages and shared chunks against the actual files', async () => {
    await expect(verifyPackagedUiAssets(root, 'http://127.0.0.1:1', async () => script())).resolves.toMatchObject({ scripts: 4, http: 'passed' });
  });
  it.each([404, 500])('rejects a failing lazy page even while Core health is available (%s)', async status => {
    await expect(verifyPackagedUiAssets(root, 'http://127.0.0.1:1', async (url: string) => url.includes('/nodes/') ? new Response('error', { status }) : script())).rejects.toThrow('UI script failed');
  });
  it('rejects stale or corrupted JavaScript served under a valid URL', async () => {
    await expect(verifyPackagedUiAssets(root, 'http://127.0.0.1:1', async () => new Response('export const ready = null;', { headers: { 'content-type': 'application/javascript' } }))).rejects.toThrow('differs');
  });
});
