import type {
  ComputerBounds,
  ComputerCommandInput,
  ComputerPlatform,
  ComputerSnapshot,
  ComputerAccessibility,
  ComputerInteraction,
} from '../../../contracts/schemas/computer.schema.js';
import type { ConversationIdentity } from './reply-scope.js';

export type ComputerAdapterContext = {
  evidencePath: string;
  passive?: boolean;
};

// Native-only receipt: emitted after the OS picker confirms the canonical URL.
// It is never accepted from a bridge request or a persisted accessibility tree.
export type ComputerFileSelection = ComputerAccessibility & {
  selectedFile?: { path: string; targetId: string; applicationId: string };
};

export type ComputerForegroundLease = {
  restore(): Promise<'restored' | 'unchanged' | 'skipped' | 'failed'>;
};

export type ComputerInputTarget = { targetId: string; appId: string };

export interface ComputerAdapter {
  readonly platform: ComputerPlatform;
  // True only for window-isolated capture, never for copying a desktop rectangle.
  readonly backgroundWindowCapture?: boolean;
  // Semantic controls only. Never permits global keyboard, coordinates or file dialogs.
  readonly backgroundInteraction?: boolean;
  // Official driver owns temporary focus/restoration per exact-window action.
  readonly scopedForegroundInteraction?: boolean;
  acquireForeground?(windowId: string, appId: string): Promise<ComputerForegroundLease>;
  snapshot(scope?: { windowId?: string }): Promise<ComputerSnapshot>;
  // Read the bound native window without activating it, even when another app has focus.
  read?(windowId: string, appId: string): Promise<ComputerAccessibility>;
  openConversation?(windowId: string, appId: string, identity: ConversationIdentity): Promise<ComputerAccessibility>;
  interact?(input: ComputerInteraction, appId: string, options?: { background: boolean }): Promise<ComputerAccessibility>;
  attachFile?(input: { targetId: string; appId: string; path: string; open: ComputerInteraction['element']; menu?: ComputerInteraction['element']; guards: ComputerInteraction['guards'] }): Promise<ComputerFileSelection>;
  receiveFile?(input: { targetId: string; appId: string; path: string; open: ComputerInteraction['element']; menu?: ComputerInteraction['element']; guards: ComputerInteraction['guards'] }): Promise<ComputerAccessibility>;
  launch(applicationId: string): Promise<void>;
  focus(windowId: string): Promise<void>;
  click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }, target?: ComputerInputTarget): Promise<void>;
  type(text: string, target?: ComputerInputTarget): Promise<void>;
  typeSensitive(text: string, target?: ComputerInputTarget): Promise<void>;
  shortcut(keys: string[], target?: ComputerInputTarget): Promise<void>;
  screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: ComputerAdapterContext): Promise<{ width: number | null; height: number | null }>;
  openSettings(permission: 'accessibility' | 'screenRecording'): Promise<void>;
}

export function resolveComputerPoint(
  input: Extract<ComputerCommandInput, { command: 'click' }>,
  snapshot: ComputerSnapshot,
): { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number; bounds: ComputerBounds } {
  let bounds: ComputerBounds;
  if (input.space === 'display') {
    const display = snapshot.displays.find((candidate) => candidate.id === input.targetId);
    if (!display) throw new Error('The target display is unavailable.');
    bounds = display.bounds;
  } else if (input.space === 'window') {
    const window = snapshot.windows.find((candidate) => candidate.id === input.targetId);
    if (!window?.bounds) throw new Error('The target window or its bounds are unavailable.');
    bounds = window.bounds;
  } else {
    const minX = Math.min(...snapshot.displays.map((display) => display.bounds.x));
    const minY = Math.min(...snapshot.displays.map((display) => display.bounds.y));
    const maxX = Math.max(...snapshot.displays.map((display) => display.bounds.x + display.bounds.width));
    const maxY = Math.max(...snapshot.displays.map((display) => display.bounds.y + display.bounds.height));
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) throw new Error('No display geometry is available.');
    bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  const relativeCoordinates = input.space !== 'screen';
  const x = relativeCoordinates ? bounds.x + input.x * bounds.width : input.x;
  const y = relativeCoordinates ? bounds.y + input.y * bounds.height : input.y;
  if (x < bounds.x || y < bounds.y || x > bounds.x + bounds.width || y > bounds.y + bounds.height) {
    throw new Error('Click coordinates are outside the selected scope.');
  }
  return { x: Math.round(x), y: Math.round(y), button: input.button, count: input.count, bounds };
}
