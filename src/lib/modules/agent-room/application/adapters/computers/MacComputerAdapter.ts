import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';

const DISPLAY_SCRIPT = `ObjC.import('AppKit'); function run(){const screens=$.NSScreen.screens.js;const primaryHeight=Number(screens[0]?.frame.size.height||0);return JSON.stringify(screens.map((s,i)=>({id:String(i+1),name:String(s.localizedName.js),bounds:{x:Number(s.frame.origin.x),y:primaryHeight-Number(s.frame.origin.y)-Number(s.frame.size.height),width:Number(s.frame.size.width),height:Number(s.frame.size.height)},scaleFactor:Number(s.backingScaleFactor),primary:i===0})));}`;
const WINDOW_IDENTITY_SCRIPT = `
ObjC.import('CoreGraphics');
function nativeWindows() {
  return ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(0, 0)))
    .filter(w => Number(w.kCGWindowOwnerPID) > 0 && Number(w.kCGWindowNumber) > 0);
}
function matchesBounds(native, position, size) {
  const b = native.kCGWindowBounds;
  return b && Math.abs(Number(b.X) - Number(position[0])) <= 1
    && Math.abs(Number(b.Y) - Number(position[1])) <= 1
    && Math.abs(Number(b.Width) - Number(size[0])) <= 1
    && Math.abs(Number(b.Height) - Number(size[1])) <= 1;
}`;

export const MAC_WINDOW_SCRIPT = `${WINDOW_IDENTITY_SCRIPT}
function run() {
  const registered = nativeWindows();
  const processes = Application('System Events').applicationProcesses.whose({visible:true})();
  return JSON.stringify(processes.slice(0,100).flatMap(p => {
    const pid = Number(p.unixId()), appName = String(p.name());
    let appId = appName, windows = [];
    try { appId = String(p.bundleIdentifier() || appName); windows = p.windows(); } catch {}
    const focused = Boolean(p.frontmost());
    return windows.slice(0,50).flatMap((w,i) => {
      try {
        const pos = w.position(), size = w.size(), title = String(w.name() || '').slice(0,1000);
        const candidates = registered.filter(n => Number(n.kCGWindowOwnerPID) === pid && matchesBounds(n,pos,size));
        if (candidates.length !== 1) return [];
        return [{id:pid+':cg:'+candidates[0].kCGWindowNumber,appId,appName,title,
          bounds:{x:Number(pos[0]),y:Number(pos[1]),width:Number(size[0]),height:Number(size[1])},focused:focused&&i===0}];
      } catch { return []; }
    });
  }).slice(0,500));
}`;

export const MAC_FOCUS_SCRIPT = `${WINDOW_IDENTITY_SCRIPT}
function run(argv) {
  const pid = Number(argv[0]), windowId = Number(argv[1]);
  const target = nativeWindows().find(w => Number(w.kCGWindowOwnerPID) === pid && Number(w.kCGWindowNumber) === windowId);
  if (!target) throw new Error('Target window is no longer available. Inspect again.');
  const processes = Application('System Events').applicationProcesses.whose({unixId:pid})();
  if (!processes.length) throw new Error('Application is no longer running.');
  const windows = processes[0].windows().filter(w => {try{return matchesBounds(target,w.position(),w.size())}catch{return false}});
  if (windows.length !== 1) throw new Error('Target window identity is ambiguous. Inspect again.');
  windows[0].actions.byName('AXRaise').perform();
  processes[0].frontmost = true;
}`;

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function keyCode(key: string): number | null {
  const codes: Record<string, number> = {
    enter: 36, return: 36, tab: 48, escape: 53, esc: 53, space: 49,
    backspace: 51, delete: 51, forwarddelete: 117,
    left: 123, right: 124, down: 125, up: 126,
    home: 115, end: 119, pageup: 116, pagedown: 121,
  };
  return codes[key.toLowerCase()] ?? null;
}

export class MacComputerAdapter implements ComputerAdapter {
  readonly platform = 'macos' as const;
  private screenRecordingGranted = false;

  async launch(applicationId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId)) throw new Error('Invalid application identifier.');
    await runNative('/usr/bin/open', ['-b', applicationId]);
  }

  async snapshot(): Promise<ComputerSnapshot> {
    if (process.platform !== 'darwin') return this.unavailable();
    const displays = parseJson<ComputerSnapshot['displays']>((await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', DISPLAY_SCRIPT])).stdout, []);
    const accessibilityCheck = await runNative('/usr/bin/osascript', ['-e', 'tell application "System Events" to get UI elements enabled'], { allowFailure: true });
    const accessibility = accessibilityCheck.code === 0 && accessibilityCheck.stdout.trim() === 'true' ? 'granted' as const : 'denied' as const;
    const windowResult = accessibility === 'granted'
      ? await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_WINDOW_SCRIPT], { allowFailure: true })
      : null;
    const parsed = windowResult ? parseJson<ComputerSnapshot['windows'] | null>(windowResult.stdout, null) : [];
    const windows = Array.isArray(parsed) ? parsed : [];
    const failed = windowResult !== null && (windowResult.code !== 0 || !Array.isArray(parsed));
    return {
      platform: this.platform,
      available: !failed,
      reason: failed ? 'backend_missing' : 'ready',
      detail: failed ? 'The native window inventory could not be read. Check Automation permission for System Events.' : accessibility === 'granted' ? null : 'Accessibility permission is required for app and input control.',
      permissions: { accessibility, screenRecording: this.screenRecordingGranted ? 'granted' : 'unknown' },
      displays,
      windows,
      focusedWindowId: windows.find((window) => window.focused)?.id ?? null,
    };
  }

  async focus(windowId: string): Promise<void> {
    const match = windowId.match(/^([1-9]\d*):cg:([1-9]\d*)$/);
    if (!match) throw new Error('Invalid macOS window reference. Inspect again for a stable native window ID.');
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_FOCUS_SCRIPT, '--', match[1], match[2]]);
  }

  async click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }): Promise<void> {
    if (point.button !== 'left') throw new Error('macOS right and middle clicks are not available through the accessibility adapter.');
    const statements = Array.from({ length: point.count }, () => `click at {${point.x}, ${point.y}}`).join('\n');
    await runNative('/usr/bin/osascript', ['-e', `tell application "System Events"\n${statements}\nend tell`]);
  }

  async type(text: string): Promise<void> {
    await this.typeSensitive(text);
  }

  async typeSensitive(text: string): Promise<void> {
    const script = `ObjC.import('Foundation');function run(){const data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;const value=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js;Application('System Events').keystroke(value);}`;
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { input: text });
  }

  async shortcut(keys: string[]): Promise<void> {
    const modifiers: Record<string, string> = { command: 'command down', cmd: 'command down', control: 'control down', ctrl: 'control down', option: 'option down', alt: 'option down', shift: 'shift down', fn: 'function down' };
    const normalized = keys.map((key) => key.toLowerCase());
    const main = normalized.find((key) => !modifiers[key]);
    if (!main || normalized.filter((key) => !modifiers[key]).length !== 1) throw new Error('Exactly one non-modifier key is required.');
    const using = normalized.filter((key) => modifiers[key]).map((key) => modifiers[key]);
    const code = keyCode(main);
    const action = code === null
      ? `keystroke ${JSON.stringify(main.length === 1 ? main : '')}${using.length ? ` using {${using.join(', ')}}` : ''}`
      : `key code ${code}${using.length ? ` using {${using.join(', ')}}` : ''}`;
    if (code === null && main.length !== 1) throw new Error('Unsupported macOS shortcut key.');
    await runNative('/usr/bin/osascript', ['-e', `tell application "System Events" to ${action}`]);
  }

  async screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: { evidencePath: string }): Promise<{ width: number | null; height: number | null }> {
    await mkdir(dirname(context.evidencePath), { recursive: true });
    const args = ['-x', '-t', 'png'];
    if (input.target === 'display') {
      if (!input.targetId || !/^\d+$/.test(input.targetId)) throw new Error('A valid macOS display is required.');
      args.push('-D', input.targetId);
    } else if (input.target === 'window') {
      if (!input.targetId) throw new Error('A target window is required.');
      const snapshot = await this.snapshot();
      const window = snapshot.windows.find((candidate) => candidate.id === input.targetId);
      if (!window?.bounds) throw new Error('The target window or its bounds are unavailable.');
      await this.focus(window.id);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const refreshed = (await this.snapshot()).windows.find((candidate) => candidate.id === window.id);
      if (!refreshed?.focused || !refreshed.bounds || refreshed.appId !== window.appId) throw new Error('Target window lost focus or bounds before capture.');
      args.push('-l', window.id.split(':cg:')[1], '-o');
    }
    args.push(context.evidencePath);
    await runNative('/usr/sbin/screencapture', args, { timeoutMs: 30_000 });
    await access(context.evidencePath);
    const info = await runNative('/usr/bin/sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', context.evidencePath]);
    const dimensions = { width: Number(info.stdout.match(/pixelWidth:\s*(\d+)/)?.[1]) || null, height: Number(info.stdout.match(/pixelHeight:\s*(\d+)/)?.[1]) || null };
    this.screenRecordingGranted = true;
    return dimensions;
  }

  async openSettings(permission: 'accessibility' | 'screenRecording'): Promise<void> {
    const url = permission === 'accessibility'
      ? 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      : 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture';
    await runNative('/usr/bin/open', [url]);
  }

  private unavailable(): ComputerSnapshot {
    return { platform: this.platform, available: false, reason: 'unsupported_os', detail: null, permissions: { accessibility: 'unavailable', screenRecording: 'unavailable' }, displays: [], windows: [], focusedWindowId: null };
  }
}
