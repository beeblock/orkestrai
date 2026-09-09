import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { CanvasNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterService } from './ControlCenterService.js';
import { portalService, type PortalCommandResult } from './PortalService.js';
import {
  portalProfileSchema,
  type ManagedPortalCommand,
  type ManagedPortalExecutorRequest,
  type ManagedPortalExecutorResult,
  type PortalProfile,
} from '../../contracts/schemas/managed-portal.schema.js';

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

async function requestElectron(request: ManagedPortalExecutorRequest): Promise<ManagedPortalExecutorResult | null> {
  if (runtime.__orkestraiExecutePortal) return runtime.__orkestraiExecutePortal(request);
  if (typeof process.send !== 'function') return null;
  return new Promise((resolveResult) => {
    const timer = setTimeout(() => {
      pending.delete(request.requestId);
      resolveResult({ ok: false, error: 'Managed browser timed out.' });
    }, request.timeoutMs + 2_000);
    timer.unref?.();
    pending.set(request.requestId, { resolve: resolveResult, timer });
    process.send?.({ type: 'orkestrai:portal:execute', ...request });
  });
}

export class ManagedPortalService {
  async execute(workspaceId: string, command: ManagedPortalCommand): Promise<PortalCommandResult> {
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
    if (command.action === 'eval') {
      if (payloadValues.portalAllowScripts !== true) throw new Error('Arbitrary Portal scripts are disabled. Enable the privileged setting on this Portal first.');
      return this.executeVisible(portal.id, command);
    }

    const args = command.action === 'upload'
      ? { ...command.args, paths: command.args.paths.map((path) => confinePortalPath(workspace.workingDir, path)) }
      : command.action === 'download'
        ? { ...command.args, downloadDirectory: confinePortalPath(workspace.workingDir, profile.downloadDirectory) }
        : command.args;
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
    const managed = await requestElectron(request);
    const result = managed ?? await this.executeVisible(portal.id, command);
    if (managed?.state) {
      await workspaceRepository.updateNode(portal.id, { payload: {
        ...payload,
        ...(managed.state.url ? { url: managed.state.url } : {}),
        portalActiveTabId: managed.state.activeTabId,
        portalTabs: managed.state.tabs,
        portalProfileId: profile.profileId,
        portalProfileScope: profile.profileScope,
        portalAllowedHosts: profile.allowedHosts,
        portalDownloadDirectory: profile.downloadDirectory,
      } });
    }
    await controlCenterService.recordActivity({
      workspaceId, nodeId: portal.id, state: result.ok ? 'done' : 'error', action: `Portal ${command.action}`,
      category: 'portal', verb: command.action, objectType: 'portal', objectId: portal.id, objectTitle: portal.title,
      outcome: result.ok ? 'succeeded' : 'failed', severity: result.ok ? 'info' : 'error',
      sourceType: command.from ? 'agent' : 'automation', sourceId: command.from ?? null,
      metadata: { managed: Boolean(managed), profileId: profile.profileId, action: command.action }, attentionRequired: false,
    });
    return { id: request.requestId, ...result };
  }

  private async executeVisible(nodeId: string, command: ManagedPortalCommand): Promise<PortalCommandResult> {
    const queued = portalService.enqueue(nodeId, command.action as 'navigate' | 'eval' | 'screenshot' | 'dom', command.args);
    return portalService.waitResult(queued.id, command.timeoutMs);
  }
}

export const managedPortalService = new ManagedPortalService();
