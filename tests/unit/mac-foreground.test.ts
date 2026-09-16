import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MAC_FOREGROUND_HANDLER } from '$lib/modules/agent-room/application/adapters/computers/mac-foreground.js';

function fixture() {
  const state = { front: 10, idle: 5, flags: 0, trusted: true, events: [] as string[] };
  const apps = new Map([10, 20, 30].map(pid => [pid, { launched: pid * 100, windowId: pid + 1 }]));
  const windows = [...apps.keys()].map(pid => ({ pid, id: pid + 1, x: pid * 10, y: 0, width: 500, height: 500 }));
  const native = windows.map(w => ({ kCGWindowOwnerPID: w.pid, kCGWindowNumber: w.id, kCGWindowBounds: { X: w.x, Y: w.y, Width: w.width, Height: w.height } }));
  const context = createContext({
    ObjC: { import() {}, bindFunction() {}, castRefToObject: (v: unknown) => v, deepUnwrap: (v: unknown) => v }, Ref: () => [], delay() {},
    $: Object.assign((v: unknown) => v, {
      AXIsProcessTrusted: () => state.trusted,
      NSRunLoop: { currentRunLoop: { runUntilDate() {} } }, NSDate: { dateWithTimeIntervalSinceNow: () => 0 },
      CGEventSourceSecondsSinceLastEventType: () => state.idle, CGEventSourceFlagsState: () => state.flags,
      NSWorkspace: { sharedWorkspace: { get frontmostApplication() { return { processIdentifier: state.front, isNil: () => false }; } } },
      NSRunningApplication: { runningApplicationWithProcessIdentifier: (pid: number) => ({
        isNil: () => !apps.has(pid), bundleIdentifier: { isNil: () => false, js: `test.${pid}` },
        launchDate: { isNil: () => false, timeIntervalSince1970: apps.get(pid)?.launched },
        activateWithOptions: () => { state.front = pid; state.events.push(`activate:${pid}`); return true; },
      }) },
      CGWindowListCopyWindowInfo: () => native,
      AXUIElementCreateApplication: (pid: number) => ({ pid }), AXUIElementSetMessagingTimeout() {},
      AXUIElementCopyAttributeValue: (el: { pid: number; id?: number }, key: string, out: unknown[]) => {
        if (key === 'AXFocusedWindow') out[0] = windows.find(w => w.id === apps.get(el.pid)?.windowId);
        else if (key === 'AXWindows') { const list = windows.filter(w => w.pid === el.pid); out[0] = { count: list.length, objectAtIndex: (i: number) => list[i] }; }
        else if (key === 'AXPosition') { const w = windows.find(w => w.id === el.id)!; out[0] = { x: w.x, y: w.y }; }
        else if (key === 'AXSize') { const w = windows.find(w => w.id === el.id)!; out[0] = { width: w.width, height: w.height }; }
        else throw new Error('Unexpected attribute read: ' + key);
        return 0;
      },
      AXUIElementPerformAction: (w: { pid: number; id: number }, key: string) => { expect(key).toBe('AXRaise'); apps.get(w.pid)!.windowId = w.id; state.events.push(`raise:${w.id}`); return 0; },
      NSMutableData: { dataWithLength: () => { const data = {}; return { bytes: data, mutableBytes: data }; } },
      AXValueGetValue: (value: object, _type: number, data: object) => { Object.assign(data, value); return true; },
      NSValue: { valueWithBytesObjCType: (bytes: object) => ({ pointValue: bytes, sizeValue: bytes }) },
    }),
  });
  runInContext(MAC_FOREGROUND_HANDLER, context);
  const request = (input: unknown) => JSON.parse(runInContext(`foregroundRequest(${JSON.stringify(input)})`, context));
  const acquire = () => request({ command: 'acquire', targetId: '20:cg:21', appId: 'test.20' });
  return { state, apps, native, acquire, restore: (receipt: unknown) => request({ command: 'restore', receipt }) };
}

describe('Owner-authorized macOS focus transaction', () => {
  it('restores the exact previous process and window without reading private content', () => {
    const f = fixture(), { receipt } = f.acquire();
    expect(receipt).toMatchObject({ changed: true, previous: { pid: 10, windowId: 11 }, target: { pid: 20, windowId: 21 } });
    expect(f.state.front).toBe(20);
    expect(f.restore(receipt)).toEqual({ state: 'restored' });
    expect(f.state.front).toBe(10);
    expect(f.state.events).toEqual(['raise:21', 'activate:20', 'raise:11', 'activate:10']);
  });

  it('does not activate again when the intended window already has focus', () => {
    const f = fixture(); f.state.front = 20;
    const { receipt } = f.acquire();
    expect(f.restore(receipt)).toEqual({ state: 'unchanged' });
    expect(f.state.events).toEqual([]);
  });

  it('never restores over a new app chosen by the user', () => {
    const f = fixture(), { receipt } = f.acquire(); f.state.front = 30;
    expect(f.restore(receipt)).toEqual({ state: 'skipped' });
    expect(f.state.front).toBe(30);
    expect(f.state.events).toHaveLength(2);
  });

  it.each([10, 20])('refuses restoration when PID %i was reused', (pid) => {
    const f = fixture(), { receipt } = f.acquire(); f.apps.get(pid)!.launched++;
    expect(f.restore(receipt)).toEqual({ state: 'skipped' });
    expect(f.state.events).toHaveLength(2);
  });

  it.each(['typing', 'modifiers', 'permission', 'window'])('performs no activation when %s makes preflight unsafe', (reason) => {
    const f = fixture();
    if (reason === 'typing') f.state.idle = 0.1;
    if (reason === 'modifiers') f.state.flags = 0x100000;
    if (reason === 'permission') f.state.trusted = false;
    if (reason === 'window') f.native.splice(1, 1);
    expect(f.acquire().error).toBeDefined();
    expect(f.state.events).toEqual([]);
  });

  it('does not restore into another window when the previous one closed', () => {
    const f = fixture(), { receipt } = f.acquire(); f.native.splice(0, 1);
    expect(f.restore(receipt)).toEqual({ state: 'failed' });
    expect(f.state.events).toHaveLength(2);
  });
});
