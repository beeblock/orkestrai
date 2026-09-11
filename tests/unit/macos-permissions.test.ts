import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { validateMacPermissionContract } from '../../scripts/validate-macos-permissions.mjs';

const required = {
  'com.apple.security.device.audio-input': true,
  'com.apple.security.automation.apple-events': true,
};

describe('signed macOS permission contract', () => {
  it('refuses unattended local Keychain signing before invoking the packager', () => {
    const result = spawnSync('bash', ['scripts/package-macos.sh', '--arm64'], {
      encoding: 'utf8',
      timeout: 5_000,
      env: { ...process.env, ORKESTRAI_MAC_LOCAL_SIGNING_IDENTITY: 'Developer ID Application: Test', ORKESTRAI_REQUIRE_MAC_SIGNING: 'false', ORKESTRAI_MAC_ALLOW_KEYCHAIN_PROMPTS: 'false' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Obtain explicit owner approval');
    expect(result.stdout).toBe('');
  });

  it('rejects the notarized 0.29.0 entitlement set that omitted microphone access', () => {
    expect(() => validateMacPermissionContract({ entitlements: {
      'com.apple.security.cs.allow-jit': true,
      'com.apple.security.cs.allow-unsigned-executable-memory': true,
      'com.apple.security.cs.disable-library-validation': true,
    } })).toThrow('audio-input');
  });

  it('requires explicit true permissions and nonempty privacy descriptions', () => {
    for (const key of Object.keys(required)) {
      expect(() => validateMacPermissionContract({ entitlements: { ...required, [key]: false } })).toThrow(key);
    }
    expect(() => validateMacPermissionContract({ entitlements: required, info: {} })).toThrow('NSMicrophoneUsageDescription');
    expect(() => validateMacPermissionContract({ entitlements: required })).not.toThrow();
  });

  it('configures both app and helper signatures, without adding an app sandbox or camera grant', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const key of ['entitlements', 'entitlementsInherit']) {
      const xml = readFileSync(pkg.build.mac[key], 'utf8');
      const entries = new XMLParser({ preserveOrder: true }).parse(xml).find((entry: any) => entry.plist)?.plist[0].dict;
      const values: Record<string, boolean> = {};
      for (let index = 0; index < entries.length; index += 2) {
        values[entries[index].key[0]['#text']] = Object.hasOwn(entries[index + 1], 'true');
      }
      validateMacPermissionContract({ entitlements: values, info: pkg.build.mac.extendInfo });
      expect(values['com.apple.security.app-sandbox']).toBeUndefined();
      expect(values['com.apple.security.device.camera']).toBeUndefined();
    }
    expect(readFileSync('.github/workflows/release.yml', 'utf8')).toContain('node scripts/validate-macos-permissions.mjs "$app"');
    expect(readFileSync('scripts/package-macos.sh', 'utf8')).toContain('ORKESTRAI_MAC_LOCAL_SIGNING_IDENTITY');
  });
});
