import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';

const WIN32 = `using System;using System.Text;using System.Collections.Generic;using System.Runtime.InteropServices;public class O{public delegate bool E(IntPtr h,IntPtr l);[DllImport("user32.dll")]public static extern bool EnumWindows(E e,IntPtr l);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern int GetWindowTextLength(IntPtr h);[DllImport("user32.dll")]public static extern int GetWindowText(IntPtr h,StringBuilder s,int n);[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern bool GetWindowRect(IntPtr h,out R r);[DllImport("user32.dll")]public static extern bool SetForegroundWindow(IntPtr h);[DllImport("user32.dll")]public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")]public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr i);[StructLayout(LayoutKind.Sequential)]public struct R{public int Left,Top,Right,Bottom;}}`;
const POWERSHELL = 'powershell.exe';

function ps(script: string, args: string[] = [], allowFailure = false) {
  return runNative(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script, ...args], { timeoutMs: 20_000, allowFailure });
}

export class WindowsComputerAdapter implements ComputerAdapter {
  readonly platform = 'windows' as const;

  async snapshot(): Promise<ComputerSnapshot> {
    if (process.platform !== 'win32') return this.unavailable();
    const script = `Add-Type -AssemblyName System.Windows.Forms;Add-Type -TypeDefinition '${WIN32}';$fg=[O]::GetForegroundWindow();$wins=New-Object Collections.Generic.List[object];[O]::EnumWindows({param($h,$l)if([O]::IsWindowVisible($h)){ $n=[O]::GetWindowTextLength($h);if($n -gt 0){$s=New-Object Text.StringBuilder ($n+1);[void][O]::GetWindowText($h,$s,$s.Capacity);$pid2=0;[void][O]::GetWindowThreadProcessId($h,[ref]$pid2);$r=New-Object O+R;[void][O]::GetWindowRect($h,[ref]$r);$p=Get-Process -Id $pid2 -ErrorAction SilentlyContinue;$wins.Add([pscustomobject]@{id=$h.ToInt64().ToString();appId=if($p){$p.ProcessName}else{$pid2.ToString()};appName=if($p){$p.ProcessName}else{'Application'};title=$s.ToString();bounds=@{x=$r.Left;y=$r.Top;width=[Math]::Max(1,$r.Right-$r.Left);height=[Math]::Max(1,$r.Bottom-$r.Top)};focused=($h -eq $fg)})}}return $true},[IntPtr]::Zero)|Out-Null;$screens=@([Windows.Forms.Screen]::AllScreens|ForEach-Object -Begin{$i=0} -Process{$i++;[pscustomobject]@{id=$_.DeviceName;name=$_.DeviceName;bounds=@{x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height};scaleFactor=1;primary=$_.Primary}});@{displays=$screens;windows=$wins}|ConvertTo-Json -Depth 6 -Compress`;
    const result = await ps(script, [], true);
    if (result.code !== 0) return { ...this.unavailable(), reason: 'backend_missing', detail: result.stderr.slice(0, 2_000) };
    const parsed = JSON.parse(result.stdout) as { displays?: ComputerSnapshot['displays']; windows?: ComputerSnapshot['windows'] };
    const windows = parsed.windows ?? [];
    return { platform: this.platform, available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'granted' }, displays: parsed.displays ?? [], windows, focusedWindowId: windows.find((window) => window.focused)?.id ?? null };
  }

  async focus(windowId: string): Promise<void> {
    if (!/^\d+$/.test(windowId)) throw new Error('Invalid Windows window reference.');
    await ps(`Add-Type -TypeDefinition '${WIN32}';if(-not [O]::SetForegroundWindow([IntPtr]::new([Int64]$args[0]))){exit 2}`, [windowId]);
  }

  async click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }): Promise<void> {
    const flags = point.button === 'left' ? [2, 4] : point.button === 'right' ? [8, 16] : [32, 64];
    await ps(`Add-Type -TypeDefinition '${WIN32}';[void][O]::SetCursorPos([int]$args[0],[int]$args[1]);1..([int]$args[4])|%{[O]::mouse_event([uint32]$args[2],0,0,0,[UIntPtr]::Zero);[O]::mouse_event([uint32]$args[3],0,0,0,[UIntPtr]::Zero)}`, [String(point.x), String(point.y), String(flags[0]), String(flags[1]), String(point.count)]);
  }

  async type(text: string): Promise<void> {
    const encoded = Buffer.from(text, 'utf8').toString('base64');
    const script = `Add-Type -AssemblyName System.Windows.Forms;$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[0]));[Windows.Forms.SendKeys]::SendWait(($t -replace '([+^%~(){}\[\]])','{$1}'))`;
    await ps(script, [encoded]);
  }

  async typeSensitive(text: string): Promise<void> {
    const script = "Add-Type -AssemblyName System.Windows.Forms;$t=[Console]::In.ReadToEnd();[Windows.Forms.SendKeys]::SendWait(($t -replace '([+^%~(){}\\[\\]])','{$1}'))";
    await runNative(POWERSHELL, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeoutMs: 20_000, input: text });
  }

  async shortcut(keys: string[]): Promise<void> {
    const modifiers: Record<string, string> = { ctrl: '^', control: '^', alt: '%', shift: '+', win: '^{ESC}' };
    const normalized = keys.map((key) => key.toLowerCase());
    const main = normalized.find((key) => !modifiers[key]);
    if (!main) throw new Error('A non-modifier key is required.');
    const special: Record<string, string> = { enter: '{ENTER}', return: '{ENTER}', tab: '{TAB}', escape: '{ESC}', esc: '{ESC}', space: ' ', delete: '{DELETE}', backspace: '{BACKSPACE}', left: '{LEFT}', right: '{RIGHT}', up: '{UP}', down: '{DOWN}', home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}' };
    const sequence = normalized.filter((key) => modifiers[key] && key !== 'win').map((key) => modifiers[key]).join('') + (special[main] ?? main);
    await ps('Add-Type -AssemblyName System.Windows.Forms;[Windows.Forms.SendKeys]::SendWait($args[0])', [sequence]);
  }

  async screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: { evidencePath: string }): Promise<{ width: number | null; height: number | null }> {
    await mkdir(dirname(context.evidencePath), { recursive: true });
    if (input.target === 'window') {
      if (!input.targetId) throw new Error('A target window is required.');
      await this.focus(input.targetId);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const script = `Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing;Add-Type -TypeDefinition '${WIN32}';$target=$args[0];$id=$args[1];if($target -eq 'window'){$r=New-Object O+R;if(-not [O]::GetWindowRect([IntPtr]::new([Int64]$id),[ref]$r)){exit 2};$b=New-Object Drawing.Rectangle($r.Left,$r.Top,[Math]::Max(1,$r.Right-$r.Left),[Math]::Max(1,$r.Bottom-$r.Top))}elseif($target -eq 'display'){$s=[Windows.Forms.Screen]::AllScreens|?{$_.DeviceName -eq $id}|Select-Object -First 1;if(-not $s){exit 3};$b=$s.Bounds}else{$b=[Windows.Forms.SystemInformation]::VirtualScreen};$bmp=New-Object Drawing.Bitmap($b.Width,$b.Height);$g=[Drawing.Graphics]::FromImage($bmp);$g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size);$bmp.Save($args[2],[Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bmp.Dispose();@{width=$b.Width;height=$b.Height}|ConvertTo-Json -Compress`;
    const result = await ps(script, [input.target, input.targetId ?? '', context.evidencePath]);
    return JSON.parse(result.stdout) as { width: number; height: number };
  }

  async openSettings(permission: 'accessibility' | 'screenRecording'): Promise<void> {
    const page = permission === 'screenRecording' ? 'ms-settings:privacy-screenshots' : 'ms-settings:privacy';
    await runNative('cmd.exe', ['/d', '/s', '/c', 'start', '', page]);
  }

  private unavailable(): ComputerSnapshot {
    return { platform: this.platform, available: false, reason: 'unsupported_os', detail: null, permissions: { accessibility: 'unavailable', screenRecording: 'unavailable' }, displays: [], windows: [], focusedWindowId: null };
  }
}
