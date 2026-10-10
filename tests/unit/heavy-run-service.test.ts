import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeavyRunService } from '$lib/modules/agent-room/application/services/HeavyRunService.js';
import * as diskGuard from '$lib/modules/agent-room/infrastructure/disk-guard.js';

describe('HeavyRunService', () => {
  const previous = process.env.ORKESTRAI_HEAVY_SLOTS;

  beforeEach(() => {
    process.env.ORKESTRAI_HEAVY_SLOTS = '1';
    vi.spyOn(diskGuard, 'freeDiskBytes').mockResolvedValue(50 * 1024 ** 3);
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.ORKESTRAI_HEAVY_SLOTS;
    else process.env.ORKESTRAI_HEAVY_SLOTS = previous;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('grants slots by capacity and serves waiting callers in arrival order', async () => {
    const service = new HeavyRunService();
    const first = await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'build web' });
    expect(first).toMatchObject({ granted: true, slots: 1, active: 1 });
    const second = await service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'e2e mobile' });
    const third = await service.acquire({ workspaceId: 'w', nodeId: 'c', label: 'package' });
    expect(second).toMatchObject({ granted: false, position: 1, reason: 'busy' });
    expect(third).toMatchObject({ granted: false, position: 2, reason: 'busy' });
    expect(second.granted ? '' : second.detail).toContain('build web');

    // A later caller never jumps the queue, even when it polls first.
    service.release((first as { leaseId: string }).leaseId);
    const thirdAgain = await service.acquire({ workspaceId: 'w', nodeId: 'c', label: 'package', ticket: (third as { ticket: string }).ticket });
    expect(thirdAgain).toMatchObject({ granted: false, position: 2 });
    const secondAgain = await service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'e2e mobile', ticket: (second as { ticket: string }).ticket });
    expect(secondAgain).toMatchObject({ granted: true });
  });

  it('wakes a long-polling caller as soon as a slot is released', async () => {
    const service = new HeavyRunService();
    const holder = await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'build' });
    const waiting = service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'test', waitMs: 10_000 });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    service.release((holder as { leaseId: string }).leaseId);
    await expect(waiting).resolves.toMatchObject({ granted: true });
  });

  it('expires the slot of a crashed holder that stopped renewing it', async () => {
    vi.useFakeTimers();
    const service = new HeavyRunService();
    await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'build' });
    vi.advanceTimersByTime(91_000);
    await expect(service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'test' })).resolves.toMatchObject({ granted: true });
  });

  it('pauses heavy runs instead of filling a nearly full disk', async () => {
    vi.mocked(diskGuard.freeDiskBytes).mockResolvedValue(1024 ** 3);
    const service = new HeavyRunService();
    const result = await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'build' });
    expect(result).toMatchObject({ granted: false, reason: 'disk' });
    expect(result.granted ? '' : result.detail).toContain('Espaço em disco insuficiente');
  });

  it('reports active and queued runs for the team', async () => {
    const service = new HeavyRunService();
    await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'build', taskId: 't1' });
    await service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'e2e' });
    const status = await service.status();
    expect(status.active).toEqual([expect.objectContaining({ label: 'build', taskId: 't1' })]);
    expect(status.queued).toEqual([expect.objectContaining({ label: 'e2e' })]);
  });

  it('tells a running build to stop before the disk fills, and only then', async () => {
    const service = new HeavyRunService();
    const lease = await service.acquire({ workspaceId: 'w', nodeId: 'a', label: 'e2e full' });
    const leaseId = (lease as { leaseId: string }).leaseId;
    await expect(service.renew(leaseId)).resolves.toEqual({ alive: true, stop: null });
    vi.mocked(diskGuard.freeDiskBytes).mockResolvedValue(0.6 * 1024 ** 3);
    const critical = await service.renew(leaseId);
    expect(critical.alive).toBe(true);
    expect(critical.stop).toContain('Disco quase cheio');
    // Unknown free space never stops a run.
    vi.mocked(diskGuard.freeDiskBytes).mockResolvedValue(null);
    await expect(service.renew(leaseId)).resolves.toEqual({ alive: true, stop: null });
  });

  it('reinstates a lease lost while its command kept running only when a slot is free', async () => {
    const service = new HeavyRunService();
    await expect(service.renew('lost-lease', { workspaceId: 'w', nodeId: 'a', label: 'e2e' })).resolves.toEqual({ alive: true, stop: null });
    // The restored run holds the only slot: a new caller waits.
    await expect(service.acquire({ workspaceId: 'w', nodeId: 'b', label: 'build' })).resolves.toMatchObject({ granted: false });
    // Another lost run finds no free slot and is told to stop.
    const other = await service.renew('other-lost', { workspaceId: 'w', nodeId: 'c', label: 'package' });
    expect(other.alive).toBe(false);
    expect(other.stop).toContain('perdida');
  });
});
