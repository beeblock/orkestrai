import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod';
import {
  autonomyAuditQuerySchema,
  autonomyGateResolutionSchema,
  autonomyPolicyInputSchema,
  secretRefInputSchema,
} from '../../../contracts/schemas/autonomy-policy.schema.js';
import { autonomyPolicyService } from '../../../application/services/AutonomyPolicyService.js';
import { secretRefService, secretStorageKey } from '../../../application/services/SecretRefService.js';

function requestOf(schema: z.ZodTypeAny) {
  return class extends FormRequest {
    rules() { return schema; }
    authorize(): boolean { return true; }
    passedValidation(data: unknown) { return schema.parse(data); }
  };
}

export class AutonomyPolicyController extends Controller {
  async show(event: any) {
    try {
      return this.json({ data: await autonomyPolicyService.get(event.params.id) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async update(event: any) {
    try {
      const input = await (requestOf(autonomyPolicyInputSchema)).validate(event);
      return this.json({ data: await autonomyPolicyService.update(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async stop(event: any) {
    try {
      return this.json({ data: await autonomyPolicyService.emergencyStop(event.params.id) });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async gates(event: any) {
    return this.json({ data: await autonomyPolicyService.listGates(event.params.id) });
  }

  async resolveGate(event: any) {
    try {
      const input = await (requestOf(autonomyGateResolutionSchema)).validate(event);
      return this.json({
        data: await autonomyPolicyService.resolveGate(
          event.params.id,
          event.params.gateId,
          input.decision,
          'workspace-owner',
          input.note,
        ),
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async audit(event: any) {
    try {
      const query = autonomyAuditQuerySchema.parse(Object.fromEntries(event.url.searchParams));
      const [events, integrity] = await Promise.all([
        autonomyPolicyService.listAudit(event.params.id, query.limit, query.runId),
        autonomyPolicyService.verifyAudit(event.params.id),
      ]);
      return this.json({ data: { events, integrity } });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async exportAudit(event: any) {
    try {
      const payload = await autonomyPolicyService.exportAudit(event.params.id);
      const date = payload.exportedAt.slice(0, 10);
      return new Response(JSON.stringify(payload, null, 2), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="orkestrai-audit-${date}.json"`,
          'cache-control': 'no-store',
        },
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async secretRefs(event: any) {
    return this.json({ data: await secretRefService.list(event.params.id) });
  }

  async createSecretRef(event: any) {
    try {
      const input = await (requestOf(secretRefInputSchema)).validate(event);
      const ref = await secretRefService.create(event.params.id, input);
      return this.json({ data: { ...ref, storageKey: secretStorageKey(event.params.id, ref.id) } }, 201);
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  async removeSecretRef(event: any) {
    return this.json({ data: { deleted: await secretRefService.remove(event.params.id, event.params.secretId) } });
  }

  private errorResponse(error: unknown) {
    return this.json({ error: error instanceof Error ? error.message : 'Autonomy request failed.' }, 400);
  }
}
