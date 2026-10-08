import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifyForgeSignatureValidation } from '../fixtures/forge-signature-validation.mjs';

const require = createRequire(import.meta.url);

describe('RSA signature validation', () => {
  it('pins the reviewed source and archive integrity without weakening the audit gate', () => {
    const archive = 'https://codeload.github.com/digitalbazaar/forge/tar.gz/ceba34402e329f0365134f23fe19898756527d65';
    const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
    expect(manifest.overrides['node-forge']).toBe(archive);
    const packages = Object.entries(lock.packages).filter(([name]) => name.endsWith('/node-forge'));
    expect(packages).toHaveLength(1);
    const metadata = packages[0][1] as { resolved: string; integrity: string };
    expect(metadata.resolved).toBe(archive);
    expect(metadata.integrity).toBe('sha512-fYRFJf8ymZNJ5jGirbhuwAljM0rSJG03cldnAK3sJRMDHSS+tG8DPosOB8he34pGWMylVCMOtnIxUEepsME2Rg==');
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('npm audit --audit-level=moderate');
    expect(manifest.scripts.postinstall).toContain('scripts/apply-dependency-patches.mjs');
    expect(readFileSync('patches/node-forge+1.4.1-0.patch', 'utf8')).toContain("(('parameters' in capture) && capture.parameters !== '')");
    expect(readFileSync('tests/fixtures/packaged-startup-upgrade.mjs', 'utf8')).toContain("verifyForgeSignatureValidation(require('node-forge'))");
  });
  it('rejects extra nested DigestAlgorithm elements while preserving valid signatures and private-key imports', () => {
    expect(verifyForgeSignatureValidation(require('node-forge'))).toEqual({
      validSignatures: 2, rejectedMalformedSignatures: 5, privateKeyImport: 'passed',
    });
  });
});
