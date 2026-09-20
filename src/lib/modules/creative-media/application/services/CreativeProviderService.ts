import { uuidv7 } from '@beeblock/svelar/support';
import { desktopSecretService } from '$lib/modules/agent-room/infrastructure/secrets/DesktopSecretService.js';
import { SensitiveValue } from '$lib/modules/agent-room/application/services/SecretRefService.js';
import { creativeWorkspaceGateway } from '$lib/modules/agent-room/application/services/CreativeWorkspaceGateway.js';
import { autonomyPolicyService } from '$lib/modules/agent-room/application/services/AutonomyPolicyService.js';
import { creativeMediaRepository, type CreativeMediaRepository } from '../../infrastructure/repositories/CreativeMediaRepository.js';
import { creativePolicySaveSchema, creativeProfileSaveSchema, type CreativeProfileSave } from '../../contracts/schemas/creative-media.schema.js';
import { CreativeMediaError, type CreativeProfile } from '../../domain/types.js';
import { withCreativeProfileLock } from './creative-profile-lock.js';

type SecretStore = Pick<typeof desktopSecretService, 'get' | 'set' | 'delete'>;
const secretKey = (id: string) => `automation:creative-profile:${id}`;

export class CreativeProviderService {
  constructor(readonly repository: CreativeMediaRepository = creativeMediaRepository, private readonly secrets: SecretStore = desktopSecretService) {}

  async profiles() { return this.repository.profiles(); }

  async save(input: CreativeProfileSave, id?: string): Promise<CreativeProfile> {
    const value = creativeProfileSaveSchema.parse(input);
    const profileId = id ?? uuidv7();
    return withCreativeProfileLock(profileId, async () => {
      const current = id ? await this.repository.profile(id) : null;
      if (id && !current) throw new CreativeMediaError('creative_profile_not_found', 404);
      if (current && current.provider !== value.provider) throw new CreativeMediaError('creative_provider_mismatch', 409);
      if (value.provider === 'higgsfield' && value.credential && !/^[\x21-\x39\x3b-\x7e]+:[\x21-\x39\x3b-\x7e]+$/.test(value.credential)) throw new CreativeMediaError('creative_credential_invalid');
      if (current && current.revision !== value.revision) throw new CreativeMediaError('creative_revision_conflict', 409);
      if (!current && value.revision !== undefined) throw new CreativeMediaError('creative_revision_conflict', 409);
      if (value.credential && await this.repository.activeForProfile(profileId)) throw new CreativeMediaError('creative_profile_busy', 409);
      if (!current?.hasCredential && !value.credential) throw new CreativeMediaError('creative_credential_missing');
      let oldCredential: string | null = null;
      let replacedCredential = false;
      if (value.credential) {
        try {
          oldCredential = current ? await this.secrets.get(secretKey(profileId)) : null;
          await this.secrets.set(secretKey(profileId), value.credential);
          replacedCredential = true;
          if (await this.secrets.get(secretKey(profileId)) !== value.credential) throw new Error('unavailable');
        } catch {
          if (replacedCredential) {
            if (oldCredential) await this.secrets.set(secretKey(profileId), oldCredential).catch(() => undefined);
            else await this.secrets.delete(secretKey(profileId)).catch(() => undefined);
          }
          throw new CreativeMediaError('creative_vault_unavailable', 503);
        }
      }
      try {
        return await this.repository.saveProfile({ id: profileId, provider: value.provider, name: value.name, enabled: value.enabled, hasCredential: Boolean(current?.hasCredential || value.credential) }, value.revision);
      } catch (error) {
        if (!current) await this.secrets.delete(secretKey(profileId)).catch(() => undefined);
        else if (value.credential && oldCredential) await this.secrets.set(secretKey(profileId), oldCredential);
        throw error;
      }
    });
  }

  async remove(id: string): Promise<void> {
    return withCreativeProfileLock(id, async () => {
      if (await this.repository.activeForProfile(id)) throw new CreativeMediaError('creative_profile_busy', 409);
      await this.secrets.delete(secretKey(id));
      if (await this.secrets.get(secretKey(id)) !== null) throw new CreativeMediaError('creative_vault_unavailable', 503);
      await this.repository.removeProfile(id);
    });
  }

  async savePolicy(workspaceId: string, profileId: string, input: unknown) {
    if (!await creativeWorkspaceGateway.workspace(workspaceId)) throw new CreativeMediaError('creative_workspace_not_found', 404);
    if (!await this.repository.profile(profileId)) throw new CreativeMediaError('creative_profile_not_found', 404);
    const { revision, ...value } = creativePolicySaveSchema.parse(input);
    const result = await this.repository.savePolicy(workspaceId, profileId, value, revision);
    await autonomyPolicyService.recordSemanticEffect({ workspaceId, capability: 'integration', operation: 'creative.policy.save', actorType: 'user', input: { profileId, revision: result.revision } }, { enabled: result.enabled, modelIds: result.modelIds, maxRunCents: result.maxRunCents, maxDayCents: result.maxDayCents });
    return result;
  }

  /** Trusted server-side consumers only. Never return this value from a route. */
  async credential(profileId: string): Promise<SensitiveValue> {
    const profile = await this.repository.profile(profileId);
    if (!profile?.hasCredential) throw new CreativeMediaError('creative_credential_missing', 403);
    let value: string | null;
    try { value = await this.secrets.get(secretKey(profileId)); } catch { throw new CreativeMediaError('creative_vault_unavailable', 503); }
    if (!value) throw new CreativeMediaError('creative_credential_missing', 403);
    return new SensitiveValue(value, `creative-profile:${profileId}`);
  }
}
export const creativeProviderService = new CreativeProviderService();
