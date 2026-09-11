import { spawn } from 'node:child_process';

const MAX_OUTPUT = 2 * 1024 * 1024;

function nativeEnvironment(): NodeJS.ProcessEnv {
  const names = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_DATA_DIRS', 'DBUS_SESSION_BUS_ADDRESS', 'WAYLAND_DISPLAY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'ProgramData', 'COMSPEC'];
  return Object.fromEntries(names.flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]])) as NodeJS.ProcessEnv;
}

export async function runNative(
  command: string,
  args: string[],
  options: { input?: string; timeoutMs?: number; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: nativeEnvironment() });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error, result?: { stdout: string; stderr: string; code: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('Native computer operation timed out.'));
    }, options.timeoutMs ?? 15_000);
    timer.unref?.();
    const collect = (bucket: Buffer[], chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT) {
        child.kill('SIGKILL');
        finish(new Error('Native computer output exceeded the safe limit.'));
        return;
      }
      // Typed content, including SecretRefs, must never be echoed in errors.
      if (options.input === undefined) bucket.push(chunk);
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.on('error', (error) => finish(error));
    child.stdin.on('error', () => {
      child.kill('SIGKILL');
      finish(new Error('Native input delivery failed.'));
    });
    child.on('close', (code) => {
      const result = { stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), code: code ?? -1 };
      if (result.code !== 0 && !options.allowFailure) finish(new Error(result.stderr.trim().slice(0, 2_000) || `Native operation exited with code ${result.code}.`));
      else finish(undefined, result);
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
