import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { createRequire } from 'node:module';
import { versionChangelogSection } from '../../scripts/release-notes.mjs';
import { disableMacAutomaticRollout } from '../../scripts/set-mac-update-policy.mjs';
import { validateReleaseArtifacts } from '../../scripts/validate-release-artifacts.mjs';

const require = createRequire(import.meta.url);
const { canInstallUpdatesAutomatically, isNewerVersion, macBundlePath } = require('../../electron/update-policy.cjs');

const VERSION = '1.2.3';
const requiredAssets = [
  `Orkestrai-${VERSION}-arm64.dmg`,
  `Orkestrai-${VERSION}-arm64.dmg.blockmap`,
  `Orkestrai-${VERSION}-arm64-mac.zip`,
  `Orkestrai-${VERSION}-arm64-mac.zip.blockmap`,
  `Orkestrai-${VERSION}.dmg`,
  `Orkestrai-${VERSION}.dmg.blockmap`,
  `Orkestrai-${VERSION}-mac.zip`,
  `Orkestrai-${VERSION}-mac.zip.blockmap`,
  `Orkestrai-Setup-${VERSION}.exe`,
  `Orkestrai-Setup-${VERSION}.exe.blockmap`,
  `Orkestrai-${VERSION}.AppImage`,
  `Orkestrai-${VERSION}.x86_64.rpm`,
];

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function checksum(file: string) {
  return createHash('sha512').update(readFileSync(file)).digest('base64');
}

function manifestEntry(directory: string, filename: string) {
  const file = path.join(directory, filename);
  return { url: filename, sha512: checksum(file), size: readFileSync(file).length };
}

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'orkestrai-release-'));
  temporaryDirectories.push(directory);
  for (const filename of requiredAssets) writeFileSync(path.join(directory, filename), `fixture:${filename}`);

  writeFileSync(
    path.join(directory, 'latest-mac.yml'),
    stringify({
      version: VERSION,
      files: [
        manifestEntry(directory, `Orkestrai-${VERSION}-arm64-mac.zip`),
        manifestEntry(directory, `Orkestrai-${VERSION}-mac.zip`),
      ],
    }),
  );
  writeFileSync(
    path.join(directory, 'latest.yml'),
    stringify({ version: VERSION, files: [manifestEntry(directory, `Orkestrai-Setup-${VERSION}.exe`)] }),
  );
  writeFileSync(
    path.join(directory, 'latest-linux.yml'),
    stringify({
      version: VERSION,
      files: [
        manifestEntry(directory, `Orkestrai-${VERSION}.AppImage`),
        manifestEntry(directory, `Orkestrai-${VERSION}.x86_64.rpm`),
      ],
    }),
  );
  return directory;
}

describe('release artifact validation', () => {
  it('declares the maintainer metadata required by native Linux packages', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    expect(packageJson.build?.linux?.maintainer).toMatch(/^[^<>]+ <[^<>\s]+@[^<>\s]+>$/);
    expect(packageJson.build?.rpm?.artifactName).toBe('${productName}-${version}.${arch}.${ext}');
  });

  it('accepts complete cross-platform artifacts with valid manifests', () => {
    const files = validateReleaseArtifacts(fixture(), VERSION);
    expect(files).toContain('latest-mac.yml');
    expect(files).toHaveLength(requiredAssets.length + 3);
  });

  it('rejects a manifest checksum that does not match the installer', () => {
    const directory = fixture();
    writeFileSync(path.join(directory, `Orkestrai-${VERSION}.AppImage`), 'corrupted');
    expect(() => validateReleaseArtifacts(directory, VERSION)).toThrow(/invalid sha512/);
  });

  it('rejects a macOS manifest without an Intel update ZIP', () => {
    const directory = fixture();
    writeFileSync(
      path.join(directory, 'latest-mac.yml'),
      stringify({ version: VERSION, files: [manifestEntry(directory, `Orkestrai-${VERSION}-arm64-mac.zip`)] }),
    );
    expect(() => validateReleaseArtifacts(directory, VERSION)).toThrow(/Intel update ZIP/);
  });

  it('rejects a Linux manifest without the RPM installer', () => {
    const directory = fixture();
    writeFileSync(
      path.join(directory, 'latest-linux.yml'),
      stringify({ version: VERSION, files: [manifestEntry(directory, `Orkestrai-${VERSION}.AppImage`)] }),
    );
    expect(() => validateReleaseArtifacts(directory, VERSION)).toThrow(/RPM/);
  });
});

describe('release notes', () => {
  it('extracts the complete English section for the requested version', () => {
    const changelog = '# Changelog\n\n## 0.1.4 - 2026-08-08\n\n- Transition\n\n## 0.1.3 - 2026-08-07\n\n- Previous\n';
    expect(versionChangelogSection(changelog, '0.1.4')).toBe('## 0.1.4 - 2026-08-08\n\n- Transition');
  });
});

describe('packaged updater', () => {
  it('ships electron-updater as a production dependency', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    expect(packageJson.dependencies?.['electron-updater']).toBeTruthy();
    expect(packageJson.devDependencies?.['electron-updater']).toBeUndefined();
  });

  it('pins the complete WebADB runtime closure for packaged builds', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    for (const dependency of [
      '@yume-chan/async',
      '@yume-chan/event',
      '@yume-chan/no-data-view',
      '@yume-chan/struct',
    ]) {
      expect(packageJson.dependencies?.[dependency]).toBeTruthy();
    }
    expect(packageJson.build?.files).toContain('src/lib/modules/agent-room/infrastructure/codex-mcp-config.ts');
  });

  it('requires trusted signing for releases while preserving the local ad-hoc fallback', () => {
    const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
    const packageScript = readFileSync(path.resolve('scripts/package-macos.sh'), 'utf8');
    const signerPatch = readFileSync(path.resolve('patches/@electron+osx-sign+1.3.3.patch'), 'utf8');
    const nodePtyPatch = readFileSync(path.resolve('patches/node-pty+1.1.0.patch'), 'utf8');
    const workflow = readFileSync(path.resolve('.github/workflows/release.yml'), 'utf8');
    const preflight = readFileSync(path.resolve('.agents/skills/orkestrai-release/scripts/preflight.sh'), 'utf8');
    expect(packageJson.build?.mac?.notarize).toBe(true);
    expect(packageScript).toContain('-c.mac.identity=-');
    expect(packageScript).toContain('-c.mac.hardenedRuntime=false');
    expect(packageScript).toContain('-c.mac.notarize=false');
    expect(packageScript).toContain('ORKESTRAI_REQUIRE_MAC_SIGNING');
    expect(packageScript).toContain('ORKESTRAI_MAC_OPEN_FILE_LIMIT');
    expect(packageScript).toContain('[[ -L "$ROOT_DIR/node_modules"');
    expect(packageScript).toContain('npm ci');
    expect(packageScript).toContain('ORKESTRAI_MAC_STAGED=true');
    expect(packageScript).toContain('ORKESTRAI_MAC_OPEN_FILE_LIMIT:-unlimited');
    expect(packageScript).toContain('ulimit -n "$requested_open_file_limit"');
    expect(packageScript).toContain('macOS open-file limit: %s');
    expect(packageJson.scripts?.postinstall).toBe('patch-package');
    expect(packageJson.devDependencies?.['patch-package']).toBeTruthy();
    expect(signerPatch).toContain('const binaryFileCheckLimit = 64;');
    expect(signerPatch).toContain('await acquireBinaryFileCheck();');
    expect(signerPatch).toContain('releaseBinaryFileCheck();');
    expect(nodePtyPatch).toContain('error.message.includes("AttachConsole failed")');
    expect(nodePtyPatch).toContain('consoleProcessList = [shellPid];');
    expect(workflow).toContain("ORKESTRAI_REQUIRE_MAC_SIGNING: 'true'");
    expect(workflow).toContain('scripts/package-macos.sh --arm64 --x64');
    expect(workflow).toContain('codesign --verify --deep --strict');
    expect(workflow).toContain('Authority=Developer ID Application:');
    expect(workflow).toContain('TeamIdentifier=$APPLE_TEAM_ID');
    expect(workflow).toContain("flags=.*\\(runtime\\)");
    expect(workflow).toContain('spctl --assess --type execute');
    expect(workflow).toContain('xcrun stapler validate');
    expect(workflow).toContain('hdiutil verify');
    expect(workflow).toContain('unzip -tq');
    for (const secret of [
      'MAC_CSC_LINK',
      'MAC_CSC_KEY_PASSWORD',
      'APPLE_ID',
      'APPLE_APP_SPECIFIC_PASSWORD',
      'APPLE_TEAM_ID',
    ]) {
      expect(preflight).toContain(secret);
    }
  });

  it('disables macOS rollout in manifests produced without Apple signing', () => {
    const directory = fixture();
    const manifestPath = path.join(directory, 'latest-mac.yml');
    disableMacAutomaticRollout(manifestPath);
    expect(readFileSync(manifestPath, 'utf8')).toContain('stagingPercentage: 0');
  });

  it('allows automatic replacement only for a trusted macOS bundle', () => {
    const execPath = '/Applications/Orkestrai.app/Contents/MacOS/Orkestrai';
    expect(macBundlePath(execPath)).toBe('/Applications/Orkestrai.app');
    expect(canInstallUpdatesAutomatically({ platform: 'win32', execPath, assess: () => ({ status: 1 }) })).toBe(true);
    expect(canInstallUpdatesAutomatically({ platform: 'darwin', execPath, assess: () => ({ status: 1 }) })).toBe(false);
    expect(canInstallUpdatesAutomatically({ platform: 'darwin', execPath, assess: () => ({ status: 0 }) })).toBe(true);
  });

  it('compares strict release versions for the manual macOS check', () => {
    expect(isNewerVersion('v0.1.3', '0.1.2')).toBe(true);
    expect(isNewerVersion('0.2.0', '0.1.9')).toBe(true);
    expect(isNewerVersion('0.1.3', '0.1.3')).toBe(false);
    expect(isNewerVersion('invalid', '0.1.3')).toBe(false);
  });
});
