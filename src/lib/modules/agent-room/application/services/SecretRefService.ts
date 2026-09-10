import { uuidv7 } from '@beeblock/svelar/support';
import type { SecretRefInput } from '../../contracts/schemas/autonomy-policy.schema.js';
import { secretRefInputSchema } from '../../contracts/schemas/autonomy-policy.schema.js';
import { AgentSecretRef } from '../../domain/models/AgentSecretRef.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { desktopSecretService } from '../../infrastructure/secrets/DesktopSecretService.js';
import { autonomyPolicyService } from './AutonomyPolicyService.js';

export type SecretRefRecord = {
  id: string;
  ref: string;
  workspaceId: string;
  name: string;
  purpose: string | null;
  provider: 'desktop' | 'host_vault';
  bindings: SecretRefInput['bindings'];
  enabled: boolean;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const hostVault = globalThis as typeof globalThis & {
  __orkestraiHostVaultResolve?: (reference: string) => Promise<string | null>;
};

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseBindings(value: unknown): SecretRefInput['bindings'] {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return secretRefInputSchema.shape.bindings.parse(parsed);
  } catch (error) {
    throw new Error('SecretRef bindings are invalid and must be repaired before this credential can be used.', {
      cause: error,
    });
  }
}

function mapSecret(model: AgentSecretRef): SecretRefRecord {
  const id = String(model.getAttribute('id'));
  return {
    id,
    ref: 'secretref:' + id,
    workspaceId: String(model.getAttribute('workspace_id')),
    name: String(model.getAttribute('name')),
    purpose: model.getAttribute('purpose') ? String(model.getAttribute('purpose')) : null,
    provider: String(model.getAttribute('provider')) as 'desktop' | 'host_vault',
    bindings: parseBindings(model.getAttribute('bindings_json')),
    enabled: Boolean(model.getAttribute('enabled')),
    lastUsedAt: model.getAttribute('last_used_at') ? iso(model.getAttribute('last_used_at')) : null,
    createdAt: iso(model.getAttribute('created_at')),
    updatedAt: iso(model.getAttribute('updated_at')),
  };
}

export function secretStorageKey(workspaceId: string, id: string): string {
  return 'automation:secret-ref:' + workspaceId + ':' + id;
}

export class SensitiveValue {
  readonly sensitive = true;

  constructor(private readonly value: string, readonly reference: string) {}

  revealInsideTrustedExecutor(): string {
    return this.value;
  }

  toJSON(): string {
    return '[redacted-secret]';
  }

  toString(): string {
    return '[redacted-secret]';
  }
}

export class SecretRefService {
  async list(workspaceId: string): Promise<SecretRefRecord[]> {
    const rows = await AgentSecretRef.query().where('workspace_id', workspaceId).orderBy('created_at', 'asc').get();
    return rows.map(mapSecret);
  }

  async create(workspaceId: string, input: SecretRefInput): Promise<SecretRefRecord> {
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!workspace) throw new Error('Workspace not found.');
    const validated = secretRefInputSchema.parse(input);
    const id = uuidv7();
    const now = new Date();
    const model = await AgentSecretRef.create({
      id,
      workspace_id: workspaceId,
      name: validated.name,
      purpose: validated.purpose ?? null,
      provider: validated.provider,
      secret_key: secretStorageKey(workspaceId, id),
      bindings_json: JSON.stringify(validated.bindings),
      enabled: true,
      last_used_at: null,
      created_at: now,
      updated_at: now,
    });
    return mapSecret(model);
  }

  async remove(workspaceId: string, id: string): Promise<boolean> {
    const model = await AgentSecretRef.query().where('workspace_id', workspaceId).where('id', id).first();
    if (!model) return false;
    if (String(model.getAttribute('provider')) === 'desktop') {
      await desktopSecretService.delete(String(model.getAttribute('secret_key'))).catch(() => undefined);
    }
    return (await AgentSecretRef.query().where('id', id).delete()) > 0;
  }

  async resolve(
    workspaceId: string,
    reference: string,
    context: { integration?: string; operation?: string; destination?: string },
  ): Promise<SensitiveValue> {
    const id = reference.replace(/^secretref:/i, '');
    if (!/^[0-9a-f-]{16,}$/i.test(id)) throw new Error('Invalid SecretRef.');
    const model = await AgentSecretRef.query().where('workspace_id', workspaceId).where('id', id).first();
    if (!model || !model.getAttribute('enabled')) throw new Error('SecretRef is unavailable.');
    const bindings = parseBindings(model.getAttribute('bindings_json'));
    if (bindings.integrations.length && (!context.integration || !bindings.integrations.includes(context.integration))) {
      throw new Error('SecretRef is not bound to this integration.');
    }
    if (bindings.operations.length && (!context.operation || !bindings.operations.includes(context.operation))) {
      throw new Error('SecretRef is not bound to this operation.');
    }
    if (bindings.destinations.length) {
      const destination = context.destination?.toLowerCase();
      if (!destination || !bindings.destinations.some((allowed) => allowed === destination || (allowed.startsWith('*.') && destination.endsWith(allowed.slice(1))))) {
        throw new Error('SecretRef is not bound to this destination.');
      }
    }
    return autonomyPolicyService.execute({
      workspaceId,
      capability: 'integration',
      operation: 'secret:resolve:' + (context.operation ?? 'unspecified'),
      target: context.destination ?? context.integration ?? reference,
      mutation: false,
      actorType: 'integration',
      actorId: context.integration ?? null,
      input: { reference, ...context },
      certainty: 'semantic',
    }, async () => {
      const provider = String(model.getAttribute('provider'));
      const key = String(model.getAttribute('secret_key'));
      const value = provider === 'host_vault'
        ? await hostVault.__orkestraiHostVaultResolve?.(reference) ?? null
        : await desktopSecretService.get(key);
      if (!value) throw new Error('SecretRef has no stored value.');
      await AgentSecretRef.query().where('id', id).update({ last_used_at: new Date(), updated_at: new Date() });
      return new SensitiveValue(value, reference);
    });
  }

  /** Rotates an already-authorized credential without exposing it to the renderer or persistence payloads. */
  async replaceValue(workspaceId: string, reference: string, value: string): Promise<void> {
    const id = reference.replace(/^secretref:/i, '');
    const model = await AgentSecretRef.query().where('workspace_id', workspaceId).where('id', id).first();
    if (!model || !model.getAttribute('enabled')) throw new Error('SecretRef is unavailable.');
    if (String(model.getAttribute('provider')) !== 'desktop') throw new Error('This SecretRef provider cannot be rotated locally.');
    await desktopSecretService.set(String(model.getAttribute('secret_key')), value);
    await AgentSecretRef.query().where('id', id).update({ last_used_at: new Date(), updated_at: new Date() });
  }
}

export const secretRefService = new SecretRefService();
