import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:child_process', async () => {
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  Object.assign(execFile, { [promisify.custom]: vi.fn(async () => ({ stdout: '', stderr: '' })) });
  return { execFile };
});
import { IosSimulatorAdapter } from '$lib/modules/agent-room/application/adapters/devices/IosSimulatorAdapter.js';

describe('iOS device discovery cache', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const arch = Object.getOwnPropertyDescriptor(process, 'arch')!;
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    Object.defineProperty(process, 'arch', { value: 'arm64', configurable: true });
  });
  afterEach(() => { Object.defineProperty(process, 'platform', platform); Object.defineProperty(process, 'arch', arch); vi.useRealTimers(); vi.restoreAllMocks(); });
  it('shares concurrent simctl reads, bounds staleness and protects cached objects', async () => {
    const adapter = new IosSimulatorAdapter();
    const read = vi.spyOn(adapter as any, 'readDevices').mockResolvedValue([{ id: 'sim', name: 'Simulator', state: 'booted' }]);
    const [first, second] = await Promise.all([adapter.list(), adapter.list()]);
    expect(read).toHaveBeenCalledTimes(1); first[0].name = 'Changed';
    expect(second[0].name).toBe('Simulator'); expect((await adapter.list())[0].name).toBe('Simulator');
    vi.advanceTimersByTime(5000); await adapter.list(); expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not cache failures or a read overtaken by a simulator mutation', async () => {
    const adapter = new IosSimulatorAdapter();
    const read = vi.spyOn(adapter as any, 'readDevices').mockRejectedValueOnce(new Error('xcrun unavailable'));
    await expect(adapter.list()).rejects.toThrow('xcrun unavailable');
    let release!: (value: unknown[]) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; })).mockResolvedValue([]);
    const old = adapter.list();
    await (adapter as any).runSimctl(['shutdown', 'test-fixture']); // mocked, never invokes Xcode
    release([{ id: 'stale' }]); await old;
    await adapter.list(); expect(read).toHaveBeenCalledTimes(3);
  });
});
