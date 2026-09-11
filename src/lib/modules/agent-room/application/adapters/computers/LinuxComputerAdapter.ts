import { access, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';

async function available(command: string): Promise<boolean> {
  return (await runNative('/usr/bin/env', ['which', command], { allowFailure: true })).code === 0;
}

export function parseWmctrlWindows(output: string, active: string): ComputerSnapshot['windows'] {
  return output.split('\n').flatMap((line) => {
    // -lGpx: window, desktop, PID, x, y, width, height, WM_CLASS, host, title.
    const match = line.match(/^(0x[0-9a-f]+)\s+-?\d+\s+\d+\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/i);
    if (!match) return [];
    const id = String(parseInt(match[1], 16));
    const appId = match[6];
    return [{ id, appId, appName: appId.split('.').filter(Boolean).pop() ?? appId, title: match[8].slice(0, 1_000), bounds: { x: Number(match[2]), y: Number(match[3]), width: Math.max(1, Number(match[4])), height: Math.max(1, Number(match[5])) }, focused: id === active }];
  });
}

export class LinuxComputerAdapter implements ComputerAdapter {
  readonly platform = 'linux' as const;

  async launch(applicationId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId)) throw new Error('Invalid application identifier.');
    const wmClass = applicationId.split('.').at(-1)!.toLowerCase();
    for (const root of [join(homedir(), '.local/share/applications'), '/usr/local/share/applications', '/usr/share/applications']) {
      const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries.slice(0, 2_000)) {
        if (!entry.isFile() || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.desktop$/.test(entry.name)) continue;
        const content = await readFile(join(root, entry.name), 'utf8');
        if (content.length > 64_000) continue;
        const main = content.split(/^\[Desktop Entry\]\s*$/m)[1]?.split(/^\[/m)[0] ?? '';
        if (/^Hidden=true\s*$/m.test(main) || !/^Type=Application\s*$/m.test(main)) continue;
        const declaredClass = main.match(/^StartupWMClass=(.+)$/m)?.[1].trim().toLowerCase();
        if (declaredClass !== wmClass && entry.name.toLowerCase() !== `${applicationId.toLowerCase()}.desktop`) continue;
        // gio interprets the registered desktop entry; never execute its Exec text ourselves.
        await runNative('gio', ['launch', join(root, entry.name)]);
        return;
      }
    }
    throw new Error('No registered desktop application matches this identifier. Open it once and authorize its window.');
  }

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
    const windows = parseWmctrlWindows(windowOutput.stdout, active);
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
