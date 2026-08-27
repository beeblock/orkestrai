<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto, replaceState } from '$app/navigation';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    ChevronDown,
    ChevronRight,
    LocateFixed,
    PanelBottomOpen,
    PanelRightClose,
    PanelRightOpen,
    Search,
    SquareTerminal,
    Activity,
    GitPullRequestArrow,
    Scale,
    Route,
    Workflow,
    BookMarked,
    MessageSquareText,
    MessageCircleMore,
    Power,
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as InputGroup from '$lib/components/ui/input-group';
  import * as Resizable from '$lib/components/ui/resizable';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import FocusedCanvasNode from '$lib/components/agent-room/FocusedCanvasNode.svelte';
  import WorkbenchFileExplorer from '$lib/components/agent-room/WorkbenchFileExplorer.svelte';
  import WorkbenchFileView from '$lib/components/agent-room/WorkbenchFileView.svelte';
  import WorkbenchNodeIcon from '$lib/components/agent-room/WorkbenchNodeIcon.svelte';
  import WorkbenchTabs from '$lib/components/agent-room/WorkbenchTabs.svelte';
  import WorkbenchUsageFooter from '$lib/components/agent-room/WorkbenchUsageFooter.svelte';
  import ControlCenterView from '$lib/components/agent-room/ControlCenterView.svelte';
  import WorkbenchReviewCenter from '$lib/components/agent-room/WorkbenchReviewCenter.svelte';
  import WorkbenchWorkstreams from '$lib/components/agent-room/WorkbenchWorkstreams.svelte';
  import WorkspaceMemoryView from '$lib/components/agent-room/WorkspaceMemoryView.svelte';
  import AnnotationCenterView from '$lib/components/agent-room/AnnotationCenterView.svelte';
  import HuddleView from '$lib/components/agent-room/HuddleView.svelte';
  import DeviceWorkbenchPanel from '$lib/components/agent-room/DeviceWorkbenchPanel.svelte';
  import DesignEditor from '$lib/components/agent-room/design/DesignEditor.svelte';
  import CouncilDialog from '$lib/components/agent-room/CouncilDialog.svelte';
  import WorkspaceSharingButton from '$lib/components/collaboration/WorkspaceSharingButton.svelte';
  import WorkspaceSharingDialog from '$lib/components/collaboration/WorkspaceSharingDialog.svelte';
  import AutomationWorkspace from '$lib/components/agent-room/AutomationWorkspace.svelte';
  import {
    WORKBENCH_EDITOR_STATE_EVENT,
    dirtyWorkbenchEditorKeys,
    discardWorkbenchEditorBuffer,
    isWorkbenchEditorBufferDirty,
  } from '$lib/components/agent-room/workbench-editor-registry.js';
  import { getAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import {
    activateWorkbenchNode,
    activateWorkbenchPane,
    activeWorkbenchPane,
    closeWorkbenchPane,
    closeWorkbenchNode,
    createWorkbenchLayout,
    cycleWorkbenchPane,
    cycleWorkbenchNode,
    legacyWorkbenchLayoutStorageKey,
    MAX_WORKBENCH_PANES,
    moveWorkbenchNode,
    normalizeWorkbenchLayout,
    normalizeWorkbenchTabPlacement,
    openWorkbenchNode,
    removeWorkbenchNode,
    splitWorkbenchPane,
    workbenchLayoutStorageKey,
    workbenchPane,
    workbenchPanes,
    type WorkbenchLayout,
    type WorkbenchLayoutNode,
    type WorkbenchPaneId,
    type WorkbenchPaneState,
    type WorkbenchSplitDirection,
    type WorkbenchTabPlacement,
  } from '$lib/components/agent-room/workbench-layout.js';
  import {
    LEADER_DICTATION_COMMAND,
    LEADER_DICTATION_STATE,
    type LeaderDictationStateDetail,
    type LeaderDictationStatus,
  } from '$lib/components/agent-room/leader-dictation.js';
  import { TEXT_DICTATION_FALLBACK, type TextDictationFallbackDetail } from '$lib/components/agent-room/text-dictation.js';
  import WorkspaceIcon from '$lib/components/agent-room/WorkspaceIcon.svelte';
  import WorkspaceModeSwitch from '$lib/components/agent-room/WorkspaceModeSwitch.svelte';
  import AttentionCenter from '$lib/components/agent-room/AttentionCenter.svelte';
  import WorkspacePermissionNotice from '$lib/components/agent-room/WorkspacePermissionNotice.svelte';
  import { isWorkspacePermissionError } from '$lib/components/agent-room/workspace-permission.js';
  import {
    WORKBENCH_OPEN_REQUEST,
    type WorkbenchOpenRequestDetail,
  } from '$lib/components/agent-room/workbench-open.js';
  import {
    createWorkbenchFileItem,
    isWorkbenchFileItemId,
    pathFromWorkbenchFileItemId,
    workbenchFileItemId,
    workbenchFilePathsFromLayout,
  } from '$lib/components/agent-room/workbench-file-items.js';
  import {
    createWorkbenchControlCenterItem,
    isWorkbenchControlCenterItemId,
    workbenchControlCenterItemId,
  } from '$lib/components/agent-room/workbench-control-center.js';
  import {
    createWorkbenchReviewCenterItem,
    isWorkbenchReviewCenterItemId,
    workbenchReviewCenterItemId,
  } from '$lib/components/agent-room/workbench-review-center.js';
  import {
    createWorkbenchWorkstreamsItem,
    isWorkbenchWorkstreamsItemId,
    workbenchWorkstreamsItemId,
  } from '$lib/components/agent-room/workbench-workstreams.js';
  import {
    createWorkbenchMemoryItem,
    isWorkbenchMemoryItemId,
    workbenchMemoryItemId,
  } from '$lib/components/agent-room/workbench-memory.js';
  import { createWorkbenchAnnotationsItem, isWorkbenchAnnotationsItemId, workbenchAnnotationsItemId } from '$lib/components/agent-room/workbench-annotations.js';
  import { createWorkbenchHuddlesItem, isWorkbenchHuddlesItemId, workbenchHuddlesItemId } from '$lib/components/agent-room/workbench-huddles.js';
  import {
    createWorkbenchAutomationsItem,
    isWorkbenchAutomationsItemId,
    workbenchAutomationsItemId,
  } from '$lib/components/agent-room/workbench-automations.js';
  import {
    readProviderCache,
    readWorkspaceListCache,
    readWorkspaceViewCache,
    writeProviderCache,
    writeWorkspaceListCache,
    writeWorkspaceViewCache,
  } from '$lib/components/agent-room/workspace-view-cache.js';
  import type {
    AgentProviderInfo,
    CanvasEdge,
    CanvasNode,
    CanvasNodeType,
    ControlCenterSnapshot,
    Floor,
    TerminalNodePayload,
    Workspace,
  } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  const BROWSABLE_TYPES = new Set<CanvasNodeType>([
    'terminal',
    'tasks',
    'note',
    'portal',
    'apiClient',
    'fileTree',
    'editor',
    'diff',
    'image',
    'imageWorkflow',
    'flow',
    'loop',
    'usage',
    'controlCenter',
    'reviewCenter',
    'device',
    'design',
  ]);

  let workspaces = $state<Workspace[]>([]);
  let nodesByWorkspace = $state<Record<string, CanvasNode[]>>({});
  let designRevisions = $state<Record<string, number>>({});
  let edgesByWorkspace = $state<Record<string, CanvasEdge[]>>({});
  let floorsByWorkspace = $state<Record<string, Floor[]>>({});
  let providers = $state<AgentProviderInfo[]>([]);
  let controlCenters = $state<Record<string, ControlCenterSnapshot>>({});
  let loadingControlCenterIds = $state<string[]>([]);
  let expandedWorkspaceIds = $state<string[]>([]);
  let selectedWorkspaceId = $state<string | null>(null);
  let selectedNodeId = $state<string | null>(null);
  let layoutsByWorkspace = $state<Record<string, WorkbenchLayout>>({});
  let filePathsByWorkspace = $state<Record<string, string[]>>({});
  let tabPlacement = $state<WorkbenchTabPlacement>('vertical');
  let deletingNode = $state<CanvasNode | null>(null);
  let pendingEditorClose = $state<{ paneId: WorkbenchPaneId; node: CanvasNode } | null>(null);
  let dirtyEditorRevision = $state(0);
  let query = $state('');
  let loading = $state(true);
  let errorMessage = $state('');
  let permissionWorkspaceId = $state<string | null>(null);
  const permissionWorkspace = $derived(workspaces.find((workspace) => workspace.id === permissionWorkspaceId) ?? null);
  let councilOpen = $state(false);
  let councilSource = $state<{ taskId?: string; taskTitle?: string; taskDescription?: string | null; leaderNodeId?: string } | null>(null);
  let sharingOpen = $state(false);
  let leaderDictationState = $state<LeaderDictationStatus>('idle');
  let leaderDictationNodeId = $state<string | null>(null);
  let loadedWorkspaceIds = $state<string[]>([]);
  let dropTargetPaneId = $state<WorkbenchPaneId | null>(null);
  const workspaceLoadRequests = new Map<string, Promise<void>>();

  const EXPLORER_GROUPS: Array<{ id: 'agents' | 'work' | 'content' | 'tools'; types: CanvasNodeType[] }> = [
    { id: 'agents', types: ['terminal'] },
    { id: 'work', types: ['tasks', 'flow', 'loop'] },
    { id: 'content', types: ['note', 'image', 'imageWorkflow', 'design'] },
    { id: 'tools', types: ['portal', 'apiClient', 'device', 'diff', 'usage'] },
  ];

  const selectedWorkspace = $derived(workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null);
  const selectedNode = $derived(
    selectedWorkspaceId && selectedNodeId
      ? workbenchItems(selectedWorkspaceId).find((node) => node.id === selectedNodeId) ?? null
      : null
  );
  const selectedLayout = $derived(selectedWorkspaceId ? layoutsByWorkspace[selectedWorkspaceId] ?? null : null);
  const visiblePanes = $derived(selectedLayout ? workbenchPanes(selectedLayout) : []);
  const dirtyEditorNodeIds = $derived.by(() => {
    if (!selectedWorkspaceId) return [];
    dirtyEditorRevision;
    const workspaceId = selectedWorkspaceId;
    return workbenchItems(workspaceId).flatMap((node) => {
      const path = node.type === 'editor' ? String((node.payload as { path?: string }).path ?? '') : '';
      return path && isWorkbenchEditorBufferDirty(workspaceId, path) ? [node.id] : [];
    });
  });

  function workbenchItems(workspaceId: string): CanvasNode[] {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const fileItems = workspace
      ? (filePathsByWorkspace[workspaceId] ?? []).map((path) => createWorkbenchFileItem(workspace, path))
      : [];
    const controlCenter = workspace
      ? [createWorkbenchControlCenterItem(workspace, m['control_center.title']())]
      : [];
    const reviewCenter = workspace
      ? [createWorkbenchReviewCenterItem(workspace, m['review_center.title']())]
      : [];
    const workstreams = workspace
      ? [createWorkbenchWorkstreamsItem(workspace, m['workstreams.title']())]
      : [];
    const memory = workspace
      ? [createWorkbenchMemoryItem(workspace, m['memory.title']())]
      : [];
    const annotations = workspace
      ? [createWorkbenchAnnotationsItem(workspace, m['annotations.title']())]
      : [];
    const huddles = workspace
      ? [createWorkbenchHuddlesItem(workspace, m['huddle.title']())]
      : [];
    const automations = workspace
      ? [createWorkbenchAutomationsItem(workspace, m['automation.title']())]
      : [];
    return [...controlCenter, ...workstreams, ...huddles, ...memory, ...annotations, ...reviewCenter, ...automations, ...(nodesByWorkspace[workspaceId] ?? []).filter((node) => BROWSABLE_TYPES.has(node.type)), ...fileItems];
  }

  function isVirtualWorkbenchItemId(id: string | null | undefined): boolean {
    return isWorkbenchFileItemId(id)
      || isWorkbenchControlCenterItemId(id)
      || isWorkbenchWorkstreamsItemId(id)
      || isWorkbenchMemoryItemId(id)
      || isWorkbenchAnnotationsItemId(id)
      || isWorkbenchHuddlesItemId(id)
      || isWorkbenchReviewCenterItemId(id)
      || isWorkbenchAutomationsItemId(id);
  }

  function rememberWorkbenchFiles(workspaceId: string, paths: string[]): void {
    const current = filePathsByWorkspace[workspaceId] ?? [];
    const next = [...new Set([...current, ...paths.filter(Boolean)])];
    if (next.length === current.length && next.every((path, index) => path === current[index])) return;
    filePathsByWorkspace = { ...filePathsByWorkspace, [workspaceId]: next };
  }

  function filePathForItem(item: CanvasNode | null | undefined): string | null {
    if (!item || item.type !== 'editor') return null;
    return String((item.payload as { path?: string }).path ?? '') || null;
  }

  function browsableNodes(workspaceId: string): CanvasNode[] {
    const normalized = query.trim().toLocaleLowerCase();
    return (nodesByWorkspace[workspaceId] ?? [])
      .filter((node) => BROWSABLE_TYPES.has(node.type) && node.type !== 'editor' && node.type !== 'fileTree')
      .filter((node) => {
        if (!normalized) return true;
        const payload = node.payload as { provider?: string; path?: string; url?: string; role?: string };
        return [node.title, node.type, payload.provider, payload.path, payload.url, payload.role]
          .some((value) => String(value ?? '').toLocaleLowerCase().includes(normalized));
      })
      .sort((a, b) => {
        if (a.type === 'terminal' && b.type !== 'terminal') return -1;
        if (a.type !== 'terminal' && b.type === 'terminal') return 1;
        return String(a.title ?? a.type).localeCompare(String(b.title ?? b.type));
      });
  }

  function agentFloorLabel(workspaceId: string, node: CanvasNode): string | null {
    if (!node.floorId) return null;
    return floorsByWorkspace[workspaceId]?.find((floor) => floor.id === node.floorId)?.name ?? null;
  }

  const visibleWorkspaces = $derived.by(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return workspaces;
    return workspaces.filter((workspace) =>
      workspace.name.toLocaleLowerCase().includes(normalized) || browsableNodes(workspace.id).length > 0
    );
  });

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['canvas.error_api']());
    return payload.data as T;
  }

  async function refreshProviders(workspaceId: string): Promise<void> {
    try {
      const status = await api<{ providers: AgentProviderInfo[] }>(
        `/api/agent-room/status?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      if (selectedWorkspaceId !== workspaceId) return;
      providers = status.providers ?? [];
      writeProviderCache(providers);
    } catch {
      // Keep the last known provider list while the selected runtime is unavailable.
    }
  }

  function applyWorkspaceData(
    workspaceId: string,
    nodes: CanvasNode[],
    edges: CanvasEdge[],
    floors: Floor[],
  ) {
    nodesByWorkspace = { ...nodesByWorkspace, [workspaceId]: nodes };
    edgesByWorkspace = { ...edgesByWorkspace, [workspaceId]: edges };
    floorsByWorkspace = { ...floorsByWorkspace, [workspaceId]: floors };
    if (!loadedWorkspaceIds.includes(workspaceId)) loadedWorkspaceIds = [...loadedWorkspaceIds, workspaceId];

    const currentLayout = layoutsByWorkspace[workspaceId];
    if (currentLayout) {
      rememberWorkbenchFiles(workspaceId, workbenchFilePathsFromLayout(currentLayout));
      const validNodeIds = workbenchItems(workspaceId).map((node) => node.id);
      const normalized = normalizeWorkbenchLayout(currentLayout, validNodeIds, validNodeIds[0]);
      layoutsByWorkspace = { ...layoutsByWorkspace, [workspaceId]: normalized };
      if (selectedWorkspaceId === workspaceId) {
        selectedNodeId = activeWorkbenchPane(normalized).activeNodeId;
        persistWorkbenchLayout(workspaceId, normalized);
      }
    }
  }

  async function loadWorkspace(workspaceId: string, options: { resume?: boolean } = {}) {
    if (options.resume) {
      const resumed = await api<Workspace>(`/api/agent-room/workspaces/${workspaceId}/load`, { method: 'POST' });
      workspaces = workspaces.map((workspace) => workspace.id === workspaceId ? resumed : workspace);
      writeWorkspaceListCache(workspaces);
    }
    const pending = workspaceLoadRequests.get(workspaceId);
    if (pending) return pending;
    const cached = readWorkspaceViewCache(workspaceId);
    if (cached) applyWorkspaceData(workspaceId, cached.nodes, cached.edges, cached.floors);
    const request = (async () => {
      const [nodes, edges, floors] = await Promise.all([
        api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`),
        api<CanvasEdge[]>(`/api/agent-room/workspaces/${workspaceId}/edges`),
        api<Floor[]>(`/api/agent-room/workspaces/${workspaceId}/floors`).catch(() => []),
      ]);
      applyWorkspaceData(workspaceId, nodes, edges, floors);
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (workspace) {
        writeWorkspaceViewCache({ workspace, nodes, edges, floors });
      }
      if (permissionWorkspaceId === workspaceId) permissionWorkspaceId = null;
      errorMessage = '';
      void refreshProviders(workspaceId);
    })().catch((error) => {
      if (isWorkspacePermissionError(error)) {
        permissionWorkspaceId = workspaceId;
        errorMessage = '';
      } else {
        errorMessage = error instanceof Error ? error.message : m['terminal_browser.load_error']();
      }
      throw error;
    }).finally(() => workspaceLoadRequests.delete(workspaceId));
    workspaceLoadRequests.set(workspaceId, request);
    return request;
  }

  async function retryWorkspaceAccess(): Promise<void> {
    const workspaceId = permissionWorkspaceId;
    if (!workspaceId) return;
    await loadWorkspace(workspaceId).catch(() => undefined);
  }

  function storedWorkbenchLayout(workspaceId: string): unknown {
    try {
      return JSON.parse(
        localStorage.getItem(workbenchLayoutStorageKey(workspaceId))
          ?? localStorage.getItem(legacyWorkbenchLayoutStorageKey(workspaceId))
          ?? 'null'
      );
    } catch {
      return null;
    }
  }

  function persistWorkbenchLayout(workspaceId: string, layout: WorkbenchLayout) {
    localStorage.setItem(workbenchLayoutStorageKey(workspaceId), JSON.stringify(layout));
    localStorage.removeItem(legacyWorkbenchLayoutStorageKey(workspaceId));
  }

  function ensureWorkbenchLayout(workspaceId: string, fallbackNodeId?: string | null): WorkbenchLayout {
    const nodes = workbenchItems(workspaceId);
    const fallback = fallbackNodeId ?? nodes.find(
      (node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).maestro)
    )?.id ?? nodes[0]?.id ?? null;
    const existing = layoutsByWorkspace[workspaceId];
    const stored = existing ?? storedWorkbenchLayout(workspaceId) ?? createWorkbenchLayout(fallback);
    rememberWorkbenchFiles(workspaceId, workbenchFilePathsFromLayout(stored));
    const validIds = nodes.map((node) => node.id);
    const layout = normalizeWorkbenchLayout(
      stored,
      validIds,
      fallback,
    );
    layoutsByWorkspace = { ...layoutsByWorkspace, [workspaceId]: layout };
    persistWorkbenchLayout(workspaceId, layout);
    return layout;
  }

  function applyWorkbenchLayout(workspaceId: string, layout: WorkbenchLayout) {
    layoutsByWorkspace = { ...layoutsByWorkspace, [workspaceId]: layout };
    persistWorkbenchLayout(workspaceId, layout);
    if (selectedWorkspaceId === workspaceId) {
      selectedNodeId = activeWorkbenchPane(layout).activeNodeId;
      persistSelection(layout);
    }
  }

  function persistSelection(layout = selectedLayout) {
    if (selectedWorkspaceId) localStorage.setItem('orkestrai.activeWorkspaceId', selectedWorkspaceId);
    const params = new URLSearchParams();
    if (selectedWorkspaceId) params.set('workspace', selectedWorkspaceId);
    if (selectedNodeId) params.set('node', selectedNodeId);
    if (layout && workbenchPanes(layout).length > 1) params.set('pane', layout.activePaneId);
    const nextUrl = `/terminal${params.size ? `?${params}` : ''}`;
    if (`${location.pathname}${location.search}` !== nextUrl) replaceState(nextUrl, {});
  }

  function selectNode(
    workspaceId: string,
    nodeId: string,
    splitDirection: WorkbenchSplitDirection | null = null,
  ) {
    const sameWorkspace = selectedWorkspaceId === workspaceId;
    if (!sameWorkspace) {
      leaderDictationState = 'idle';
      leaderDictationNodeId = null;
    }
    selectedWorkspaceId = workspaceId;
    if (!sameWorkspace) void refreshProviders(workspaceId);
    const layout = ensureWorkbenchLayout(workspaceId, nodeId);
    applyWorkbenchLayout(workspaceId, openWorkbenchNode(layout, nodeId, {
      toSide: Boolean(splitDirection) && sameWorkspace,
      direction: splitDirection ?? undefined,
    }));
    if (!expandedWorkspaceIds.includes(workspaceId)) expandedWorkspaceIds = [...expandedWorkspaceIds, workspaceId];
  }

  function openWorkbenchFile(
    workspaceId: string,
    path: string,
    splitDirection: WorkbenchSplitDirection | null = null,
  ): void {
    rememberWorkbenchFiles(workspaceId, [path]);
    selectNode(workspaceId, workbenchFileItemId(path), splitDirection);
  }

  function selectOpenNode(paneId: WorkbenchPaneId, nodeId: string) {
    if (!selectedWorkspaceId || !selectedLayout) return;
    applyWorkbenchLayout(selectedWorkspaceId, activateWorkbenchNode(selectedLayout, paneId, nodeId));
  }

  async function closeOpenNode(paneId: WorkbenchPaneId, nodeId: string) {
    if (!selectedWorkspaceId || !selectedLayout) return;
    const node = workbenchItems(selectedWorkspaceId).find((candidate) => candidate.id === nodeId);
    const path = filePathForItem(node) ?? '';
    if (node && path && isWorkbenchEditorBufferDirty(selectedWorkspaceId, path)) {
      pendingEditorClose = { paneId, node };
      return;
    }
    applyWorkbenchLayout(selectedWorkspaceId, closeWorkbenchNode(selectedLayout, paneId, nodeId));
  }

  function discardAndCloseEditor() {
    const pending = pendingEditorClose;
    pendingEditorClose = null;
    if (!pending || !selectedWorkspaceId || !selectedLayout) return;
    const path = String((pending.node.payload as { path?: string }).path ?? '');
    if (path) discardWorkbenchEditorBuffer(selectedWorkspaceId, path);
    dirtyEditorRevision += 1;
    applyWorkbenchLayout(selectedWorkspaceId, closeWorkbenchNode(selectedLayout, pending.paneId, pending.node.id));
  }

  function moveOpenNode(paneId: WorkbenchPaneId, nodeId: string) {
    if (!selectedWorkspaceId || !selectedLayout) return;
    applyWorkbenchLayout(selectedWorkspaceId, moveWorkbenchNode(selectedLayout, nodeId, paneId));
  }

  function handlePaneDragOver(event: DragEvent, paneId: WorkbenchPaneId): void {
    if (!event.dataTransfer?.types.includes('application/x-orkestrai-workbench-node')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dropTargetPaneId = paneId;
  }

  function handlePaneDrop(event: DragEvent, paneId: WorkbenchPaneId): void {
    event.preventDefault();
    const nodeId = event.dataTransfer?.getData('application/x-orkestrai-workbench-node');
    dropTargetPaneId = null;
    if (nodeId) moveOpenNode(paneId, nodeId);
  }

  function focusPane(paneId: WorkbenchPaneId) {
    if (!selectedWorkspaceId || !selectedLayout || selectedLayout.activePaneId === paneId) return;
    applyWorkbenchLayout(selectedWorkspaceId, activateWorkbenchPane(selectedLayout, paneId));
  }

  function splitActivePane(direction: WorkbenchSplitDirection) {
    if (!selectedWorkspaceId || !selectedLayout) return;
    if (visiblePanes.length >= MAX_WORKBENCH_PANES) {
      toast.error(m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }));
      return;
    }
    applyWorkbenchLayout(selectedWorkspaceId, splitWorkbenchPane(
      selectedLayout,
      selectedLayout.activePaneId,
      direction,
    ));
  }

  function closeActivePane() {
    if (!selectedWorkspaceId || !selectedLayout || visiblePanes.length <= 1) return;
    const pane = workbenchPane(selectedLayout, selectedLayout.activePaneId);
    const hasDirtyEditor = pane?.nodeIds.some((nodeId) => {
      const node = workbenchItems(selectedWorkspaceId!).find((candidate) => candidate.id === nodeId);
      const path = filePathForItem(node) ?? '';
      return Boolean(path && isWorkbenchEditorBufferDirty(selectedWorkspaceId!, path));
    });
    if (hasDirtyEditor) {
      toast.error(m['workbench_editor.close_pane_dirty']());
      return;
    }
    applyWorkbenchLayout(
      selectedWorkspaceId,
      closeWorkbenchPane(selectedLayout, selectedLayout.activePaneId),
    );
  }

  function nodeForPane(pane: WorkbenchPaneState): CanvasNode | null {
    if (!selectedWorkspaceId || !pane.activeNodeId) return null;
    return workbenchItems(selectedWorkspaceId).find((node) => node.id === pane.activeNodeId) ?? null;
  }

  async function toggleWorkspace(workspaceId: string) {
    if (expandedWorkspaceIds.includes(workspaceId)) {
      expandedWorkspaceIds = expandedWorkspaceIds.filter((id) => id !== workspaceId);
      return;
    }
    expandedWorkspaceIds = [...expandedWorkspaceIds, workspaceId];
    if (!loadedWorkspaceIds.includes(workspaceId)) await loadWorkspace(workspaceId, { resume: true }).catch(() => undefined);
  }

  function updateNode(updated: CanvasNode) {
    const current = nodesByWorkspace[updated.workspaceId] ?? [];
    nodesByWorkspace = {
      ...nodesByWorkspace,
      [updated.workspaceId]: current.map((node) => node.id === updated.id ? updated : node),
    };
  }

  async function confirmDeleteNode() {
    const target = deletingNode;
    deletingNode = null;
    if (!target) return;
    if (target.type === 'editor') {
      const path = String((target.payload as { path?: string }).path ?? '');
      if (path) discardWorkbenchEditorBuffer(target.workspaceId, path);
      dirtyEditorRevision += 1;
    }
    await api(`/api/agent-room/workspaces/${target.workspaceId}/nodes/${target.id}`, { method: 'DELETE' });
    const remaining = (nodesByWorkspace[target.workspaceId] ?? []).filter((node) => node.id !== target.id);
    nodesByWorkspace = { ...nodesByWorkspace, [target.workspaceId]: remaining };
    const layout = layoutsByWorkspace[target.workspaceId];
    if (layout) {
      applyWorkbenchLayout(target.workspaceId, removeWorkbenchNode(layout, target.id));
    }
  }

  function nodeTypeLabel(node: CanvasNode): string {
    if (node.type === 'terminal') {
      const payload = node.payload as TerminalNodePayload;
      return providers.find((provider) => provider.id === payload.provider)?.displayName ?? m['terminal_browser.kind_terminal']();
    }
    if (node.type === 'tasks') return m['terminal_browser.kind_tasks']();
    if (node.type === 'note') return m['terminal_browser.kind_note']();
    if (node.type === 'portal') return m['terminal_browser.kind_portal']();
    if (node.type === 'apiClient') return m['api_client.title']();
    if (node.type === 'fileTree') return m['terminal_browser.kind_files']();
    if (node.type === 'editor') return m['terminal_browser.kind_editor']();
    if (node.type === 'diff') return m['terminal_browser.kind_diff']();
    if (node.type === 'image') return m['terminal_browser.kind_image']();
    if (node.type === 'imageWorkflow') return m['image_workflow.title']();
    if (node.type === 'flow') return m['terminal_browser.kind_flow']();
    if (node.type === 'loop') return m['terminal_browser.kind_loop']();
    if (node.type === 'usage') return m['terminal_browser.kind_usage']();
    if (node.type === 'controlCenter') return m['control_center.title']();
    if (node.type === 'reviewCenter') return m['review_center.title']();
    if (node.type === 'memory') return m['memory.title']();
    if (node.type === 'annotations') return m['annotations.title']();
    if (node.type === 'automation') return m['automation.title']();
    if (node.type === 'device') return m['device.title']();
    if (node.type === 'design') return m['terminal_browser.kind_design']();
    return node.type;
  }

  async function refreshControlCenter(workspaceId: string): Promise<void> {
    if (!loadingControlCenterIds.includes(workspaceId)) loadingControlCenterIds = [...loadingControlCenterIds, workspaceId];
    try {
      const snapshot = await api<ControlCenterSnapshot>(`/api/agent-room/workspaces/${workspaceId}/control-center`);
      controlCenters = { ...controlCenters, [workspaceId]: snapshot };
    } finally {
      loadingControlCenterIds = loadingControlCenterIds.filter((id) => id !== workspaceId);
    }
  }

  function workspaceAttention(workspaceId: string): number {
    const counts = controlCenters[workspaceId]?.counts;
    return counts ? counts.waiting_input + counts.waiting_permission + counts.blocked + counts.error : 0;
  }

  function agentStateColor(workspaceId: string, nodeId: string): string {
    const state = controlCenters[workspaceId]?.agents.find((agent) => agent.nodeId === nodeId)?.state;
    if (state === 'working') return 'var(--app-success)';
    if (state === 'waiting_input' || state === 'waiting_permission') return 'var(--app-warning)';
    if (state === 'blocked' || state === 'error' || state === 'disconnected') return 'var(--app-danger)';
    if (state === 'done') return 'var(--app-accent)';
    return 'var(--app-text-muted)';
  }

  function agentActivityLabel(workspaceId: string, nodeId: string): string | null {
    const agent = controlCenters[workspaceId]?.agents.find((candidate) => candidate.nodeId === nodeId);
    if (!agent?.lastAction) return agent?.currentTask?.title ?? null;
    const name = (key: string) => String(agent.lastActionData[key] ?? m['control_center.workspace_user']());
    if (agent.lastAction === 'system:message_received') return m['control_center.action_message_received']({ name: name('fromTitle') });
    if (agent.lastAction === 'system:message_replied') return m['control_center.action_message_replied']({ name: name('toTitle') });
    if (agent.lastAction === 'system:task_completed') return m['control_center.action_task_completed']({ title: name('taskTitle') });
    if (agent.lastAction === 'system:task_review') return m['control_center.action_task_review']({ title: name('taskTitle') });
    if (agent.lastAction === 'system:task_working') return m['control_center.action_task_working']({ title: name('taskTitle') });
    return agent.currentTask?.title ?? agent.lastAction;
  }

  function paneLabel(paneId: WorkbenchPaneId): string {
    const index = visiblePanes.findIndex((pane) => pane.id === paneId);
    return m['workbench.pane_number']({ number: Math.max(1, index + 1) });
  }

  function explorerGroupLabel(groupId: 'agents' | 'work' | 'content' | 'tools'): string {
    return {
      agents: m['workbench.group_agents'](),
      work: m['workbench.group_work'](),
      content: m['workbench.group_content'](),
      tools: m['workbench.group_tools'](),
    }[groupId];
  }

  function handleKeydown(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key === '1') {
      event.preventDefault();
      const canvasNodeId = selectedNodeId && !isVirtualWorkbenchItemId(selectedNodeId)
        ? selectedNodeId
        : null;
      void goto(selectedWorkspaceId ? `/canvas?workspace=${selectedWorkspaceId}${canvasNodeId ? `&node=${canvasNodeId}` : ''}` : '/canvas');
      return;
    }
    if (!selectedWorkspaceId || !selectedLayout || !(event.metaKey || event.ctrlKey)) return;
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      if (event.shiftKey && visiblePanes.length > 1) {
        applyWorkbenchLayout(selectedWorkspaceId, cycleWorkbenchPane(
          selectedLayout,
          event.key === 'PageUp' ? -1 : 1,
        ));
        return;
      }
      applyWorkbenchLayout(selectedWorkspaceId, cycleWorkbenchNode(selectedLayout, event.key === 'PageUp' ? -1 : 1));
      return;
    }
    if (event.key === '\\') {
      event.preventDefault();
      splitActivePane(event.shiftKey ? 'vertical' : 'horizontal');
    }
  }

  function dispatchLeaderDictation(nodeId: string) {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(LEADER_DICTATION_COMMAND, { detail: { nodeId } }));
    });
  }

  async function toggleLeaderDictation() {
    const workspaceId = selectedWorkspaceId;
    if (!workspaceId || leaderDictationState === 'transcribing') return;
    if (leaderDictationState === 'recording' && leaderDictationNodeId) {
      dispatchLeaderDictation(leaderDictationNodeId);
      return;
    }

    let workspaceNodes: CanvasNode[];
    try {
      workspaceNodes = await api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`);
      nodesByWorkspace = { ...nodesByWorkspace, [workspaceId]: workspaceNodes };
    } catch {
      toast.error(m['leader_dictation.error']());
      return;
    }

    const leader = workspaceNodes.find(
      (node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).maestro)
    );
    if (!leader) {
      leaderDictationState = 'idle';
      leaderDictationNodeId = null;
      toast.error(m['leader_dictation.no_leader']());
      return;
    }

    leaderDictationNodeId = leader.id;
    if (selectedNodeId !== leader.id) {
      selectNode(workspaceId, leader.id);
      await tick();
    }
    dispatchLeaderDictation(leader.id);
  }

  onMount(() => {
    const handleEditorState = () => (dirtyEditorRevision += 1);
    const handleCouncilOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; source?: typeof councilSource }>).detail;
      const workspaceId = detail?.workspaceId;
      if (workspaceId) selectedWorkspaceId = workspaceId;
      councilSource = detail?.source ?? null;
      councilOpen = true;
    };
    const handleSharingOpen = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
      if (workspaceId) selectedWorkspaceId = workspaceId;
      sharingOpen = true;
    };
    const guardDirtyBuffers = (event: BeforeUnloadEvent) => {
      if (!dirtyWorkbenchEditorKeys().length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener(WORKBENCH_EDITOR_STATE_EVENT, handleEditorState);
    window.addEventListener('beforeunload', guardDirtyBuffers);
    const handleDictationState = (event: Event) => {
      const detail = (event as CustomEvent<LeaderDictationStateDetail>).detail;
      if (!detail) return;
      if (detail.nodeId !== leaderDictationNodeId) {
        const source = selectedWorkspaceId
          ? (nodesByWorkspace[selectedWorkspaceId] ?? []).find((node) => node.id === detail.nodeId)
          : null;
        if (source?.type !== 'terminal' || !(source.payload as TerminalNodePayload).maestro) return;
        leaderDictationNodeId = detail.nodeId;
      }
      leaderDictationState = detail.status;
    };
    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent<TextDictationFallbackDetail>).detail;
      if (!detail || !selectedWorkspaceId) return;
      detail.handled = true;
      void toggleLeaderDictation();
    };
    const handleWorkbenchOpen = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchOpenRequestDetail>).detail;
      if (!detail?.workspaceId || !detail.nodeId) return;
      selectNode(detail.workspaceId, detail.nodeId, detail.direction);
    };
    const handleWorkbenchFileOpen = (event: Event) => {
      const detail = (event as CustomEvent<{
        workspaceId?: string;
        path?: string;
        direction?: WorkbenchSplitDirection | null;
      }>).detail;
      if (!detail?.workspaceId || !detail.path) return;
      openWorkbenchFile(detail.workspaceId, detail.path, detail.direction ?? null);
    };
    window.addEventListener(LEADER_DICTATION_STATE, handleDictationState);
    window.addEventListener(TEXT_DICTATION_FALLBACK, handleFallback);
    window.addEventListener(WORKBENCH_OPEN_REQUEST, handleWorkbenchOpen);
    window.addEventListener('orkestrai:open-council', handleCouncilOpen);
    window.addEventListener('orkestrai:open-sharing', handleSharingOpen);
    window.addEventListener('orkestrai:open-file', handleWorkbenchFileOpen);
    return () => {
      window.removeEventListener(WORKBENCH_EDITOR_STATE_EVENT, handleEditorState);
      window.removeEventListener('beforeunload', guardDirtyBuffers);
      window.removeEventListener(LEADER_DICTATION_STATE, handleDictationState);
      window.removeEventListener(TEXT_DICTATION_FALLBACK, handleFallback);
      window.removeEventListener(WORKBENCH_OPEN_REQUEST, handleWorkbenchOpen);
      window.removeEventListener('orkestrai:open-council', handleCouncilOpen);
      window.removeEventListener('orkestrai:open-sharing', handleSharingOpen);
      window.removeEventListener('orkestrai:open-file', handleWorkbenchFileOpen);
    };
  });

  onMount(() => {
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const connectEvents = () => {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (!message.workspaceId) return;
          if (message.type === 'workspaceChanged') {
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void loadWorkspace(String(message.workspaceId)), 200);
          }
          if (message.type === 'designChanged' && message.nodeId) {
            const nodeId = String(message.nodeId);
            designRevisions = { ...designRevisions, [nodeId]: Number(message.revision) || 0 };
          }
          if (message.type === 'controlCenterChanged' || message.type === 'messageDelivery') {
            void refreshControlCenter(String(message.workspaceId));
          }
        } catch {
          // Frames PTY não relacionados não fazem parte deste explorer.
        }
      };
      socket.onclose = () => {
        if (!destroyed) reconnectTimer = setTimeout(connectEvents, 3_000);
      };
    };

    const initialize = async () => {
      try {
        const cachedWorkspaces = readWorkspaceListCache();
        const cachedProviders = readProviderCache();
        if (cachedWorkspaces) workspaces = cachedWorkspaces;
        if (cachedProviders) providers = cachedProviders;
        const [workspaceList, settings, summaries] = await Promise.all([
          api<Workspace[]>('/api/agent-room/workspaces'),
          getAppSettings(),
          api<Record<string, ControlCenterSnapshot>>('/api/agent-room/control-center').catch(() => ({})),
        ]);
        if (destroyed) return;
        workspaces = workspaceList;
        controlCenters = summaries;
        writeWorkspaceListCache(workspaceList);
        tabPlacement = normalizeWorkbenchTabPlacement(settings.workbenchTabPlacement);
        const params = new URLSearchParams(location.search);
        let pendingFile: { workspaceId?: string; path?: string } | null = null;
        try {
          pendingFile = JSON.parse(sessionStorage.getItem('orkestrai.open-file') ?? 'null');
        } catch {
          pendingFile = null;
        }
        const explicitWorkspace = params.get('workspace') || pendingFile?.workspaceId || null;
        const rememberedWorkspace = localStorage.getItem('orkestrai.activeWorkspaceId');
        const initialWorkspace = workspaceList.find((workspace) => workspace.id === explicitWorkspace)
          ?? workspaceList.find((workspace) => workspace.id === rememberedWorkspace && !workspace.suspendedAt)
          ?? workspaceList.find((workspace) => !workspace.suspendedAt)
          ?? null;
        selectedWorkspaceId = initialWorkspace?.id ?? null;
        expandedWorkspaceIds = initialWorkspace ? [initialWorkspace.id] : [];
        if (initialWorkspace) {
          const workspaceLoad = loadWorkspace(initialWorkspace.id, { resume: explicitWorkspace === initialWorkspace.id });
          if (loadedWorkspaceIds.includes(initialWorkspace.id)) loading = false;
          await workspaceLoad;
          if (destroyed) return;
          const requestedNode = params.get('node');
          const requestedFilePath = pathFromWorkbenchFileItemId(requestedNode);
          if (requestedFilePath) rememberWorkbenchFiles(initialWorkspace.id, [requestedFilePath]);
          if (pendingFile?.workspaceId === initialWorkspace.id && pendingFile.path) {
            rememberWorkbenchFiles(initialWorkspace.id, [pendingFile.path]);
          }
          const candidates = workbenchItems(initialWorkspace.id);
          const fallbackNodeId = candidates.find((node) => node.id === requestedNode)?.id
            ?? candidates.find((node) => node.type === 'terminal' && Boolean((node.payload as TerminalNodePayload).maestro))?.id
            ?? candidates[0]?.id
            ?? null;
          let layout = ensureWorkbenchLayout(initialWorkspace.id, fallbackNodeId);
          if (requestedNode && candidates.some((node) => node.id === requestedNode)) {
            const requestedSplit = params.get('split');
            if (requestedSplit === 'horizontal' || requestedSplit === 'vertical') {
              layout = openWorkbenchNode(layout, requestedNode, {
                toSide: true,
                direction: requestedSplit,
              });
            } else {
              const requestedPaneId = params.get('pane');
              layout = requestedPaneId && workbenchPane(layout, requestedPaneId)
                ? openWorkbenchNode(layout, requestedNode, { paneId: requestedPaneId })
                : openWorkbenchNode(layout, requestedNode);
            }
          }
          if (pendingFile?.workspaceId === initialWorkspace.id && pendingFile.path) {
            layout = openWorkbenchNode(layout, workbenchFileItemId(pendingFile.path));
            sessionStorage.removeItem('orkestrai.open-file');
          }
          applyWorkbenchLayout(initialWorkspace.id, layout);
          persistSelection();
        }
        loading = false;
        await tick();
        connectEvents();
      } catch (error) {
        if (!destroyed && !permissionWorkspaceId) {
          errorMessage = error instanceof Error ? error.message : m['terminal_browser.load_error']();
        }
      } finally {
        if (!destroyed) loading = false;
      }
    };

    void initialize();

    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (refreshTimer) clearTimeout(refreshTimer);
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  });
</script>

<svelte:head>
  <title>Orkestrai - {m['workspace_view.workbench']()}</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

{#snippet renderWorkbenchPane(pane: WorkbenchPaneState)}
  {@const paneNode = nodeForPane(pane)}
  <section
    class={`grid h-full min-h-0 min-w-0 bg-[var(--app-canvas)] transition-[box-shadow,background-color] ${tabPlacement === 'horizontal' ? 'grid-rows-[36px_minmax(0,1fr)]' : 'grid-rows-[minmax(0,1fr)]'} ${selectedLayout?.activePaneId === pane.id ? 'shadow-[inset_0_0_0_1px_var(--app-border-strong)]' : ''} ${dropTargetPaneId === pane.id ? 'bg-[var(--app-accent-soft)] shadow-[inset_0_0_0_2px_var(--app-accent)]' : ''}`}
    data-pane-id={pane.id}
    data-testid={`workbench-pane-${pane.id}`}
    aria-label={paneLabel(pane.id)}
    onpointerdown={() => focusPane(pane.id)}
    ondragover={(event) => handlePaneDragOver(event, pane.id)}
    ondragleave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) dropTargetPaneId = null;
    }}
    ondrop={(event) => handlePaneDrop(event, pane.id)}
  >
    {#if tabPlacement === 'horizontal' && selectedWorkspaceId && selectedLayout}
      <WorkbenchTabs
        {pane}
        nodes={workbenchItems(selectedWorkspaceId)}
        placement="horizontal"
        activePane={selectedLayout.activePaneId === pane.id}
        label={paneLabel(pane.id)}
        panes={visiblePanes.map((candidate) => ({ id: candidate.id, label: paneLabel(candidate.id) }))}
        dirtyNodeIds={dirtyEditorNodeIds}
        onSelect={(nodeId) => selectOpenNode(pane.id, nodeId)}
        onClose={(nodeId) => closeOpenNode(pane.id, nodeId)}
        onMove={(nodeId, paneId) => moveOpenNode(paneId, nodeId)}
      />
    {/if}
    <div class="min-h-0 min-w-0">
      {#if paneNode && selectedWorkspace}
        {#if isWorkbenchFileItemId(paneNode.id) && filePathForItem(paneNode)}
          {#key `${pane.id}:${paneNode.id}`}
            <WorkbenchFileView
              workspaceId={selectedWorkspace.id}
              workingDir={selectedWorkspace.workingDir}
              path={filePathForItem(paneNode) ?? ''}
            />
          {/key}
        {:else if isWorkbenchControlCenterItemId(paneNode.id)}
          <ControlCenterView
            workspaceName={selectedWorkspace.name}
            snapshot={controlCenters[selectedWorkspace.id] ?? null}
            loading={loadingControlCenterIds.includes(selectedWorkspace.id)}
            onRefresh={() => void refreshControlCenter(selectedWorkspace.id)}
          />
        {:else if isWorkbenchWorkstreamsItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <WorkbenchWorkstreams workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if isWorkbenchMemoryItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <WorkspaceMemoryView workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if isWorkbenchAnnotationsItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <AnnotationCenterView workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if isWorkbenchHuddlesItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <HuddleView workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if isWorkbenchReviewCenterItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <WorkbenchReviewCenter workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if isWorkbenchAutomationsItemId(paneNode.id)}
          {#key `${pane.id}:${paneNode.id}`}
            <AutomationWorkspace
              workspaceId={selectedWorkspace.id}
              terminals={(nodesByWorkspace[selectedWorkspace.id] ?? []).filter((item) => item.type === 'terminal').map((item) => ({ id: item.id, title: item.title || m['terminal_browser.kind_terminal']() }))}
            />
          {/key}
        {:else if paneNode.type === 'device'}
          {#key `${pane.id}:${paneNode.id}`}
            <DeviceWorkbenchPanel workspaceId={selectedWorkspace.id} />
          {/key}
        {:else if paneNode.type === 'design'}
          {#key `${pane.id}:${paneNode.id}`}
            <DesignEditor workspaceId={selectedWorkspace.id} nodeId={paneNode.id} externalRevision={designRevisions[paneNode.id] ?? 0} />
          {/key}
        {:else}
          {#key `${pane.id}:${paneNode.id}`}
            <FocusedCanvasNode
              workspace={selectedWorkspace}
              node={paneNode}
              workspaceNodes={nodesByWorkspace[selectedWorkspace.id] ?? []}
              edges={edgesByWorkspace[selectedWorkspace.id] ?? []}
              floors={floorsByWorkspace[selectedWorkspace.id] ?? []}
              {providers}
              onNodeUpdated={updateNode}
              onDeleteRequested={(node) => (deletingNode = node)}
              onSelectNode={(nodeId) => selectNode(selectedWorkspace.id, nodeId)}
              onOpenFile={(path) => openWorkbenchFile(selectedWorkspace.id, path)}
              onRefresh={() => loadWorkspace(selectedWorkspace.id)}
            />
          {/key}
        {/if}
      {:else}
        <div class="flex h-full items-center justify-center p-8">
          <div class="max-w-xs text-center">
            <PanelRightOpen size={26} class="mx-auto mb-3 text-[var(--app-text-muted)]" strokeWidth={1.5} aria-hidden="true" />
            <h2 class="text-sm font-semibold text-balance">{m['workbench.empty_pane_title']()}</h2>
            <p class="mt-1 text-xs leading-5 text-pretty text-[var(--app-text-muted)]">{m['workbench.empty_pane_body']()}</p>
          </div>
        </div>
      {/if}
    </div>
  </section>
{/snippet}

{#snippet renderWorkbenchLayout(node: WorkbenchLayoutNode)}
  {#if node.kind === 'pane'}
    {@render renderWorkbenchPane(node)}
  {:else if selectedWorkspace}
    <Resizable.PaneGroup
      direction={node.direction}
      autoSaveId={`orkestrai.workbench.panes.v2.${selectedWorkspace.id}.${node.id}`}
      class="min-h-0 min-w-0"
    >
      {#each node.children as child, index (child.id)}
        {#if index > 0}
          <Resizable.Handle class="z-10 bg-[var(--app-border)] hover:bg-[var(--app-accent)] focus-visible:ring-[var(--app-accent)]" />
        {/if}
        <Resizable.Pane id={`${node.id}-${child.id}`} defaultSize={50} minSize={12} order={index + 1}>
          {@render renderWorkbenchLayout(child)}
        </Resizable.Pane>
      {/each}
    </Resizable.PaneGroup>
  {/if}
{/snippet}

<main class="grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)] max-[720px]:grid-cols-[236px_minmax(420px,1fr)]" data-testid="workbench-shell">
  <aside class="flex min-h-0 flex-col border-r border-[var(--app-border)] bg-[var(--app-sidebar)]">
    <div class="flex h-11 shrink-0 items-center gap-2 px-3">
      <img src="/brand/icon.svg" width="20" height="20" alt="" />
      <strong class="font-['Sora_Variable'] text-[14px] font-semibold text-[var(--app-text)]">Orkestrai</strong>
      <div class="ml-auto"><WorkspaceSharingButton variant="icon" workspaceId={selectedWorkspaceId} onOpen={() => (sharingOpen = true)} /></div>
    </div>
    <div class="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[var(--app-border)] px-3">
      <WorkspaceModeSwitch
        active="terminals"
        workspaceId={selectedWorkspaceId}
        nodeId={isVirtualWorkbenchItemId(selectedNodeId) ? null : selectedNodeId}
      />
      <AttentionCenter workspaceId={selectedWorkspaceId} />
    </div>

    <div class="shrink-0 p-2.5">
      <InputGroup.Root class="h-8 border-[var(--app-border)] bg-[var(--app-canvas)] shadow-none">
        <InputGroup.Addon><Search size={13} /></InputGroup.Addon>
        <InputGroup.Input
          bind:value={query}
          data-testid="terminal-workspace-search"
          placeholder={m['terminal_browser.search_placeholder']()}
          aria-label={m['terminal_browser.search_aria']()}
          autocomplete="off"
          spellcheck="false"
        />
      </InputGroup.Root>
    </div>

    {#if tabPlacement === 'vertical' && selectedLayout && selectedWorkspaceId}
      <div class="max-h-[38%] shrink-0 overflow-y-auto border-b border-[var(--app-border)] pb-1" data-testid="workbench-vertical-tabs">
        <div class="flex h-7 items-center px-3 text-[10px] font-semibold uppercase text-[var(--app-text-muted)]">
          {m['workbench.open_items']()}
        </div>
        {#each visiblePanes as pane (pane.id)}
          <WorkbenchTabs
            {pane}
            nodes={workbenchItems(selectedWorkspaceId)}
            placement="vertical"
            activePane={selectedLayout.activePaneId === pane.id}
            label={paneLabel(pane.id)}
            panes={visiblePanes.map((candidate) => ({ id: candidate.id, label: paneLabel(candidate.id) }))}
            dirtyNodeIds={dirtyEditorNodeIds}
            onSelect={(nodeId) => selectOpenNode(pane.id, nodeId)}
            onClose={(nodeId) => closeOpenNode(pane.id, nodeId)}
            onMove={(nodeId, paneId) => moveOpenNode(paneId, nodeId)}
          />
        {/each}
      </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" data-testid="terminal-workspace-tree">
      {#if loading}
        <div class="space-y-2 px-1 py-1">
          {#each [0, 1, 2, 3] as item (item)}
            <Skeleton class="h-8 w-full bg-[var(--app-surface-raised)]" />
          {/each}
        </div>
      {:else if permissionWorkspace}
        <div class="px-2 py-3">
          <WorkspacePermissionNotice workingDir={permissionWorkspace.workingDir} onRetry={retryWorkspaceAccess} />
        </div>
      {:else if errorMessage}
        <p class="px-3 py-4 text-xs leading-5 text-[var(--app-danger)]">{errorMessage}</p>
      {:else}
        {#each visibleWorkspaces as workspace (workspace.id)}
          {@const workspaceNodes = browsableNodes(workspace.id)}
          {@const expanded = expandedWorkspaceIds.includes(workspace.id) || Boolean(query.trim())}
          <section class="mb-0.5">
            <button
              class="group flex h-8 w-full items-center gap-1.5 rounded-[5px] px-1.5 text-left text-xs text-[var(--app-text-soft)] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
              aria-expanded={expanded}
              onclick={() => void toggleWorkspace(workspace.id)}
            >
              {#if expanded}<ChevronDown size={13} />{:else}<ChevronRight size={13} />{/if}
              <WorkspaceIcon name={workspace.icon} size={14} />
              <span class="min-w-0 flex-1 truncate font-medium">{workspace.name}</span>
              {#if workspace.suspendedAt}
                <Power size={11} class="text-[var(--app-text-muted)]" aria-label={m['canvas.ws_suspended']({ name: workspace.name })} />
              {:else if workspaceAttention(workspace.id)}
                <span class="rounded-[3px] bg-[color-mix(in_srgb,var(--app-warning)_16%,transparent)] px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-[var(--app-warning)]" title={m['control_center.summary_attention']()}>{workspaceAttention(workspace.id)}</span>
              {:else if controlCenters[workspace.id]?.counts.working}
                <span class="h-1.5 w-1.5 rounded-full bg-[var(--app-success)]" role="status" aria-label={m['control_center.summary_working']()}></span>
              {/if}
              {#if loadedWorkspaceIds.includes(workspace.id)}
                <span class="min-w-5 text-right text-[10px] tabular-nums text-[var(--app-text-muted)]">{workspaceNodes.length}</span>
              {/if}
            </button>

            {#if expanded}
              <div class="ml-3 border-l border-[var(--app-border)] py-0.5 pl-1.5">
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchControlCenterItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button
                    class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                    aria-current={selectedNodeId === workbenchControlCenterItemId(workspace.id) ? 'page' : undefined}
                    onclick={() => selectNode(workspace.id, workbenchControlCenterItemId(workspace.id))}
                  >
                    <Activity size={13} class={selectedNodeId === workbenchControlCenterItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['control_center.title']()}</span>
                    {#if workspaceAttention(workspace.id)}
                      <span class="rounded-[3px] bg-[color-mix(in_srgb,var(--app-warning)_16%,transparent)] px-1.5 py-0.5 text-[8px] font-semibold tabular-nums text-[var(--app-warning)]">{workspaceAttention(workspace.id)}</span>
                    {:else}
                      <span class="text-[9px] tabular-nums text-[var(--app-text-muted)]">{controlCenters[workspace.id]?.counts.working ?? 0}</span>
                    {/if}
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchWorkstreamsItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button
                    class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                    aria-current={selectedNodeId === workbenchWorkstreamsItemId(workspace.id) ? 'page' : undefined}
                    onclick={() => selectNode(workspace.id, workbenchWorkstreamsItemId(workspace.id))}
                  >
                    <Route size={13} class={selectedNodeId === workbenchWorkstreamsItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['workstreams.title']()}</span>
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchReviewCenterItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button
                    class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                    aria-current={selectedNodeId === workbenchReviewCenterItemId(workspace.id) ? 'page' : undefined}
                    onclick={() => selectNode(workspace.id, workbenchReviewCenterItemId(workspace.id))}
                  >
                    <GitPullRequestArrow size={13} class={selectedNodeId === workbenchReviewCenterItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['review_center.title']()}</span>
                  </button>
                </div>
                <div class="group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] text-[var(--app-text-soft)] transition-[background-color,color] hover:bg-[var(--app-surface-raised)]">
                  <button
                    class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                    aria-haspopup="dialog"
                    onclick={() => {
                      selectedWorkspaceId = workspace.id;
                      councilSource = null;
                      councilOpen = true;
                    }}
                  >
                    <Scale size={13} class="text-[var(--app-text-muted)]" aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['council.title']()}</span>
                    <span class="text-[9px] text-[var(--app-text-muted)]">{m['council.new']()}</span>
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchAutomationsItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button
                    class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                    aria-current={selectedNodeId === workbenchAutomationsItemId(workspace.id) ? 'page' : undefined}
                    onclick={() => selectNode(workspace.id, workbenchAutomationsItemId(workspace.id))}
                  >
                    <Workflow size={13} class={selectedNodeId === workbenchAutomationsItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['automation.title']()}</span>
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchMemoryItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]" aria-current={selectedNodeId === workbenchMemoryItemId(workspace.id) ? 'page' : undefined} onclick={() => selectNode(workspace.id, workbenchMemoryItemId(workspace.id))}>
                    <BookMarked size={13} class={selectedNodeId === workbenchMemoryItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['memory.title']()}</span>
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchHuddlesItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]" aria-current={selectedNodeId === workbenchHuddlesItemId(workspace.id) ? 'page' : undefined} onclick={() => selectNode(workspace.id, workbenchHuddlesItemId(workspace.id))}>
                    <MessageCircleMore size={13} class={selectedNodeId === workbenchHuddlesItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['huddle.title']()}</span>
                  </button>
                </div>
                <div class={`group mb-0.5 flex h-8 w-full min-w-0 items-center rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === workbenchAnnotationsItemId(workspace.id) ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                  <button class="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]" aria-current={selectedNodeId === workbenchAnnotationsItemId(workspace.id) ? 'page' : undefined} onclick={() => selectNode(workspace.id, workbenchAnnotationsItemId(workspace.id))}>
                    <MessageSquareText size={13} class={selectedNodeId === workbenchAnnotationsItemId(workspace.id) ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'} aria-hidden="true" />
                    <span class="min-w-0 flex-1 truncate font-medium">{m['annotations.title']()}</span>
                  </button>
                </div>
                <WorkbenchFileExplorer
                  workspaceId={workspace.id}
                  rootPath={workspace.workingDir}
                  activePath={selectedWorkspaceId === workspace.id ? filePathForItem(selectedNode) : null}
                  onOpen={(path, direction) => openWorkbenchFile(workspace.id, path, direction)}
                />
                {#each EXPLORER_GROUPS as group (group.id)}
                  {@const groupedItems = workspaceNodes.filter((item) => group.types.includes(item.type))}
                  {#if groupedItems.length}
                    <div class="flex h-6 items-center gap-2 px-2 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">
                      <span>{explorerGroupLabel(group.id)}</span>
                      <span class="ml-auto tabular-nums">{groupedItems.length}</span>
                    </div>
                    {#each groupedItems as item (item.id)}
                      <div data-testid={item.type === 'terminal' ? 'workbench-agent-item' : undefined} class={`group flex ${item.type === 'terminal' ? 'min-h-16 items-stretch' : 'h-8 items-center'} w-full min-w-0 rounded-[5px] transition-[background-color,color] hover:bg-[var(--app-surface-raised)] ${selectedNodeId === item.id ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)]'}`}>
                        <button
                          class="flex min-w-0 flex-1 items-start gap-2 px-2 text-left text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent)]"
                          aria-current={selectedNodeId === item.id ? 'page' : undefined}
                          onclick={() => selectNode(workspace.id, item.id)}
                        >
                          {#if item.type === 'terminal'}
                            <span class="mt-2.5 size-2 shrink-0 rounded-full" style:background={agentStateColor(workspace.id, item.id)}></span>
                            <span class="min-w-0 flex-1 py-1.5">
                              <span data-testid="workbench-agent-name" class="block break-words font-medium leading-[14px]">{item.title || nodeTypeLabel(item)}</span>
                              <span data-testid="workbench-agent-role" class="mt-0.5 block break-words text-[9px] leading-[13px] text-[var(--app-text-muted)]">{(item.payload as TerminalNodePayload).role ?? nodeTypeLabel(item)}</span>
                              {#if agentFloorLabel(workspace.id, item)}<span class="mt-0.5 block truncate text-[9px] leading-[13px] text-[var(--app-accent)]">{agentFloorLabel(workspace.id, item)}</span>{/if}
                              <span class="mt-1 block truncate text-[9px] text-[var(--app-text-soft)]">{agentActivityLabel(workspace.id, item.id) ?? nodeTypeLabel(item)}</span>
                            </span>
                          {:else}
                            <span class={`shrink-0 ${selectedNodeId === item.id ? 'text-[var(--app-accent)]' : 'text-[var(--app-text-muted)]'}`}>
                              <WorkbenchNodeIcon type={item.type} size={13} />
                            </span>
                            <span class="min-w-0 flex-1 truncate">{item.title || nodeTypeLabel(item)}</span>
                            <span class="max-w-20 truncate text-[9px] text-[var(--app-text-soft)]">{nodeTypeLabel(item)}</span>
                          {/if}
                        </button>
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <button
                                {...props}
                                class="mr-1 grid size-6 shrink-0 self-center place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] group-hover:opacity-100"
                                aria-label={m['workbench.open_right_named']({ name: item.title || nodeTypeLabel(item) })}
                                onclick={() => selectNode(workspace.id, item.id, 'horizontal')}
                              >
                                <PanelRightOpen size={13} aria-hidden="true" />
                              </button>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content side="right">{m['workbench.open_right']()}</Tooltip.Content>
                        </Tooltip.Root>
                        <Tooltip.Root>
                          <Tooltip.Trigger>
                            {#snippet child({ props })}
                              <button
                                {...props}
                                class="mr-1 grid size-6 shrink-0 self-center place-items-center rounded-[4px] text-[var(--app-text-muted)] opacity-0 transition-[background-color,color,opacity] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-text)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] group-hover:opacity-100"
                                aria-label={m['workbench.open_below_named']({ name: item.title || nodeTypeLabel(item) })}
                                onclick={() => selectNode(workspace.id, item.id, 'vertical')}
                              >
                                <PanelBottomOpen size={13} aria-hidden="true" />
                              </button>
                            {/snippet}
                          </Tooltip.Trigger>
                          <Tooltip.Content side="right">{m['workbench.open_below']()}</Tooltip.Content>
                        </Tooltip.Root>
                      </div>
                    {/each}
                  {/if}
                {/each}
                {#if workspaceNodes.length === 0}
                  <p class="px-2 py-2 text-[10px] text-[var(--app-text-muted)]">{m['terminal_browser.workspace_empty']()}</p>
                {/if}
              </div>
            {/if}
          </section>
        {:else}
          <p class="px-3 py-4 text-xs text-[var(--app-text-muted)]">{m['terminal_browser.no_results']()}</p>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="grid min-h-0 min-w-0 grid-rows-[48px_minmax(0,1fr)_28px]">
    <header class="flex min-w-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3" data-testid="terminal-workspace-header">
      {#if selectedWorkspace && selectedLayout}
        <WorkspaceIcon name={selectedWorkspace.icon} size={15} />
        <span class="truncate text-xs font-medium">{selectedWorkspace.name}</span>
        {#if selectedNode}
          <ChevronRight size={13} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />
          <span class="min-w-0 truncate text-xs text-[var(--app-text-soft)]">{selectedNode.title || nodeTypeLabel(selectedNode)}</span>
          <span class="ml-auto shrink-0 text-[10px] text-[var(--app-text-muted)]">
            {isWorkbenchFileItemId(selectedNode.id) ? m['workbench_files.file']() : nodeTypeLabel(selectedNode)}
          </span>
        {:else}
          <span class="ml-auto"></span>
        {/if}
        <div class="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-0.5">
          <span
            class="px-1.5 text-[9px] tabular-nums text-[var(--app-text-muted)]"
            aria-label={m['workbench.pane_count']({ current: visiblePanes.length, max: MAX_WORKBENCH_PANES })}
            title={visiblePanes.length >= MAX_WORKBENCH_PANES ? m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }) : undefined}
            data-testid="workbench-pane-count"
          >{visiblePanes.length}/{MAX_WORKBENCH_PANES}</span>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                aria-label={visiblePanes.length >= MAX_WORKBENCH_PANES ? m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }) : m['workbench.split_right']()}
                disabled={visiblePanes.length >= MAX_WORKBENCH_PANES}
                onclick={() => splitActivePane('horizontal')}
                data-testid="workbench-split-right"
              >
                <PanelRightOpen size={15} strokeWidth={1.8} />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{visiblePanes.length >= MAX_WORKBENCH_PANES ? m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }) : m['workbench.split_right']()}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                aria-label={visiblePanes.length >= MAX_WORKBENCH_PANES ? m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }) : m['workbench.split_down']()}
                disabled={visiblePanes.length >= MAX_WORKBENCH_PANES}
                onclick={() => splitActivePane('vertical')}
                data-testid="workbench-split-down"
              >
                <PanelBottomOpen size={15} strokeWidth={1.8} />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{visiblePanes.length >= MAX_WORKBENCH_PANES ? m['workbench.pane_limit']({ count: MAX_WORKBENCH_PANES }) : m['workbench.split_down']()}</Tooltip.Content>
        </Tooltip.Root>
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                variant="ghost"
                size="icon-sm"
                aria-label={m['workbench.close_pane']()}
                disabled={visiblePanes.length <= 1}
                onclick={closeActivePane}
                data-testid="workbench-close-pane"
              >
                <PanelRightClose size={15} strokeWidth={1.8} />
              </Button>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content>{m['workbench.close_pane']()}</Tooltip.Content>
        </Tooltip.Root>
        {#if selectedNode && !isVirtualWorkbenchItemId(selectedNode.id)}
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <Button
                  {...props}
                  variant="ghost"
                  size="icon-sm"
                  aria-label={m['terminal_browser.open_canvas']()}
                  href={`/canvas?workspace=${selectedWorkspace.id}&node=${selectedNode.id}`}
                  data-testid="terminal-open-canvas"
                >
                  <LocateFixed size={15} strokeWidth={1.8} />
                </Button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content>{m['terminal_browser.open_canvas']()}</Tooltip.Content>
          </Tooltip.Root>
        {/if}
        </div>
        <span class="h-full w-[60px] shrink-0" data-dictation-dock aria-hidden="true"></span>
      {:else}
        <span class="text-xs text-[var(--app-text-muted)]">{m['workbench.title']()}</span>
      {/if}
    </header>

    <div class="min-h-0 min-w-0">
      {#if selectedWorkspace && selectedLayout}
        {@render renderWorkbenchLayout(selectedLayout.root)}
      {:else if !loading}
        <div class="flex h-full items-center justify-center p-8">
          <div class="max-w-sm text-center">
            <SquareTerminal size={28} class="mx-auto mb-3 text-[var(--app-text-muted)]" strokeWidth={1.5} />
            <h1 class="text-sm font-semibold">{m['workbench.empty_title']()}</h1>
            <p class="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">{m['workbench.empty_body']()}</p>
          </div>
        </div>
      {/if}
    </div>
    <WorkbenchUsageFooter workspaceId={selectedWorkspaceId} />
  </section>
</main>

{#if selectedWorkspace}
  <CouncilDialog bind:open={councilOpen} workspaceId={selectedWorkspace.id} source={councilSource} />
{/if}
{#if sharingOpen && selectedWorkspace}
  <WorkspaceSharingDialog workspaceId={selectedWorkspace.id} onClose={() => (sharingOpen = false)} />
{/if}

<AlertDialog.Root open={Boolean(deletingNode)} onOpenChange={(open) => { if (!open) deletingNode = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['terminal_browser.delete_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['terminal_browser.delete_description']({ name: deletingNode?.title || (deletingNode ? nodeTypeLabel(deletingNode) : '') })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={confirmDeleteNode}>{m['settings.delete']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={Boolean(pendingEditorClose)} onOpenChange={(open) => { if (!open) pendingEditorClose = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['workbench_editor.close_unsaved_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['workbench_editor.close_unsaved_description']({ name: pendingEditorClose?.node.title || '' })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={discardAndCloseEditor}>{m['workbench_editor.discard_close']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
