import { describe, expect, it } from 'vitest';
import { runNative } from '$lib/modules/agent-room/application/adapters/computers/native-runner.js';
import { resolveComputerPoint } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
import { parseWmctrlWindows } from '$lib/modules/agent-room/application/adapters/computers/LinuxComputerAdapter.js';

const snapshot: ComputerSnapshot = {
  platform: 'macos', available: true, reason: 'ready', detail: null,
  permissions: { accessibility: 'granted', screenRecording: 'granted' },
  displays: [{ id: 'main', name: 'Main', bounds: { x: -100, y: 20, width: 1000, height: 800 }, scaleFactor: 1, primary: true }],
  windows: [{ id: 'w1', appId: 'editor', appName: 'Editor', title: 'Project', bounds: { x: 100, y: 200, width: 600, height: 400 }, focused: true }],
  focusedWindowId: 'w1',
};

describe('computer native boundary', () => {
  it('does not expose SecretRef stdin echoed by a failing native process', async () => {
    await expect(runNative(process.execPath, ['-e', 'process.stdin.on("data", x => { process.stderr.write(x); process.exitCode = 1; });'], { input: 'private-value-must-not-leak' })).rejects.toThrow('Native operation exited with code 1');
    const result = await runNative(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: 'private-value-must-not-leak' });
    expect(result.stdout).toBe('');
  });

  it('parses actual wmctrl -lGpx columns including PID and sticky desktops', () => {
    const windows = parseWmctrlWindows('0x03400003 -1 12944 -20 50 1280 720 google-chrome.Google-chrome workstation Inbox - Chrome\n0x04000001 0 141 10 30 500 400 calc.Calculator host ', '54525955');
    expect(windows[0]).toMatchObject({ appId: 'google-chrome.Google-chrome', title: 'Inbox - Chrome', bounds: { x: -20, y: 50, width: 1280, height: 720 } });
    expect(windows[1].title).toBe('');
  });
  it('does not inherit arbitrary application environment secrets', async () => {
    process.env.ORKESTRAI_TEST_SECRET = 'must-not-reach-native-process';
    try {
      const result = await runNative(process.execPath, ['-e', 'process.stdout.write(process.env.ORKESTRAI_TEST_SECRET || "absent")']);
      expect(result.stdout).toBe('absent');
    } finally {
      delete process.env.ORKESTRAI_TEST_SECRET;
    }
  });

  it('preserves native profile paths without forwarding application secrets', async () => {
    const original = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = '/tmp/desktop-profile-test';
    try {
      const result = await runNative(process.execPath, ['-e', 'process.stdout.write(process.env.XDG_CONFIG_HOME || "absent")']);
      expect(result.stdout).toBe('/tmp/desktop-profile-test');
    } finally {
      if (original === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = original;
    }
  });

  it('maps normalized window coordinates and rejects escape attempts', () => {
    expect(resolveComputerPoint({ command: 'click', space: 'window', targetId: 'w1', x: 0.5, y: 0.25, button: 'left', count: 1 }, snapshot)).toMatchObject({ x: 400, y: 300 });
    expect(() => resolveComputerPoint({ command: 'click', space: 'window', targetId: 'w1', x: 1.1, y: 0.5, button: 'left', count: 1 }, snapshot)).toThrow('outside');
  });
});
