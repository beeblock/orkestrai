import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProviderProfileService } from '$lib/modules/agent-room/application/services/ProviderProfileService.js';
import type { AgentProfileStrategy } from '$lib/modules/agent-room/application/adapters/types.js';
import type { ProviderProfile } from '$lib/modules/agent-room/domain/types.js';
import type {
  CreateProviderProfileInput,
  ProviderProfileRepository,
} from '$lib/modules/agent-room/infrastructure/repositories/ProviderProfileRepository.js';

const STRATEGIES: Record<string, AgentProfileStrategy> = {
  claude: { kind: 'configDir', envVar: 'CLAUDE_CONFIG_DIR', defaultDir: '~/.claude' },
  opencode: {
    kind: 'configDirPair',
    configEnvVar: 'OPENCODE_CONFIG_DIR',
    dataEnvVar: 'XDG_DATA_HOME',
    defaultConfigDir: '~/.config/opencode',
    defaultDataDir: '~/.local/share',
  },
  tokenProvider: { kind: 'token', envVar: 'TEST_PROVIDER_TOKEN' },
  antigravity: { kind: 'unsupported' },
};

function fakeRepository(seed: ProviderProfile[] = []): ProviderProfileRepository {
  const rows = [...seed];
  let counter = 0;
  return {
    async list(providerId?: string) {
      return providerId ? rows.filter((row) => row.providerId === providerId) : [...rows];
    },
    async find(id: string) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async findByNormalizedName(providerId: string, normalizedName: string) {
      return rows.find((row) => row.providerId === providerId && row.name.normalize('NFKC').toLocaleLowerCase('en-US') === normalizedName) ?? null;
    },
    async create(input: CreateProviderProfileInput) {
      const now = new Date().toISOString();
      const row: ProviderProfile = {
        id: `profile-${++counter}`,
        providerId: input.providerId,
        name: input.name,
        configDir: input.configDir,
        dataDir: input.dataDir,
        hasToken: input.hasToken,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return row;
    },
    async update(id: string, input: Partial<CreateProviderProfileInput>) {
      const row = rows.find((entry) => entry.id === id);
      if (!row) return null;
      Object.assign(row, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.configDir !== undefined ? { configDir: input.configDir } : {}),
        ...(input.dataDir !== undefined ? { dataDir: input.dataDir } : {}),
        ...(input.hasToken !== undefined ? { hasToken: input.hasToken } : {}),
      });
      return row;
    },
    async delete(id: string) {
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    },
  } satisfies ProviderProfileRepository;
}

function fakeSecrets() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

function service(seed: ProviderProfile[] = []) {
  return new ProviderProfileService({
    repository: fakeRepository(seed),
    secrets: fakeSecrets(),
    isProfileReferenced: async () => false,
    adapterProfileStrategy: (providerId) => {
      const strategy = STRATEGIES[providerId];
      if (!strategy) throw new Error(`unknown provider: ${providerId}`);
      return strategy;
    },
  });
}

describe('ProviderProfileService', () => {
  it('inherits an account reference without resolving its host or WSL environment early', async () => {
    const svc = service();
    const profile = await svc.create({ providerId: 'claude', name: 'Work', configDir: '~/.claude-work' });
    const inherited = await svc.resolveCreationProfile('claude', undefined, { provider: 'claude', profileId: profile.id });
    expect(inherited).toBe(profile.id);
    await expect(svc.resolveEnv(inherited!, 'claude', { runtimeHome: '/home/wsl' })).resolves.toEqual({ CLAUDE_CONFIG_DIR: '/home/wsl/.claude-work' });
    await expect(svc.resolveEnv(inherited!, 'claude', { runtimeHome: '/Users/native' })).resolves.toEqual({ CLAUDE_CONFIG_DIR: '/Users/native/.claude-work' });
    expect((await svc.list())[0].configDir).toBe('~/.claude-work');
  });
  it('does not inherit a malformed or incompatible account as the default account', async () => {
    const svc = service();
    await expect(svc.resolveCreationProfile('claude', undefined, { provider: 'claude', profileId: 123 })).rejects.toMatchObject({ code: 'profile_not_found' });
    const other = await svc.create({ providerId: 'opencode', name: 'Other', configDir: '/tmp/other-config', dataDir: '/tmp/other-data' });
    await expect(svc.resolveCreationProfile('claude', undefined, { provider: 'claude', profileId: other.id })).rejects.toMatchObject({ code: 'profile_not_found' });
  });
  it('creates a configDir profile and resolves its env by the provider strategy', async () => {
    const svc = service();
    const created = await svc.create({ providerId: 'claude', name: 'Trabalho', configDir: '/tmp/claude-trabalho' });
    expect(created.configDir).toBe('/tmp/claude-trabalho');
    expect(created.hasToken).toBe(false);
    await expect(svc.resolveEnv(created.id, 'claude')).resolves.toEqual({ CLAUDE_CONFIG_DIR: '/tmp/claude-trabalho' });
  });

  it('keeps ~ portable and expands it for the runtime home at spawn time', async () => {
    const svc = service();
    const created = await svc.create({ providerId: 'claude', name: 'Trabalho', configDir: '~/.claude-trabalho' });
    expect(created.configDir).toBe('~/.claude-trabalho');
    await expect(svc.resolveEnv(created.id, 'claude')).resolves.toEqual({
      CLAUDE_CONFIG_DIR: join(homedir(), '.claude-trabalho'),
    });
    await expect(svc.resolveEnv(created.id, 'claude', { runtimeHome: '/home/dev' })).resolves.toEqual({
      CLAUDE_CONFIG_DIR: '/home/dev/.claude-trabalho',
    });
  });

  it('requires both directories for a configDirPair strategy', async () => {
    const svc = service();
    await expect(svc.create({ providerId: 'opencode', name: 'Trabalho', configDir: '/tmp/opencode-trabalho' }))
      .rejects.toMatchObject({ code: 'profile_directories_required' });
    const created = await svc.create({
      providerId: 'opencode',
      name: 'Trabalho',
      configDir: '/tmp/opencode-trabalho',
      dataDir: '/tmp/share-trabalho',
    });
    await expect(svc.resolveEnv(created.id, 'opencode')).resolves.toEqual({
      OPENCODE_CONFIG_DIR: '/tmp/opencode-trabalho',
      XDG_DATA_HOME: '/tmp/share-trabalho',
    });
  });

  it('stores a token profile secret out of band and resolves it back as env', async () => {
    const svc = service();
    const created = await svc.create({ providerId: 'tokenProvider', name: 'Trabalho', token: 'secret-token' });
    expect(created.hasToken).toBe(true);
    await expect(svc.resolveEnv(created.id, 'tokenProvider')).resolves.toEqual({ TEST_PROVIDER_TOKEN: 'secret-token' });
  });

  it('rejects creating a profile for a provider without an official multi-account mechanism', async () => {
    const svc = service();
    await expect(svc.create({ providerId: 'antigravity', name: 'Trabalho' })).rejects.toMatchObject({ code: 'profile_unsupported' });
  });

  it('rejects a duplicate profile name for the same provider case-insensitively', async () => {
    const svc = service();
    await svc.create({ providerId: 'claude', name: 'Trabalho', configDir: '~/.claude-trabalho' });
    await expect(svc.create({ providerId: 'claude', name: 'trabalho', configDir: '~/.claude-outro' }))
      .rejects.toMatchObject({ code: 'profile_duplicate' });
  });

  it('resolves by stable id, so renaming a profile never breaks resolution', async () => {
    const svc = service();
    const created = await svc.create({ providerId: 'claude', name: 'Trabalho', configDir: '/tmp/claude-trabalho' });
    await svc.update(created.id, { providerId: 'claude', name: 'Conta B', configDir: '/tmp/claude-trabalho' });
    await expect(svc.resolveEnv(created.id, 'claude')).resolves.toEqual({ CLAUDE_CONFIG_DIR: '/tmp/claude-trabalho' });
  });

  it('rejects resolving a profile against the wrong provider', async () => {
    const svc = service();
    const created = await svc.create({ providerId: 'claude', name: 'Trabalho', configDir: '~/.claude-trabalho' });
    await expect(svc.resolveEnv(created.id, 'codex')).rejects.toMatchObject({ code: 'profile_not_found' });
  });

  it('validates a profile reference without resolving its secret', async () => {
    let secretReads = 0;
    const repository = fakeRepository();
    const svc = new ProviderProfileService({
      repository,
      secrets: {
        get: async () => { secretReads += 1; return 'secret'; },
        set: async () => undefined,
        delete: async () => undefined,
      },
      isProfileReferenced: async () => false,
      adapterProfileStrategy: () => STRATEGIES.tokenProvider,
    });
    const profile = await repository.create({
      providerId: 'tokenProvider',
      name: 'Work',
      normalizedName: 'work',
      configDir: null,
      dataDir: null,
      hasToken: true,
    });

    await expect(svc.assertCompatible(profile.id, 'tokenProvider')).resolves.toBeUndefined();
    await expect(svc.assertCompatible(profile.id, 'other')).rejects.toMatchObject({ code: 'profile_not_found' });
    expect(secretReads).toBe(0);
  });

  it('rolls back the database row when secure token storage fails', async () => {
    const repository = fakeRepository();
    const svc = new ProviderProfileService({
      repository,
      secrets: {
        get: async () => null,
        set: async () => { throw new Error('keychain unavailable'); },
        delete: async () => undefined,
      },
      isProfileReferenced: async () => false,
      adapterProfileStrategy: () => STRATEGIES.tokenProvider,
    });

    await expect(svc.create({ providerId: 'tokenProvider', name: 'Work', token: 'secret' })).rejects.toThrow('keychain unavailable');
    await expect(repository.list('tokenProvider')).resolves.toEqual([]);
  });

  it('does not claim a token was saved when the secure store silently drops it', async () => {
    const repository = fakeRepository();
    const svc = new ProviderProfileService({
      repository,
      secrets: {
        get: async () => null,
        set: async () => undefined,
        delete: async () => undefined,
      },
      isProfileReferenced: async () => false,
      adapterProfileStrategy: () => STRATEGIES.tokenProvider,
    });

    await expect(svc.create({ providerId: 'tokenProvider', name: 'Work', token: 'secret' }))
      .rejects.toThrow('did not persist');
    await expect(repository.list('tokenProvider')).resolves.toEqual([]);
  });

  it('refuses to remove a profile still referenced by a terminal or Usage routing', async () => {
    const repository = fakeRepository();
    const svc = new ProviderProfileService({
      repository,
      secrets: fakeSecrets(),
      isProfileReferenced: async () => true,
      adapterProfileStrategy: () => STRATEGIES.claude,
    });
    const created = await svc.create({ providerId: 'claude', name: 'Work', configDir: '/tmp/claude-work' });

    await expect(svc.delete(created.id)).rejects.toMatchObject({ code: 'profile_in_use' });
    await expect(repository.find(created.id)).resolves.toMatchObject({ id: created.id });
  });

  it('keeps a token profile reachable when secure credential deletion fails', async () => {
    const repository = fakeRepository();
    const secrets = fakeSecrets();
    const svc = new ProviderProfileService({
      repository,
      secrets: {
        ...secrets,
        delete: async () => { throw new Error('keychain locked'); },
      },
      isProfileReferenced: async () => false,
      adapterProfileStrategy: () => STRATEGIES.tokenProvider,
    });
    const created = await svc.create({ providerId: 'tokenProvider', name: 'Work', token: 'secret' });

    await expect(svc.delete(created.id)).rejects.toThrow('keychain locked');
    await expect(repository.find(created.id)).resolves.toMatchObject({ id: created.id });
  });
});
