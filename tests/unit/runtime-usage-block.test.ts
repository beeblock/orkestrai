import { describe, expect, it } from 'vitest';
import { runtimeUsageBlock } from '$lib/modules/agent-room/domain/runtime-usage.js';
import type { ProviderUsage } from '$lib/modules/agent-room/application/services/UsageService.js';
const row = (provider = 'claude', profileId: string | null = null, usedPercent = 97): ProviderUsage => ({ provider, profileId,
  error: null, plan: null, fetchedAt: new Date().toISOString(), windows: [{ kind: 'weekly', label: 'Weekly', usedPercent, resetsAt: null }] });
describe('runtime usage-limit warning follows the actual gate', () => {
  it('shows the 97 percent account versus the default 95 percent cap', () => {
    expect(runtimeUsageBlock({ provider: 'claude' }, [row()])).toEqual({ provider: 'claude', profileId: null, usedPercent: 97, limit: 95, window: 'weekly', resetsAt: null });
  });
  it('does not blame a different profile or provider and clears when the cap changes', () => {
    const rows = [row(), row('claude', 'other-profile', 30), row('codex', null, 20)];
    expect(runtimeUsageBlock({ provider: 'claude', profileId: 'other-profile' }, rows)).toBeNull();
    expect(runtimeUsageBlock({ provider: 'codex' }, rows)).toBeNull();
    expect(runtimeUsageBlock({ provider: 'claude', agentRuntimeUsageLimit: 100 }, rows)).toBeNull();
    expect(runtimeUsageBlock({ provider: 'claude', profileId: 'missing' }, rows)).toBeNull();
  });
  it('omits unknown/error/expired readings instead of reporting a false quota block', () => {
    const expired = row(); expired.windows[0].resetsAt = '2000-01-01T00:00:00Z';
    expect(runtimeUsageBlock({ provider: 'claude' }, [expired])).toBeNull();
    expect(runtimeUsageBlock({ provider: 'claude' }, [{ ...row(), error: 'api_request_failed' }])).toBeNull();
    expect(runtimeUsageBlock({ provider: 'claude' }, [row('claude', null, NaN)])).toBeNull();
  });
});
