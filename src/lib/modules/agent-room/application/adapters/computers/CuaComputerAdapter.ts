import { writeFile } from 'node:fs/promises';
import { computerHostImageSchema } from '../../../contracts/schemas/computer-host.schema.js';
import { computerSnapshotSchema, type ComputerCommandInput, type ComputerInteraction } from '../../../contracts/schemas/computer.schema.js';
import { executeDesktopComputer } from '../../../infrastructure/computers/DesktopComputerClient.js';
import { parseAccessibility } from './accessibility.js';
import type { ComputerAdapter, ComputerAdapterContext, ComputerInputTarget } from './types.js';
import { MacComputerAdapter } from './MacComputerAdapter.js';
import { nativeFileControl } from './native-file-controls.js';
import type { ConversationIdentity } from './reply-scope.js';

/** The native SDK runs under Orkestrai's Electron identity via private IPC. */
export class CuaComputerAdapter implements ComputerAdapter {
  readonly platform = 'macos' as const;
  readonly backgroundWindowCapture = true;
  readonly backgroundInteraction = true;
  readonly scopedForegroundInteraction = true;
  constructor(private readonly execute = executeDesktopComputer, private readonly files = new MacComputerAdapter()) {}

  async snapshot(scope?: { windowId?: string }) {
    return computerSnapshotSchema.parse(await this.execute({ operation: 'snapshot', targetId: scope?.windowId }));
  }
  async read(targetId: string, appId: string) {
    return parseAccessibility(await this.execute({ operation: 'read', targetId, appId }));
  }
  async openConversation(targetId: string, appId: string, identity: ConversationIdentity) {
    return parseAccessibility(await this.execute({ operation: 'open_conversation', targetId, appId, identity }));
  }
  async interact(input: ComputerInteraction, appId: string, options = { background: true }) {
    return parseAccessibility(await this.execute({ operation: 'interact', input, appId, background: options.background }));
  }
  async launch(appId: string) { await this.execute({ operation: 'launch', appId }); }
  async focus(targetId: string) { await this.execute({ operation: 'focus', targetId }); }
  async type(text: string, binding?: ComputerInputTarget) { await this.execute({ operation: 'type', text, binding }); }
  async typeSensitive(text: string, binding?: ComputerInputTarget) { await this.type(text, binding); }
  async shortcut(keys: string[], binding?: ComputerInputTarget) { await this.execute({ operation: 'shortcut', keys, binding }); }
  async click(point: { x: number; y: number; button: 'left' | 'right' | 'middle'; count: number }, binding?: ComputerInputTarget) {
    await this.execute({ operation: 'click', x: point.x, y: point.y, button: point.button, count: point.count, binding });
  }
  async screenshot(input: Extract<ComputerCommandInput, { command: 'screenshot' }>, context: ComputerAdapterContext) {
    const image = computerHostImageSchema.parse(await this.execute({ operation: 'capture', target: input.target, targetId: input.targetId }));
    const bytes = Buffer.from(image.base64, 'base64');
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== image.width || bytes.readUInt32BE(20) !== image.height) throw new Error('The native capture is invalid.');
    // EvidenceService owns confinement and retention. Main never receives a path.
    await writeFile(context.evidencePath, bytes, { mode: 0o600, flag: 'wx' });
    return { width: image.width, height: image.height };
  }
  async openSettings(permission: 'accessibility' | 'screenRecording') { await this.execute({ operation: 'settings', permission }); }

  private async fileControls(input: Parameters<NonNullable<ComputerAdapter['attachFile']>>[0]) {
    // The SDK does not expose the selected NSOpenPanel URL. Retain the existing
    // specialized file-picker verifier, not an input fallback after Cua fails.
    const source = await this.read(input.targetId, input.appId);
    const target = await this.files.read(input.targetId, input.appId);
    const select = (control: ComputerInteraction['element']) => nativeFileControl(control, source, target);
    // A menu may not exist until Open is pressed. The picker verifier resolves
    // its exact approved role/name uniquely after the popover appears.
    return { ...input, open: select(input.open), guards: input.guards.map(select) };
  }
  async attachFile(input: Parameters<NonNullable<ComputerAdapter['attachFile']>>[0]) {
    const selection = await this.files.attachFile(await this.fileControls(input));
    const tree = await this.read(input.targetId, input.appId);
    return { ...tree, ...(selection.selectedFile ? { selectedFile: selection.selectedFile } : {}) };
  }
  async receiveFile(input: Parameters<NonNullable<ComputerAdapter['receiveFile']>>[0]) {
    await this.files.receiveFile(await this.fileControls(input));
    return this.read(input.targetId, input.appId);
  }
}
