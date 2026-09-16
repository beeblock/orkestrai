import type { CuaDriverLike, WindowStateOutput } from '@trycua/cua-driver';
import type { ComputerAccessibility, ComputerInteraction } from '../../../contracts/schemas/computer.schema.js';
import { parseAccessibility } from './accessibility.js';
import { NativeInteractionError } from './native-interaction-error.js';
import { openNativeConversation } from './conversation-navigation.js';
import type { ConversationIdentity } from './reply-scope.js';

type Driver = Pick<CuaDriverLike, 'listApps' | 'listWindows' | 'getWindowState' | 'callTool'>;
type Selector = ComputerInteraction['element'];
type Binding = { token: string; index: bigint; inWebContent: boolean };
type Observation = { tree: ComputerAccessibility; bindings: Map<string, Binding> };
export type CuaClipboardText = <T>(text: string, deliver: () => Promise<T>) => Promise<{ used: boolean; result?: T }>;
export type CuaStructureReader = (targetId: string, appId: string) => Promise<ComputerAccessibility>;

export function cuaWindowTarget(id: string) {
  const match = /^([1-9]\d{0,9}):cg:([1-9]\d{0,9})$/.exec(id);
  if (!match) throw new NativeInteractionError('Invalid exact native window identity.', false);
  const pid = Number(match[1]), windowId = BigInt(match[2]);
  if (pid > 0xffffffff || windowId > 0xffffffffn) throw new NativeInteractionError('Native window identity is outside the macOS range.', false);
  return { pid, windowId };
}

// Keep the native hierarchy, with a separate namespace from legacy AX paths.
// An existing recipient grant cannot accidentally authorize a new driver index.
export function cuaObservation(raw: WindowStateOutput, target: ReturnType<typeof cuaWindowTarget>): Observation {
  if (raw.pid !== target.pid || raw.windowId !== target.windowId || raw.degraded) throw new NativeInteractionError('The driver could not prove the exact requested window.', false);
  if (!raw.elements || raw.elements.length > 500) throw new NativeInteractionError('The native element tree is unavailable or too large.', false);
  const byIndex = new Map(raw.elements.map(element => [element.elementIndex, element]));
  if (byIndex.size !== raw.elements.length) throw new NativeInteractionError('Ambiguous native element indices.', false);
  const paths = new Map<bigint, string>();
  const pathFor = (index: bigint, visiting = new Set<bigint>()): string => {
    if (paths.has(index)) return paths.get(index)!;
    const element = byIndex.get(index);
    if (!element || index < 0n || index > 9998n || visiting.has(index) || visiting.size > 21) throw new NativeInteractionError('Invalid native element hierarchy.', false);
    visiting.add(index);
    const parent = element.parentIndex;
    const path = (parent === undefined ? '0.9999' : pathFor(parent, visiting)) + '.' + String(index + 1n);
    paths.set(index, path);
    return path;
  };
  const bindings = new Map<string, Binding>();
  const tokens = new Set<string>();
  const elements = raw.elements.map(element => {
    const id = pathFor(element.elementIndex);
    const protectedField = /secure|password/i.test(element.role);
    const token = element.elementToken;
    if (token) {
      if (token.length > 512 || tokens.has(token)) throw new NativeInteractionError('Ambiguous native element token.', false);
      tokens.add(token);
      if (!protectedField) bindings.set(id, { token, index: element.elementIndex, inWebContent: element.inWebContent === true });
    }
    const actions: ('press' | 'fill')[] = [];
    if (token && !protectedField) {
      if (element.actions?.some(action => ['AXPress', 'press', 'AXConfirm'].includes(action))) actions.push('press');
      if (['AXTextField', 'AXTextArea', 'AXComboBox'].includes(element.role)) actions.push('fill');
    }
    return { id, role: element.role, name: protectedField ? '' : element.label ?? '', value: protectedField ? '' : element.value ?? '',
      protected: protectedField, enabled: element.enabled !== false, focused: false, actions };
  });
  const tree = parseAccessibility({ available: true, truncated: raw.truncated === true || raw.elementsComplete === false, elements });
  return { tree, bindings };
}

function match(tree: ComputerAccessibility, selector: Selector) {
  const candidates = tree.elements.filter(element => element.id === selector.id && element.role === selector.role && element.name === selector.name && (selector.value === undefined || element.value === selector.value));
  if (candidates.length !== 1 || candidates[0].protected) throw new NativeInteractionError('The native control or recipient changed. No input was attempted.', false, 'control_changed');
  return candidates[0];
}

function confirmedDraft(tree: ComputerAccessibility, control: ComputerAccessibility['elements'][number], text: string) {
  // Chat apps insert Send beside the editor after typing, shifting sibling IDs.
  // Keep the original parent, semantic identity and unique complete draft bound.
  const parent = control.id.slice(0, control.id.lastIndexOf('.') + 1);
  const fields = tree.elements.filter(element => element.id.startsWith(parent)
    && element.id.slice(parent.length).indexOf('.') === -1
    && element.role === control.role && element.name === control.name);
  return fields.length === 1 && !fields[0].protected && fields[0].enabled && fields[0].value === text;
}

/** Cua's macOS elements are an actionable projection, not a complete AX tree. */
export function bindCuaStructure(raw: WindowStateOutput, target: ReturnType<typeof cuaWindowTarget>, structure: ComputerAccessibility): Observation {
  const projected = cuaObservation(raw, target);
  const tree = parseAccessibility(structure);
  if (!tree.available || tree.truncated || raw.truncated) throw new NativeInteractionError('A complete native conversation observation is required. No input was attempted.', false, 'observation_incomplete');
  const bindings = new Map<string, Binding>();
  for (const element of tree.elements) {
    if (element.protected || !element.enabled) continue;
    const same = (candidate: typeof element) => !candidate.protected && candidate.enabled && candidate.role === element.role && candidate.name === element.name && candidate.value === element.value;
    const source = tree.elements.filter(same), destinations = projected.tree.elements.filter(same);
    // Never infer a target from projected indices, order, absence or coordinates.
    if (source.length !== 1 || destinations.length !== 1) continue;
    const binding = projected.bindings.get(destinations[0].id);
    if (binding) bindings.set(element.id, binding);
  }
  return { tree, bindings };
}

/** Native engine supplied by the official Cua SDK; policy remains in ComputerService. */
export class CuaComputerSession {
  private active = false;
  constructor(private readonly driver: Driver, private readonly clipboardText?: CuaClipboardText, private readonly structureReader?: CuaStructureReader) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    // Snapshot tokens belong to one transport. Never let another read invalidate
    // them between guard validation and a native action, or queue stale sends.
    if (this.active) throw new NativeInteractionError('The native driver is busy. No input was attempted.', false);
    this.active = true;
    try { return await operation(); }
    catch (error) {
      if (error instanceof NativeInteractionError) throw error;
      throw new NativeInteractionError('The native observation is unavailable. No input was attempted.', false);
    } finally { this.active = false; }
  }

  private async inspect(targetId: string, appId: string) {
    const target = cuaWindowTarget(targetId);
    const apps = await this.driver.listApps({});
    const matching = apps.apps.filter(app => app.pid === target.pid && app.running && app.bundleId === appId);
    if (matching.length !== 1) throw new NativeInteractionError('The authorized native application changed. No input was attempted.', false);
    const windows = await this.driver.listWindows({ pid: target.pid });
    if (windows.windows.filter(window => window.pid === target.pid && window.windowId === target.windowId).length !== 1) throw new NativeInteractionError('The authorized native window changed. No input was attempted.', false);
    const structure = this.structureReader ? await this.structureReader(targetId, appId) : undefined;
    const raw = await this.driver.getWindowState({ ...target, includeScreenshot: false, includeAccessibilityTree: true, maxElements: 500, maxDepth: 22 });
    return { ...(structure ? bindCuaStructure(raw, target, structure) : cuaObservation(raw, target)), target };
  }

  private async after(target: ReturnType<typeof cuaWindowTarget>, appId: string): Promise<ComputerAccessibility> {
    if (this.structureReader) return parseAccessibility(await this.structureReader(`${target.pid}:cg:${target.windowId}`, appId));
    return cuaObservation(await this.driver.getWindowState({ ...target, includeScreenshot: false, includeAccessibilityTree: true, maxElements: 500, maxDepth: 22 }), target).tree;
  }

  read(targetId: string, appId: string): Promise<ComputerAccessibility> {
    return this.exclusive(async () => this.structureReader
      ? parseAccessibility(await this.structureReader(targetId, appId))
      : (await this.inspect(targetId, appId)).tree);
  }

  openConversation(targetId: string, appId: string, identity: ConversationIdentity): Promise<ComputerAccessibility> {
    return this.exclusive(async () => {
      const act = async (selector: Selector, query?: string) => {
        const { tree, bindings, target } = await this.inspect(targetId, appId);
        const control = match(tree, selector), binding = bindings.get(control.id);
        if (!tree.available || tree.truncated || !binding || !control.enabled || control.protected
          || (query === undefined ? !control.actions.includes('press') : !control.focused)) {
          throw new NativeInteractionError('The verified native navigation control changed. No input was attempted.', false, 'control_changed');
        }
        const args = { pid: target.pid, window_id: Number(target.windowId), element_token: binding.token, delivery_mode: 'foreground',
          ...(query === undefined ? { action: 'press', button: 'left' } : { text: query, delay_ms: 0 }) };
        const result = await this.driver.callTool(query === undefined ? 'click' : 'type_text', JSON.stringify(args));
        if (result.isError || result.degraded || !result.action || ![0, 2].includes(result.action.effect)) throw new NativeInteractionError('Native conversation navigation was not confirmed. No message was sent.', true, 'effect_unconfirmed');
      };
      return openNativeConversation(identity, {
        read: () => this.after(cuaWindowTarget(targetId), appId),
        press: control => act(control), search: (control, query) => act(control, query),
      });
    });
  }

  interact(input: ComputerInteraction, appId: string, options: { background: boolean }): Promise<ComputerAccessibility> {
    return this.exclusive(async () => {
      const { tree, bindings, target } = await this.inspect(input.targetId, appId);
      if (tree.truncated || !input.guards.length) throw new NativeInteractionError('Complete recipient guards are required. No input was attempted.', false, 'observation_incomplete');
      for (const guard of input.guards) {
        match(tree, guard);
        if (this.structureReader && !bindings.has(guard.id)) throw new NativeInteractionError('The current native recipient guard could not be bound to the driver. No input was attempted.', false, 'guard_unbound');
      }
      const control = match(tree, input.element);
      const binding = bindings.get(control.id);
      if (!binding || !control.enabled || !control.actions.includes(input.action)) throw new NativeInteractionError('The requested native action is unavailable. No input was attempted.', false, 'control_unavailable');
      const args: Record<string, unknown> = { pid: target.pid, window_id: Number(target.windowId), element_token: binding.token,
        delivery_mode: options.background ? 'background' : 'foreground' };
      if (input.action === 'fill') {
        // Append only to a verified prefix. No Select All, clipboard overwrite,
        // AXValue substitution or implicit Enter that could publish a draft.
        if (input.element.value === undefined || typeof input.text !== 'string' || !input.text.startsWith(control.value) || input.text.length > 20_000 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(input.text)) throw new NativeInteractionError('Only bounded text extending the verified draft is supported by this route.', false);
        args.text = input.text.slice(control.value.length);
        args.delay_ms = 0;
        if (!args.text) return tree;
        // Single-line replies use the SDK's verified text transport. A native
        // modifier chord may insert a literal "v" instead of pasting on macOS.
        // Reserve paste for newlines, which must never become Return events.
        if (!options.background && !binding.inWebContent && this.clipboardText && input.text.includes('\n')) {
          let pasted;
          try {
            pasted = await this.clipboardText(String(args.text), async () => {
              const result = await this.driver.callTool('hotkey', JSON.stringify({ pid: target.pid, window_id: Number(target.windowId), element_token: binding.token, delivery_mode: 'foreground', keys: ['cmd', 'v'] }));
              if (result.isError || result.degraded || !result.action || ![0, 2].includes(result.action.effect)) throw new NativeInteractionError('Native paste was not confirmed. Do not retry automatically.', true, 'effect_unconfirmed');
              const until = Date.now() + 2000;
              do {
                const after = await this.after(target, appId);
                if (!after.available || after.truncated) throw new NativeInteractionError('The pasted draft observation is incomplete.', true, 'result_unconfirmed');
                try { for (const guard of input.guards) match(after, guard); }
                catch { throw new NativeInteractionError('The recipient changed after composition. No Send was attempted.', true, 'recipient_changed'); }
                if (confirmedDraft(after, control, input.text!)) return after;
                await new Promise(resolve => setTimeout(resolve, 50));
              } while (Date.now() < until);
              throw new NativeInteractionError('The complete pasted draft could not be confirmed. No Send was attempted.', true, 'draft_unconfirmed');
            });
          } catch (error) {
            if (error instanceof NativeInteractionError) throw new NativeInteractionError(error.message, true, error.code);
            throw new NativeInteractionError('Native paste or clipboard restoration was interrupted. Do not retry automatically.', true, 'clipboard_interrupted');
          }
          if (pasted.used) {
            if (!pasted.result) throw new NativeInteractionError('Native paste returned no draft confirmation.', true, 'draft_unconfirmed');
            return pasted.result;
          }
        }
        // Newlines are inserted as plain clipboard text, never Return events.
        if (input.text.includes('\n')) throw new NativeInteractionError('Safe multiline insertion is unavailable without an authorized foreground paste.', false);
      } else { args.action = 'press'; args.button = 'left'; }
      let result;
      try { result = await this.driver.callTool(input.action === 'fill' ? 'type_text' : 'click', JSON.stringify(args)); }
      catch { throw new NativeInteractionError('The native driver did not confirm the action. Do not retry automatically.', true, 'delivery_interrupted'); }
      // A refused/no-op/unverifiable native result is not a completed action.
      // Never expose raw native errors (which may contain message or secret text).
      const accepted = input.action === 'fill' ? result.action?.effect === 0 : result.action?.effect === 0 || result.action?.effect === 2;
      // Generic presses normally have no driver-level postcondition. Return the
      // fresh tree to ComputerService, which checks the guarded Send outcome;
      // never interpret this as a message delivery receipt.
      if (result.isError || result.degraded || !accepted) throw new NativeInteractionError('The native action effect is unconfirmed. Inspect the target; no automatic retry.', true, 'effect_unconfirmed');
      let after: ComputerAccessibility;
      try {
        after = await this.after(target, appId);
        if (!after.available || after.truncated) throw new Error('Incomplete postcondition.');
      } catch { throw new NativeInteractionError('The action ran but its resulting native state is unconfirmed.', true, 'result_unconfirmed'); }
      if (input.action === 'fill') {
        try { for (const guard of input.guards) match(after, guard); }
        catch { throw new NativeInteractionError('The recipient changed after composition. No Send was attempted.', true, 'recipient_changed'); }
        if (!confirmedDraft(after, control, input.text!)) throw new NativeInteractionError('The complete draft could not be confirmed. Do not submit or retry automatically.', true, 'draft_unconfirmed');
      }
      return after;
    });
  }
}
