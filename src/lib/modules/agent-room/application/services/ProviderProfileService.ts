import { homedir } from 'node:os';
import { getAgentAdapter, hasAgentAdapter } from '../adapters/registry.js';
import type { AgentProfileStrategy } from '../adapters/types.js';
import type { ProviderProfile } from '../../domain/types.js';
import { usageRoutingId } from '../../domain/usage-routing.js';
import {
  providerProfileRepository,
  type ProviderProfileRepository,
} from '../../infrastructure/repositories/ProviderProfileRepository.js';
import { desktopSecretService } from '../../infrastructure/secrets/DesktopSecretService.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';

function secretKey(profileId: string): string {
  return `automation:provider-profile:${profileId}`;
}

/** `~` nao expande sozinho fora de um shell. A home correta depende do
    runtime efetivo (host ou distribuicao WSL), entao expandimos no resolve. */
function expandHome(dir: string, runtimeHome = homedir()): string {
  return dir === '~' || dir.startsWith('~/') ? dir.replace(/^~/, runtimeHome) : dir;
}

function normalizeName(name: string): string {
  return name.normalize('NFKC').toLocaleLowerCase('en-US');
}

export type ProviderProfileErrorCode =
  | 'profile_unknown_provider'
  | 'profile_not_found'
  | 'profile_unsupported'
  | 'profile_name_required'
  | 'profile_duplicate'
  | 'profile_config_required'
  | 'profile_directories_required'
  | 'profile_token_required'
  | 'profile_in_use';

export class ProviderProfileError extends Error {
  constructor(public readonly code: ProviderProfileErrorCode, message: string) {
    super(message);
    this.name = 'ProviderProfileError';
  }
}

async function profileIsReferenced(profileId: string, providerId: string): Promise<boolean> {
  const { modelAccessService } = await import('$lib/modules/model-access/application/services/ModelAccessService.js');
  if (await modelAccessService.referencesProfile(profileId)) return true;
  const routingId = usageRoutingId({ provider: providerId, profileId });
  for (const workspace of await workspaceRepository.listWorkspaces()) {
    const nodes = await workspaceRepository.listNodes(workspace.id, undefined, true, true);
    if (nodes.some((node) => {
      const payload = node.payload as Record<string, unknown>;
      return payload.profileId === profileId || payload.sourceProvider === routingId || payload.fallbackProvider === routingId;
    })) return true;
  }
  return false;
}

export type SaveProviderProfileInput = {
  providerId: string;
  name: string;
  configDir?: string | null;
  dataDir?: string | null;
  token?: string | null;
};

type SecretStore = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type ProviderProfileServiceOptions = {
  repository?: ProviderProfileRepository;
  secrets?: SecretStore;
  adapterProfileStrategy?: (providerId: string) => AgentProfileStrategy;
  isProfileReferenced?: (profileId: string, providerId: string) => Promise<boolean>;
};

export class ProviderProfileService {
  private readonly repository: ProviderProfileRepository;
  private readonly secrets: SecretStore;
  private readonly adapterProfileStrategy: (providerId: string) => AgentProfileStrategy;
  private readonly isProfileReferenced: (profileId: string, providerId: string) => Promise<boolean>;

  constructor(options: ProviderProfileServiceOptions = {}) {
    this.repository = options.repository ?? providerProfileRepository;
    this.secrets = options.secrets ?? desktopSecretService;
    this.isProfileReferenced = options.isProfileReferenced ?? profileIsReferenced;
    this.adapterProfileStrategy = options.adapterProfileStrategy ?? ((providerId) => {
      if (!hasAgentAdapter(providerId)) throw new ProviderProfileError('profile_unknown_provider', `Unknown provider: "${providerId}".`);
      return getAgentAdapter(providerId).profileStrategy;
    });
  }

  async list(providerId?: string): Promise<ProviderProfile[]> {
    return this.repository.list(providerId);
  }

  /** Resolve por id OU nome (case-insensitive) — a bridge/CLI/MCP recebem um
      nome digitado pelo agente, nao o uuid interno. */
  async resolveByIdOrName(providerId: string, idOrName: string): Promise<ProviderProfile | null> {
    const byId = await this.repository.find(idOrName);
    if (byId && byId.providerId === providerId) return byId;
    return this.repository.findByNormalizedName(providerId, normalizeName(idOrName.trim()));
  }

  strategyFor(providerId: string): AgentProfileStrategy {
    return this.adapterProfileStrategy(providerId);
  }

  /** Omission inherits a same-provider leader; explicit null selects the default account. */
  async resolveCreationProfile(
    providerId: string,
    requestedProfileId: unknown,
    leader?: { provider?: unknown; profileId?: unknown } | null,
  ): Promise<string | null> {
    const selected = requestedProfileId === undefined
      ? (leader?.provider === providerId ? leader.profileId : null)
      : requestedProfileId;
    if (selected == null || selected === '') return null;
    if (typeof selected !== 'string') throw new ProviderProfileError('profile_not_found', 'Invalid agent profile.');
    const profileId = selected.trim();
    if (!profileId) return null;
    await this.assertCompatible(profileId, providerId);
    return profileId;
  }

  async assertCompatible(profileId: string, expectedProviderId: string): Promise<void> {
    const profile = await this.repository.find(profileId);
    if (!profile || profile.providerId !== expectedProviderId) {
      throw new ProviderProfileError('profile_not_found', 'Profile not found for this provider.');
    }
    const strategy = this.strategyFor(profile.providerId);
    if (strategy.kind === 'configDir' && !profile.configDir) {
      throw new ProviderProfileError('profile_config_required', 'Profile has no config directory.');
    }
    if (strategy.kind === 'configDirPair' && (!profile.configDir || !profile.dataDir)) {
      throw new ProviderProfileError('profile_directories_required', 'Profile has incomplete config and data directories.');
    }
    if (strategy.kind === 'token' && !profile.hasToken) {
      throw new ProviderProfileError('profile_token_required', 'Profile has no saved token.');
    }
    if (strategy.kind === 'unsupported') {
      throw new ProviderProfileError('profile_unsupported', `Provider "${profile.providerId}" does not support profiles.`);
    }
  }

  async create(input: SaveProviderProfileInput): Promise<ProviderProfile> {
    const { name, normalizedName, configDir, dataDir, hasToken } = await this.validate(input, null);
    const created = await this.repository.create({
      providerId: input.providerId,
      name,
      normalizedName,
      configDir,
      dataDir,
      hasToken,
    });
    if (hasToken && input.token) {
      try {
        const token = input.token.trim();
        await this.secrets.set(secretKey(created.id), token);
        if (await this.secrets.get(secretKey(created.id)) !== token) {
          throw new Error('The secure credential store did not persist the profile token.');
        }
      } catch (error) {
        await this.secrets.delete(secretKey(created.id)).catch(() => undefined);
        await this.repository.delete(created.id).catch(() => false);
        throw error;
      }
    }
    return created;
  }

  async update(id: string, input: SaveProviderProfileInput): Promise<ProviderProfile> {
    const existing = await this.repository.find(id);
    if (!existing || existing.providerId !== input.providerId) throw new ProviderProfileError('profile_not_found', 'Profile not found for this provider.');
    const { name, normalizedName, configDir, dataDir, hasToken } = await this.validate(input, existing);
    const updated = await this.repository.update(id, { name, normalizedName, configDir, dataDir, hasToken });
    if (!updated) throw new ProviderProfileError('profile_not_found', 'Profile not found.');
    if (hasToken && input.token) {
      const token = input.token.trim();
      await this.secrets.set(secretKey(id), token);
      if (await this.secrets.get(secretKey(id)) !== token) {
        throw new Error('The secure credential store did not persist the profile token.');
      }
    }
    return updated;
  }

  async delete(id: string): Promise<void> {
    const profile = await this.repository.find(id);
    if (!profile) return;
    if (await this.isProfileReferenced(id, profile.providerId)) {
      throw new ProviderProfileError('profile_in_use', 'Switch terminals and Usage routing away from this profile before removing it.');
    }
    // Remove and verify the credential first. If the secure store cannot be
    // changed, keep the database row so the user can retry instead of leaving
    // an unreachable encrypted secret behind.
    if (profile.hasToken) {
      await this.secrets.delete(secretKey(id));
      if (await this.secrets.get(secretKey(id)) !== null) {
        throw new Error('The secure credential store did not remove the profile token.');
      }
    }
    await this.repository.delete(id);
  }

  /** Env a aplicar ao spawnar o processo com esse perfil ativo — determinado
      pela estrategia do provider, nunca por "todas as chaves ja vistas" (o
      jeito fragil que perfis genericos de env costumam usar). */
  async resolveEnv(
    profileId: string,
    expectedProviderId: string,
    options: { runtimeHome?: string } = {},
  ): Promise<Record<string, string>> {
    const profile = await this.repository.find(profileId);
    if (!profile || profile.providerId !== expectedProviderId) throw new ProviderProfileError('profile_not_found', 'Profile not found for this provider.');
    const strategy = this.strategyFor(profile.providerId);
    if (strategy.kind === 'configDir') {
      if (!profile.configDir) throw new ProviderProfileError('profile_config_required', 'Profile has no config directory.');
      return { [strategy.envVar]: expandHome(profile.configDir, options.runtimeHome) };
    }
    if (strategy.kind === 'configDirPair') {
      if (!profile.configDir || !profile.dataDir) throw new ProviderProfileError('profile_directories_required', 'Profile has incomplete config and data directories.');
      return {
        [strategy.configEnvVar]: expandHome(profile.configDir, options.runtimeHome),
        [strategy.dataEnvVar]: expandHome(profile.dataDir, options.runtimeHome),
      };
    }
    if (strategy.kind === 'token') {
      const token = await this.secrets.get(secretKey(profileId));
      if (!token) throw new ProviderProfileError('profile_token_required', 'Profile has no saved token.');
      return { [strategy.envVar]: token };
    }
    throw new ProviderProfileError('profile_unsupported', `Provider "${profile.providerId}" does not support profiles.`);
  }

  private async validate(
    input: SaveProviderProfileInput,
    existing: ProviderProfile | null,
  ): Promise<{ name: string; normalizedName: string; configDir: string | null; dataDir: string | null; hasToken: boolean }> {
    const strategy = this.strategyFor(input.providerId);
    if (strategy.kind === 'unsupported') {
      throw new ProviderProfileError('profile_unsupported', `${input.providerId} has no supported multi-account mechanism.`);
    }
    const name = input.name.trim().slice(0, 48);
    if (!name) throw new ProviderProfileError('profile_name_required', 'Enter a profile name.');
    const normalizedName = normalizeName(name);
    const duplicate = await this.repository.findByNormalizedName(input.providerId, normalizedName);
    if (duplicate && duplicate.id !== existing?.id) throw new ProviderProfileError('profile_duplicate', `A profile named "${name}" already exists for this provider.`);

    if (strategy.kind === 'configDir') {
      const configDir = input.configDir?.trim();
      if (!configDir) throw new ProviderProfileError('profile_config_required', 'Enter the profile config directory.');
      return { name, normalizedName, configDir, dataDir: null, hasToken: false };
    }
    if (strategy.kind === 'configDirPair') {
      const configDir = input.configDir?.trim();
      const dataDir = input.dataDir?.trim();
      if (!configDir || !dataDir) throw new ProviderProfileError('profile_directories_required', 'Enter both profile directories (config and data).');
      return { name, normalizedName, configDir, dataDir, hasToken: false };
    }
    // strategy.kind === 'token'
    const token = input.token?.trim();
    if (!token && !existing?.hasToken) throw new ProviderProfileError('profile_token_required', 'Enter the profile token.');
    return { name, normalizedName, configDir: null, dataDir: null, hasToken: Boolean(token || existing?.hasToken) };
  }
}

export const providerProfileService = new ProviderProfileService();
