import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const policy = require('../../electron/core-runtime-policy.cjs') as {
  BACKGROUND_CORE_ARGUMENT: string;
  isBackgroundCoreLaunch(argv: string[]): boolean;
  normalizeCorePreferences(input: Record<string, unknown>): { runInBackground: boolean; launchAtLogin: boolean };
  shouldKeepCoreRunning(input: { isQuitting?: boolean; runInBackground?: boolean }): boolean;
};

describe('Core runtime policy', () => {
  it('normalizes persisted string settings', () => {
    expect(policy.normalizeCorePreferences({ runInBackground: 'true', launchAtLogin: false })).toEqual({
      runInBackground: true,
      launchAtLogin: false,
    });
  });

  it('recognizes the hidden start-at-login launch', () => {
    expect(policy.isBackgroundCoreLaunch(['Orkestrai', policy.BACKGROUND_CORE_ARGUMENT])).toBe(true);
    expect(policy.isBackgroundCoreLaunch(['Orkestrai'])).toBe(false);
  });

  it('keeps the Core alive only while background mode is enabled and the app is not quitting', () => {
    expect(policy.shouldKeepCoreRunning({ runInBackground: true })).toBe(true);
    expect(policy.shouldKeepCoreRunning({ runInBackground: false })).toBe(false);
    expect(policy.shouldKeepCoreRunning({ runInBackground: true, isQuitting: true })).toBe(false);
  });
});
