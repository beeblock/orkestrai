import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowsComputerAdapter, computerPowerShellArgs } from '$lib/modules/agent-room/application/adapters/computers/WindowsComputerAdapter.js';
import { MacComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/MacComputerAdapter.js';
import { runNative } from '$lib/modules/agent-room/application/adapters/computers/native-runner.js';
import type { ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

vi.mock('$lib/modules/agent-room/application/adapters/computers/native-runner.js', () => ({ runNative: vi.fn() }));
const native = vi.mocked(runNative);

function windowsInvocation() {
  const [, args] = native.mock.calls.at(-1)!;
  expect(args.at(-2)).toBe('-EncodedCommand');
  const script = Buffer.from(args.at(-1)!, 'base64').toString('utf16le');
  const values = script.match(/FromBase64String\('([A-Za-z0-9+/=]+)'\)/)![1];
  return { script, values: JSON.parse(Buffer.from(values, 'base64').toString('utf8')) as string[] };
}

describe('native desktop adapters', () => {
  beforeEach(() => { native.mockReset(); native.mockResolvedValue({ stdout: '', stderr: '', code: 0 }); });

  it('passes Windows application identifiers as data, not trailing PowerShell source', async () => {
    const adapter = new WindowsComputerAdapter();
    await adapter.launch('chrome');
    expect(native.mock.calls[0][0]).toBe('powershell.exe');
    const { script, values } = windowsInvocation();
    expect(values).toEqual(['chrome']);
    expect(script).toContain('App Paths');
    expect(script).toContain('Start-Process -FilePath $path');
    expect(script).toContain('} @values');
    expect(script).toContain("$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')");
    expect(script).toContain('$values=ConvertFrom-Json');
    expect(script).not.toContain('$values=@(');
    await expect(adapter.launch('chrome; calc')).rejects.toThrow('Invalid application');
    await expect(adapter.launch('C:\\Windows\\cmd.exe')).rejects.toThrow('Invalid application');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform !== 'win32')('round-trips native PowerShell arguments without interpreting their contents', async () => {
    const { runNative: realRunNative } = await vi.importActual<typeof import('$lib/modules/agent-room/application/adapters/computers/native-runner.js')>('$lib/modules/agent-room/application/adapters/computers/native-runner.js');
    const values = ['C:\\Program Files\\Desktop App', 'a; throw "must not execute"', 'a\'b"c', 'a+b[]{}', 'a\u00e7\u00e3o'];
    const result = await realRunNative('powershell.exe', computerPowerShellArgs('ConvertTo-Json -Compress -InputObject @($args)', values), { timeoutMs: 20_000 });
    expect(JSON.parse(result.stdout)).toEqual(values);
    // Allow the bounded native timeout to finish even on a cold Windows runner.
  }, 30_000);

  it.skipIf(process.platform !== 'win32').each([{ values: [] }, { values: [''] }, { values: ['single'] }])('preserves PowerShell argument cardinality for $values', async ({ values }) => {
    const { runNative: realRunNative } = await vi.importActual<typeof import('$lib/modules/agent-room/application/adapters/computers/native-runner.js')>('$lib/modules/agent-room/application/adapters/computers/native-runner.js');
    const result = await realRunNative('powershell.exe', computerPowerShellArgs('ConvertTo-Json -Compress -InputObject @($args)', values), { timeoutMs: 20_000 });
    expect(JSON.parse(result.stdout)).toEqual(values);
  }, 30_000);

  it('preserves SendKeys metacharacters as literal text and keeps secrets off argv', async () => {
    const adapter = new WindowsComputerAdapter();
    const text = 'A+[B] {C} $(calc); "D"';
    await adapter.type(text);
    expect(native.mock.calls.at(-1)?.[2]?.input).toBe(text);
    expect(native.mock.calls.at(-1)?.[1].join(' ')).not.toContain(text);
    await adapter.typeSensitive(text);
    const [, args, options] = native.mock.calls.at(-1)!;
    expect(args.join(' ')).not.toContain(text);
    expect(options?.input).toBe(text);
    expect(args.join(' ')).toContain(String.raw`([+^%~(){}\[\]])`);
    expect(args.join(' ')).toContain("$env:PSModulePath=[IO.Path]::Combine($PSHOME,'Modules')");
    await adapter.type('x'.repeat(20_000));
    expect(native.mock.calls.at(-1)?.[1].join(' ').length).toBeLessThan(1000);
    expect(native.mock.calls.at(-1)?.[2]?.input?.length).toBe(20_000);
  });

  it('executes one actual shortcut, not an ignored modifier or a typed key name', async () => {
    const windows = new WindowsComputerAdapter();
    await windows.shortcut(['ctrl', 'F12']);
    expect(windowsInvocation().values).toEqual(['^{F12}']);
    await expect(windows.shortcut(['win', 'r'])).rejects.toThrow('not supported');
    await expect(windows.shortcut(['ctrl', 'a', 'b'])).rejects.toThrow('Exactly one');
    await expect(windows.shortcut(['ctrl', 'unknown'])).rejects.toThrow('Unsupported');
    const mac = new MacComputerAdapter();
    await expect(mac.shortcut(['cmd', 'a', 'b'])).rejects.toThrow('Exactly one');
    await mac.shortcut(['cmd', 'a']);
    expect(native.mock.calls.at(-1)?.[1]).toEqual(['-e', 'tell application "System Events" to keystroke "a" using {command down}']);
  });

  it('launches macOS bundles without shell execution or arbitrary arguments', async () => {
    const adapter = new MacComputerAdapter();
    await adapter.launch('com.apple.calculator');
    expect(native).toHaveBeenCalledWith('/usr/bin/open', ['-b', 'com.apple.calculator']);
    await expect(adapter.launch('--args')).rejects.toThrow('Invalid application');
    await expect(adapter.launch('/tmp/app')).rejects.toThrow('Invalid application');
    await expect(adapter.focus('0:0')).rejects.toThrow('Invalid macOS');
    await expect(adapter.focus('42:-1')).rejects.toThrow('Invalid macOS');
    await expect(adapter.focus('42:0')).rejects.toThrow('stable native window ID');
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('does not capture an undefined region when a focused window loses its bounds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-capture-bounds-'));
    const adapter = new MacComputerAdapter();
    const state: ComputerSnapshot = { platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'granted' }, displays: [], windows: [{ id: '42:cg:9', appId: 'com.apple.calculator', appName: 'Calculator', title: 'Calculator', focused: true, bounds: { x: 1, y: 1, width: 300, height: 500 } }], focusedWindowId: '42:cg:9' };
    vi.spyOn(adapter, 'snapshot').mockResolvedValueOnce(state).mockResolvedValueOnce({ ...state, windows: [{ ...state.windows[0], bounds: null }] });
    try {
      await expect(adapter.screenshot({ command: 'screenshot', target: 'window', targetId: '42:cg:9' }, { evidencePath: join(dir, 'capture.png') })).rejects.toThrow('lost focus or bounds');
      expect(native.mock.calls.some(([command]) => command.includes('screencapture'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
