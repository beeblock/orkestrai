import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { stampProductionBundle, verifyProductionBundle } from '../../scripts/production-bundle.mjs';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'orkestrai-production-bundle-'));
  directories.push(directory);
  for (const file of ['index.js', 'handler.js', 'computer-host/index.mjs', 'desktop-messages/index.cjs']) {
    mkdirSync(join(directory, file, '..'), { recursive: true });
    writeFileSync(join(directory, file), `fixture:${file}`);
  }
  const lockfile = join(directory, 'fixture-lock.json');
  writeFileSync(lockfile, '{}');
  return { directory, options: { sourceSha: 'a'.repeat(40), version: '1.2.3', lockfile } };
}

describe('tested portable production bundle', () => {
  it('binds a complete bundle to its tested source, package version, lockfile and every file', async () => {
    const { directory, options } = fixture();
    const stamped = await stampProductionBundle(directory, options);
    expect(await verifyProductionBundle(directory, options)).toEqual(stamped);
    expect(stamped.files).toHaveLength(5);
  });

  it.each(['source', 'version', 'lock', 'file', 'extra-file'])('rejects a different %s', async (failure) => {
    const { directory, options } = fixture();
    await stampProductionBundle(directory, options);
    if (failure === 'source') options.sourceSha = 'b'.repeat(40);
    if (failure === 'version') options.version = '1.2.4';
    if (failure === 'lock') writeFileSync(options.lockfile, '{"changed":true}');
    if (failure === 'file') writeFileSync(join(directory, 'handler.js'), 'tampered');
    if (failure === 'extra-file') writeFileSync(join(directory, 'unexpected.js'), 'tampered');
    await expect(verifyProductionBundle(directory, options)).rejects.toThrow();
  });

  it('does not treat native binaries as portable build output', async () => {
    const { directory, options } = fixture();
    writeFileSync(join(directory, 'sqlite.node'), 'not portable');
    await expect(stampProductionBundle(directory, options)).rejects.toThrow('Native binaries');
  });

  it('preserves the tested lockfile bytes in a Windows-style Git checkout', async () => {
    const { directory, options } = fixture();
    const checkout = mkdtempSync(join(tmpdir(), 'orkestrai-lock-checkout-'));
    directories.push(checkout);
    const git = (...args: string[]) => execFileSync('git', [
      '-C', checkout, '-c', 'core.autocrlf=true', '-c', 'init.defaultBranch=main', ...args,
    ], { encoding: 'utf8', stdio: 'pipe' });
    git('init', '--quiet');
    const contents = '{\n  "lockfileVersion": 3,\n  "packages": {}\n}\n';
    options.lockfile = join(checkout, 'package-lock.json');
    writeFileSync(options.lockfile, contents);
    git('add', '--', 'package-lock.json');
    const stamped = await stampProductionBundle(directory, options);

    // Reproduce the release failure without the repository's LF policy.
    unlinkSync(options.lockfile);
    git('checkout-index', '--', 'package-lock.json');
    expect(readFileSync(options.lockfile, 'utf8')).toContain('\r\n');
    await expect(verifyProductionBundle(directory, options)).rejects.toThrow('lockSha256');

    writeFileSync(join(checkout, '.gitattributes'), readFileSync('.gitattributes'));
    git('add', '--', '.gitattributes');
    unlinkSync(options.lockfile);
    git('checkout-index', '--', 'package-lock.json');
    expect(readFileSync(options.lockfile, 'utf8')).toBe(contents);
    expect(await verifyProductionBundle(directory, options)).toEqual(stamped);
  });

  it('uploads only the main-push bundle after E2E success and keeps native rebuilds per target', () => {
    const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    const candidate = ci.jobs.verify.steps.find((step: { name: string }) => step.name === 'Upload browser-test candidate');
    expect(candidate.with.name).toBe('browser-candidate-${{ github.sha }}');
    const browsers = ci.jobs['browser-tests'];
    expect(browsers.needs).toBe('verify');
    expect(browsers.strategy['fail-fast']).toBe(false);
    expect(browsers.strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    const browserCommand = browsers.steps.find((step: { name: string }) => step.name === 'Run end-to-end tests').run;
    expect(browserCommand).toContain('--shard=${{ matrix.shard }}/4');
    expect(browserCommand).toContain('--workers=1');
    expect(browserCommand).not.toContain('--grep');
    const browserDownload = browsers.steps.find((step: { name: string }) => step.name === 'Download browser-test candidate');
    expect(browserDownload.uses).toBe('actions/download-artifact@v8');
    expect(browserDownload.with['digest-mismatch']).toBe('error');
    expect(browsers.steps.some((step: { run?: string }) => step.run?.includes('production-bundle.mjs verify'))).toBe(true);
    const promotion = ci.jobs['production-bundle'];
    expect([...promotion.needs].sort()).toEqual(['verify', 'browser-tests', 'windows-native', 'windows-codex-soak', 'relay-container', 'secrets'].sort());
    expect(promotion.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(promotion.if).not.toMatch(/always|cancelled/);
    const steps = promotion.steps;
    const verified = steps.findIndex((step: { name: string }) => step.name === 'Verify tested source and unchanged file hashes');
    const upload = steps.findIndex((step: { name: string }) => step.name === 'Upload tested production bundle');
    expect(verified).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(verified);
    expect(steps[upload].with.name).toBe('production-build-${{ github.sha }}');
    const productionDownload = steps.find((step: { name: string }) => step.name === 'Download verified browser-test candidate');
    expect(productionDownload.uses).toBe('actions/download-artifact@v8');
    expect(productionDownload.with['digest-mismatch']).toBe('error');
    const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
    expect(ci.jobs['windows-native'].steps.some((step: { run?: string }) => step.run?.includes('tests/unit/production-bundle.test.ts'))).toBe(true);
    expect(release.jobs['build-windows'].steps.some((step: { run?: string }) => step.run?.includes('tests/unit/production-bundle.test.ts'))).toBe(true);
    for (const name of ['build-macos', 'build-windows', 'build-linux']) {
      const download = release.jobs[name].steps.find((step: { name: string }) => step.name === 'Download tested production bundle');
      expect(download.with['artifact-ids']).toBe('${{ needs.validate.outputs.production_artifact_id }}');
      expect(download.with['run-id']).toBe('${{ needs.validate.outputs.production_run_id }}');
      expect(download.with['digest-mismatch']).toBe('error');
      expect(release.jobs[name].steps.some((step: { name: string }) => step.name === 'Verify production bundle source and file hashes')).toBe(true);
    }
    expect(readFileSync('scripts/after-pack.mjs', 'utf8')).toContain('await packageSqliteRuntime(context)');
  });
});
