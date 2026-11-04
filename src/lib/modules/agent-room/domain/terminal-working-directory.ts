import type { WorkspaceExecutionRuntime } from './types.js';

function safeDirectory(value: string): string | null {
  return value && value.length <= 4000 && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}

export function workingDirectoryFromOsc(payload: string, windows = false): string | null {
  try {
    const url = new URL(payload);
    if (url.protocol !== 'file:') return null;
    let path = decodeURIComponent(url.pathname);
    if (windows && /^\/[a-zA-Z]:\//.test(path)) path = path.slice(1);
    else if (windows && url.hostname && url.hostname !== 'localhost') path = '//' + url.hostname + path;
    return safeDirectory(path);
  } catch { return null; }
}

/** Windows Terminal's OSC 9;9 carries a literal path, optionally quoted. */
export function workingDirectoryFromWindowsOsc(payload: string): string | null {
  if (!payload.startsWith('9;')) return null;
  const path = payload.slice(2).replace(/^"(.*)"$/, '$1');
  if (!/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path)) return null;
  return safeDirectory(path);
}

export function shellDirectoryForRuntime(cwd: string, runtime: WorkspaceExecutionRuntime): string | null {
  if (!safeDirectory(cwd)) return null;
  if (runtime.kind !== 'wsl') return cwd;
  const unc = cwd.match(/^[\\/]{2}wsl(?:\.localhost|\$)[\\/]([^\\/]+)(?:[\\/]|$)/i);
  if (unc) return unc[1].toLowerCase() === runtime.distribution.toLowerCase() ? cwd : null;
  const drive = cwd.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
  if (drive) return drive[1].toUpperCase() + ':\\' + (drive[2] ?? '').replaceAll('/', '\\');
  if (cwd.startsWith('/')) return '\\\\wsl.localhost\\' + runtime.distribution + cwd.replaceAll('/', '\\');
  return /^[a-z]:[\\/]/i.test(cwd) ? cwd : null;
}

export function restoreShellDirectory(command: string, args: string[], baseCwd: string, saved: string | undefined, runtime: WorkspaceExecutionRuntime, windows = false) {
  if (!saved) return { cwd: baseCwd, args };
  const shell = command.replaceAll('\\', '/').split('/').at(-1) ?? '';
  if (runtime.kind === 'native' && windows && /^wsl(?:\.exe)?$/i.test(shell) && saved.startsWith('/')) {
    return { cwd: baseCwd, args: args.some(arg => arg === '--cd') ? args : ['--cd', saved, ...args] };
  }
  const cwd = shellDirectoryForRuntime(saved, runtime);
  if (!cwd || (runtime.kind === 'native' && windows && cwd.startsWith('/') && !cwd.startsWith('//'))) return { cwd: baseCwd, args };
  return { cwd, args };
}
