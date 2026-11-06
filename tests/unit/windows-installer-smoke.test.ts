import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { assertIsolatedInstallerHost, installerChildEnvironment, assertNoExistingInstallation } from '../../scripts/run-windows-installer-smoke.mjs';

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

it.skipIf(process.platform !== 'win32')('accepts a missing registry root without treating a PowerShell lookup error as an install failure', async () => {
  const powershell = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const root = String.raw`HKCU:\Software\OrkestraiInstallerQA` + '\\' + randomUUID();
  await expect(assertNoExistingInstallation(powershell, [root])).resolves.toBeUndefined();
  await expect(assertNoExistingInstallation(powershell, ['unknown-provider:\\missing'])).rejects.toThrow();
}, 20_000);

it.skipIf(process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true')('refuses an existing installer registration on an isolated Windows runner', async () => {
  const powershell = join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const root = String.raw`HKCU:\Software\OrkestraiInstallerQA` + '\\' + randomUUID();
  const env = { ...installerChildEnvironment(), ORKESTRAI_INSTALLER_QA_REGISTRY_KEY: root };
  const execute = promisify(execFile);
  try {
    await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $key=Join-Path $env:ORKESTRAI_INSTALLER_QA_REGISTRY_KEY 'owned-fixture'; New-Item -Path $key -Force | Out-Null; New-ItemProperty -LiteralPath $key -Name DisplayName -Value 'Orkestrai QA' -Force | Out-Null; exit 0"], { env });
    await expect(assertNoExistingInstallation(powershell, [root])).rejects.toMatchObject({
      code: 1, stderr: expect.stringContaining('Refusing to change an existing Orkestrai installation'),
    });
  } finally {
    await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      'Remove-Item -LiteralPath $env:ORKESTRAI_INSTALLER_QA_REGISTRY_KEY -Recurse -Force -ErrorAction SilentlyContinue; exit 0'], { env });
  }
}, 20_000);
