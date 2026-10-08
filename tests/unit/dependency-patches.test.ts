import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { applyPatch, parsePatch, reversePatch } from 'diff';
import { applyDependencyPatches } from '../../scripts/apply-dependency-patches.mjs';

const roots: string[] = [];
const sha = (text: string) => createHash('sha256').update(text.replaceAll('\r\n', '\n')).digest('hex');
const contract = JSON.parse(fs.readFileSync('patches/dependency-patches.json', 'utf8'));

function fixture(crlf = false) {
  const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'orkestrai-patches-')));
  roots.push(root);
  fs.cpSync('patches', join(root, 'patches'), { recursive: true });
  for (const entry of contract.files) {
    const parsed = parsePatch(fs.readFileSync(join('patches', entry.patch), 'utf8')).find((patch) => patch.newFileName === `b/${entry.file}`)!;
    const installed = fs.readFileSync(entry.file, 'utf8').replaceAll('\r\n', '\n');
    expect(sha(installed)).toBe(entry.after);
    const original = applyPatch(installed, reversePatch(parsed), { fuzzFactor: 0 }) as string;
    expect(sha(original)).toBe(entry.before);
    const target = join(root, entry.file);
    fs.mkdirSync(join(target, '..'), { recursive: true });
    fs.writeFileSync(target, crlf ? original.replaceAll('\n', '\r\n') : original);
    const segments = entry.file.split('/');
    const packageDir = join(root, ...segments.slice(0, segments[1].startsWith('@') ? 3 : 2));
    fs.writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ version: entry.patch.slice(entry.patch.lastIndexOf('+') + 1, -6) }));
  }
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('reviewed dependency patch application', () => {
  it.each([false, true])('preserves all eight exact patches and is idempotent (CRLF: %s)', (crlf) => {
    const root = fixture(crlf);
    expect(applyDependencyPatches(root)).toEqual({ verified: 8, applied: 8 });
    for (const entry of contract.files) expect(sha(fs.readFileSync(join(root, entry.file), 'utf8'))).toBe(entry.after);
    expect(applyDependencyPatches(root)).toEqual({ verified: 8, applied: 0 });
  });

  it.each(['corrupt', 'missing', 'version', 'postimage', 'extra_patch'])('refuses %s before writing any target', (problem) => {
    const root = fixture();
    const first = join(root, contract.files[0].file);
    const original = fs.readFileSync(first, 'utf8');
    const last = join(root, contract.files.at(-1).file);
    if (problem === 'corrupt') fs.appendFileSync(last, '\nUnexpected source');
    if (problem === 'missing') fs.unlinkSync(last);
    if (problem === 'version') fs.writeFileSync(join(root, 'node_modules/sigma/package.json'), '{"version":"9.0.0"}');
    if (problem === 'extra_patch') fs.writeFileSync(join(root, 'patches/unreviewed.patch'), 'unreviewed');
    if (problem === 'postimage') {
      const changed = structuredClone(contract);
      changed.files.at(-1).after = '0'.repeat(64);
      fs.writeFileSync(join(root, 'patches/dependency-patches.json'), JSON.stringify(changed));
    }
    expect(() => applyDependencyPatches(root)).toThrow();
    expect(fs.readFileSync(first, 'utf8')).toBe(original);
  });

  it('does not follow a symlinked module outside the package', () => {
    const root = fixture();
    const target = join(root, contract.files[0].file);
    const original = fs.readFileSync(target, 'utf8');
    const external = join(root, 'external.js');
    fs.writeFileSync(external, original);
    fs.unlinkSync(target);
    fs.symlinkSync(external, target);
    expect(() => applyDependencyPatches(root)).toThrow('Unsafe dependency target');
    expect(fs.readFileSync(external, 'utf8')).toBe(original);
  });

  it('cleans staged files and leaves installed modules intact on disk exhaustion', () => {
    const root = fixture();
    const write = fs.writeFileSync.bind(fs);
    let calls = 0;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((...args) => {
      if (++calls === 2) throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
      return write(...args);
    });
    expect(() => applyDependencyPatches(root)).toThrow('Disk full');
    for (const entry of contract.files) {
      const target = join(root, entry.file);
      expect(sha(fs.readFileSync(target, 'utf8'))).toBe(entry.before);
      expect(fs.readdirSync(join(target, '..')).some((name) => name.includes('.orkestrai-patch-'))).toBe(false);
    }
  });
});

describe('release dependency security', () => {
  it('removes the vulnerable dependency chains without bypassing npm audit', () => {
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
    expect(manifest.devDependencies['patch-package']).toBeUndefined();
    for (const name of ['braces', 'sprintf-js', 'patch-package']) {
      expect(Object.keys(lock.packages).some((path) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`)).toBe(false);
    }
    expect(manifest.overrides).toMatchObject({ 'global-agent': '4.1.3', 'http-cache-semantics': '4.3.0', joi: '17.13.8', 'source-map-js': '1.2.2' });
    expect(fs.readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('npm audit --audit-level=moderate');
  });

  it('preserves the legacy Electron downloader proxy bootstrap API', () => {
    const require = createRequire(import.meta.url);
    const builderRequire = createRequire(require.resolve('app-builder-lib'));
    const getPath = builderRequire.resolve('@electron/get');
    const source = `
      const http = require('node:http');
      const get = require(${JSON.stringify(getPath)});
      const proxy = http.createServer((request, response) => response.end(request.url));
      proxy.listen(0, '127.0.0.1', () => {
        process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://127.0.0.1:' + proxy.address().port;
        process.env.GLOBAL_AGENT_NO_PROXY = '';
        get.initializeProxy();
        http.get('http://unresolved.invalid/probe', (response) => {
          let body = ''; response.on('data', chunk => body += chunk);
          response.on('end', () => {
            proxy.close();
            if (body !== 'http://unresolved.invalid/probe') process.exitCode = 1;
            else console.log('proxy bootstrap verified');
          });
        }).on('error', () => { proxy.close(); process.exitCode = 1; });
      });
    `;
    const result = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 10_000,
      env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TMPDIR: process.env.TMPDIR } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('proxy bootstrap verified');
  });
});
