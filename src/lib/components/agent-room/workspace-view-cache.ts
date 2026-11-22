import type {
  AgentProviderInfo,
  CanvasEdge,
  CanvasNode,
  Floor,
  Workspace,
} from '$lib/modules/agent-room/domain/types.js';

const CACHE_TTL_MS = 60_000;
// Match the six visible tabs. Keep DTOs, never mounted terminals or images.
const MAX_WORKSPACE_SNAPSHOTS = 6;
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

type TimedValue<T> = {
  value: T;
  updatedAt: number;
};

export type WorkspaceViewSnapshot = {
  workspace: Workspace;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  floors: Floor[];
};

let workspaceListCache: TimedValue<Workspace[]> | null = null;
let providerCache: TimedValue<AgentProviderInfo[]> | null = null;
const workspaceSnapshots = new Map<string, TimedValue<WorkspaceViewSnapshot> & { bytes: number }>();
let snapshotBytes = 0;
const workspaceProviders = new Map<string, TimedValue<AgentProviderInfo[]>>();
const providerRequests = new Map<string, Promise<AgentProviderInfo[]>>();

function fresh<T>(entry: TimedValue<T> | null | undefined): T | null {
  if (!entry || Date.now() - entry.updatedAt > CACHE_TTL_MS) return null;
  return entry.value;
}

export function readWorkspaceListCache(): Workspace[] | null {
  return fresh(workspaceListCache);
}

export function writeWorkspaceListCache(workspaces: Workspace[]): void {
  workspaceListCache = { value: workspaces, updatedAt: Date.now() };
}

export function readProviderCache(): AgentProviderInfo[] | null {
  return fresh(providerCache);
}

export function writeProviderCache(providers: AgentProviderInfo[]): void {
  providerCache = { value: providers, updatedAt: Date.now() };
}

export function readWorkspaceViewCache(workspaceId: string): WorkspaceViewSnapshot | null {
  const entry = workspaceSnapshots.get(workspaceId);
  workspaceSnapshots.delete(workspaceId);
  if (entry) workspaceSnapshots.set(workspaceId, entry);
  // A tab does not become cold after one minute. Its snapshot is immediately
  // revalidated by the page, while explicit unload/delete still evicts it.
  return entry?.value ?? null;
}

export function writeWorkspaceViewCache(snapshot: WorkspaceViewSnapshot): void {
  evictSnapshot(snapshot.workspace.id);
  // The HTTP DTO is JSON data. Estimate UTF-16 storage without retaining a
  // second serialized copy; oversized boards do not displace every warm tab.
  let bytes: number;
  try { bytes = 2 * JSON.stringify(snapshot).length; } catch { return; }
  if (bytes > MAX_SNAPSHOT_BYTES) return;
  while (workspaceSnapshots.size && (workspaceSnapshots.size >= MAX_WORKSPACE_SNAPSHOTS || snapshotBytes + bytes > MAX_SNAPSHOT_BYTES)) {
    evictSnapshot(workspaceSnapshots.keys().next().value!);
  }
  workspaceSnapshots.set(snapshot.workspace.id, { value: snapshot, updatedAt: Date.now(), bytes });
  snapshotBytes += bytes;
}

function evictSnapshot(workspaceId: string): void {
  snapshotBytes -= workspaceSnapshots.get(workspaceId)?.bytes ?? 0;
  workspaceSnapshots.delete(workspaceId);
}

/** Provider discovery is scoped by workspace/runtime and shared by callers. */
export function loadWorkspaceProviders(workspaceId: string, load: () => Promise<AgentProviderInfo[]>, force = false): Promise<AgentProviderInfo[]> {
  if (force) clearWorkspaceProviderCache(workspaceId);
  const cached = fresh(workspaceProviders.get(workspaceId));
  if (cached) {
    const entry = workspaceProviders.get(workspaceId)!;
    workspaceProviders.delete(workspaceId); workspaceProviders.set(workspaceId, entry);
    return Promise.resolve(cached);
  }
  const existing = providerRequests.get(workspaceId);
  if (existing) return existing;
  const request = Promise.resolve().then(load).then(value => {
    if (providerRequests.get(workspaceId) === request) {
      workspaceProviders.delete(workspaceId);
      workspaceProviders.set(workspaceId, { value, updatedAt: Date.now() });
      while (workspaceProviders.size > MAX_WORKSPACE_SNAPSHOTS) workspaceProviders.delete(workspaceProviders.keys().next().value!);
    }
    return value;
  }).finally(() => { if (providerRequests.get(workspaceId) === request) providerRequests.delete(workspaceId); });
  providerRequests.set(workspaceId, request);
  return request;
}

export function removeWorkspaceViewCache(workspaceId: string): void {
  clearWorkspaceViewCache(workspaceId);
  if (workspaceListCache) {
    workspaceListCache = {
      value: workspaceListCache.value.filter((workspace) => workspace.id !== workspaceId),
      updatedAt: Date.now(),
    };
  }
}

export function clearWorkspaceViewCache(workspaceId: string): void {
  evictSnapshot(workspaceId);
  clearWorkspaceProviderCache(workspaceId);
}

function clearWorkspaceProviderCache(workspaceId: string): void {
  workspaceProviders.delete(workspaceId);
  providerRequests.delete(workspaceId);
}
