import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WindowsComputerAdapter, computerPowerShellArgs } from '$lib/modules/agent-room/application/adapters/computers/WindowsComputerAdapter.js';
import { MacComputerAdapter } from '$lib/modules/agent-room/application/adapters/computers/MacComputerAdapter.js';
import { runNative } from '$lib/modules/agent-room/application/adapters/computers/native-runner.js';
import type { ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { WINDOWS_ACCESSIBILITY_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/windows-accessibility.js';

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

  it('binds Windows reads to HWND/process and keeps foreground guards exclusive to mutations', async () => {
    native.mockResolvedValue({ stdout: JSON.stringify({ available: true, truncated: false, elements: [] }), stderr: '', code: 0 });
    await new WindowsComputerAdapter().read('42', 'qa.app');
    expect(native.mock.calls[0][2]?.input).toBe(JSON.stringify({ targetId: '42', appId: 'qa.app' }));
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).toContain('AutomationElement]::FromHandle($handle)');
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).toContain('GetWindowThreadProcessId($handle,[ref]$owner)');
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).toContain('Check-Target\n  if($r.action){Check-Interaction}');
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).toContain('if($r.background -ne $true){Check-Focus}');
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).not.toContain('.SetFocus(');
    expect(WINDOWS_ACCESSIBILITY_SCRIPT).not.toContain('SetForegroundWindow');
  });

  it.each([MacComputerAdapter, WindowsComputerAdapter])('offers a visual fallback for unsupported reads, never for uncertain actions', async (Adapter) => {
    const adapter = new Adapter();
    native.mockResolvedValue({ stdout: JSON.stringify({ error: 'accessibility_failed' }), stderr: '', code: 0 });
    await expect(adapter.read('42', 'qa.app')).resolves.toEqual({ available: false, truncated: false, elements: [] });
    const element = { id: '0', role: 'button', name: 'Send' };
    await expect(adapter.interact({ command: 'interact', targetId: '42', element, guards: [element], action: 'press' }, 'qa.app')).rejects.toThrow('No automatic retry');
    native.mockResolvedValue({ stdout: JSON.stringify({ error: 'focus_changed' }), stderr: '', code: 0 });
    await expect(adapter.read('42', 'qa.app')).rejects.toThrow('focus_changed');
  });

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

  it('issues a file-selection receipt only after successful native picker verification', async () => {
    const adapter = new MacComputerAdapter();
    const preview = { available: true, truncated: false, elements: [] };
    const input = { targetId: '42:cg:9', appId: 'net.whatsapp.WhatsApp', path: '/private/staging/photo.png', open: { id: '0.0.1', role: 'AXButton', name: 'Photos' }, guards: [{ id: '0.0.0', role: 'AXButton', name: 'Taylor' }] };
    native.mockResolvedValue({ stdout: JSON.stringify(preview), stderr: '', code: 0 });
    await expect(adapter.attachFile(input)).resolves.toEqual({ ...preview, selectedFile: { path: input.path, targetId: input.targetId, applicationId: input.appId } });
    await expect(adapter.receiveFile(input)).resolves.toEqual(preview);
    native.mockResolvedValue({ stdout: JSON.stringify({ error: 'file_dialog_invalid' }), stderr: '', code: 0 });
    await expect(adapter.attachFile(input)).rejects.toThrow('file_dialog_invalid');
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

  it('keeps macOS Unicode text and SecretRefs off process arguments and logs', async () => {
    const adapter = new MacComputerAdapter();
    const text = 'Ol\u00e1; password=private-qa-fixture \ud83d\ude80';
    await adapter.type(text);
    await adapter.typeSensitive(text);
    for (const [command, args, options] of native.mock.calls) {
      expect(command).toBe('/usr/bin/osascript');
      expect(options?.input).toBe(text);
      expect(args.join(' ')).not.toContain(text);
      expect(args.join(' ')).toContain('CGEventKeyboardSetUnicodeString');
    }
  });

  it('captures an isolated macOS background window without focusing or copying the desktop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orkestrai-background-capture-'));
    const path = join(dir, 'capture.png');
    const adapter = new MacComputerAdapter();
    const focus = vi.spyOn(adapter, 'focus');
    const state: ComputerSnapshot = { platform: 'macos', available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'granted' }, displays: [], windows: [{ id: '42:cg:9', appId: 'com.apple.calculator', appName: 'Calculator', title: 'Calculator', focused: false, bounds: { x: 1, y: 1, width: 300, height: 500 } }], focusedWindowId: null };
    vi.spyOn(adapter, 'snapshot').mockResolvedValue(state);
    native.mockImplementation(async (command, args) => {
      if (command === '/usr/sbin/screencapture') {
        expect(args).toContain('-l'); expect(args).toContain('9'); expect(args).not.toContain('-R');
        writeFileSync(path, 'capture fixture');
      }
      return { stdout: command === '/usr/bin/sips' ? 'pixelWidth: 300\npixelHeight: 500' : '', stderr: '', code: 0 };
    });
    try {
      expect(await adapter.screenshot({ command: 'screenshot', target: 'window', targetId: '42:cg:9' }, { evidencePath: path, passive: true })).toEqual({ width: 300, height: 500 });
      expect(focus).not.toHaveBeenCalled();
    } finally { rmSync(dir, { recursive: true, force: true }); }
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
