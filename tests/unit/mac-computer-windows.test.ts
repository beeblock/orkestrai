import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { MAC_FOCUS_SCRIPT, MAC_WINDOW_SCRIPT, MAC_SNAPSHOT_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/MacComputerAdapter.js';
import { MAC_ACCESSIBILITY_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/mac-accessibility.js';

function desktop() {
  let order = ['A', 'B'];
  let focused = true;
  const events: string[] = [];
  const applicationQueries: string[] = [];
  const entries = [
    { kCGWindowNumber: 101, kCGWindowOwnerPID: 42, kCGWindowLayer: 0, kCGWindowBounds: { X: 10, Y: 20, Width: 600, Height: 400 } },
    { kCGWindowNumber: 102, kCGWindowOwnerPID: 42, kCGWindowLayer: 0, kCGWindowBounds: { X: 100, Y: 200, Width: 600, Height: 400 } },
  ];
  const positions: Record<string, number[]> = { A: [10, 20], B: [100, 200] };
  const app = new Proxy({
    unixId: () => 42, name: () => 'Browser', bundleIdentifier: () => 'example.browser',
    windows: () => order.map((name) => ({
      name: () => name, position: () => positions[name], size: () => [600, 400],
      actions: { byName: () => ({ perform: () => { events.push(`raise:${name}`); order = [name, ...order.filter((item) => item !== name)]; } }) },
    })),
    frontmost: () => focused,
  }, {
    set: (_target, key, value) => { if (key !== 'frontmost') throw new Error('Unexpected mutation'); focused = Boolean(value); events.push('activate'); return true; },
  });
  const context = {
    ObjC: { import: () => {}, bindFunction: () => {}, castRefToObject: (value: unknown) => value, deepUnwrap: (value: unknown) => value },
    Ref: () => [],
    $: Object.assign((value: unknown) => value, {
      CGWindowListCopyWindowInfo: () => entries,
      NSRunningApplication: { runningApplicationWithProcessIdentifier: (pid: number) => ({ isNil: () => pid !== 42, bundleIdentifier: { isNil: () => false, js: 'example.browser' }, localizedName: { js: 'Browser' } }) },
      NSWorkspace: { sharedWorkspace: { get frontmostApplication() { return { processIdentifier: focused ? 42 : 99 }; } } },
      AXUIElementCreateApplication: () => 'root', AXUIElementSetMessagingTimeout: () => {}, CFEqual: (a: unknown, b: unknown) => a === b,
      AXUIElementCopyAttributeValue: (element: string, name: string, out: unknown[]) => {
        if (element === 'root' && name === 'AXWindows') out[0] = { count: order.length, objectAtIndex: (i: number) => order[i] };
        else if (element === 'root' && name === 'AXFocusedWindow') out[0] = order[0];
        else if (name === 'AXPosition') out[0] = { x: positions[element][0], y: positions[element][1] };
        else if (name === 'AXSize') out[0] = { width: 600, height: 400 };
        else if (name === 'AXTitle') out[0] = element;
        else return -1;
        return 0;
      },
      NSMutableData: { dataWithLength: () => { const data = {}; return { bytes: data, mutableBytes: data }; } },
      AXValueGetValue: (value: object, _type: number, data: object) => { Object.assign(data, value); return true; },
      NSValue: { valueWithBytesObjCType: (bytes: object) => ({ pointValue: bytes, sizeValue: bytes }) },
    }),
    Application: (name: string) => { applicationQueries.push(name); return { applicationProcesses: { whose: (filter: { unixId?: number }) => () => !filter.unixId || filter.unixId === 42 ? [app] : [] } }; },
  };
  const inspect = (pid?: number) => JSON.parse(runInNewContext(`${MAC_WINDOW_SCRIPT};run(${JSON.stringify(pid ? [String(pid)] : [])})`, context)) as { id: string; title: string; focused: boolean }[];
  const focus = (id: number) => runInNewContext(`${MAC_FOCUS_SCRIPT};run(['42','${id}'])`, context);
  return { entries, events, applicationQueries, positions, inspect, focus };
}

describe('macOS stable desktop window identity', () => {
  it.skipIf(process.platform !== 'darwin' || !process.env.ORKESTRAI_NATIVE_BACKGROUND_WINDOW)('reads an explicitly authorized real background window without activating it', () => {
    const targetId = process.env.ORKESTRAI_NATIVE_BACKGROUND_WINDOW!;
    const appId = process.env.ORKESTRAI_NATIVE_BACKGROUND_APP!;
    const recipientId = process.env.ORKESTRAI_NATIVE_BACKGROUND_RECIPIENT_ID!;
    const recipientName = process.env.ORKESTRAI_NATIVE_BACKGROUND_RECIPIENT_NAME!;
    expect(targetId).toMatch(/^[1-9]\d*:cg:[1-9]\d*$/);
    expect(appId).toMatch(/^[\w.-]+$/);
    expect(recipientId).toMatch(/^0(?:\.\d+)+$/);
    expect(recipientName.length).toBeGreaterThan(0);
    const inspect = () => JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_WINDOW_SCRIPT, '--', targetId.split(':')[0]], { encoding: 'utf8', timeout: 15000 })) as { id: string; focused: boolean }[];
    expect(inspect().find(w => w.id === targetId)?.focused).toBe(false);
    const started = performance.now();
    const tree = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_ACCESSIBILITY_SCRIPT], { input: JSON.stringify({ targetId, appId }), encoding: 'utf8', timeout: 5000 }));
    // Never print the tree or surrounding conversations, including on assertion failure.
    expect(tree.error).toBeUndefined();
    expect(tree.available).toBe(true);
    expect(tree.truncated).toBe(false);
    expect(tree.elements.some((e: { id: string; name: string }) => e.id === recipientId && e.name === recipientName)).toBe(true);
    expect(inspect().find(w => w.id === targetId)?.focused).toBe(false);
    process.stdout.write(JSON.stringify({ backgroundReadMs: Math.round(performance.now() - started), authorizedRecipientMatched: true, targetStayedInBackground: true }) + '\n');
  }, 35000);

  it('reports revoked caller accessibility without trusting the global UI scripting switch', () => {
    const appQueries: string[] = [];
    const result = JSON.parse(runInNewContext(`${MAC_SNAPSHOT_SCRIPT}; run([])`, {
      ObjC: { import: () => {}, bindFunction: () => {} },
      $: { NSScreen: { screens: { js: [] } }, AXIsProcessTrusted: () => false },
      Application: (name: string) => { appQueries.push(name); return { uiElementsEnabled: () => true }; },
    }));
    expect(result).toEqual({ displays: [], accessibility: false, windows: [] });
    expect(appQueries).toEqual([]);
  });
  it.skipIf(process.platform !== 'darwin' || !process.env.ORKESTRAI_NATIVE_BENCHMARK_PID)('measures a real full versus target-scoped inventory without posting desktop input', () => {
    const pid = process.env.ORKESTRAI_NATIVE_BENCHMARK_PID!;
    expect(pid).toMatch(/^[1-9]\d*$/);
    const observe = (target?: string) => {
      const start = performance.now();
      const windows = JSON.parse(execFileSync('/usr/bin/osascript', ['-l', 'JavaScript', '-e', MAC_WINDOW_SCRIPT, ...(target ? ['--', target] : [])], { encoding: 'utf8', timeout: 15000 }));
      return { windows, ms: Math.round(performance.now() - start) };
    };
    const full = observe();
    const scoped = observe(pid);
    expect(scoped.windows.length).toBeGreaterThan(0);
    expect(scoped.windows.every((window: { id: string }) => window.id.startsWith(pid + ':cg:'))).toBe(true);
    process.stdout.write(JSON.stringify({ fullInventoryMs: full.ms, scopedInventoryMs: scoped.ms, targetWindows: scoped.windows.length }) + '\n');
  }, 35000);

  it('scopes repeated action observations to the target process without retargeting another app', () => {
    const host = desktop();
    const scoped = host.inspect(42);
    expect(host.applicationQueries).toEqual([]);
    expect(host.inspect(99)).toEqual([]);
    expect(host.applicationQueries).toEqual([]);
    expect(scoped).toEqual(host.inspect());
    expect(host.applicationQueries).toEqual(['System Events']);
  });
  it('keeps CoreGraphics identities when raising another window changes its array index', () => {
    const host = desktop();
    expect(host.inspect()).toMatchObject([{ id: '42:cg:101', title: 'A' }, { id: '42:cg:102', title: 'B' }]);
    host.focus(102);
    expect(host.events).toEqual(['raise:B', 'activate']);
    expect(host.inspect()).toMatchObject([{ id: '42:cg:102', title: 'B', focused: true }, { id: '42:cg:101', title: 'A', focused: false }]);
    host.focus(101);
    expect(host.inspect()[0]).toMatchObject({ id: '42:cg:101', title: 'A', focused: true });
  });

  it('rejects a closed native window even if Accessibility still contains a stale entry', () => {
    const host = desktop();
    host.entries.splice(1, 1);
    expect(() => host.focus(102)).toThrow('no longer available');
    expect(host.events).toEqual([]);
    expect(host.inspect()).toHaveLength(1);
  });

  it('refuses ambiguous native-to-accessibility matches instead of targeting a guessed window', () => {
    const host = desktop();
    host.entries[1].kCGWindowBounds = { ...host.entries[0].kCGWindowBounds };
    host.positions.B = [...host.positions.A];
    expect(host.inspect()).toEqual([]);
    expect(() => host.focus(102)).toThrow('ambiguous');
    expect(host.events).toEqual([]);
  });
});
