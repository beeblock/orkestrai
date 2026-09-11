import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @param {{ entitlements: Record<string, unknown>, info?: Record<string, unknown>, label?: string }} input */
export function validateMacPermissionContract({ entitlements, info, label = 'application' }) {
  for (const key of ['com.apple.security.device.audio-input', 'com.apple.security.automation.apple-events']) {
    if (entitlements[key] !== true) throw new Error(`${label}: missing signed entitlement ${key}`);
  }
  if (info) {
    for (const key of ['NSMicrophoneUsageDescription', 'NSAppleEventsUsageDescription']) {
      if (typeof info[key] !== 'string' || !info[key].trim()) throw new Error(`${label}: missing ${key}`);
    }
  }
}

/** @param {string | Buffer} input */
function parsePlist(input) {
  return JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input, encoding: 'utf8' }));
}

/** @param {string} appPath */
export function validateSignedMacPermissions(appPath) {
  const app = resolve(appPath);
  const frameworks = join(app, 'Contents', 'Frameworks');
  const helpers = readdirSync(frameworks).filter((name) => name.endsWith('.app') && name.includes('Helper'));
  if (!helpers.length) throw new Error('No signed Electron helper applications found.');
  for (const target of [app, ...helpers.map((name) => join(frameworks, name))]) {
    const entitlements = parsePlist(execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    validateMacPermissionContract({
      label: target,
      entitlements,
      ...(target === app ? { info: parsePlist(readFileSync(join(app, 'Contents', 'Info.plist'))) } : {}),
    });
  }
  console.log(`Verified microphone and automation entitlements in the app and ${helpers.length} Electron helpers.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/validate-macos-permissions.mjs <Orkestrai.app>');
  validateSignedMacPermissions(process.argv[2]);
}
