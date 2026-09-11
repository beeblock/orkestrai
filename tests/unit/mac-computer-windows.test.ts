import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { MAC_FOCUS_SCRIPT, MAC_WINDOW_SCRIPT } from '$lib/modules/agent-room/application/adapters/computers/MacComputerAdapter.js';

function desktop() {
  let order = ['A', 'B'];
  let focused = true;
  const events: string[] = [];
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
    ObjC: { import: () => {}, castRefToObject: (value: unknown) => value, deepUnwrap: (value: unknown) => value },
    $: { CGWindowListCopyWindowInfo: () => entries },
    Application: () => ({ applicationProcesses: { whose: (filter: { unixId?: number }) => () => !filter.unixId || filter.unixId === 42 ? [app] : [] } }),
  };
  const inspect = () => JSON.parse(runInNewContext(`${MAC_WINDOW_SCRIPT};run()`, context)) as { id: string; title: string; focused: boolean }[];
  const focus = (id: number) => runInNewContext(`${MAC_FOCUS_SCRIPT};run(['42','${id}'])`, context);
  return { entries, events, positions, inspect, focus };
}

describe('macOS stable desktop window identity', () => {
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
