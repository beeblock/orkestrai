import { statfs } from 'node:fs/promises';

const GIB = 1024 ** 3;

/** Free bytes available to this user on the volume holding `path`, or null when unknown. */
export async function freeDiskBytes(path: string): Promise<number | null> {
  try {
    const stats = await statfs(path);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
}

export function formatGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(1)} GB`;
}

export class InsufficientDiskError extends Error {
  readonly code = 'INSUFFICIENT_DISK';

  constructor(readonly freeBytes: number, readonly requiredBytes: number, action: string) {
    super(`Espaço em disco insuficiente para ${action}: ${formatGiB(freeBytes)} livres, mínimo ${formatGiB(requiredBytes)}. Libere espaço (andares já integrados, builds e caches antigos) antes de continuar.`);
    this.name = 'InsufficientDiskError';
  }
}

/** Throws before a disk-heavy operation would exhaust the volume. Unknown free space never blocks. */
export async function assertFreeDisk(path: string, requiredBytes: number, action: string): Promise<void> {
  const free = await freeDiskBytes(path);
  if (free !== null && free < requiredBytes) throw new InsufficientDiskError(free, requiredBytes, action);
}

export const DISK_LIMITS = {
  /** A floor duplicates the tracked tree; keep room for its builds as well. */
  floorCreate: 3 * GIB,
  /** Heavy runs (builds, E2E, packaging) wait instead of filling the disk. */
  heavyRun: 2 * GIB,
  /** Below this the app raises an attention item. */
  warning: 5 * GIB,
  /** Running heavy runs are stopped below this: a full disk crashes the machine. */
  critical: 1 * GIB,
} as const;
