import { access, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ComputerAdapter } from './types.js';
import type { ComputerCommandInput, ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { runNative } from './native-runner.js';

const DISPLAY_SCRIPT = `ObjC.import('AppKit'); function run(){return JSON.stringify($.NSScreen.screens.js.map((s,i)=>({id:String(i+1),name:String(s.localizedName.js),bounds:{x:Number(s.frame.origin.x),y:Number(s.frame.origin.y),width:Number(s.frame.size.width),height:Number(s.frame.size.height)},scaleFactor:Number(s.backingScaleFactor),primary:i===0})));}`;
const WINDOW_SCRIPT = `function run(){const se=Application('System Events');const ps=se.applicationProcesses.whose({visible:true})();return JSON.stringify(ps.slice(0,100).flatMap(p=>{const pid=Number(p.unixId());const appName=String(p.name());let appId=appName;try{appId=String(p.bundleIdentifier()||appName)}catch{}const focused=Boolean(p.frontmost());let windows=[];try{windows=p.windows()}catch{}return windows.slice(0,50).map((w,i)=>{let pos=[0,0],size=[1,1],title='';try{pos=w.position();size=w.size();title=String(w.name()||'')}catch{}return{id:pid+':'+i,appId,appName,title,bounds:{x:Number(pos[0]),y:Number(pos[1]),width:Math.max(1,Number(size[0])),height:Math.max(1,Number(size[1]))},focused:focused&&i===0}})}));}`;

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

  async snapshot(): Promise<ComputerSnapshot> {
    if (process.platform !== 'darwin') return this.unavailable();
    const displays = parseJson<ComputerSnapshot['displays']>((await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', DISPLAY_SCRIPT])).stdout, []);
    const accessibilityCheck = await runNative('/usr/bin/osascript', ['-e', 'tell application "System Events" to get UI elements enabled'], { allowFailure: true });
    const accessibility = accessibilityCheck.code === 0 && accessibilityCheck.stdout.trim() === 'true' ? 'granted' as const : 'denied' as const;
    const windows = accessibility === 'granted'
      ? parseJson<ComputerSnapshot['windows']>((await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WINDOW_SCRIPT], { allowFailure: true })).stdout, [])
      : [];
    return {
      platform: this.platform,
      available: true,
      reason: 'ready',
      detail: accessibility === 'granted' ? null : 'Accessibility permission is required for app and input control.',
      permissions: { accessibility, screenRecording: this.screenRecordingGranted ? 'granted' : 'unknown' },
      displays,
      windows,
      focusedWindowId: windows.find((window) => window.focused)?.id ?? null,
    };
  }

  async focus(windowId: string): Promise<void> {
    const [pidText, indexText] = windowId.split(':');
    const pid = Number(pidText); const index = Number(indexText);
    if (!Number.isInteger(pid) || !Number.isInteger(index)) throw new Error('Invalid macOS window reference.');
    const script = `function run(argv){const pid=Number(argv[0]),index=Number(argv[1]);const se=Application('System Events');const p=se.applicationProcesses.whose({unixId:pid})();if(!p.length)throw new Error('Application is no longer running.');p[0].frontmost=true;const ws=p[0].windows();if(ws[index])ws[index].actions.byName('AXRaise').perform();}`;
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', String(pid), String(index)]);
  }

  async click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }): Promise<void> {
    if (point.button !== 'left') throw new Error('macOS right and middle clicks are not available through the accessibility adapter.');
    const statements = Array.from({ length: point.count }, () => `click at {${point.x}, ${point.y}}`).join('\n');
    await runNative('/usr/bin/osascript', ['-e', `tell application "System Events"\n${statements}\nend tell`]);
  }

  async type(text: string): Promise<void> {
    const script = `function run(argv){Application('System Events').keystroke(argv[0]);}`;
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script, '--', text]);
  }

  async typeSensitive(text: string): Promise<void> {
    const script = `ObjC.import('Foundation');function run(){const data=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;const value=$.NSString.alloc.initWithDataEncoding(data,$.NSUTF8StringEncoding).js;Application('System Events').keystroke(value);}`;
    await runNative('/usr/bin/osascript', ['-l', 'JavaScript', '-e', script], { input: text });
  }

  async shortcut(keys: string[]): Promise<void> {
    const modifiers: Record<string, string> = { command: 'command down', cmd: 'command down', control: 'control down', ctrl: 'control down', option: 'option down', alt: 'option down', shift: 'shift down', fn: 'function down' };
    const normalized = keys.map((key) => key.toLowerCase());
    const main = normalized.find((key) => !modifiers[key]);
    if (!main) throw new Error('A non-modifier key is required.');
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
    let dimensions: { width: number | null; height: number | null } = { width: null, height: null };
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
      const { x, y, width, height } = window.bounds;
      args.push(`-R${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`);
      dimensions = { width: Math.round(width), height: Math.round(height) };
    }
    args.push(context.evidencePath);
    await runNative('/usr/sbin/screencapture', args, { timeoutMs: 30_000 });
    await access(context.evidencePath);
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
