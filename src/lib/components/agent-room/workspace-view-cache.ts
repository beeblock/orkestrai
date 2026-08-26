import type {
  AgentProviderInfo,
  CanvasEdge,
  CanvasNode,
  Floor,
  Workspace,
} from '$lib/modules/agent-room/domain/types.js';

const CACHE_TTL_MS = 60_000;

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
const workspaceSnapshots = new Map<string, TimedValue<WorkspaceViewSnapshot>>();

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
  return fresh(workspaceSnapshots.get(workspaceId));
}

export function writeWorkspaceViewCache(snapshot: WorkspaceViewSnapshot): void {
  workspaceSnapshots.set(snapshot.workspace.id, { value: snapshot, updatedAt: Date.now() });
}

export function removeWorkspaceViewCache(workspaceId: string): void {
  workspaceSnapshots.delete(workspaceId);
  if (workspaceListCache) {
    workspaceListCache = {
      value: workspaceListCache.value.filter((workspace) => workspace.id !== workspaceId),
      updatedAt: Date.now(),
    };
  }
}

export function clearWorkspaceViewCache(workspaceId: string): void {
  workspaceSnapshots.delete(workspaceId);
}
