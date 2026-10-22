import { describe, expect, it } from 'vitest';
import { buildUsageRoutingReport, normalizeUsageRoutingPolicy, tightestAccountUsage } from '$lib/modules/agent-room/domain/usage-routing.js';
import type { ProviderUsage } from '$lib/modules/agent-room/application/services/UsageService.js';

const usage = (provider: ProviderUsage['provider'], usedPercent: number, error: ProviderUsage['error'] = null): ProviderUsage => ({
  provider,
  plan: null,
  windows: error ? [] : [{ kind: '5h', label: '5 hours', usedPercent, resetsAt: null }],
  error,
  fetchedAt: new Date(0).toISOString(),
});

describe('usage routing', () => {
  it('recomenda o fallback quando a origem cruza o limite e o destino esta disponivel', () => {
    const report = buildUsageRoutingReport([usage('claude', 94), usage('codex', 20), usage('kimi', 10)], {
      enabled: true,
      sourceProvider: 'claude',
      fallbackProvider: 'codex',
      windowKind: '5h',
      thresholdPercent: 90,
    });
    expect(report.shouldFallback).toBe(true);
    expect(report.recommendedProvider).toBe('codex');
    expect(report.providers.find((provider) => provider.provider === 'claude')?.status).toBe('near_limit');
  });

  it('nao recomenda destino indisponivel nem politica desativada', () => {
    expect(buildUsageRoutingReport([usage('claude', 100), usage('codex', 0, 'credentials_missing')]).shouldFallback).toBe(false);
    expect(buildUsageRoutingReport([usage('claude', 100), usage('codex', 10)], { enabled: false }).shouldFallback).toBe(false);
  });

  it('normaliza limite e providers vindos do payload persistido', () => {
    expect(normalizeUsageRoutingPolicy({ thresholdPercent: 12, sourceProvider: ' claude ', fallbackProvider: ' kimi ' })).toEqual({
      enabled: true,
      sourceProvider: 'claude',
      fallbackProvider: 'kimi',
      windowKind: 'weekly',
      thresholdPercent: 50,
    });
  });

  it('avalia somente a janela escolhida pela politica', () => {
    const providers: ProviderUsage[] = [
      {
        ...usage('claude', 95),
        windows: [
          { kind: '5h', label: '5 hours', usedPercent: 95, resetsAt: null },
          { kind: 'weekly', label: 'Weekly', usedPercent: 30, resetsAt: null },
        ],
      },
      {
        ...usage('codex', 10),
        windows: [
          { kind: '5h', label: '5 hours', usedPercent: 10, resetsAt: null },
          { kind: 'weekly', label: 'Weekly', usedPercent: 10, resetsAt: null },
        ],
      },
    ];

    expect(buildUsageRoutingReport(providers, { windowKind: 'weekly' }).shouldFallback).toBe(false);
    expect(buildUsageRoutingReport(providers, { windowKind: '5h' }).shouldFallback).toBe(true);
  });

  it('marca o provider indisponivel quando ele nao reporta a janela escolhida', () => {
    const report = buildUsageRoutingReport([usage('claude', 20)], { windowKind: 'monthly' });
    expect(report.providers[0].status).toBe('unavailable');
    expect(report.providers[0].monitoredUsedPercent).toBeNull();
  });

  it('nunca mantem origem e fallback iguais', () => {
    expect(normalizeUsageRoutingPolicy({ sourceProvider: 'claude', fallbackProvider: 'claude' })).toMatchObject({
      sourceProvider: 'claude',
      fallbackProvider: 'codex',
    });
    expect(normalizeUsageRoutingPolicy({ sourceProvider: 'codex', fallbackProvider: 'codex' })).toMatchObject({
      sourceProvider: 'codex',
      fallbackProvider: 'claude',
    });
  });

  it('preserva ids UUID completos dos perfis na politica persistida', () => {
    const profileId = '0198db82-7eaf-7000-8b8e-fd721c2db512';
    const routingId = `claude:profile:${profileId}`;
    const policy = normalizeUsageRoutingPolicy({ sourceProvider: routingId, fallbackProvider: 'codex', windowKind: '5h' });
    expect(policy.sourceProvider).toBe(routingId);

    const profileUsage: ProviderUsage = { ...usage('claude', 95), profileId, profileName: 'Work' };
    const report = buildUsageRoutingReport([profileUsage, usage('codex', 10)], policy);
    expect(report.providers[0].routingId).toBe(routingId);
    expect(report.recommendedProvider).toBe('codex');
  });

  it('shows the usage of the account the workspace agents run on, not the busiest one on the machine', () => {
    const standard = usage('claude', 12);
    const work = { ...usage('claude', 30), profileId: 'work', profileName: 'Trabalho' };
    const codex = usage('codex', 55);
    // The workspace runs Claude on the default account: the work profile's 30% is not its usage.
    expect(tightestAccountUsage([standard, work, codex], [{ provider: 'claude', profileId: null }])).toMatchObject({ usage: standard, percent: 12, shared: true });
    expect(tightestAccountUsage([standard, work], [{ provider: 'claude', profileId: 'work' }])).toMatchObject({ usage: work, percent: 30, shared: true });
    // An unreadable default account shows nothing rather than another account's figure.
    expect(tightestAccountUsage([usage('claude', 0, 'credentials_missing'), work], [{ provider: 'claude' }])).toBeNull();
    // Without agents, only default accounts count.
    expect(tightestAccountUsage([standard, work, codex], [])).toMatchObject({ usage: codex, percent: 55, shared: false });
  });
});
