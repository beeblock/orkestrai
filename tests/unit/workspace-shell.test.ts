import { describe, expect, it } from 'vitest';
import { resolvePosixShell } from '$lib/modules/agent-room/infrastructure/workspace.js';

describe('workspace shell selection', () => {
  it('keeps a configured shell when it exists', () => {
    expect(resolvePosixShell('/opt/homebrew/bin/fish', 'darwin', (path) => path === '/opt/homebrew/bin/fish'))
      .toBe('/opt/homebrew/bin/fish');
  });

  it('uses bash on Linux when zsh is unavailable', () => {
    expect(resolvePosixShell(undefined, 'linux', (path) => path === '/bin/bash'))
      .toBe('/bin/bash');
  });

  it('falls back to the portable POSIX shell when no preferred shell exists', () => {
    expect(resolvePosixShell('/missing/zsh', 'linux', (path) => path === '/bin/sh'))
      .toBe('/bin/sh');
    expect(resolvePosixShell('/missing/zsh', 'linux', () => false)).toBe('/bin/sh');
  });
});
