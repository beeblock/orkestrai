import type { CuaDriverLike, WindowStateOutput } from '@trycua/cua-driver';
import type { ComputerHostRequest } from '../../../contracts/schemas/computer-host.schema.js';
import { computerHostImageSchema } from '../../../contracts/schemas/computer-host.schema.js';
import { cuaWindowTarget } from './cua-session.js';
import { NativeInteractionError } from './native-interaction-error.js';
import type { ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';

type Driver = Pick<CuaDriverLike, 'listApps' | 'listWindows' | 'getWindowState' | 'callTool'>;
type Action = Extract<ComputerHostRequest, { operation: 'launch' | 'focus' | 'type' | 'shortcut' | 'click' }>;

export function cuaImage(raw: WindowStateOutput, target: ReturnType<typeof cuaWindowTarget>) {
  if (raw.pid !== target.pid || raw.windowId !== target.windowId || raw.degraded || raw.screenshotFrameValid === false || raw.images.length !== 1 || raw.images[0].mimeType !== 'image/png') {
    throw new NativeInteractionError('The exact native capture is unavailable.', false);
  }
  return computerHostImageSchema.parse({ base64: raw.images[0].dataBase64, width: raw.screenshotWidth, height: raw.screenshotHeight });
}

async function verifyWindow(driver: Driver, targetId: string, appId?: string) {
  const target = cuaWindowTarget(targetId);
  const apps = await driver.listApps({});
  if (apps.apps.filter(app => app.pid === target.pid && app.running && (!appId || app.bundleId === appId)).length !== 1) throw new NativeInteractionError('The target application changed. No input was attempted.', false);
  const windows = await driver.listWindows({ pid: target.pid });
  const matches = windows.windows.filter(window => window.pid === target.pid && window.windowId === target.windowId);
  if (matches.length !== 1) throw new NativeInteractionError('The exact target window is unavailable. No input was attempted.', false);
  return { target, window: matches[0] };
}

export async function executeCuaAction(driver: Driver, input: Action, displays: ComputerSnapshot['displays'] = []) {
  let tool: string, args: Record<string, unknown>;
  if (input.operation === 'launch') {
    tool = 'launch_app'; args = { bundle_id: input.appId };
  } else if (input.operation === 'focus') {
    const { target } = await verifyWindow(driver, input.targetId);
    tool = 'bring_to_front'; args = { pid: target.pid, window_id: Number(target.windowId) };
  } else {
    const bound = input.binding ? await verifyWindow(driver, input.binding.targetId, input.binding.appId) : null;
    args = bound ? { pid: bound.target.pid, window_id: Number(bound.target.windowId), delivery_mode: 'foreground' } : { scope: 'desktop' };
    if (input.operation === 'type') { tool = 'type_text'; args.text = input.text; args.delay_ms = 0; }
    else if (input.operation === 'shortcut') {
      tool = input.keys.length === 1 ? 'press_key' : 'hotkey';
      args[input.keys.length === 1 ? 'key' : 'keys'] = input.keys.length === 1 ? input.keys[0] : input.keys;
    } else {
      tool = 'click'; args.button = input.button; args.count = input.count;
      if (bound) {
        // Cua pixels refer to its actual image, not Electron CSS points. Refresh
        // that coordinate frame rather than assuming a Retina scale of two.
        const raw = await driver.getWindowState({ ...bound.target, includeScreenshot: true, includeAccessibilityTree: false });
        const image = cuaImage(raw, bound.target), bounds = raw.windowBounds;
        if (!bounds || bounds.width <= 0 || bounds.height <= 0 || input.x < bounds.x || input.y < bounds.y || input.x >= bounds.x + bounds.width || input.y >= bounds.y + bounds.height) throw new NativeInteractionError('The click moved outside its window. No input was attempted.', false);
        args.x = (input.x - bounds.x) * image.width / bounds.width;
        args.y = (input.y - bounds.y) * image.height / bounds.height;
      } else {
        const primary = displays.filter(display => display.primary);
        if (primary.length !== 1) throw new NativeInteractionError('The primary display is unavailable. No input was attempted.', false);
        const bounds = primary[0].bounds;
        if (input.x < bounds.x || input.y < bounds.y || input.x >= bounds.x + bounds.width || input.y >= bounds.y + bounds.height) throw new NativeInteractionError('Choose a target window for input outside the primary display.', false);
        const screen = await driver.callTool('get_screen_size', '{}');
        let geometry;
        try { geometry = JSON.parse(screen.structuredJson ?? '{}'); } catch { /* Invalid geometry is rejected below. */ }
        const width = geometry?.width, height = geometry?.height, scale = geometry?.scale_factor;
        if (screen.isError || screen.degraded || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || width > 32768 || height > 32768 || !Number.isFinite(scale) || scale < 0.25 || scale > 8 || Math.abs(width / scale - bounds.width) > 1 || Math.abs(height / scale - bounds.height) > 1) throw new NativeInteractionError('The native display coordinate frame could not be confirmed. No input was attempted.', false);
        args.target = { kind: 'desktop', display_id: 'primary' };
        args.x = (input.x - bounds.x) * scale;
        args.y = (input.y - bounds.y) * scale;
      }
    }
  }
  let result;
  try { result = await driver.callTool(tool, JSON.stringify(args)); }
  catch { throw new NativeInteractionError('The native action is unconfirmed. Inspect before retrying.', true); }
  if (result.isError || result.degraded || result.action && ![0, 2].includes(result.action.effect)) throw new NativeInteractionError('The native action is unconfirmed. Inspect before retrying.', true);
  // Native dispatch is not a remote delivery or application-level receipt.
  return { dispatched: true };
}
