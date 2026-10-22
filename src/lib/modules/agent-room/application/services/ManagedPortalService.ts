import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CanvasNodePayload } from '../../domain/types.js';
import { workspaceRepository } from '../../infrastructure/repositories/WorkspaceRepository.js';
import { controlCenterService } from './ControlCenterService.js';
import type { PortalCommandResult } from './PortalService.js';
import {
  portalProfileFromPayload,
  portalGrantsAgent,
  type ManagedPortalCommand,
  type ManagedPortalExecutorRequest,
  type ManagedPortalExecutorResult,
} from '../../contracts/schemas/managed-portal.schema.js';
import { autonomyPolicyService, type AutonomyOperation } from './AutonomyPolicyService.js';

type PendingPortalRequest = {
  resolve: (result: ManagedPortalExecutorResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

const runtime = globalThis as typeof globalThis & {
  __orkestraiPortalPending?: Map<string, PendingPortalRequest>;
  __orkestraiPortalListenerReady?: boolean;
  __orkestraiPortalDigestKey?: Buffer;
  __orkestraiExecutePortal?: (request: ManagedPortalExecutorRequest) => Promise<ManagedPortalExecutorResult>;
};
const pending = runtime.__orkestraiPortalPending ??= new Map<string, PendingPortalRequest>();
// A persisted unkeyed digest of a short login password permits offline guessing.
const digestKey = runtime.__orkestraiPortalDigestKey ??= randomBytes(32);

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

export { portalProfileFromPayload } from '../../contracts/schemas/managed-portal.schema.js';

export function assertAllowedPortalUrl(candidate: string, allowedHosts: string[], _currentUrl?: string): URL {
  if (candidate.length > 4_096) throw new Error('Portal URL is too long.');
  let url: URL;
  try { url = new URL(candidate); } catch { throw new Error('Portal URL is invalid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Portal navigation only accepts credential-free HTTP(S) URLs.');
  }
  // Empty is unrestricted HTTP(S), not an implicit lock to the initial URL.
  // A nonempty owner list is exact, including redirects and local IPv6 hosts.
  const allowed = new Set(allowedHosts.filter(Boolean).map((host) => host.toLowerCase()));
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

export const PORTAL_SCREENSHOT_DIRECTORY = '.orkestrai/portal/screenshots';
// Older captures are pruned so repeated checks do not fill the workspace.
const KEPT_PORTAL_SCREENSHOTS = 40;
const PNG_DATA_URL = 'data:image/png;base64,';

/**
 * Writes a Portal capture into the workspace as a PNG file. Agents read
 * images from files (Claude Code's Read, Codex's image viewer); a data URL
 * printed as text is too large for their tool output and cannot be viewed.
 */
export async function savePortalScreenshot(
  workspaceRoot: string,
  portalTitle: string | null,
  capture: unknown,
): Promise<{ path: string; relativePath: string; width: number; height: number } | null> {
  const value = capture as { dataUrl?: unknown; width?: unknown; height?: unknown } | null;
  if (typeof value?.dataUrl !== 'string' || !value.dataUrl.startsWith(PNG_DATA_URL)) return null;
  const png = Buffer.from(value.dataUrl.slice(PNG_DATA_URL.length), 'base64');
  if (png.length < 24 || png.readUInt32BE(0) !== 0x89504e47) return null;
  const root = await realpath(workspaceRoot);
  const directory = await preparePortalDirectory(root, PORTAL_SCREENSHOT_DIRECTORY);
  const slug = (portalTitle ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'portal';
  // A name no other capture shares, created exclusively: `wx` fails on any
  // existing entry, so a link left at that path is never followed or replaced.
  const path = join(directory, `${slug}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.png`);
  const file = await open(path, 'wx', 0o644);
  try { await file.writeFile(png); } finally { await file.close(); }
  // The folder was confined before the file existed: if it was swapped for a
  // link meanwhile, remove what was just written there and fail.
  if (await realpath(dirname(path)).catch(() => null) !== directory) {
    await rm(path, { force: true }).catch(() => undefined);
    throw new Error('Portal screenshot folder changed while saving.');
  }
  await prunePortalScreenshots(directory).catch(() => undefined);
  return { path, relativePath: relative(root, path).split(sep).join('/'), width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function prunePortalScreenshots(directory: string): Promise<void> {
  const files = (await readdir(directory)).filter((name) => name.endsWith('.png'));
  if (files.length <= KEPT_PORTAL_SCREENSHOTS) return;
  // lstat: a link is pruned as itself, never through its target.
  const dated = await Promise.all(files.map(async (name) => ({ name, time: (await lstat(join(directory, name))).mtimeMs })));
  dated.sort((a, b) => b.time - a.time);
  await Promise.all(dated.slice(KEPT_PORTAL_SCREENSHOTS).map(({ name }) => rm(join(directory, name), { force: true })));
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
    const actorType = context.actorType ?? (command.from ? 'agent' : 'user');
    const { ref: _ref, ...semanticArgs } = command.args as Record<string, unknown>;
    const requestDigest = (command.action === 'type' ? createHmac('sha256', digestKey) : createHash('sha256'))
      .update(JSON.stringify(semanticArgs)).digest('hex');
    const operation: AutonomyOperation = {
      workspaceId,
      runId: context.runId ?? null,
      stepId: context.stepId ?? null,
      capability: 'browser',
      operation: 'portal:authorize:' + command.action,
      target: portal.id,
      mutation: false,
      actorType,
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
      if (actorType === 'agent') {
        const agent = actorId ? await workspaceRepository.getNode(actorId) : null;
        if (!agent || agent.workspaceId !== workspaceId || agent.type !== 'terminal' || !portalGrantsAgent(profile, agent.id)) {
          throw new Error('This agent has not been granted access to the Portal.');
        }
      }
      const inspection = await requestElectron(request, true);
      const observed = inspection?.ok ? inspection.result as { url?: string; element?: { name?: string; tag?: string; href?: string; protected?: boolean; writeOnly?: boolean } } : null;
      const element = observed?.element;
      const passwordWrite = command.action === 'type' && element?.protected === true && element.writeOnly === true;
      if (element?.protected && !passwordWrite) throw new Error('Protected field cannot be accessed. Only writeOnly password inputs accept typing; OTP and private fields require the user.');
      if (!inspection?.ok || !observed) throw new Error('Portal page is unavailable. Open the Portal and take another snapshot.');
      if (passwordWrite) {
        const destination = assertAllowedPortalUrl(observed.url ?? '', profile.allowedHosts, initialUrl);
        const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
        if (destination.protocol !== 'https:' && !loopback) throw new Error('Portal passwords require HTTPS or a loopback development server.');
        args.passwordOrigin = destination.origin;
      }
      const submits = command.action === 'type' && command.args.submit;
      // A generic click cannot prove that the destination is non-destructive.
      const risk = passwordWrite ? 'account_permission' : command.action === 'upload' ? 'external_publication'
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
        || (actorType === 'agent' && !portalGrantsAgent(liveProfile, actorId!))) throw new Error('Portal access was revoked.');
      request.profile = liveProfile;
      if (command.action === 'download') {
        args.downloadDirectory = await preparePortalDirectory(root, String(args.downloadDirectory));
      }
      let managed: ManagedPortalExecutorResult | null;
      try { managed = await requestElectron(request); }
      catch (error) {
        if (passwordWrite) throw new Error('Portal password entry could not be confirmed. Take another snapshot before retrying.');
        throw error;
      }
      if (!managed) throw new Error('Managed Portal control requires the desktop Core.');
      const commandResult = managed;
      if (!commandResult.ok) throw new Error(passwordWrite ? 'Portal password entry could not be confirmed. Take another snapshot before retrying.' : commandResult.error || 'Portal action could not be confirmed.');
      if (managed?.state) {
        await workspaceRepository.updateNode(portal.id, { payload: {
          ...(managed.state.url ? { url: managed.state.url } : {}),
          portalActiveTabId: managed.state.activeTabId,
          portalTabs: managed.state.tabs,
        } }, { mergePortalPayload: true });
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
