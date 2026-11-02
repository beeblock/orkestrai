/** Viewer transport health is independent from the process and inbox it displays. */
export class TerminalConnectionHealth {
  private failures = 0;
  private lastFrame = 0;
  private lastTick = 0;
  private attachedAt: number | null = null;
  opened(now: number): void { this.lastFrame = now; this.lastTick = now; this.attachedAt = null; }
  received(now: number): void { this.lastFrame = now; }
  attached(now: number): void { this.attachedAt ??= now; }
  heartbeat(now: number): 'ping' | 'reconnect' {
    // A suspended/throttled renderer cannot interpret its own missed timers as a dead Core.
    const resumed = now - this.lastTick > 25_000;
    this.lastTick = now;
    if (resumed) { this.lastFrame = now; this.attachedAt = null; return 'ping'; }
    if (this.attachedAt !== null && now - this.attachedAt >= 30_000 && now - this.lastFrame <= 15_000) this.failures = 0;
    return now - this.lastFrame > 30_000 ? 'reconnect' : 'ping';
  }
  disconnected(random = Math.random()): { attempt: number; delay: number } {
    this.attachedAt = null;
    this.failures = Math.min(this.failures + 1, 9999);
    return { attempt: this.failures, delay: Math.round(Math.min(15_000, 1000 * 2 ** Math.min(this.failures - 1, 4)) * (0.8 + Math.min(1, Math.max(0, random)) * 0.4)) };
  }
}
