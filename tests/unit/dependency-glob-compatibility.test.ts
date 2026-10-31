import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'orkestrai-glob-compat-')); roots.push(root);
  for (const name of ['nested/source.ts', 'nested/read me.md', '.hidden/keep.ts', 'skip/ignored.ts', 'brackets[ab].md']) {
    const path = join(root, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, name);
  }
  return root;
}
describe('patched glob dependency contracts', () => {
  it('preserves callable CommonJS and named/ESM matcher APIs', async () => {
    const cjs = require('minimatch'); const esm = await import('minimatch');
    expect(typeof cjs).toBe('function'); expect(cjs.minimatch).toBe(cjs);
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ['nested/a.ts', '**/*.ts', {}], ['.hidden/a.ts', '**/*.ts', { dot: true }],
      ['C:/Project/a.ts', 'c:/**/*.ts', { nocase: true, platform: 'win32' }],
      ['brackets[ab].md', 'brackets\\[ab\\].md', {}], ['a.ts', '*.{ts,md}', {}],
      ['folder/skip/a.ts', '**/skip/**', {}], ['notes.md', '!*.ts', {}],
    ];
    for (const [path, pattern, options] of cases) {
      expect(cjs(path, pattern, options)).toBe(esm.minimatch(path, pattern, options));
      expect(new cjs.Minimatch(pattern, options).match(path)).toBe(esm.minimatch(path, pattern, options));
    }
    const matcher = new cjs.Minimatch('nested/*.ts');
    expect(matcher.globParts).toEqual([['nested', '*.ts']]);
    expect('source.ts'.match(matcher.set[0][1])).not.toBeNull();
    expect('source.md'.match(matcher.set[0][1])).toBeNull();
  });
  it('walks identical files through the callback glob used by packagers and modern promise glob', async () => {
    const cwd = fixture(); const legacy = require('glob');
    const modern = require(require.resolve('glob', { paths: [require.resolve('gcp-metadata')] }));
    const options = { cwd, dot: true, nodir: true, ignore: '**/skip/**' };
    const expected = ['.hidden/keep.ts', 'brackets[ab].md', 'nested/read me.md', 'nested/source.ts'];
    const normalize = (paths: string[]) => paths.map((path) => path.replaceAll('\\', '/')).sort();
    expect(normalize(legacy.sync('**/*.{ts,md}', options))).toEqual(expected);
    const asyncLegacy = await new Promise<string[]>((resolve, reject) => legacy('**/*.{ts,md}', options, (error: Error | null, paths: string[]) => error ? reject(error) : resolve(paths)));
    expect(normalize(asyncLegacy)).toEqual(expected);
    expect(normalize(await modern.glob('**/*.{ts,md}', options))).toEqual(expected);
  });
  it('keeps preprocessing bounded with the reviewed upstream attack input', () => {
    const child = spawnSync(process.execPath, ['--max-old-space-size=256', '-e', `
      const {Minimatch}=require(${JSON.stringify(require.resolve('minimatch'))});
      const matcher=new Minimatch(Array(30).fill('**/../a/b').join('/'),{optimizationLevel:2,braceExpandMax:64});
      if(matcher.set.length!==64)process.exit(2);
    `], { encoding: 'utf8', timeout: 5_000 });
    expect(child.error).toBeUndefined(); expect(child.status, child.stderr).toBe(0);
  });
  it('creates readable native asar and ZIP archives with the real packaging dependencies', async () => {
    const cwd = fixture(); const asar = require('@electron/asar');
    const path = join(cwd, '..', 'bundle-' + Date.now() + '.asar');
    try {
      await asar.createPackage(cwd, path);
      expect(asar.listPackage(path).map((entry: string) => entry.replaceAll('\\', '/'))).toContain('/nested/source.ts');
    } finally { rmSync(path, { force: true }); }
    const archive = require('archiver')('zip'); const output = new PassThrough(); const parts: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
      archive.on('error', reject); output.on('error', reject); output.on('data', (part: Buffer) => parts.push(part));
      output.on('end', () => resolve(Buffer.concat(parts)));
    });
    archive.pipe(output); archive.glob('**/*', { cwd, dot: true }); await archive.finalize();
    const zipped = await finished; expect(zipped.subarray(0, 2).toString()).toBe('PK');
    expect(zipped.includes(Buffer.from('nested/source.ts'))).toBe(true);
  });
});
