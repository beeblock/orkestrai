import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function assertIsolatedInstallerHost(env = process.env, platform = process.platform) {
  assert.equal(platform, 'win32', 'Installer smoke requires native Windows');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Installer smoke may only run on an isolated GitHub runner');
  assert.ok(env.RUNNER_TEMP && win32.isAbsolute(env.RUNNER_TEMP), 'An isolated runner temporary directory is required');
}

export function installerChildEnvironment(source = process.env) {
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PSModulePath',
    'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'TEMP', 'TMP', 'ProgramFiles', 'ProgramFiles(x86)']) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  return env;
}

export async function assertNoExistingInstallation(powershell, registryRoots = [
  String.raw`HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
  String.raw`HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
]) {
  assert.ok(Array.isArray(registryRoots) && registryRoots.length > 0 && registryRoots.length <= 8
    && registryRoots.every(root => typeof root === 'string' && root.length <= 1024
      && /^HK(?:CU|LM):\\Software\\/i.test(root) && !/[\u0000-\u001f]/.test(root)), 'Unsupported registry root');
  const script = String.raw`$ErrorActionPreference='Stop';
    $roots=ConvertFrom-Json $env:ORKESTRAI_INSTALLER_QA_REGISTRY_ROOTS;
    foreach($root in $roots){
      if(Test-Path -LiteralPath $root -ErrorAction Stop){
        foreach($key in (Get-ChildItem -LiteralPath $root -ErrorAction Stop)){
          $entry=Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop;
          if($entry.DisplayName -like 'Orkestrai*'){throw 'Refusing to change an existing Orkestrai installation'}
        }
      }
    }
    exit 0`;
  await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...installerChildEnvironment(), ORKESTRAI_INSTALLER_QA_REGISTRY_ROOTS: JSON.stringify(registryRoots) },
    windowsHide: true, timeout: 30_000,
  });
}

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

async function run(command, args, env = installerChildEnvironment()) {
  const result = await execute(command, args, { env, windowsHide: true, timeout: 240_000, maxBuffer: 2 * 1024 * 1024 });
  if (result.stdout.trim()) console.log(result.stdout.trim());
  return result;
}

export async function verifyWindowsInstaller(installer, unpacked, previousInstaller) {
  assertIsolatedInstallerHost();
  const reference = resolve(unpacked);
  const packageJson = JSON.parse(await readFile(join(reference, 'resources/app/package.json'), 'utf8'));
  assert.equal(packageJson.name, 'orkestrai');
  const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  // Never uninstall an existing application. This test owns a new ephemeral
  // installation and its per-user registration on an otherwise fresh runner.
  await assertNoExistingInstallation(powershell);
  const root = await mkdtemp(join(process.env.RUNNER_TEMP, 'orkestrai-installer-'));
  const installed = join(root, 'App with spaces');
  const executable = join(installed, 'Orkestrai.exe');
  const appRoot = join(installed, 'resources/app');
  const env = { ...installerChildEnvironment(), TMP: root, TEMP: root };
  // NSIS /D must be the last argument, just as in the pinned NsisUpdater.
  const install = async (file, updating) => run(resolve(file), [
    ...(updating ? ['--updated'] : []), '/S', '/currentuser', `/D=${installed}`,
  ], env);
  const verifyFiles = async () => {
    for (const file of ['Orkestrai.exe', 'resources/app/package.json', 'resources/app/electron/main.cjs',
      'resources/app/electron/update-policy.cjs', 'resources/app/electron/diagnostics.cjs',
      'resources/app/scripts/orkestrai-server.mjs', 'resources/orkestrai-cli-runtime/node.exe']) {
      assert.equal(await sha256(join(installed, file)), await sha256(join(reference, file)), `Installed file differs: ${file}`);
    }
    const shortcuts = await execute(powershell, ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference='Stop'; $wsh=New-Object -ComObject WScript.Shell; $count=0; foreach($folder in @('DesktopDirectory','Programs')){ $link=Join-Path ([Environment]::GetFolderPath($folder)) 'Orkestrai.lnk'; if(Test-Path -LiteralPath $link){ $target=$wsh.CreateShortcut($link).TargetPath; if($target -ine $env:ORKESTRAI_INSTALLER_QA_EXECUTABLE){throw 'Shortcut points to a different executable'}; if(!(Test-Path -LiteralPath $target)){throw 'Shortcut target is missing'}; $count++ }}; if($count -lt 1){throw 'No installed shortcut found'}; Write-Output ('Verified {0} shortcut(s)' -f $count)"],
    { env: { ...env, ORKESTRAI_INSTALLER_QA_EXECUTABLE: executable }, windowsHide: true, timeout: 30_000 });
    console.log(shortcuts.stdout.trim());
  };
  try {
    await install(previousInstaller ?? installer, false);
    assert.ok((await stat(executable)).size > 0, 'The initial NSIS installation did not create its executable');
    await install(installer, true);
    await verifyFiles();
    // Execute the installed payload, not win-unpacked. The smoke runner
    // isolates all home/data paths and verifies migrations, UI assets and PTYs.
    for (let launch = 1; launch <= 2; launch += 1) {
      await run(process.execPath, [join(project, 'scripts/run-packaged-startup-smoke.mjs'), executable, appRoot]);
      await verifyFiles();
      console.log(`Installed Windows startup ${launch}/2 passed`);
    }
    console.log(`NSIS install, upgrade, shortcuts and repeated startup passed: ${packageJson.version}`);
  } finally {
    const uninstaller = join(installed, 'Uninstall Orkestrai.exe');
    try {
      if (await stat(uninstaller).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) {
        const cleanup = join(root, 'cleanup.exe');
        await copyFile(uninstaller, cleanup);
        await run(cleanup, ['/S', '/KEEP_APP_DATA', '/currentuser', `_?=${installed}`], env);
      }
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [installer, unpacked, previousInstaller] = process.argv.slice(2);
  assert.ok(installer && unpacked, 'Usage: run-windows-installer-smoke.mjs <installer.exe> <win-unpacked> [previous-installer.exe]');
  await verifyWindowsInstaller(installer, unpacked, previousInstaller);
}
