import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isBackgroundRuntimeInvocation } = require('../../electron/launch-intent.cjs') as {
  isBackgroundRuntimeInvocation: (argv: unknown[]) => boolean;
};

describe('Electron launch intent', () => {
  it('recognizes packaged CLI and server child invocations on every path style', () => {
    expect(isBackgroundRuntimeInvocation([
      'C:\\Program Files\\Orkestrai\\Orkestrai.exe',
      'C:\\Program Files\\Orkestrai\\resources\\app\\packages\\orkestrai-cli\\bin\\orkestrai.js',
      'task',
      'list',
    ])).toBe(true);
    expect(isBackgroundRuntimeInvocation([
      '/Applications/Orkestrai.app/Contents/MacOS/Orkestrai',
      '/Applications/Orkestrai.app/Contents/Resources/app/scripts/orkestrai-server.mjs',
    ])).toBe(true);
  });

  it('keeps normal launches and collaboration links user-visible', () => {
    expect(isBackgroundRuntimeInvocation(['C:\\Program Files\\Orkestrai\\Orkestrai.exe'])).toBe(false);
    expect(isBackgroundRuntimeInvocation([
      'C:\\Program Files\\Orkestrai\\Orkestrai.exe',
      'orkestrai://join/invite-token#abcdefghijklmnopqrstuvwxyzABCDEFGH1234567',
    ])).toBe(false);
  });
});
