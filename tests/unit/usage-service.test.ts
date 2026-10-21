import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { UsageService } from '$lib/modules/agent-room/application/services/UsageService.js';
import { USAGE_REFRESH_INTERVAL_MS } from '$lib/modules/agent-room/domain/usage.js';
import type { ProviderProfile } from '$lib/modules/agent-room/domain/types.js';

function fakeFetch(routes: Record<string, unknown>) {
  return (async (url: string) => {
    const body = routes[url];
    if (!body) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}

function homeWith(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), 'orkestrai-usage-'));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(home, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return home;
}

const CLAUDE_USAGE = {
  five_hour: { utilization: 42, resets_at: '2026-08-02T18:00:00Z' },
  seven_day: { utilization: 10, resets_at: '2026-08-05T00:00:00Z' },
};

const CODEX_USAGE = {
  plan_type: 'pro',
  rate_limit: {
    primary_window: { used_percent: 55, limit_window_seconds: 18000, reset_at: 1785600000 },
    secondary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 1786200000 },
  },
};

const KIMI_USAGE = {
  user: { membership: { level: 'LEVEL_ALLEGRO' } },
  usage: { limit: '100', remaining: '61', resetTime: '2026-08-04T10:00:00Z' },
  limits: [
    { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '93', resetTime: '2026-08-02T15:00:00Z' } },
  ],
};

describe('UsageService', () => {
  it('claude: le credencial do arquivo e normaliza 5h + semanal', async () => {
    const home = homeWith({ '.claude/.credentials.json': JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }) });
    const service = new UsageService(fakeFetch({ 'https://api.anthropic.com/api/oauth/usage': CLAUDE_USAGE }), home, async () => null);

    const usage = await service.getUsage('claude');
    expect(usage.error).toBeNull();
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows[0]).toMatchObject({ kind: '5h', label: '5 hours', usedPercent: 42 });
    expect(usage.windows[1]).toMatchObject({ kind: 'weekly', usedPercent: 10, resetsAt: '2026-08-05T00:00:00Z' });
  });

  it('claude: cai no Keychain quando o arquivo nao existe', async () => {
    const home = homeWith({});
    const service = new UsageService(
      fakeFetch({ 'https://api.anthropic.com/api/oauth/usage': CLAUDE_USAGE }),
      home,
      async () => JSON.stringify({ claudeAiOauth: { accessToken: 'tok-keychain' } }),
      'darwin',
    );
    const usage = await service.getUsage('claude');
    expect(usage.error).toBeNull();
    expect(usage.windows[0].usedPercent).toBe(42);
  });

  it('claude: perfil com CLAUDE_CONFIG_DIR proprio le do Keychain namespaced por configDir', async () => {
    const home = homeWith({});
    const configDir = join(home, '.claude-trabalho');
    const expectedService = `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`;
    const profile: ProviderProfile = {
      id: 'profile-1', providerId: 'claude', name: 'Trabalho', configDir, dataDir: null, hasToken: false,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    };
    const service = new UsageService(
      fakeFetch({ 'https://api.anthropic.com/api/oauth/usage': CLAUDE_USAGE }),
      home,
      async (service) => (service === expectedService ? JSON.stringify({ claudeAiOauth: { accessToken: 'tok-profile' } }) : null),
      'darwin',
    );
    const usage = await service.getUsage('claude', false, profile);
    expect(usage.error).toBeNull();
    expect(usage.windows[0].usedPercent).toBe(42);
  });

  it('claude: sem credencial retorna erro amigavel', async () => {
    const service = new UsageService(fakeFetch({}), homeWith({}), async () => null);
    const usage = await service.getUsage('claude');
    expect(usage.error).toBe('credentials_missing');
    expect(usage.windows).toHaveLength(0);
  });

  it('codex: mapeia janelas 5h/semanal pelos segundos e o plano', async () => {
    const home = homeWith({ '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'tok', account_id: 'acc' } }) });
    const service = new UsageService(fakeFetch({ 'https://chatgpt.com/backend-api/wham/usage': CODEX_USAGE }), home);

    const usage = await service.getUsage('codex');
    expect(usage.error).toBeNull();
    expect(usage.plan).toBe('Pro');
    expect(usage.windows[0]).toMatchObject({ kind: '5h', usedPercent: 55 });
    expect(usage.windows[1]).toMatchObject({ kind: 'weekly', usedPercent: 20 });
    expect(usage.windows[0].resetsAt).toBe(new Date(1785600000 * 1000).toISOString());
  });

  it('codex: incorpora e deduplica janelas dos limites adicionais', async () => {
    const home = homeWith({ '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'tok', account_id: 'acc' } }) });
    const response = {
      ...CODEX_USAGE,
      rate_limit: {
        primary_window: { used_percent: 20, limit_window_seconds: 604800, reset_at: 1786200000 },
      },
      additional_rate_limits: [{
        limit_name: 'Codex fast',
        rate_limit: {
          primary_window: { used_percent: 64, limit_window_seconds: 18000, reset_at: 1785600000 },
          secondary_window: { used_percent: 35, limit_window_seconds: 604800, reset_at: 1786200000 },
        },
      }],
    };
    const service = new UsageService(fakeFetch({ 'https://chatgpt.com/backend-api/wham/usage': response }), home);

    const usage = await service.getUsage('codex');
    expect(usage.windows).toHaveLength(2);
    expect(usage.windows.find((window) => window.kind === '5h')?.usedPercent).toBe(64);
    expect(usage.windows.find((window) => window.kind === 'weekly')?.usedPercent).toBe(35);
  });

  it('kimi: calcula uso por remaining nas janelas de 5h e semanal', async () => {
    const home = homeWith({ '.kimi-code/credentials/kimi-code.json': JSON.stringify({ access_token: 'tok' }) });
    const service = new UsageService(fakeFetch({ 'https://api.kimi.com/coding/v1/usages': KIMI_USAGE }), home);

    const usage = await service.getUsage('kimi');
    expect(usage.error).toBeNull();
    expect(usage.plan).toBe('Allegro');
    expect(usage.windows[0]).toMatchObject({ kind: '5h', usedPercent: 7 });
    expect(usage.windows[1]).toMatchObject({ kind: 'weekly', usedPercent: 39, resetsAt: '2026-08-04T10:00:00Z' });
  });

  it('kimi: token expirado renova via refresh_token e persiste a rotacao', async () => {
    const expiredCreds = {
      access_token: 'tok-velho',
      refresh_token: 'refresh-1',
      expires_at: Math.floor(Date.now() / 1000) - 10, // expirado (segundos)
    };
    const home = homeWith({ '.kimi-code/credentials/kimi-code.json': JSON.stringify(expiredCreds) });
    const calls: Array<{ url: string; body?: string }> = [];
    const fn = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? String(init.body) : undefined });
      if (String(url).includes('/api/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ access_token: 'tok-novo', refresh_token: 'refresh-2', expires_in: 900, scope: 'kimi-code', token_type: 'Bearer' }),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => KIMI_USAGE } as Response;
    }) as typeof fetch;
    const service = new UsageService(fn, home);

    const usage = await service.getUsage('kimi');
    expect(usage.error).toBeNull();
    expect(usage.windows.length).toBeGreaterThan(0);

    // Renovou ANTES da chamada de usage e persistiu os DOIS tokens (rotacao).
    expect(calls[0].url).toContain('/api/oauth/token');
    expect(calls[0].body).toContain('refresh_token=refresh-1');
    const saved = JSON.parse(readFileSync(join(home, '.kimi-code', 'credentials', 'kimi-code.json'), 'utf8'));
    expect(saved.access_token).toBe('tok-novo');
    expect(saved.refresh_token).toBe('refresh-2');
    expect(saved.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('401 vira mensagem de credencial expirada', async () => {
    const home = homeWith({ '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'tok' } }) });
    const expired = (async () => ({ ok: false, status: 401, json: async () => ({}) }) as Response) as typeof fetch;
    const service = new UsageService(expired, home);
    const usage = await service.getUsage('codex');
    expect(usage.error).toBe('credential_expired');
  });

  it('cache: protege os providers por 5 minutos e permite refresh manual', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    let calls = 0;
    const counting = (async (url: string) => {
      calls += 1;
      return { ok: true, status: 200, json: async () => CODEX_USAGE } as Response;
    }) as typeof fetch;
    const home = homeWith({ '.codex/auth.json': JSON.stringify({ tokens: { access_token: 'tok' } }) });
    try {
      const service = new UsageService(counting, home);
      expect(USAGE_REFRESH_INTERVAL_MS).toBe(300_000);

      await service.getUsage('codex');
      vi.advanceTimersByTime(USAGE_REFRESH_INTERVAL_MS - 1);
      await service.getUsage('codex');
      expect(calls).toBe(1);

      await service.getUsage('codex', true);
      expect(calls).toBe(2);

      vi.advanceTimersByTime(USAGE_REFRESH_INTERVAL_MS);
      await service.getUsage('codex');
      expect(calls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lista todos os adapters e explica quando a cota nao e legivel automaticamente', async () => {
    const service = new UsageService(fakeFetch({}), homeWith({}), async () => null);
    const usages = await service.getAll();

    expect(usages.map((usage) => usage.provider)).toEqual([
      'claude', 'codex', 'kimi', 'antigravity', 'cursor', 'devin', 'opencode', 'cline', 'copilot',
      'gemini', 'qwen', 'aider', 'goose', 'amp',
    ]);
    expect(usages.find((usage) => usage.provider === 'antigravity')).toMatchObject({
      diagnostic: 'provider_cli_only',
      error: null,
    });
    expect(usages.find((usage) => usage.provider === 'cursor')?.helpUrl).toContain('cursor.com');
    expect(usages.find((usage) => usage.provider === 'devin')?.helpUrl).toContain('/build-usage-dashboard');
    expect(usages.find((usage) => usage.provider === 'opencode')).toMatchObject({
      diagnostic: 'model_provider_managed',
      helpUrl: 'https://dev.opencode.ai/docs/go/',
    });
    expect(usages.find((usage) => usage.provider === 'cline')?.helpUrl).toBe(
      'https://docs.cline.bot/getting-started/cline-provider',
    );
  });
});
