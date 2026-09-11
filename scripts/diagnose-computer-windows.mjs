import { spawn } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('Windows runner required.');
const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_DATA_DIRS', 'DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'COMSPEC'];
const restricted = Object.fromEntries(names.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
const script = `[Console]::Error.WriteLine('entered');[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);[Console]::Error.WriteLine('encoding');$v=@(ConvertFrom-Json '["hello"]');[Console]::Error.WriteLine('json');ConvertTo-Json -Compress -InputObject $v;[Console]::Error.WriteLine('finished')`;
for (const environment of ['restricted-builtin-modules']) {
  for (const stdin of ['pipe', 'ignore']) {
    const result = await new Promise(resolve => {
      const started = Date.now();
      const source = `$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules');${script}`;
      const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, env: restricted, stdio: [stdin, 'pipe', 'pipe'] });
      let stdout = '', stderr = '', timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 10_000);
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.stdin?.end();
      child.on('error', error => { clearTimeout(timer); resolve({ code: error.code }); });
      child.on('close', code => { clearTimeout(timer); resolve({ code, timedOut, milliseconds: Date.now() - started, stdout, stderr }); });
    });
    console.log(JSON.stringify({ environment, stdin, result }));
  }
}
