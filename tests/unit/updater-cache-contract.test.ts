import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const { DownloadedUpdateHelper } = createRequire(import.meta.url)('electron-updater/out/DownloadedUpdateHelper.js');
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'orkestrai-update-cache-')); roots.push(root);
  const pending = join(root, 'pending'); await mkdir(pending);
  const bytes = Buffer.from('synthetic installer');
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const outside = join(root, 'outside.bin'); await writeFile(outside, bytes);
  return { root, pending, bytes, sha512, outside, helper: new DownloadedUpdateHelper(root),
    logger: { info: vi.fn(), warn: vi.fn() }, fileInfo: { info: { sha512 } } };
}

it('accepts a confined cached installer only when its actual SHA-512 matches', async () => {
  const f = await fixture(); const path = join(f.pending, 'installer.zip');
  await writeFile(path, f.bytes);
  await writeFile(join(f.pending, 'update-info.json'), JSON.stringify({ fileName: 'installer.zip', sha512: f.sha512 }));
  await expect(f.helper.getValidCachedUpdateFile(f.fileInfo, f.logger)).resolves.toBe(path);
  await writeFile(path, 'corrupted download');
  await expect(f.helper.getValidCachedUpdateFile(f.fileInfo, f.logger)).resolves.toBeNull();
  expect(await readFile(f.outside)).toEqual(f.bytes);
});

it.each(['../outside.bin', '', null, undefined, 'absolute'])('rejects malformed cached names without using files outside pending: %s', async name => {
  const f = await fixture();
  await writeFile(join(f.pending, 'update-info.json'), JSON.stringify({ fileName: name === 'absolute' ? f.outside : name, sha512: f.sha512 }));
  await expect(f.helper.getValidCachedUpdateFile(f.fileInfo, f.logger)).resolves.toBeNull();
  expect(await readFile(f.outside)).toEqual(f.bytes);
});
