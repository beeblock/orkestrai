import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('uploads only the main-push bundle after E2E success and keeps native rebuilds per target', () => {
    const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
    const steps = ci.jobs.verify.steps;
    const e2e = steps.findIndex((step: { name: string }) => step.name === 'Run end-to-end tests');
    const upload = steps.findIndex((step: { name: string }) => step.name === 'Upload tested production bundle');
    expect(upload).toBeGreaterThan(e2e);
    expect(steps[upload].if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    const release = parse(readFileSync('.github/workflows/release.yml', 'utf8'));
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
