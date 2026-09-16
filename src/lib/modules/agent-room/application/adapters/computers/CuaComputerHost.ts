import type { CuaDriverLike } from '@trycua/cua-driver';
import { computerHostMutation, computerHostRequestSchema, type ComputerHostRequest } from '../../../contracts/schemas/computer-host.schema.js';
import { computerSnapshotSchema, type ComputerSnapshot } from '../../../contracts/schemas/computer.schema.js';
import { CuaComputerSession, cuaWindowTarget, type CuaClipboardText, type CuaStructureReader } from './cua-session.js';
import { MacComputerAdapter } from './MacComputerAdapter.js';
import { NativeInteractionError, nativeFailureMessage } from './native-interaction-error.js';
import { cuaImage, executeCuaAction } from './cua-actions.js';

type Driver = Pick<CuaDriverLike, 'listApps' | 'listWindows' | 'getWindowState' | 'callTool' | 'shutdown'> & { uniffiDestroy?: () => void };
type Host = {
  permissions(): ComputerSnapshot['permissions'];
  displays(): ComputerSnapshot['displays'];
  captureDesktop?: (input: Extract<ComputerHostRequest, { operation: 'capture' }>) => Promise<unknown>;
  openSettings?: (permission: 'accessibility' | 'screenRecording') => Promise<void>;
  clipboardText?: CuaClipboardText;
  loadDriver?: () => Promise<Driver>;
  structureReader?: CuaStructureReader;
};

/** Loaded only by Electron main, never the renderer or adapter-node child. */
export class CuaComputerHost {
  private driverPromise: Promise<{ driver: Driver; session: CuaComputerSession }> | null = null;
  private current: Promise<unknown> | null = null;
  private stopping = false;
  private quarantined = false;
  private stopPromise: Promise<void> | null = null;
  private disposal: Promise<void> | null = null;
  private cancellation: AbortController | null = null;

  constructor(private readonly host: Host) {}

  get ready(): boolean { return !this.stopping && !this.quarantined && !this.current; }

  failureCode(error: unknown): string | undefined {
    return error instanceof NativeInteractionError && nativeFailureMessage(error.code) ? error.code : undefined;
  }

  private disposeRuntime(): Promise<void> {
    if (this.disposal) return this.disposal;
    const pending = this.driverPromise;
    this.disposal = (async () => {
      const runtime = await pending?.catch(() => null);
      if (runtime) {
        // SDK shutdown closes admission and waits for admitted native operations.
        // Never destroy or recreate a runtime before that acknowledgement.
        await runtime.driver.shutdown();
        runtime.driver.uniffiDestroy?.();
      }
      if (this.driverPromise === pending) this.driverPromise = null;
    })().finally(() => { this.disposal = null; });
    return this.disposal;
  }

  private runtime() {
    if (this.stopping) throw new NativeInteractionError('The embedded Computer runtime is stopping.', false);
    if (!this.driverPromise) {
      this.driverPromise = (async () => {
        // Native runtime has no reason to report usage outside this desktop.
        process.env.CUA_DRIVER_RS_TELEMETRY_ENABLED = '0';
        const driver: Driver = this.host.loadDriver
          ? await this.host.loadDriver()
          : (await import('@trycua/cua-driver')).CuaDriver.create(undefined);
        const options = () => {
          if (!this.cancellation) throw new NativeInteractionError('Native operation admission expired.', false);
          return { signal: this.cancellation.signal };
        };
        const guarded: Driver = {
          listApps: input => driver.listApps(input, options()),
          listWindows: input => driver.listWindows(input, options()),
          getWindowState: input => driver.getWindowState(input, options()),
          callTool: (name, args) => driver.callTool(name, args, options()),
          shutdown: () => driver.shutdown(), uniffiDestroy: () => driver.uniffiDestroy?.(),
        };
        // Preserve the existing bounded conversation hierarchy and selectors.
        // The SDK intentionally exports only actionable rows, with completeness
        // unknown on macOS. Input still goes exclusively through its fresh tokens.
        const nativeStructure = new MacComputerAdapter();
        const structure = this.host.structureReader ?? (this.host.loadDriver ? undefined : nativeStructure.read.bind(nativeStructure));
        return { driver: guarded, session: new CuaComputerSession(guarded, this.host.clipboardText, structure) };
      })().catch(() => {
        this.driverPromise = null;
        throw new NativeInteractionError('The embedded Computer runtime could not load.', false, 'runtime_load_failed');
      });
    }
    return this.driverPromise;
  }

  execute(raw: unknown): Promise<unknown> {
    if (!this.ready) return Promise.reject(new NativeInteractionError('The embedded Computer runtime is busy or stopping. No input was attempted.', false, 'runtime_busy'));
    const input = computerHostRequestSchema.parse(raw);
    const cancellation = new AbortController();
    this.cancellation = cancellation;
    const timer = setTimeout(() => cancellation.abort(), 20_000);
    timer.unref();
    const pending = this.executeUnchecked(input).then(result => {
      if (cancellation.signal.aborted) throw new NativeInteractionError('The native operation expired. Inspect before repeating an uncertain action.', computerHostMutation(input), 'runtime_expired');
      return result;
    });
    this.current = pending;
    return pending.finally(async () => {
      clearTimeout(timer);
      try {
        // Cancellation can leave native work settling after its JS promise.
        // New work waits for shutdown; a failed shutdown stays quarantined.
        if (cancellation.signal.aborted && !this.stopping) {
          this.quarantined = true;
          await this.disposeRuntime();
          this.quarantined = false;
        }
      } finally {
        if (this.current === pending) { this.current = null; this.cancellation = null; }
      }
    });
  }

  private async executeUnchecked(input: ComputerHostRequest) {
    if (input.operation === 'settings') {
      if (!this.host.openSettings) throw new NativeInteractionError('System settings are unavailable.', false);
      await this.host.openSettings(input.permission);
      return { opened: true };
    }
    const permissions = this.host.permissions();
    if (input.operation === 'snapshot' && permissions.accessibility !== 'granted') {
      return computerSnapshotSchema.parse({ platform: 'macos', available: true, reason: 'ready', detail: null,
        permissions, displays: this.host.displays(), windows: [], focusedWindowId: null });
    }
    if (permissions.accessibility !== 'granted') throw new NativeInteractionError('Orkestrai Accessibility permission is required. No input was attempted.', false, 'permission_accessibility');
    const { driver, session } = await this.runtime();
    if (input.operation === 'read') return session.read(input.targetId, input.appId);
    if (input.operation === 'open_conversation') return session.openConversation(input.targetId, input.appId, input.identity);
    if (input.operation === 'interact') return session.interact(input.input, input.appId, { background: input.background });
    if (input.operation === 'capture') {
      if (permissions.screenRecording !== 'granted') throw new NativeInteractionError('Orkestrai Screen Recording permission is required.', false, 'permission_screen_recording');
      if (input.target === 'window' && input.targetId) {
        const target = cuaWindowTarget(input.targetId);
        return cuaImage(await driver.getWindowState({ ...target, includeScreenshot: true, includeAccessibilityTree: false }), target);
      }
      if (!this.host.captureDesktop) throw new NativeInteractionError('Display capture is unavailable.', false);
      return this.host.captureDesktop(input);
    }
    if (input.operation !== 'snapshot') return executeCuaAction(driver, input, this.host.displays());
    const target = input.targetId ? cuaWindowTarget(input.targetId) : undefined;
    const { apps } = await driver.listApps({});
    const { windows } = await driver.listWindows(target ? { pid: target.pid } : {});
    // Never infer focus from arbitrary array order. Only an active app's unique
    // top layer-0 window with explicit z-order can be reported as focused.
    const activePids = new Set(apps.filter(app => app.running && app.active).map(app => app.pid));
    const focusCandidates = activePids.size === 1 ? windows.filter(window => window.pid !== undefined && activePids.has(window.pid) && window.isOnScreen && !window.minimized && (window.layer ?? 0) === 0 && window.zIndex !== undefined) : [];
    const highest = focusCandidates.reduce<bigint | undefined>((z, window) => z === undefined || window.zIndex! > z ? window.zIndex : z, undefined);
    const focused = focusCandidates.filter(window => window.zIndex === highest);
    const focusedId = focused.length === 1 ? `${focused[0].pid}:cg:${focused[0].windowId}` : null;
    const result = windows.slice(0, 500).flatMap(window => {
      if ((window.layer ?? 0) !== 0 || window.bounds.width <= 1 || window.bounds.height <= 1) return [];
      const owners = apps.filter(app => app.running && app.pid === window.pid && app.bundleId);
      if (owners.length !== 1 || window.windowId <= 0n || window.windowId > 0xffffffffn) return [];
      return [{ id: `${window.pid}:cg:${window.windowId}`, appId: owners[0].bundleId!, appName: owners[0].name.slice(0, 255),
        title: window.title.slice(0, 1000), bounds: window.bounds, focused: `${window.pid}:cg:${window.windowId}` === focusedId }];
    });
    return computerSnapshotSchema.parse({ platform: 'macos', available: true, reason: 'ready', detail: null,
      permissions, displays: this.host.displays(), windows: result, focusedWindowId: result.find(window => window.focused)?.id ?? null });
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.cancellation?.abort();
    this.stopPromise = (async () => {
      await this.current?.catch(() => undefined);
      await this.disposeRuntime();
    })();
    return this.stopPromise;
  }
}
