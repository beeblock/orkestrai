import { describe, expect, it } from 'vitest';
import { runNative } from '$lib/modules/agent-room/application/adapters/computers/native-runner.js';
import { resolveComputerPoint } from '$lib/modules/agent-room/application/adapters/computers/types.js';
import type { ComputerSnapshot } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';

const snapshot: ComputerSnapshot = {
  platform: 'macos', available: true, reason: 'ready', detail: null,
  permissions: { accessibility: 'granted', screenRecording: 'granted' },
  displays: [{ id: 'main', name: 'Main', bounds: { x: -100, y: 20, width: 1000, height: 800 }, scaleFactor: 1, primary: true }],
  windows: [{ id: 'w1', appId: 'editor', appName: 'Editor', title: 'Project', bounds: { x: 100, y: 200, width: 600, height: 400 }, focused: true }],
  focusedWindowId: 'w1',
};

describe('computer native boundary', () => {
  it('does not inherit arbitrary application environment secrets', async () => {
    process.env.ORKESTRAI_TEST_SECRET = 'must-not-reach-native-process';
    try {
      const result = await runNative(process.execPath, ['-e', 'process.stdout.write(process.env.ORKESTRAI_TEST_SECRET || "absent")']);
      expect(result.stdout).toBe('absent');
    } finally {
      delete process.env.ORKESTRAI_TEST_SECRET;
    }
  });

  it('maps normalized window coordinates and rejects escape attempts', () => {
    expect(resolveComputerPoint({ command: 'click', space: 'window', targetId: 'w1', x: 0.5, y: 0.25, button: 'left', count: 1 }, snapshot)).toMatchObject({ x: 400, y: 300 });
    expect(() => resolveComputerPoint({ command: 'click', space: 'window', targetId: 'w1', x: 1.1, y: 0.5, button: 'left', count: 1 }, snapshot)).toThrow('outside');
  });
});
