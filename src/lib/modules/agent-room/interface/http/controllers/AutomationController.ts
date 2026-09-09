import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { Controller } from '@beeblock/svelar/routing';
import { FormRequest } from '@beeblock/svelar/forms';
import { z } from 'zod';
import { automationEnabledSchema, automationFormSchema, githubIntegrationSchema } from '../../../contracts/schemas/automation.schema.js';
import { AutomationTriggerReceived } from '../../../domain/events/AutomationTriggerReceived.js';
import { routineService } from '../../../application/services/RoutineService.js';
import { automationIntegrationService } from '../../../application/services/AutomationIntegrationService.js';
import { automationRecipes } from '../../../application/catalogs/AutomationRecipeCatalog.js';

function requestOf(schema: z.ZodTypeAny) {
  return class extends FormRequest {
    rules() { return schema; }
    authorize(): boolean { return true; }
    passedValidation(data: unknown) { return schema.parse(data); }
  };
}

export class AutomationController extends Controller {
  async list(event: any) {
    return this.json({ data: await routineService.list(event.params.id) });
  }

  async create(event: any) {
    try {
      const input = await (requestOf(automationFormSchema)).validate(event);
      return this.json({ data: await routineService.createAutomation(event.params.id, input) }, 201);
    } catch (error) {
      return this.errorResponse(error, 'Failed to create automation.');
    }
  }

  async update(event: any) {
    try {
      const existing = await routineService.get(event.params.automationId);
      if (!existing || existing.workspaceId !== event.params.id) return this.json({ error: 'Automation not found.' }, 404);
      const input = await (requestOf(automationFormSchema)).validate(event);
      const automation = await routineService.updateAutomation(event.params.automationId, input);
      return this.json({ data: automation });
    } catch (error) {
      return this.errorResponse(error, 'Failed to update automation.');
    }
  }

  async enabled(event: any) {
    try {
      const existing = await routineService.get(event.params.automationId);
      if (!existing || existing.workspaceId !== event.params.id) return this.json({ error: 'Automation not found.' }, 404);
      const input = await (requestOf(automationEnabledSchema)).validate(event);
      const automation = await routineService.setEnabled(event.params.automationId, input.enabled);
      return this.json({ data: automation });
    } catch (error) {
      return this.errorResponse(error, 'Failed to update automation.');
    }
  }

  async remove(event: any) {
    const automation = await routineService.get(event.params.automationId);
    if (!automation || automation.workspaceId !== event.params.id) return this.json({ error: 'Automation not found.' }, 404);
    return this.json({ data: { deleted: await routineService.remove(automation.id) } });
  }

  async run(event: any) {
    try {
      const automation = await routineService.get(event.params.automationId);
      if (!automation || automation.workspaceId !== event.params.id) return this.json({ error: 'Automation not found.' }, 404);
      return this.json({ data: await routineService.runNow(automation.id) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to run automation.');
    }
  }

  async history(event: any) {
    const id = event.params.automationId;
    if (id) {
      const automation = await routineService.get(id);
      if (!automation || automation.workspaceId !== event.params.id) return this.json({ error: 'Automation not found.' }, 404);
    }
    return this.json({ data: id ? await routineService.history(id) : await routineService.workspaceHistory(event.params.id) });
  }

  async retry(event: any) {
    try {
      const run = await routineService.getRun(event.params.runId);
      const automation = run ? await routineService.get(run.routineId) : null;
      if (!run || !automation || automation.workspaceId !== event.params.id) return this.json({ error: 'Execution not found.' }, 404);
      return this.json({ data: await routineService.retry(event.params.runId) }, 202);
    } catch (error) {
      return this.errorResponse(error, 'Failed to retry automation.');
    }
  }

  async cancel(event: any) {
    try {
      const run = await routineService.getRun(event.params.runId);
      const automation = run ? await routineService.get(run.routineId) : null;
      if (!run || !automation || automation.workspaceId !== event.params.id) return this.json({ error: 'Execution not found.' }, 404);
      return this.json({ data: await routineService.cancel(run.id) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to cancel automation execution.');
    }
  }

  async recipes() {
    return this.json({ data: automationRecipes });
  }

  async integrations(event: any) {
    return this.json({ data: await automationIntegrationService.list(event.params.id) });
  }

  async connectGitHub(event: any) {
    try {
      const input = await (requestOf(githubIntegrationSchema)).validate(event);
      return this.json({ data: await automationIntegrationService.connectGitHub(event.params.id, input) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to connect GitHub.');
    }
  }

  async checkGitHub(event: any) {
    try {
      return this.json({ data: await automationIntegrationService.checkGitHub(event.params.id) });
    } catch (error) {
      return this.errorResponse(error, 'Failed to check GitHub.');
    }
  }

  async removeIntegration(event: any) {
    return this.json({ data: { deleted: await automationIntegrationService.remove(event.params.id, event.params.integrationId) } });
  }

  async webhook(event: any) {
    try {
      const automation = await routineService.get(event.params.automationId);
      if (!automation || automation.workspaceId !== event.params.id || automation.triggerType !== 'webhook') {
        return this.json({ error: 'Webhook automation not found.' }, 404);
      }
      const supplied = event.request.headers.get('x-orkestrai-webhook-secret')
        ?? event.request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
        ?? '';
      const expected = String(automation.triggerConfig.secretHash ?? '');
      const actual = createHash('sha256').update(supplied).digest('hex');
      const expectedBuffer = Buffer.from(expected);
      const actualBuffer = Buffer.from(actual);
      if (!expected || expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
        return this.json({ error: 'Invalid webhook credential.' }, 401);
      }
      const data = await event.request.json().catch(() => ({}));
      const key = `webhook:${event.request.headers.get('x-orkestrai-delivery') ?? randomUUID()}`;
      const dispatched = await routineService.dispatchEvent(new AutomationTriggerReceived(
        automation.workspaceId, 'webhook', 'received', key, { automationId: automation.id, payload: data },
      ));
      return this.json({ data: { accepted: true, dispatched } }, 202);
    } catch (error) {
      return this.errorResponse(error, 'Failed to receive webhook.');
    }
  }

  private errorResponse(error: unknown, fallback: string, status = 400) {
    return this.json({ error: error instanceof Error ? error.message : fallback }, status);
  }
}
