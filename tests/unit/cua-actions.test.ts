import { describe, expect, it, vi } from 'vitest';
import { executeCuaAction, cuaImage } from '$lib/modules/agent-room/application/adapters/computers/cua-actions.js';

function fixture() {
  const state = { pid: 12, windowId: 34n, screenshotWidth: 1600, screenshotHeight: 1200, windowBounds: { x: 100, y: 50, width: 800, height: 600 }, images: [{ mimeType: 'image/png', dataBase64: 'aW1hZ2U=' }] };
  const driver = {
    listApps: vi.fn(async () => ({ apps: [{ pid: 12, running: true, bundleId: 'com.test.app' }] })),
    listWindows: vi.fn(async () => ({ windows: [{ pid: 12, windowId: 34n }] })),
    getWindowState: vi.fn(async () => state),
    callTool: vi.fn(async (_name: string, _args: string) => ({ isError: false, action: { effect: 2 } })),
  };
  return { driver, state, execute: (input: Parameters<typeof executeCuaAction>[1]) => executeCuaAction(driver as never, input) };
}
const binding = { targetId: '12:cg:34', appId: 'com.test.app' };

describe('Cua private action translation', () => {
  it('maps OS coordinates against the fresh exact-window image rather than guessing DPI', async () => {
    const f = fixture();
    await f.execute({ operation: 'click', x: 500, y: 350, count: 1, button: 'left', binding });
    expect(f.driver.callTool).toHaveBeenCalledWith('click', JSON.stringify({ pid: 12, window_id: 34, delivery_mode: 'foreground', button: 'left', count: 1, x: 800, y: 600 }));
  });
  it('refuses a stale owner or moved coordinate before sending any input', async () => {
    const f = fixture();
    await expect(f.execute({ operation: 'type', text: 'private', binding: { ...binding, appId: 'another.app' } })).rejects.toMatchObject({ inputAttempted: false });
    await expect(f.execute({ operation: 'click', x: 99, y: 60, count: 1, button: 'left', binding })).rejects.toMatchObject({ inputAttempted: false });
    expect(f.driver.callTool).not.toHaveBeenCalled();
  });
  it('converts primary-screen points using the driver-confirmed backing scale', async () => {
    const f = fixture();
    f.driver.callTool.mockImplementation(async name => name === 'get_screen_size'
      ? { isError: false, action: { effect: 0 }, structuredJson: JSON.stringify({ width: 1600, height: 1200, scale_factor: 2 }) }
      : { isError: false, action: { effect: 2 } });
    const displays = [{ id: '1', name: 'Primary', primary: true, scaleFactor: 2, bounds: { x: 0, y: 0, width: 800, height: 600 } }];
    await executeCuaAction(f.driver as never, { operation: 'click', x: 300, y: 200, button: 'left', count: 1 }, displays);
    expect(JSON.parse(f.driver.callTool.mock.calls[1][1])).toMatchObject({ target: { kind: 'desktop', display_id: 'primary' }, x: 600, y: 400 });
    await expect(executeCuaAction(f.driver as never, { operation: 'click', x: 900, y: 200, button: 'left', count: 1 }, displays)).rejects.toMatchObject({ inputAttempted: false });
    expect(f.driver.callTool).toHaveBeenCalledTimes(2);
  });
  it('uses the same pinned window for typed text and shortcuts, without global input fallback', async () => {
    const f = fixture();
    await f.execute({ operation: 'type', text: 'text', binding });
    await f.execute({ operation: 'shortcut', keys: ['enter'], binding });
    await f.execute({ operation: 'shortcut', keys: ['cmd', 'c'], binding });
    expect(f.driver.callTool.mock.calls.map(call => [call[0], JSON.parse(call[1])])).toEqual([
      ['type_text', { pid: 12, window_id: 34, delivery_mode: 'foreground', text: 'text', delay_ms: 0 }],
      ['press_key', { pid: 12, window_id: 34, delivery_mode: 'foreground', key: 'enter' }],
      ['hotkey', { pid: 12, window_id: 34, delivery_mode: 'foreground', keys: ['cmd', 'c'] }],
    ]);
  });
  it('does not send arbitrary launch arguments or reflect native failures containing sensitive text', async () => {
    const f = fixture();
    f.driver.callTool.mockRejectedValue(new Error('secret text and a private path'));
    await expect(f.execute({ operation: 'launch', appId: 'com.apple.calculator' })).rejects.toMatchObject({ inputAttempted: true, message: 'The native action is unconfirmed. Inspect before retrying.' });
    expect(f.driver.callTool).toHaveBeenCalledWith('launch_app', '{"bundle_id":"com.apple.calculator"}');
  });
  it('does not accept a capture from a different window, invalid frame or missing image', () => {
    const f = fixture(), target = { pid: 12, windowId: 34n };
    for (const state of [{ ...f.state, pid: 13 }, { ...f.state, screenshotFrameValid: false }, { ...f.state, images: [] }]) expect(() => cuaImage(state as never, target)).toThrow();
  });
});
