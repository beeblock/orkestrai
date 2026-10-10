import { availableParallelism, homedir, totalmem } from 'node:os';
import { uuidv7 } from '@beeblock/svelar/support';
import type { Workspace } from '../../domain/types.js';
import { DISK_LIMITS, formatGiB, freeDiskBytes } from '../../infrastructure/disk-guard.js';
import { nativeNotificationService } from './NativeNotificationService.js';

/**
 * Machine-wide admission for heavy commands (builds, E2E suites, packaging).
 *
 * Agents used to negotiate "exclusive windows" for these runs by chat, through
 * the leader, which serialized the whole team on conversation round trips.
 * The server now grants slots by measured capacity and queues the rest in
 * order; a crashed holder's slot expires with its heartbeat.
 */

export type HeavyLease = {
  leaseId: string;
  workspaceId: string;
  nodeId: string | null;
  label: string;
  taskId: string | null;
  acquiredAt: string;
  heartbeatAt: number;
};

type Waiter = {
  ticket: string;
  workspaceId: string;
  nodeId: string | null;
  label: string;
  taskId: string | null;
  enqueuedAt: number;
  lastSeenAt: number;
  wake: () => void;
};

export type HeavyAcquireResult =
  | { granted: true; leaseId: string; slots: number; active: number }
  | { granted: false; ticket: string; position: number; slots: number; active: number; reason: 'busy' | 'disk'; detail: string };

export type HeavyCapacity = { slots: number; cpus: number; memoryGiB: number; freeDiskBytes: number | null; diskBlocked: boolean };

const LEASE_TTL_MS = 90_000;
const WAITER_TTL_MS = 60_000;
const GIB = 1024 ** 3;

export class HeavyRunService {
  private readonly leases = new Map<string, HeavyLease>();
  private queue: Waiter[] = [];
  private lastDiskNotice = 0;
  private diskProbePath = homedir();

  setDiskProbePath(path: string): void {
    this.diskProbePath = path;
  }

  async capacity(): Promise<HeavyCapacity> {
    const cpus = availableParallelism();
    const memoryGiB = totalmem() / GIB;
    // A build or E2E suite comfortably uses ~4 cores and ~6 GB; never fewer than one slot.
    const configured = Number(process.env.ORKESTRAI_HEAVY_SLOTS ?? 0);
    const slots = configured > 0
      ? Math.min(8, Math.floor(configured))
      : Math.max(1, Math.min(4, Math.floor(cpus / 4), Math.floor(memoryGiB / 6)));
    const free = await freeDiskBytes(this.diskProbePath);
    return { slots, cpus, memoryGiB: Math.round(memoryGiB), freeDiskBytes: free, diskBlocked: free !== null && free < DISK_LIMITS.heavyRun };
  }

  /**
   * Grants a slot or queues the caller. `waitMs` long-polls so a CLI wrapper
   * can wait in order without hammering the server; the ticket keeps its place.
   */
  async acquire(input: { workspaceId: string; nodeId: string | null; label: string; taskId?: string | null; ticket?: string | null; waitMs?: number }): Promise<HeavyAcquireResult> {
    this.expire();
    const capacity = await this.capacity();
    let waiter = input.ticket ? this.queue.find((item) => item.ticket === input.ticket) : undefined;
    if (!waiter) {
      waiter = {
        ticket: input.ticket ?? uuidv7(),
        workspaceId: input.workspaceId,
        nodeId: input.nodeId,
        label: input.label.slice(0, 120),
        taskId: input.taskId ?? null,
        enqueuedAt: Date.now(),
        lastSeenAt: Date.now(),
        wake: () => undefined,
      };
      this.queue.push(waiter);
    }
    waiter.lastSeenAt = Date.now();
    const granted = this.tryGrant(waiter, capacity);
    if (granted) return granted;
    if (capacity.diskBlocked) {
      this.noticeDisk(capacity.freeDiskBytes ?? 0);
      return this.waiting(waiter, capacity, 'disk');
    }
    const waitMs = Math.max(0, Math.min(input.waitMs ?? 0, 25_000));
    if (waitMs > 0) {
      await new Promise<void>((resolvePromise) => {
        const timer = setTimeout(resolvePromise, waitMs);
        timer.unref?.();
        waiter!.wake = () => {
          clearTimeout(timer);
          resolvePromise();
        };
      });
      waiter.wake = () => undefined;
      waiter.lastSeenAt = Date.now();
      const retried = this.tryGrant(waiter, await this.capacity());
      if (retried) return retried;
    }
    return this.waiting(waiter, capacity, 'busy');
  }

  heartbeat(leaseId: string): boolean {
    const lease = this.leases.get(leaseId);
    if (!lease) return false;
    lease.heartbeatAt = Date.now();
    return true;
  }

  /**
   * Renews a lease. The queue only keeps new runs from starting on a nearly
   * full disk; a run already writing is told to stop before the disk fills.
   */
  async renew(leaseId: string): Promise<{ alive: boolean; stop: string | null }> {
    const alive = this.heartbeat(leaseId);
    const free = await freeDiskBytes(this.diskProbePath);
    if (free === null || free >= DISK_LIMITS.critical) return { alive, stop: null };
    this.noticeDisk(free);
    return {
      alive,
      stop: `Disco quase cheio (${formatGiB(free)} livres, mínimo ${formatGiB(DISK_LIMITS.critical)}): execução pesada interrompida para proteger a máquina. Libere espaço e rode de novo.`,
    };
  }

  release(leaseId: string): boolean {
    const removed = this.leases.delete(leaseId);
    this.wakeNext();
    return removed;
  }

  /** Abandons a queued ticket (caller cancelled before its turn). */
  leave(ticket: string): void {
    this.queue = this.queue.filter((item) => item.ticket !== ticket);
    this.wakeNext();
  }

  async status(): Promise<{ capacity: HeavyCapacity; active: HeavyLease[]; queued: Array<Pick<Waiter, 'ticket' | 'workspaceId' | 'nodeId' | 'label' | 'taskId'> & { waitingSeconds: number }> }> {
    this.expire();
    return {
      capacity: await this.capacity(),
      active: [...this.leases.values()],
      queued: this.queue.map((item) => ({
        ticket: item.ticket, workspaceId: item.workspaceId, nodeId: item.nodeId, label: item.label, taskId: item.taskId,
        waitingSeconds: Math.round((Date.now() - item.enqueuedAt) / 1000),
      })),
    };
  }

  private tryGrant(waiter: Waiter, capacity: HeavyCapacity): HeavyAcquireResult | null {
    if (capacity.diskBlocked) return null;
    // Strict arrival order: a later caller never jumps a waiting one.
    if (this.queue[0]?.ticket !== waiter.ticket || this.leases.size >= capacity.slots) return null;
    this.queue.shift();
    const lease: HeavyLease = {
      leaseId: waiter.ticket,
      workspaceId: waiter.workspaceId,
      nodeId: waiter.nodeId,
      label: waiter.label,
      taskId: waiter.taskId,
      acquiredAt: new Date().toISOString(),
      heartbeatAt: Date.now(),
    };
    this.leases.set(lease.leaseId, lease);
    this.wakeNext();
    return { granted: true, leaseId: lease.leaseId, slots: capacity.slots, active: this.leases.size };
  }

  private waiting(waiter: Waiter, capacity: HeavyCapacity, reason: 'busy' | 'disk'): HeavyAcquireResult {
    const position = this.queue.findIndex((item) => item.ticket === waiter.ticket) + 1;
    const detail = reason === 'disk'
      ? `Espaço em disco insuficiente para execução pesada (${formatGiB(capacity.freeDiskBytes ?? 0)} livres, mínimo ${formatGiB(DISK_LIMITS.heavyRun)}). Libere espaço; a fila continua quando houver espaço.`
      : `Aguardando vaga: posição ${position}, ${this.leases.size}/${capacity.slots} em uso (${[...this.leases.values()].map((lease) => lease.label).join(', ')}).`;
    return { granted: false, ticket: waiter.ticket, position, slots: capacity.slots, active: this.leases.size, reason, detail };
  }

  private wakeNext(): void {
    for (const waiter of this.queue.slice(0, 4)) waiter.wake();
  }

  private expire(): void {
    const now = Date.now();
    let changed = false;
    for (const [leaseId, lease] of this.leases) {
      if (now - lease.heartbeatAt > LEASE_TTL_MS) {
        this.leases.delete(leaseId);
        changed = true;
      }
    }
    const before = this.queue.length;
    this.queue = this.queue.filter((item) => now - item.lastSeenAt <= WAITER_TTL_MS);
    if (changed || before !== this.queue.length) this.wakeNext();
  }

  private noticeDisk(free: number): void {
    if (Date.now() - this.lastDiskNotice < 60 * 60_000) return;
    this.lastDiskNotice = Date.now();
    void nativeNotificationService.send({ name: 'Orkestrai' } as Workspace, {
      kind: 'attention',
      title: 'Disco',
      message: `Execuções pesadas pausadas: ${formatGiB(free)} livres.`,
    }).catch(() => undefined);
  }
}

const globalRef = globalThis as unknown as { __orkestraiHeavyRunService?: HeavyRunService };
export const heavyRunService = (globalRef.__orkestraiHeavyRunService ??= new HeavyRunService());
