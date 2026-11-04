import { describe, expect, it } from 'vitest';
import { workingDirectoryFromOsc } from '$lib/components/agent-room/terminal-working-directory.js';
import { workingDirectoryFromWindowsOsc, shellDirectoryForRuntime, restoreShellDirectory } from '$lib/modules/agent-room/domain/terminal-working-directory.js';
import { parseLsofWorkingDirectory } from '$lib/modules/agent-room/infrastructure/pty/PtySessionManager.ts';

describe('terminal working directory', () => {
  it('reads literal Windows and WSL paths from OSC 9;9', () => {
    expect(workingDirectoryFromWindowsOsc('9;"C:\\Work folder\\assets"')).toBe('C:\\Work folder\\assets');
    expect(workingDirectoryFromWindowsOsc('9;/home/me/project/assets')).toBe('/home/me/project/assets');
    expect(workingDirectoryFromWindowsOsc('4;1;50')).toBeNull();
    expect(workingDirectoryFromWindowsOsc('9;C:\\bad\npath')).toBeNull();
  });
  it('keeps WSL directory restoration in the correct distribution', () => {
    const runtime = { kind: 'wsl' as const, distribution: 'Ubuntu', linuxWorkingDir: '/home/me/project' };
    expect(shellDirectoryForRuntime('/home/me/project/assets', runtime)).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\project\\assets');
    expect(shellDirectoryForRuntime('/mnt/c/Work/assets', runtime)).toBe('C:\\Work\\assets');
    expect(shellDirectoryForRuntime('\\\\wsl.localhost\\Debian\\home\\me', runtime)).toBeNull();
    expect(restoreShellDirectory('bash', [], 'C:\\root', '/home/me/project/assets', runtime, true).cwd).toBe('\\\\wsl.localhost\\Ubuntu\\home\\me\\project\\assets');
  });
  it('passes a Linux cwd to native wsl.exe through --cd rather than the Windows host cwd', () => {
    const result = restoreShellDirectory('wsl.exe', ['--distribution', 'Ubuntu'], 'C:\\root', '/home/me/subdir', { kind: 'native' }, true);
    expect(result).toEqual({ cwd: 'C:\\root', args: ['--cd', '/home/me/subdir', '--distribution', 'Ubuntu'] });
    expect(restoreShellDirectory('powershell.exe', [], 'C:\\root', '/home/me', { kind: 'native' }, true).cwd).toBe('C:\\root');
  });
  it('decodes the standard OSC 7 file URI', () => {
    expect(workingDirectoryFromOsc('file://MacBook/Users/raoni/My%20Project')).toBe('/Users/raoni/My Project');
    expect(workingDirectoryFromOsc('https://example.com/nope')).toBeNull();
  });

  it('normalizes Windows drive paths reported by OSC 7', () => {
    expect(workingDirectoryFromOsc('file://desktop/C:/Users/Raoni/App', true)).toBe('C:/Users/Raoni/App');
  });

  it('extracts cwd from lsof field output', () => {
    expect(parseLsofWorkingDirectory('p120\nfcwd\nn/Users/raoni/project\n')).toBe('/Users/raoni/project');
    expect(parseLsofWorkingDirectory('')).toBeNull();
  });
});
