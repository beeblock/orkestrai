import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerInteraction, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';
import { MAC_ACCESSIBILITY_SCRIPT, MAC_ACCESSIBILITY_SESSION_SCRIPT } from './mac-accessibility.js';
import { macNativeSessionScript } from './mac-native-session.js';
import { MAC_SCOPED_WINDOW_READ } from './mac-window-read.js';
import { MAC_TEXT_EVENTS } from './mac-text-events.js';
import { parseAccessibility, unavailableAccessibility } from './accessibility.js';
import { NativeInteractionError } from './native-interaction-error.js';
import { acquireMacForeground } from './mac-foreground.js';

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
${MAC_SCOPED_WINDOW_READ}
function run(argv) {
  const registered = nativeWindows();
  const pid = Number(argv && argv[0]);
  if(pid)return JSON.stringify(readScopedNativeWindows(pid,registered));
  const processes = Application('System Events').applicationProcesses.whose(pid ? {unixId:pid} : {visible:true})();
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

const MAC_SNAPSHOT_HANDLER = `${DISPLAY_SCRIPT.replace('function run()', 'function readDisplays()')}
${MAC_WINDOW_SCRIPT.replace('function run(argv)', 'function readWindows(argv)')}
ObjC.import('ApplicationServices');
function readSnapshot(argv) {
  const displays=JSON.parse(readDisplays());
  let accessibility=false;
  // The global UI scripting switch stays true even when this app's signature
  // loses its TCC grant after a local replacement. Check the actual caller.
  try{accessibility=Boolean($.AXIsProcessTrusted());}catch{}
  return JSON.stringify({displays,accessibility,windows:accessibility?JSON.parse(readWindows(argv)):[]});
}`;
export const MAC_SNAPSHOT_SCRIPT = MAC_SNAPSHOT_HANDLER + '\nfunction run(argv){return readSnapshot(argv);}';
const MAC_SNAPSHOT_SESSION_SCRIPT = macNativeSessionScript('readSnapshot', MAC_SNAPSHOT_HANDLER);

// System Events "click at" performs an Accessibility action, which can silently
// do nothing on custom list rows. Post actual mouse down/up events instead.
export const MAC_CLICK_SCRIPT = `
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightPostEventAccess',['bool',[]]);
function run(argv) {
  const x = Number(argv[0]), y = Number(argv[1]), count = Number(argv[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(count) || count < 1 || count > 3) throw new Error('Invalid mouse input.');
  if (!$.CGPreflightPostEventAccess()) throw new Error('Accessibility permission is required for native input.');
  const position = $.CGPointMake(x,y);
  for (let i = 1; i <= count; i++) {
    const down = $.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseDown,position,$.kCGMouseButtonLeft);
    const up = $.CGEventCreateMouseEvent(null,$.kCGEventLeftMouseUp,position,$.kCGMouseButtonLeft);
    if (!down || !up) throw new Error('Could not create native mouse input.');
    $.CGEventSetFlags(down,0); $.CGEventSetFlags(up,0);
    $.CGEventSetIntegerValueField(down,$.kCGMouseEventClickState,i);
    $.CGEventSetIntegerValueField(up,$.kCGMouseEventClickState,i);
    $.CGEventPost($.kCGHIDEventTap,down);
    delay(0.02);
    $.CGEventPost($.kCGHIDEventTap,up);
    if (i < count) delay(0.04);
  }
}`;

// NSData owns the UTF-16 buffer. The explicit pointer binding avoids JXA's
// incompatible void*/UniChar* Ref coercion without using the user's clipboard.
export const MAC_TYPE_SCRIPT = `
ObjC.import('Foundation'); ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightPostEventAccess',['bool',[]]);
ObjC.bindFunction('CGEventKeyboardSetUnicodeString',['void',['void *','unsigned long','void *']]);
${MAC_TEXT_EVENTS}
function run() {
  const input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  const decoded = $.NSString.alloc.initWithDataEncoding(input,$.NSUTF8StringEncoding);
  if (decoded.isNil()) throw new Error('Invalid native text encoding.');
  const value = decoded.js;
  if (value.length > 20000) throw new Error('Native text input exceeded the safe limit.');
  if (!$.CGPreflightPostEventAccess()) throw new Error('Accessibility permission is required for native input.');
  for (const chunk of unicodeChunks(value)) {
    for (const event of unicodeEvents(chunk)) $.CGEventPost($.kCGHIDEventTap,event);
    delay(0.002);
  }
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
  readonly backgroundWindowCapture = true;
  readonly backgroundInteraction = true;
  private screenRecordingGranted = false;

  private async accessibility(request: { targetId: string; appId: string; background?: boolean } & Partial<ComputerInteraction>) {
    const result = await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_ACCESSIBILITY_SCRIPT], {
      input: JSON.stringify(request), structuredOutput: true, timeoutMs: request.action === 'fill' ? 15_000 : 5000,
      persistent: { script: MAC_ACCESSIBILITY_SESSION_SCRIPT, scope: 'mac-ax:' + request.targetId.split(':')[0] },
    });
    const parsed = JSON.parse(result.stdout);
    if (parsed.error) {
      if (!request.action && ['accessibility_unavailable', 'accessibility_failed'].includes(parsed.error)) return unavailableAccessibility();
      throw new NativeInteractionError(`Native accessibility check failed (${String(parsed.error).replace(/[^a-z_]/g, '').slice(0, 60)}). ${parsed.inputAttempted === false ? 'No native input was attempted.' : 'No automatic retry; inspect the current target.'}`, parsed.inputAttempted !== false);
    }
    return parseAccessibility(parsed);
  }

  read(targetId: string, appId: string) { return this.accessibility({ targetId, appId }); }
  acquireForeground(targetId: string, appId: string) { return acquireMacForeground(targetId, appId); }
  interact(input: ComputerInteraction, appId: string, options?: { background: boolean }) { return this.accessibility({ ...input, appId, background: options?.background === true }); }

  async attachFile(input: Parameters<NonNullable<ComputerAdapter['attachFile']>>[0]) {
    const preview = await this.selectFile(input, 'open');
    return { ...preview, selectedFile: { path: input.path, targetId: input.targetId, applicationId: input.appId } };
  }

  async receiveFile(input: Parameters<NonNullable<ComputerAdapter['receiveFile']>>[0]) {
    return this.selectFile(input, 'save');
  }

  private async selectFile(input: Parameters<NonNullable<ComputerAdapter['attachFile']>>[0], mode: 'open' | 'save') {
    const result = await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_ACCESSIBILITY_SCRIPT], {
      input: JSON.stringify({ targetId: input.targetId, appId: input.appId, guards: input.guards, file: { mode, path: input.path, open: input.open, menu: input.menu } }), structuredOutput: true, timeoutMs: 15_000,
    });
    const parsed = JSON.parse(result.stdout);
    if (parsed.error) throw new Error(`Native file selection failed (${String(parsed.error).replace(/[^a-z_]/g, '').slice(0, 60)}). Inspect the dialog before retrying.`);
    return parseAccessibility(parsed);
  }

  async launch(applicationId: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId)) throw new Error('Invalid application identifier.');
    await runNative('/usr/bin/open', ['-b', applicationId]);
  }

  async snapshot(scope?: { windowId?: string }): Promise<ComputerSnapshot> {
    if (process.platform !== 'darwin') return this.unavailable();
    const target = scope?.windowId?.match(/^([1-9]\d*):cg:([1-9]\d*)$/);
    if (scope?.windowId && !target) throw new Error('Invalid macOS window reference. Inspect again.');
    const result = await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_SNAPSHOT_SCRIPT, ...(target ? ['--', target[1]] : [])], {
      allowFailure: true, input: JSON.stringify(target ? [target[1]] : []), structuredOutput: true,
      persistent: { script: MAC_SNAPSHOT_SESSION_SCRIPT, scope: 'mac-snapshot:' + (target?.[1] ?? 'all') },
    });
    const parsed = parseJson<{ displays: ComputerSnapshot['displays']; windows: ComputerSnapshot['windows']; accessibility: boolean } | null>(result.stdout, null);
    const accessibility = parsed?.accessibility === true ? 'granted' as const : 'denied' as const;
    const windows = Array.isArray(parsed?.windows) ? parsed.windows : [];
    const displays = Array.isArray(parsed?.displays) ? parsed.displays : [];
    const failed = result.code !== 0 || !parsed || !Array.isArray(parsed.windows) || !Array.isArray(parsed.displays);
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
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.count) || point.count < 1 || point.count > 3) throw new Error('Invalid mouse input.');
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_CLICK_SCRIPT, '--', String(point.x), String(point.y), String(point.count)]);
  }

  async type(text: string): Promise<void> {
    await this.typeSensitive(text);
  }

  async typeSensitive(text: string): Promise<void> {
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_TYPE_SCRIPT], { input: text });
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

  async screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: { evidencePath: string; passive?: boolean }): Promise<{ width: number | null; height: number | null }> {
    await mkdir(dirname(context.evidencePath), { recursive: true });
    const args = ['-x', '-t', 'png'];
    if (input.target === 'display') {
      if (!input.targetId || !/^\d+$/.test(input.targetId)) throw new Error('A valid macOS display is required.');
      args.push('-D', input.targetId);
    } else if (input.target === 'window') {
      if (!input.targetId) throw new Error('A target window is required.');
      const snapshot = await this.snapshot({ windowId: input.targetId });
      const window = snapshot.windows.find((candidate) => candidate.id === input.targetId);
      if (!window?.bounds) throw new Error('The target window or its bounds are unavailable.');
      if (!context.passive && !window.focused) {
        await this.focus(window.id);
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      const refreshed = (await this.snapshot({ windowId: window.id })).windows.find((candidate) => candidate.id === window.id);
      if (!refreshed?.bounds || refreshed.appId !== window.appId || (!context.passive && !refreshed.focused)) throw new Error('Target window lost focus or bounds before capture.');
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
