import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { workspaceFileForTerminal } from '$lib/modules/agent-room/infrastructure/WslRuntime.js';

const file = '.orkestrai/portal/screenshots/shop.png';
const native = { workingDir: join('/', 'projects', 'shop'), runtimeKind: 'native' as const, wslDistribution: null, wslWorkingDir: null };
const wsl = { ...native, runtimeKind: 'wsl' as const, wslDistribution: 'Ubuntu', wslWorkingDir: '/home/dev/shop' };

describe('workspace files in a terminal\'s runtime', () => {
  it('uses the host path for native terminals, including native ones in a WSL workspace', () => {
    expect(workspaceFileForTerminal(native, {}, file)).toBe(join(native.workingDir, '.orkestrai', 'portal', 'screenshots', 'shop.png'));
    expect(workspaceFileForTerminal(wsl, { executionRuntime: { kind: 'native' } }, file)).toBe(join(native.workingDir, '.orkestrai', 'portal', 'screenshots', 'shop.png'));
  });

  it('uses the Linux path for WSL terminals, from the workspace or their own distribution', () => {
    expect(workspaceFileForTerminal(wsl, {}, file)).toBe('/home/dev/shop/.orkestrai/portal/screenshots/shop.png');
    expect(workspaceFileForTerminal(native, { executionRuntime: { kind: 'wsl', distribution: 'Debian', linuxWorkingDir: '/srv/shop' } }, file))
      .toBe('/srv/shop/.orkestrai/portal/screenshots/shop.png');
  });

  it('accepts Windows separators in the relative path', () => {
    expect(workspaceFileForTerminal(wsl, null, '.orkestrai\\attachments\\a.png')).toBe('/home/dev/shop/.orkestrai/attachments/a.png');
  });
});
