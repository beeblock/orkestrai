import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { USAGE_REFRESH_INTERVAL_MS, type UsageErrorCode } from '$lib/modules/agent-room/domain/usage.js';
import { USAGE_PROVIDERS, usageProviderDefinition, type UsageDiagnostic } from '$lib/modules/agent-room/domain/usage-providers.js';
import type { ProviderProfile } from '$lib/modules/agent-room/domain/types.js';
import { providerProfileService } from './ProviderProfileService.js';

const FETCH_TIMEOUT_MS = 10_000;
/** OAuth do kimi-code (client publico da CLI). */
const KIMI_OAUTH_TOKEN_URL = 'https://auth.kimi.com/api/oauth/token';
const KIMI_OAUTH_CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';

function expandProfileHome(path: string, home: string): string {
  return path === '~' || path.startsWith('~/') ? path.replace(/^~/, home) : path;
}

/** Sufixo do service name do Keychain do Claude Code para um CLAUDE_CONFIG_DIR nao padrao. */
function claudeKeychainSuffix(configDir: string): string {
  return createHash('sha256').update(configDir).digest('hex').slice(0, 8);
}

export type UsageWindowKind = '5h' | 'weekly' | 'monthly';

export type UsageWindow = {
  kind: UsageWindowKind;
  label: string;
  /** 0-100 */
  usedPercent: number;
  resetsAt: string | null;
};

export type ProviderUsage = {
  provider: string;
  /** Perfil de multi-conta desta leitura, ou null para a conta padrão do provider. */
  profileId?: string | null;
  profileName?: string | null;
  plan: string | null;
  windows: UsageWindow[];
  error: UsageErrorCode | null;
  diagnostic?: UsageDiagnostic | null;
  helpUrl?: string | null;
  fetchedAt: string;
};

const WINDOW_LABELS: Record<UsageWindowKind, string> = {
  '5h': '5 hours',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

class UsageCollectionError extends Error {
  constructor(readonly code: UsageErrorCode) {
    super(code);
    this.name = 'UsageCollectionError';
  }
}

function usageError(code: UsageErrorCode): UsageCollectionError {
  return new UsageCollectionError(code);
}

function windowOf(kind: UsageWindowKind, usedPercent: number, resetsAt: string | null): UsageWindow {
  return { kind, label: WINDOW_LABELS[kind], usedPercent: Math.max(0, Math.min(100, Math.round(usedPercent))), resetsAt };
}

/** Mantem uma unica barra por periodo, usando a cota mais pressionada. */
function mergeWindow(windows: UsageWindow[], next: UsageWindow): void {
  const index = windows.findIndex((window) => window.kind === next.kind);
  if (index < 0) {
    windows.push(next);
    return;
  }
  if (next.usedPercent > windows[index].usedPercent) windows[index] = next;
}

function kindFromSeconds(seconds: number): UsageWindowKind {
  if (seconds <= 5.5 * 3600) return '5h';
  if (seconds <= 8 * 24 * 3600) return 'weekly';
  return 'monthly';
}

/**
 * Uso/cota dos providers (Claude, Codex, Kimi) lido DIRETO das APIs de cada
 * um, com as credenciais locais da propria CLI — nada para o usuario
 * configurar. Cache alinhado ao intervalo automatico do painel.
 */
export class UsageService {
  private cache = new Map<string, { at: number; usage: ProviderUsage }>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly home: string = homedir(),
    private readonly keychainReader: (service: string) => Promise<string | null> = readMacOsKeychain,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly listProfiles: (providerId: string) => Promise<ProviderProfile[]> = (id) => providerProfileService.list(id),
  ) {}

  /** Base de cada provider + uma linha por perfil de multi-conta configDir
      (os unicos onde da pra ler a cota real: token strategy nao tem arquivo
      de credenciais para ler sem rodar a CLI, e configDirPair/unsupported
      nao tem collector). */
  async getAll(forceRefresh = false): Promise<ProviderUsage[]> {
    const base = await Promise.all(USAGE_PROVIDERS.map((provider) => this.getUsage(provider.id, forceRefresh)));
    const profileRows = await Promise.all(USAGE_PROVIDERS
      .filter((provider) => provider.collector)
      .map(async (provider) => {
        const profiles = await this.listProfiles(provider.id).catch(() => []);
        return Promise.all(profiles.map((profile) => this.getUsage(provider.id, forceRefresh, profile)));
      }));
    return [...base, ...profileRows.flat()];
  }

  /** Cached-only exact account read for lightweight runtime/UI projections. */
  cachedAccount(provider: string, profileId: string | null = null): ProviderUsage | null {
    const entry = this.cache.get(profileId ? `${provider}::${profileId}` : provider);
    return entry && Date.now() - entry.at < USAGE_REFRESH_INTERVAL_MS ? entry.usage : null;
  }

  cached(): ProviderUsage[] {
    return USAGE_PROVIDERS
      .map((provider) => this.cache.get(provider.id)?.usage ?? null)
      .filter((usage): usage is ProviderUsage => Boolean(usage));
  }

  async getUsage(provider: string, forceRefresh = false, profile: ProviderProfile | null = null): Promise<ProviderUsage> {
    const cacheKey = profile ? `${provider}::${profile.id}` : provider;
    const cached = this.cache.get(cacheKey);
    if (!forceRefresh && cached && Date.now() - cached.at < USAGE_REFRESH_INTERVAL_MS) return cached.usage;

    let usage: ProviderUsage;
    try {
      const definition = usageProviderDefinition(provider);
      const configDir = profile?.configDir ? expandProfileHome(profile.configDir, this.home) : undefined;
      const collectors = {
        claude: () => this.claudeUsage(configDir),
        codex: () => this.codexUsage(configDir),
        kimi: () => this.kimiUsage(configDir),
      } satisfies Record<NonNullable<typeof definition.collector>, () => Promise<ProviderUsage>>;
      if (definition.collector) usage = await collectors[definition.collector]();
      else {
        usage = {
          provider,
          plan: null,
          windows: [],
          error: definition.diagnostic ? null : 'unknown_provider',
          diagnostic: definition.diagnostic,
          helpUrl: definition.helpUrl,
          fetchedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      usage = this.failure(provider, error instanceof UsageCollectionError ? error.code : 'unexpected');
    }
    if (profile) { usage.profileId = profile.id; usage.profileName = profile.name; }
    this.cache.set(cacheKey, { at: Date.now(), usage });
    return usage;
  }

  private failure(provider: string, error: UsageErrorCode): ProviderUsage {
    return { provider, plan: null, windows: [], error, diagnostic: null, helpUrl: usageProviderDefinition(provider).helpUrl, fetchedAt: new Date().toISOString() };
  }

  // -- Claude (OAuth do Claude Code; token no arquivo ou no Keychain do macOS) --

  private async claudeToken(configDir?: string): Promise<string> {
    const filePath = join(configDir ?? join(this.home, '.claude'), '.credentials.json');
    if (existsSync(filePath)) {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      const token = parsed?.claudeAiOauth?.accessToken;
      if (token) return token as string;
    }
    // O Keychain do macOS E namespaced por CLAUDE_CONFIG_DIR: o Claude Code
    // grava a conta padrao em "Claude Code-credentials" e qualquer outro
    // CLAUDE_CONFIG_DIR em "Claude Code-credentials-<sha256(configDir).slice(0,8)>"
    // (confirmado via `security dump-keychain` — o sufixo bate exatamente
    // com os 8 primeiros hex do sha256 do caminho absoluto do configDir).
    if (this.platform === 'darwin') {
      const service = configDir ? `Claude Code-credentials-${claudeKeychainSuffix(configDir)}` : 'Claude Code-credentials';
      const raw = await this.keychainReader(service);
      if (raw) {
        const token = JSON.parse(raw)?.claudeAiOauth?.accessToken;
        if (token) return token as string;
      }
    }
    throw usageError('credentials_missing');
  }

  private async claudeUsage(configDir?: string): Promise<ProviderUsage> {
    const token = await this.claudeToken(configDir);
    const data = await this.fetchJson('https://api.anthropic.com/api/oauth/usage', {
      authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    });
    const windows: UsageWindow[] = [];
    const fiveHour = data?.five_hour as { utilization?: number; resets_at?: string } | null;
    const sevenDay = data?.seven_day as { utilization?: number; resets_at?: string } | null;
    if (fiveHour) windows.push(windowOf('5h', Number(fiveHour.utilization ?? 0), fiveHour.resets_at ?? null));
    if (sevenDay) windows.push(windowOf('weekly', Number(sevenDay.utilization ?? 0), sevenDay.resets_at ?? null));
    return { provider: 'claude', plan: null, windows, error: null, diagnostic: null, helpUrl: null, fetchedAt: new Date().toISOString() };
  }

  // -- Codex (ChatGPT backend; auth.json do codex CLI) --

  private async codexUsage(configDir?: string): Promise<ProviderUsage> {
    const filePath = join(configDir ?? join(this.home, '.codex'), 'auth.json');
    if (!existsSync(filePath)) throw usageError('credentials_missing');
    const auth = JSON.parse(readFileSync(filePath, 'utf8'));
    const token = auth?.tokens?.access_token;
    if (!token) throw usageError('access_token_missing');

    const data = await this.fetchJson('https://chatgpt.com/backend-api/wham/usage', {
      authorization: `Bearer ${token}`,
      'chatgpt-account-id': String(auth?.tokens?.account_id ?? ''),
    });
    const windows: UsageWindow[] = [];
    const rateLimits = [data?.rate_limit];
    const additional = Array.isArray(data?.additional_rate_limits)
      ? data.additional_rate_limits as Array<{ rate_limit?: unknown }>
      : [];
    rateLimits.push(...additional.map((entry) => entry.rate_limit));
    for (const rateLimit of rateLimits) {
      for (const key of ['primary_window', 'secondary_window'] as const) {
        const win = (rateLimit as Record<string, unknown> | null)?.[key] as {
          used_percent?: number;
          limit_window_seconds?: number;
          reset_at?: number;
        } | null;
        if (!win) continue;
        const seconds = Number(win.limit_window_seconds ?? 0);
        if (!Number.isFinite(seconds) || seconds <= 0) continue;
        const kind = kindFromSeconds(seconds);
        mergeWindow(windows, windowOf(
          kind,
          Number(win.used_percent ?? 0),
          win.reset_at ? new Date(win.reset_at * 1000).toISOString() : null,
        ));
      }
    }
    const plan = typeof data?.plan_type === 'string' ? (data.plan_type as string) : null;
    return {
      provider: 'codex',
      plan: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null,
      windows,
      error: null,
      diagnostic: null,
      helpUrl: null,
      fetchedAt: new Date().toISOString(),
    };
  }

  // -- Kimi (kimi-code; /coding/v1/usages) --

  /**
   * Token OAuth do kimi-code: expira em 15 min e o refresh ROTACIONA (vem um
   * refresh_token novo — precisa persistir os dois, senao o da CLI morre).
   * Sem isso o usage so funcionava logo depois de abrir a CLI do kimi.
   */
  private async kimiToken(filePath: string): Promise<string> {
    const creds = JSON.parse(readFileSync(filePath, 'utf8')) as {
      access_token?: string;
      refresh_token?: string;
      expires_at?: number;
      expires_in?: number;
      scope?: string;
      token_type?: string;
    };
    if (!creds.access_token) throw usageError('access_token_missing');
    // Sem expires_at registrado: usa o token como esta (so renova quando sabe que venceu).
    const expiresAtMs = Number(creds.expires_at ?? 0) * 1000; // expires_at e em SEGUNDOS
    if (!creds.expires_at || expiresAtMs > Date.now() + 60_000) return creds.access_token;
    if (!creds.refresh_token) throw usageError('refresh_token_missing');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      client_id: KIMI_OAUTH_CLIENT_ID,
    });
    const response = await this.fetchFn(KIMI_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw usageError('refresh_failed');
    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope?: string;
      token_type?: string;
    };
    const next = {
      ...creds,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      expires_in: data.expires_in,
      scope: data.scope ?? creds.scope,
      token_type: data.token_type ?? 'Bearer',
    };
    writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);
    return data.access_token;
  }

  private async kimiUsage(configDir?: string): Promise<ProviderUsage> {
    const filePath = join(configDir ?? join(this.home, '.kimi-code'), 'credentials', 'kimi-code.json');
    if (!existsSync(filePath)) throw usageError('credentials_missing');
    const token = await this.kimiToken(filePath);

    const data = await this.fetchJson('https://api.kimi.com/coding/v1/usages', {
      authorization: `Bearer ${token}`,
    });
    const windows: UsageWindow[] = [];
    const limits = Array.isArray(data?.limits) ? (data.limits as Array<Record<string, unknown>>) : [];
    for (const entry of limits) {
      const win = entry?.window as { duration?: number; timeUnit?: string } | undefined;
      const detail = entry?.detail as { limit?: string; used?: string; remaining?: string; resetTime?: string } | undefined;
      if (!win || !detail) continue;
      const minutes = Number(win.duration ?? 0) * (String(win.timeUnit).includes('HOUR') ? 60 : 1);
      if (!Number.isFinite(minutes) || minutes <= 0 || (detail.used === undefined && detail.remaining === undefined)) continue;
      const kind = kindFromSeconds(minutes * 60);
      mergeWindow(windows, windowOf(kind, percentOfUsage(detail), detail.resetTime ?? null));
    }
    const weekly = data?.usage as { limit?: string; used?: string; remaining?: string; resetTime?: string } | undefined;
    if (weekly && (weekly.used !== undefined || weekly.remaining !== undefined)) {
      mergeWindow(windows, windowOf('weekly', percentOfUsage(weekly), weekly.resetTime ?? null));
    }

    const level = (data?.user as { membership?: { level?: string } } | undefined)?.membership?.level ?? null;
    const plan = level ? level.replace(/^LEVEL_/, '').charAt(0).toUpperCase() + level.replace(/^LEVEL_/, '').slice(1).toLowerCase() : null;
    return { provider: 'kimi', plan, windows, error: null, diagnostic: null, helpUrl: null, fetchedAt: new Date().toISOString() };
  }

  private async fetchJson(url: string, headers: Record<string, string>): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchFn(url, { headers, signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        throw usageError('credential_expired');
      }
      if (!response.ok) throw usageError('api_request_failed');
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw usageError('api_timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function percentOfUsage(value: { used?: string; remaining?: string; limit?: string }): number {
  const limitNum = Number(value.limit ?? 0);
  if (!limitNum) return 0;
  const usedNum = value.used === undefined
    ? Math.max(0, limitNum - Number(value.remaining ?? limitNum))
    : Number(value.used);
  return (usedNum / limitNum) * 100;
}

/** Le uma entrada do Keychain do macOS (ex.: credenciais do Claude Code). */
async function readMacOsKeychain(service: string): Promise<string | null> {
  try {
    const exec = promisify(execFile);
    const { stdout } = await exec('security', ['find-generic-password', '-s', service, '-w'], { timeout: 10_000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export const usageService = new UsageService();
