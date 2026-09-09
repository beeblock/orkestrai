import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';

async function available(command: string): Promise<boolean> {
  return (await runNative('/usr/bin/env', ['which', command], { allowFailure: true })).code === 0;
}

export class LinuxComputerAdapter implements ComputerAdapter {
  readonly platform = 'linux' as const;

  async snapshot(): Promise<ComputerSnapshot> {
    if (process.platform !== 'linux') return this.unavailable('unsupported_os');
    if (process.env.XDG_SESSION_TYPE?.toLowerCase() === 'wayland') return this.unavailable('wayland_unsupported');
    if (!await available('xdotool') || !await available('wmctrl')) return this.unavailable('backend_missing');
    const [displayOutput, windowOutput, activeOutput] = await Promise.all([
      runNative('xrandr', ['--listmonitors'], { allowFailure: true }),
      runNative('wmctrl', ['-lGpx'], { allowFailure: true }),
      runNative('xdotool', ['getactivewindow'], { allowFailure: true }),
    ]);
    const displays = displayOutput.stdout.split('\n').slice(1).flatMap((line, index) => {
      const match = line.match(/^\s*\d+:\s+[^ ]*\s+(\d+)\/[\d]+x(\d+)\/[\d]+\+(-?\d+)\+(-?\d+)\s+(.+)$/);
      return match ? [{ id: String(index), name: match[5].trim(), bounds: { x: Number(match[3]), y: Number(match[4]), width: Number(match[1]), height: Number(match[2]) }, scaleFactor: 1, primary: index === 0 }] : [];
    });
    const active = String(Number(activeOutput.stdout.trim()));
    const windows = windowOutput.stdout.split('\n').flatMap((line) => {
      const match = line.match(/^(0x[0-9a-f]+)\s+\d+\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/i);
      if (!match) return [];
      const id = String(parseInt(match[1], 16));
      const app = match[7].split('.').filter(Boolean).pop() ?? match[7];
      return [{ id, appId: match[7], appName: app, title: match[9].slice(0, 1_000), bounds: { x: Number(match[2]), y: Number(match[3]), width: Number(match[4]), height: Number(match[5]) }, focused: id === active }];
    });
    return { platform: this.platform, available: true, reason: 'ready', detail: null, permissions: { accessibility: 'granted', screenRecording: 'granted' }, displays, windows, focusedWindowId: windows.find((window) => window.focused)?.id ?? null };
  }

  focus(windowId: string): Promise<void> { return runNative('wmctrl', ['-ia', `0x${Number(windowId).toString(16)}`]).then(() => undefined); }

  async click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }): Promise<void> {
    const button = point.button === 'left' ? '1' : point.button === 'middle' ? '2' : '3';
    await runNative('xdotool', ['mousemove', '--sync', String(point.x), String(point.y), 'click', '--repeat', String(point.count), button]);
  }

  async type(text: string): Promise<void> { await runNative('xdotool', ['type', '--clearmodifiers', '--delay', '1', '--', text]); }
  async typeSensitive(_text: string): Promise<void> { throw new Error('Secure credential typing is unavailable on this Linux desktop backend. Use an API integration or a managed Portal SecretRef instead.'); }
  async shortcut(keys: string[]): Promise<void> { await runNative('xdotool', ['key', '--clearmodifiers', keys.join('+')]); }

  async screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: { evidencePath: string }): Promise<{ width: number | null; height: number | null }> {
    await mkdir(dirname(context.evidencePath), { recursive: true });
    if (input.target === 'display') throw new Error('Display-only capture is unavailable in the Linux adapter; capture all displays or an allowed window.');
    if (input.target === 'window') {
      if (!input.targetId) throw new Error('A target window is required.');
      await this.focus(input.targetId);
      if (await available('gnome-screenshot')) await runNative('gnome-screenshot', ['-w', '-f', context.evidencePath]);
      else if (await available('scrot')) await runNative('scrot', ['-u', context.evidencePath]);
      else throw new Error('Install gnome-screenshot or scrot to capture windows.');
    } else if (await available('gnome-screenshot')) await runNative('gnome-screenshot', ['-f', context.evidencePath]);
    else if (await available('scrot')) await runNative('scrot', [context.evidencePath]);
    else throw new Error('Install gnome-screenshot or scrot to capture the desktop.');
    await access(context.evidencePath);
    return { width: null, height: null };
  }

  async openSettings(): Promise<void> { throw new Error('Grant desktop accessibility and screenshot access in your Linux desktop settings.'); }

  private unavailable(reason: 'unsupported_os' | 'backend_missing' | 'wayland_unsupported'): ComputerSnapshot {
    const detail = reason === 'backend_missing' ? 'Install xdotool and wmctrl.' : reason === 'wayland_unsupported' ? 'The Linux Computer adapter currently requires an X11 session.' : null;
    return { platform: this.platform, available: false, reason, detail, permissions: { accessibility: 'unavailable', screenRecording: 'unavailable' }, displays: [], windows: [], focusedWindowId: null };
  }
}
