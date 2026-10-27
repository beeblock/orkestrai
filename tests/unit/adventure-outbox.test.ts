import { describe, expect, it } from 'vitest';
import { OUTBOX_MAX_MS, REPORT_LIMITS, ReportOutbox, fitsReport, retryable, type Battle } from '$lib/components/agent-room/adventure/adventure-outbox.js';
import { adventureReportSchema } from '$lib/modules/agent-room/contracts/schemas/adventure.schema.js';

function battle(overrides: Partial<Battle> = {}): Battle {
  return { elapsedMs: 5_000, xp: { hero: 10 }, gold: 3, kills: { 'bug-beetle': 2 }, chests: [], bosses: [], stages: [], position: { difficulty: 'normal', act: 1, stage: 1 }, wave: 0, ...overrides };
}

function ids() {
  let next = 0;
  return () => `report-${++next}`;
}

describe('ReportOutbox', () => {
  it('gathers battle in one open report and seals it, unchanged, once it is sent', () => {
    const outbox = new ReportOutbox(ids());
    outbox.add('ws', battle());
    outbox.add('ws', battle({ gold: 4 }));
    const sent = outbox.next()!;
    expect(sent).toMatchObject({ workspaceId: 'ws', reportId: 'report-1' });
    expect(sent.battle).toMatchObject({ elapsedMs: 10_000, gold: 7, xp: { hero: 20 }, kills: { 'bug-beetle': 4 } });
    // The answer never came: new battle waits apart, and the same report goes again.
    outbox.add('ws', battle({ gold: 9 }));
    expect(outbox.next()).toEqual(sent);
    outbox.settle('report-1');
    expect(outbox.next()).toMatchObject({ reportId: 'report-2', battle: { gold: 9 } });
  });

  it('skips empty battle and keeps each workspace in its own reports', () => {
    const outbox = new ReportOutbox(ids());
    outbox.add('alpha', battle({ elapsedMs: 0, xp: {}, gold: 0, kills: {} }));
    expect(outbox.size()).toBe(0);
    outbox.add('alpha', battle({ gold: 1 }));
    outbox.add('beta', battle({ gold: 2 }));
    outbox.add('alpha', battle({ gold: 4 }));
    expect(outbox.size('alpha')).toBe(1);
    expect(outbox.next()).toMatchObject({ workspaceId: 'alpha', battle: { gold: 5 } });
    outbox.drop('alpha');
    expect(outbox.next()).toMatchObject({ workspaceId: 'beta', battle: { gold: 2 } });
  });

  it('splits a long absence into reports the server accepts', () => {
    const outbox = new ReportOutbox(ids());
    const chest = { tier: 'white' as const, level: 1, difficulty: 'normal' as const, act: 1 };
    const stage = { difficulty: 'normal' as const, act: 1, stage: 1, result: 'clear' as const };
    // Over an hour of battle with chests, bosses and stages, five seconds at a time.
    for (let tick = 0; tick < 800; tick++) {
      outbox.add('ws', battle({
        kills: { 'bug-beetle': 3 },
        chests: tick % 2 ? [chest] : [],
        stages: tick % 9 ? [] : [stage],
        bosses: tick % 40 ? [] : [{ difficulty: 'normal', act: 1, monsterId: 'outage-kraken' }],
      }));
    }
    let total = 0;
    for (let next = outbox.next(); next; next = outbox.next()) {
      expect(fitsReport(next.battle)).toBe(true);
      expect(adventureReportSchema.safeParse({ reportId: next.reportId, ...next.battle }).success).toBe(true);
      expect(next.battle.elapsedMs).toBeLessThanOrEqual(REPORT_LIMITS.elapsedMs);
      total += next.battle.elapsedMs;
      outbox.settle(next.reportId);
    }
    expect(total).toBe(800 * 5_000);
  });

  it('fills up after hours without the server', () => {
    const outbox = new ReportOutbox(ids());
    for (let minutes = 0; minutes < OUTBOX_MAX_MS / 60_000; minutes += 5) {
      expect(outbox.full()).toBe(false);
      outbox.add('ws', battle({ elapsedMs: 5 * 60_000, kills: { 'bug-beetle': 100 } }));
    }
    expect(outbox.full()).toBe(true);
  });

  it('retries only failures that may pass later', () => {
    expect([null, 408, 429, 500, 503].map(retryable)).toEqual([true, true, true, true, true]);
    expect([400, 404, 422].map(retryable)).toEqual([false, false, false]);
  });
});
