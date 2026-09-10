import { createHash, randomUUID } from 'node:crypto';
import { realpath, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { CanvasNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterService } from './ControlCenterService.js';
import type { PortalCommandResult } from './PortalService.js';
import {
  portalProfileSchema,
  type ManagedPortalCommand,
  type ManagedPortalExecutorRequest,
  type ManagedPortalExecutorResult,
  type PortalProfile,
} from '../../contracts/schemas/managed-portal.schema.js';
import { autonomyPolicyService, type AutonomyOperation } from './AutonomyPolicyService.js';

type PendingPortalRequest = {
  resolve: (result: ManagedPortalExecutorResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const runtime = globalThis as typeof globalThis & {
  __orkestraiPortalPending?: Map<string, PendingPortalRequest>;
  __orkestraiPortalListenerReady?: boolean;
  __orkestraiExecutePortal?: (request: ManagedPortalExecutorRequest) => Promise<ManagedPortalExecutorResult>;
};
const pending = runtime.__orkestraiPortalPending ??= new Map<string, PendingPortalRequest>();

if (!runtime.__orkestraiPortalListenerReady && typeof process.on === 'function') {
  process.on('message', (message: unknown) => {
    const response = message as { type?: string; requestId?: string; result?: ManagedPortalExecutorResult } | null;
    if (response?.type !== 'orkestrai:portal:result' || !response.requestId) return;
    const request = pending.get(response.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.requestId);
    request.resolve(response.result ?? { ok: false, error: 'Managed browser returned no result.' });
  });
  runtime.__orkestraiPortalListenerReady = true;
}

export function portalProfileFromPayload(payload: CanvasNodePayload): PortalProfile {
  const values = payload as Record<string, unknown>;
  return portalProfileSchema.parse({
    profileId: values.portalProfileId ?? 'default',
    profileScope: values.portalProfileScope ?? 'workspace',
    allowedHosts: Array.isArray(values.portalAllowedHosts) ? values.portalAllowedHosts : [],
    downloadDirectory: values.portalDownloadDirectory ?? '.orkestrai/downloads',
    control: values.portalControl ?? 'disabled',
    agentIds: values.portalAgentIds ?? [],
    paused: values.portalPaused ?? false,
    allowBackground: values.portalAllowBackground ?? false,
  });
}

export function assertAllowedPortalUrl(candidate: string, allowedHosts: string[], currentUrl?: string): URL {
  if (candidate.length > 4_096) throw new Error('Portal URL is too long.');
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Portal URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Portal navigation only accepts credential-free HTTP(S) URLs.');
  }
  let baseline = '';
  try { baseline = currentUrl ? new URL(currentUrl).hostname.toLowerCase() : ''; } catch { baseline = ''; }
  const allowed = new Set([...allowedHosts, baseline].filter(Boolean).map((host) => host.toLowerCase()));
  if (allowed.size > 0 && !allowed.has(url.hostname.toLowerCase())) {
    throw new Error(`Host ${url.hostname} is not allowed by this Portal.`);
  }
  return url;
}

export function confinePortalPath(workspaceRoot: string, candidate: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, candidate);
  const rel = relative(root, absolute);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw new Error('Portal file path must stay inside the workspace.');
  return absolute;
}

export async function preparePortalDirectory(root: string, candidate: string): Promise<string> {
  const requested = confinePortalPath(root, candidate);
  let ancestor = requested;
  while (true) {
    try { confinePortalPath(root, await realpath(ancestor)); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  await mkdir(requested, { recursive: true });
  return confinePortalPath(root, await realpath(requested));
}

async function requestElectron(request: ManagedPortalExecutorRequest, inspect = false): Promise<ManagedPortalExecutorResult | null> {
  if (runtime.__orkestraiExecutePortal) return runtime.__orkestraiExecutePortal({ ...request, ...(inspect ? { inspect: true } : {}) } as ManagedPortalExecutorRequest);
  if (typeof process.send !== 'function') return null;
  return new Promise((resolveResult) => {
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      resolveResult({ ok: false, error: 'Managed browser timed out.' });
    }, request.timeoutMs + 2_000);
    timer.unref?.();
    pending.set(request.requestId, { resolve: resolveResult, timer });
    process.send?.({ type: inspect ? 'orkestrai:portal:inspect' : 'orkestrai:portal:execute', ...request });
  });
}

export class ManagedPortalService {
  async execute(
    workspaceId: string,
    command: ManagedPortalCommand,
    context: { actorType?: 'agent' | 'automation' | 'user'; actorId?: string | null; runId?: string | null; stepId?: string | null } = {},
  ): Promise<PortalCommandResult> {
    const portal = await workspaceRepository.getNode(command.nodeId);
    const workspace = await workspaceRepository.getWorkspace(workspaceId);
    if (!portal || portal.workspaceId !== workspaceId || portal.type !== 'portal') throw new Error('Portal not found in this workspace.');
    if (!workspace) throw new Error('Workspace not found.');

    const payload = portal.payload as CanvasNodePayload;
    const payloadValues = payload as Record<string, unknown>;
    const initialUrl = String(payloadValues.url ?? 'about:blank');
    const profile = portalProfileFromPayload(payload);
    if (command.action === 'navigate') assertAllowedPortalUrl(String(command.args.url), profile.allowedHosts, initialUrl);
    if (command.action === 'tabs' && command.args.operation === 'new') assertAllowedPortalUrl(String(command.args.url), profile.allowedHosts, initialUrl);
    const args: Record<string, unknown> = { ...command.args };
    const root = await realpath(workspace.workingDir);
    if (command.action === 'upload') args.paths = await Promise.all(command.args.paths.map(async (path) => {
      const actual = await realpath(confinePortalPath(root, path)); confinePortalPath(root, actual); return actual;
    }));
    if (command.action === 'download') {
      const directory = confinePortalPath(root, profile.downloadDirectory);
      args.downloadDirectory = directory;
    }
    const request: ManagedPortalExecutorRequest = {
      requestId: randomUUID(), workspaceId, workspaceRoot: workspace.workingDir, nodeId: portal.id,
      profile,
      initialUrl,
      initialTabs: Array.isArray(payloadValues.portalTabs)
        ? payloadValues.portalTabs
            .filter((tab): tab is { id: string; url: string; title?: string } => {
              if (!tab || typeof tab !== 'object') return false;
              const value = tab as Record<string, unknown>;
              return typeof value.id === 'string' && typeof value.url === 'string';
            })
            .slice(0, 20)
        : undefined,
      initialActiveTabId: typeof payloadValues.portalActiveTabId === 'string' ? payloadValues.portalActiveTabId : undefined,
      action: command.action,
      args,
      timeoutMs: command.timeoutMs,
    };
    const navigationUrl = command.action === 'navigate'
      ? String(command.args.url)
      : command.action === 'tabs' && command.args.operation === 'new'
        ? String(command.args.url)
        : null;
    const readOnly = ['snapshot', 'extract', 'screenshot', 'dom'].includes(command.action)
      || command.action === 'wait' || (command.action === 'tabs' && command.args.operation === 'list');
    const actorId = context.actorId ?? command.from ?? null;
    const { ref: _ref, ...semanticArgs } = command.args as Record<string, unknown>;
    const requestDigest = createHash('sha256').update(JSON.stringify(semanticArgs)).digest('hex');
    const operation: AutonomyOperation = {
      workspaceId,
      runId: context.runId ?? null,
      stepId: context.stepId ?? null,
      capability: 'browser',
      operation: 'portal:authorize:' + command.action,
      target: portal.id,
      mutation: false,
      actorType: context.actorType ?? (command.from ? 'agent' : 'user'),
      actorId,
      input: { action: command.action, requestDigest, taskId: command.taskId ?? null },
      auditOutput: (value) => ({ confirmed: (value as PortalCommandResult)?.ok === true, action: command.action }),
      certainty: 'semantic',
      ...(navigationUrl || /^https?:/.test(initialUrl) ? { network: { url: navigationUrl || initialUrl, method: 'GET' } } : {}),
    };
    const result = await autonomyPolicyService.execute(operation, async () => {
      if (command.action === 'eval') throw new Error('Arbitrary agent scripts cannot operate authenticated Portals. Use typed Portal tools.');
      if (profile.paused) throw new Error('Portal control is paused by the user.');
      if (profile.control === 'disabled' || (!readOnly && profile.control !== 'interact')) throw new Error('This action is outside the Portal control grant.');
      if (context.actorType === 'agent' && (!actorId || !profile.agentIds.includes(actorId))) throw new Error('This agent has not been granted access to the Portal.');
      const policy = await autonomyPolicyService.get(workspaceId);
      if (!readOnly && (!policy.enabled || policy.mode === 'observe')) throw new Error('Enable an enforcing autonomy policy before granting browser mutations.');
      const inspection = await requestElectron(request, true);
      const observed = inspection?.ok ? inspection.result as { url?: string; element?: { name?: string; tag?: string; href?: string; protected?: boolean } } : null;
      const element = observed?.element;
      if (element?.protected) throw new Error('Protected fields require the user to authenticate in the Portal.');
      if (!inspection?.ok || !observed) throw new Error('Portal page is unavailable. Open the Portal and take another snapshot.');
      const submits = command.action === 'type' && command.args.submit;
      // A generic click cannot prove that the destination is non-destructive.
      const risk = command.action === 'upload' ? 'external_publication'
        : command.action === 'click' || submits ? (/send|publish|post|enviar|publicar/i.test(element?.name ?? '') ? 'external_publication'
          : /delete|remove|excluir|apagar|eliminar/i.test(element?.name ?? '') ? 'bulk_destructive'
            : /buy|pay|purchase|comprar|pagar/i.test(element?.name ?? '') ? 'purchase' : 'irreversible') : null;
      return autonomyPolicyService.execute({ ...operation, operation: 'portal:' + command.action,
        mutation: !readOnly, risk, input: { action: command.action, requestDigest, taskId: command.taskId ?? null,
          element: element ? { name: element.name, tag: element.tag } : null,
          pageDigest: createHash('sha256').update(JSON.stringify({ url: observed.url, element: observed.element })).digest('hex') },
      }, async () => {
      const latest = await workspaceRepository.getNode(portal.id);
      const liveProfile = latest ? portalProfileFromPayload(latest.payload as CanvasNodePayload) : null;
      if (!liveProfile || liveProfile.paused || liveProfile.control === 'disabled'
        || (!readOnly && liveProfile.control !== 'interact')
        || (context.actorType === 'agent' && !liveProfile.agentIds.includes(actorId!))) throw new Error('Portal access was revoked.');
      request.profile = liveProfile;
      if (command.action === 'download') {
        args.downloadDirectory = await preparePortalDirectory(root, String(args.downloadDirectory));
      }
      const managed = await requestElectron(request);
      if (!managed) throw new Error('Managed Portal control requires the desktop Core.');
      const commandResult = managed;
      if (!commandResult.ok) throw new Error(commandResult.error || 'Portal action could not be confirmed.');
      if (managed?.state) {
        await workspaceRepository.updateNode(portal.id, { payload: {
          ...(await workspaceRepository.getNode(portal.id))?.payload,
          ...(managed.state.url ? { url: managed.state.url } : {}),
          portalActiveTabId: managed.state.activeTabId,
          portalTabs: managed.state.tabs,
        } });
      }
      return { id: request.requestId, ...commandResult };
      });
    });
    await controlCenterService.recordActivity({
      workspaceId, nodeId: portal.id, state: result.ok ? 'done' : 'error', action: `Portal ${command.action}`,
      category: 'portal', verb: command.action, objectType: 'portal', objectId: portal.id, objectTitle: portal.title,
      outcome: result.ok ? 'succeeded' : 'failed', severity: result.ok ? 'info' : 'error',
      sourceType: command.from ? 'agent' : 'automation', sourceId: command.from ?? null,
      metadata: { managed: Boolean(runtime.__orkestraiExecutePortal || process.send), profileId: profile.profileId, action: command.action }, attentionRequired: false,
    });
    return result;
  }

}

export const managedPortalService = new ManagedPortalService();
