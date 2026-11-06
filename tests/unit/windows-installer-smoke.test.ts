import { expect, it } from 'vitest';
import { assertIsolatedInstallerHost, installerChildEnvironment } from '../../scripts/run-windows-installer-smoke.mjs';

it('refuses to run installer QA on a normal Windows user machine', () => {
  expect(() => assertIsolatedInstallerHost({ RUNNER_TEMP: 'C:\\Temp' }, 'win32')).toThrow('isolated GitHub runner');
});

it('never forwards CI or provider credentials into an installed application or installer', () => {
  const env = installerChildEnvironment({ PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows',
    GH_TOKEN: 'private-gh-token', ACTIONS_RUNTIME_TOKEN: 'private-actions-token',
    CLAUDE_CODE_OAUTH_TOKEN: 'private-provider-token', ORKESTRAI_AGENT_TOKEN: 'private-agent-token' });
  expect(env).toEqual({ PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows' });
});

it('requires native Windows and an absolute disposable runner directory', () => {
  expect(() => assertIsolatedInstallerHost({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/tmp' }, 'darwin')).toThrow('native Windows');
  expect(() => assertIsolatedInstallerHost({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: 'relative' }, 'win32')).toThrow('temporary directory');
  expect(() => assertIsolatedInstallerHost({ GITHUB_ACTIONS: 'true', RUNNER_TEMP: 'D:\\runner-temp' }, 'win32')).not.toThrow();
});
