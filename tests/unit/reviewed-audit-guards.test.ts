import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { auditFindings, verifyReviewedGuards } from '../../scripts/audit-reviewed-guards.mjs';

const require = createRequire(import.meta.url);
const now = new Date('2026-11-18T12:00:00Z');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'reviewed-audit-')); roots.push(root);
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'node_modules/picomatch/lib'), { recursive: true });
  // The authorization is pinned to 0.54.0, independently of the version being developed.
  writeFileSync(join(root, 'package.json'), JSON.stringify({ ...JSON.parse(readFileSync('package.json', 'utf8')), version: '0.54.0', type: 'module' }));
  writeFileSync(join(root, 'package-lock.json'), readFileSync('package-lock.json'));
  writeFileSync(join(root, 'svelte.config.js'), 'export default { kit: { experimental: { remoteFunctions: false } } };');
  writeFileSync(join(root, 'node_modules/picomatch/lib/parse.js'), readFileSync(require.resolve('picomatch/lib/parse.js')));
  return root;
}
const id = 'GHSA-3r8g-jcqq-3p5j';
const advisory = (ghsa = id, severity = 'high') => ({ name: '@sveltejs/kit', severity, url: `https://github.com/advisories/${ghsa}`, title: ghsa });
const report = (via: any[] = [advisory()]) => ({ auditReportVersion: 2, metadata: { vulnerabilities: {} }, vulnerabilities: { kit: { severity: 'high', via } } });

describe('release-specific reviewed audit guards', () => {
  it('blocks every moderate-or-higher advisory by default and only accepts exact reviewed ids', () => {
    expect(auditFindings(report()).blocking).toHaveLength(1);
    const result = auditFindings(report([advisory(), advisory('GHSA-neww-aaaa-bbbb', 'moderate')]), new Set([id]));
    expect(result.guarded).toEqual([id]); expect(result.blocking).toHaveLength(1);
    expect(result.blocking[0][0]).toContain('GHSA-neww-aaaa-bbbb');
  });
  it('rejects invalid, incomplete and circular audit results instead of passing on missing evidence', () => {
    for (const value of [{}, { error: {} }, report([]), report(['missing']), report(['kit'])]) {
      expect(() => auditFindings(value)).toThrow();
    }
  });
  it('only enables guards for the exact release, disabled remote functions and verified security source', async () => {
    expect(await verifyReviewedGuards(fixture(), now)).toEqual(new Set([id, 'GHSA-6cf5-gc4q-fm3x', 'GHSA-fc5q-39xc-vjpf']));
  });
  it.each(['expired', 'version', 'remote-enabled', 'remote-module', 'source'])('fails closed for %s', async reason => {
    const root = fixture();
    if (reason === 'version') {
      const p = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); p.version = '0.54.1'; writeFileSync(join(root, 'package.json'), JSON.stringify(p));
    } else if (reason === 'remote-enabled') writeFileSync(join(root, 'svelte.config.js'), 'export default { kit: { experimental: { remoteFunctions: true } } };');
    else if (reason === 'remote-module') writeFileSync(join(root, 'src/query.remote.ts'), 'export const query = {};');
    else if (reason === 'source') writeFileSync(join(root, 'node_modules/picomatch/lib/parse.js'), 'unverified');
    await expect(verifyReviewedGuards(root, reason === 'expired' ? new Date('2026-11-26') : now)).rejects.toThrow();
  });
  it.each(['0.55.0-beta.1', '0.55.0-beta.2', '0.55.0'])('does not carry the old release authorization into %s', async version => {
    const root = fixture();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ ...manifest, version }));
    await expect(verifyReviewedGuards(root, now)).rejects.toThrow();
  });
  it('runs the Picomatch amplification regressions outside the event loop with a hard deadline', () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', `
      const assert = require('node:assert/strict'); const pm = require(${JSON.stringify(require.resolve('picomatch'))});
      for (const options of [{}, { windows: true }, { bash: true }, { capture: true }, { nobracket: true }]) {
        for (const pattern of ['+(*)b', '*(*a)', '+(*a)', '+(*a|b)', '+(a*a*a*a*a*)', '*(a*|b)z', '+(W*, *)z']) {
          assert.equal(pm(pattern, options)('a'.repeat(60000) + '/'), false);
        }
      }
      assert.equal(pm('+(*a)')('xaya'), true); assert.equal(pm('src/**/*.ts')('src/a/b.ts'), true);
      assert.equal(pm('**/*.png', { windows: true })('assets\\\\hero.png'), true);
    `], { encoding: 'utf8', timeout: 3000, killSignal: 'SIGKILL' });
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0);
  });
});
