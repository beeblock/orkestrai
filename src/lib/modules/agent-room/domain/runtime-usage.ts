import type { ProviderUsage } from '../application/services/UsageService.js';
import type { AgentUsageBlock } from '../contracts/schemas/agent-runtime.schema.js';

/** Pure projection of the same account/window that gates unattended work. */
export function runtimeUsageBlock(payload: { provider?: string; profileId?: string | null; agentRuntimeUsageLimit?: number }, rows: readonly ProviderUsage[]): AgentUsageBlock | null {
  const limit = Math.max(50, Math.min(100, Math.round(payload.agentRuntimeUsageLimit ?? 95)));
  const usage = rows.find(row => row.provider === payload.provider && (row.profileId ?? null) === (payload.profileId ?? null) && !row.error);
  const window = usage?.windows.filter(item => Number.isFinite(item.usedPercent) && item.usedPercent >= limit
    && (!item.resetsAt || !Number.isFinite(Date.parse(item.resetsAt)) || Date.parse(item.resetsAt) > Date.now()))
    .sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (!window || !usage) return null;
  return { provider: usage.provider, profileId: usage.profileId ?? null, usedPercent: Math.max(0, Math.min(100, Math.round(window.usedPercent))),
    limit, window: window.kind, resetsAt: window.resetsAt };
}
