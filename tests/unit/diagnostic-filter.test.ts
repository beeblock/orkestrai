import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { isExpectedPortalDiagnostic, isExpectedServerDiagnostic, orchestrationHealthDiagnostic } = require('../../electron/diagnostic-filter.cjs') as {
  isExpectedPortalDiagnostic: (values: unknown[]) => boolean;
  isExpectedServerDiagnostic: (values: unknown[]) => boolean;
  orchestrationHealthDiagnostic: (line: string) => string | null;
};

describe('desktop diagnostic filter', () => {
  it('persists only allowlisted numeric dispatch health data', () => {
    const metrics = { pendingRecipients: 30, activeDrains: 6, submitting: 0, waitingForWriter: 0,
      confirmationWatches: 6, replyWatches: 4, oldestDrainMs: 31_000, loopDelayMs: 100, rssBytes: 512_000_000 };
    const line = (value: unknown) => `[orkestrai:orchestration-health] ${JSON.stringify(value)}`;
    expect(JSON.parse(orchestrationHealthDiagnostic(line({ ...metrics, message: 'PRIVATE_PROMPT', token: 'PRIVATE_TOKEN' }))!)).toEqual(metrics);
    for (const value of [null, [], { ...metrics, submitting: -1 }, { ...metrics, rssBytes: 'PRIVATE_VALUE' }, { ...metrics, rssBytes: 1e20 }]) {
      expect(orchestrationHealthDiagnostic(line(value))).toBeNull();
    }
    expect(orchestrationHealthDiagnostic(line({ ...metrics, message: 'x'.repeat(2048) }))).toBeNull();
    expect(orchestrationHealthDiagnostic('[orkestrai:orchestration-health] {invalid')).toBeNull();
  });
  it('does not persist duplicate expected Portal failures', () => {
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: ERR_CONNECTION_REFUSED",
    ])).toBe(true);
    expect(isExpectedPortalDiagnostic([
      '(node:123) electron: Failed to load URL: http://127.0.0.1:5000 with error: ERR_CONNECTION_REFUSED',
    ])).toBe(true);
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: Script failed to execute",
    ])).toBe(true);
    for (const code of ['ERR_ABORTED', 'ERR_FAILED', 'ERR_NAME_NOT_RESOLVED']) {
      expect(isExpectedPortalDiagnostic([
        `Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: ${code}`,
      ])).toBe(true);
      expect(isExpectedPortalDiagnostic([
        `(node:123) electron: Failed to load URL: https://invalid.test with error: ${code}`,
      ])).toBe(true);
    }
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error:  (-3) loading 'http://localhost:50574/harness/'",
    ])).toBe(true);
  });

  it('keeps unexpected Electron and renderer failures actionable', () => {
    expect(isExpectedPortalDiagnostic(['Renderer process exited unexpectedly'])).toBe(false);
    expect(isExpectedPortalDiagnostic([
      "Error occurred in handler for 'GUEST_VIEW_MANAGER_CALL': Error: permission denied",
    ])).toBe(false);
  });

  it('omits missing page assets while retaining missing API routes', () => {
    expect(isExpectedServerDiagnostic([
      '[2026-09-05T22:09:14.397Z] ERROR Not found: /assets/sfx-mix.wav',
    ])).toBe(true);
    expect(isExpectedServerDiagnostic([
      '[2026-09-05T22:09:14.397Z] ERROR Not found: /...',
    ])).toBe(true);
    expect(isExpectedServerDiagnostic([
      '[2026-09-05T22:09:14.397Z] ERROR Not found: /api/agent-room/providers',
    ])).toBe(false);
    expect(isExpectedServerDiagnostic(['Error: database unavailable'])).toBe(false);
  });
});
