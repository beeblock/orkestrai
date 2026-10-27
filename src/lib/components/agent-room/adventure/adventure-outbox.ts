import type { PendingReport } from '$lib/modules/agent-room/domain/adventure/simulation.js';
import type { StagePosition } from '$lib/modules/agent-room/domain/adventure/world.js';

/** What the battle on a screen produced, and where the party stood at the end. */
export type Battle = PendingReport & { position: StagePosition; wave: number };

/** A report on its way: sent, and sent again with the same id, until the server answers. */
export type SealedReport = { workspaceId: string; reportId: string; battle: Battle };

/**
 * The most one report carries, inside what the server accepts and pays in
 * full: five minutes of battle, a few bosses and stage results, and no more
 * chests than the monsters that fell could drop.
 */
export const REPORT_LIMITS = { elapsedMs: 5 * 60_000, chests: 100, bosses: 3, stages: 10, heroes: 64 };

/** Battle kept for a server that does not answer; past it the party camps until the server is back. */
export const OUTBOX_MAX_MS = 8 * 3_600_000;

export function isEmptyBattle(battle: Battle): boolean {
  return battle.elapsedMs === 0 && !battle.chests.length && !battle.stages.length && !battle.bosses.length && !Object.keys(battle.xp).length;
}

export function mergeBattles(a: Battle, b: Battle): Battle {
  const xp = { ...a.xp };
  for (const [heroId, value] of Object.entries(b.xp)) xp[heroId] = (xp[heroId] ?? 0) + value;
  const kills = { ...a.kills };
  for (const [monster, value] of Object.entries(b.kills) as Array<[keyof typeof kills, number]>) kills[monster] = (kills[monster] ?? 0) + value;
  return { elapsedMs: a.elapsedMs + b.elapsedMs, xp, gold: a.gold + b.gold, kills, chests: [...a.chests, ...b.chests], bosses: [...a.bosses, ...b.bosses], stages: [...a.stages, ...b.stages], position: b.position, wave: b.wave };
}

/** Whether one report can carry the battle. */
export function fitsReport(battle: Battle): boolean {
  const kills = Object.values(battle.kills).reduce((sum, count) => sum + (count ?? 0), 0);
  return battle.elapsedMs <= REPORT_LIMITS.elapsedMs
    && battle.chests.length <= Math.min(REPORT_LIMITS.chests, kills + 2)
    && battle.bosses.length <= REPORT_LIMITS.bosses
    && battle.stages.length <= REPORT_LIMITS.stages
    && Object.keys(battle.xp).length <= REPORT_LIMITS.heroes;
}

type Entry = { workspaceId: string; reportId: string | null; battle: Battle };

/**
 * Battle results the server has not acknowledged yet, oldest first. Each
 * workspace gathers new battle in one open report until it is full or sent;
 * from then on that report is sealed with an id and never changes, so a
 * report whose answer was lost is sent again exactly as it was, and the
 * server, which remembers recent ids, never pays it twice.
 */
export class ReportOutbox {
  private entries: Entry[] = [];

  constructor(private readonly newId: () => string = () => crypto.randomUUID()) {}

  add(workspaceId: string, fresh: Battle): void {
    if (isEmptyBattle(fresh)) return;
    const open = this.entries.findLast((entry) => entry.workspaceId === workspaceId && entry.reportId === null);
    if (open) {
      const merged = mergeBattles(open.battle, fresh);
      if (fitsReport(merged)) {
        open.battle = merged;
        return;
      }
      open.reportId = this.newId();
    }
    this.entries.push({ workspaceId, reportId: null, battle: fresh });
  }

  /** The next report to send: the oldest one, sealed now if it was still open. */
  next(): SealedReport | null {
    const head = this.entries[0];
    if (!head) return null;
    head.reportId ??= this.newId();
    return { workspaceId: head.workspaceId, reportId: head.reportId, battle: head.battle };
  }

  /** The server took the report, already had it, or refused it for good. */
  settle(reportId: string): void {
    this.entries = this.entries.filter((entry) => entry.reportId !== reportId);
  }

  /** The workspace is gone: nothing of it can be saved any more. */
  drop(workspaceId: string): void {
    this.entries = this.entries.filter((entry) => entry.workspaceId !== workspaceId);
  }

  /** Reports waiting, for one workspace or all. */
  size(workspaceId?: string): number {
    return this.entries.filter((entry) => !workspaceId || entry.workspaceId === workspaceId).length;
  }

  /** Whether the battle kept for an absent server reached its limit. */
  full(): boolean {
    return this.entries.reduce((sum, entry) => sum + entry.battle.elapsedMs, 0) >= OUTBOX_MAX_MS;
  }
}

/** Whether a failed send may succeed later (the server was away or busy) rather than being refused for good. */
export function retryable(status: number | null): boolean {
  return status === null || status === 408 || status === 425 || status === 429 || status >= 500;
}
