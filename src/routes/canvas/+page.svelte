<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { toast } from '@beeblock/svelar/ui';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import {
    Background,
    ConnectionMode,
    Controls,
    MiniMap,
    Panel,
    SvelteFlow,
    type Connection,
    type Edge,
    type Node,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import TerminalCanvasNode from '$lib/components/agent-room/canvas/TerminalCanvasNode.svelte';
  import NoteCanvasNode from '$lib/components/agent-room/canvas/NoteCanvasNode.svelte';
  import WorkspaceEditDialog from '$lib/components/agent-room/canvas/WorkspaceEditDialog.svelte';
  import WorkspaceCreateDialog from '$lib/components/agent-room/canvas/WorkspaceCreateDialog.svelte';
  import CanvasNodeTransferDialog from '$lib/components/agent-room/canvas/CanvasNodeTransferDialog.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { Button } from '$lib/components/ui/button';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as m from '$lib/paraglide/messages.js';
  import FileTreeCanvasNode from '$lib/components/agent-room/canvas/FileTreeCanvasNode.svelte';
  import EditorCanvasNode from '$lib/components/agent-room/canvas/EditorCanvasNode.svelte';
  import DiffCanvasNode from '$lib/components/agent-room/canvas/DiffCanvasNode.svelte';
  import PortalCanvasNode from '$lib/components/agent-room/canvas/PortalCanvasNode.svelte';
  import ApiClientCanvasNode from '$lib/components/agent-room/canvas/ApiClientCanvasNode.svelte';
  import LoopCanvasNode from '$lib/components/agent-room/canvas/LoopCanvasNode.svelte';
  import GroupCanvasNode from '$lib/components/agent-room/canvas/GroupCanvasNode.svelte';
  import OrkestraiEdge from '$lib/components/agent-room/canvas/OrkestraiEdge.svelte';
  import ShapeCanvasNode, { type ShapeStyle } from '$lib/components/agent-room/canvas/ShapeCanvasNode.svelte';
  import {
    SHAPE_CLIPBOARD_TYPE,
    offsetShapeClipboard,
    parseShapeClipboard,
    serializeShapeClipboard,
    type ShapeClipboardEntry,
  } from '$lib/components/agent-room/canvas/shape-clipboard.js';
  import FloorPanel from '$lib/components/agent-room/canvas/FloorPanel.svelte';
  import AgentCreateDialog from '$lib/components/agent-room/canvas/AgentCreateDialog.svelte';
  import HeaderIconButton from '$lib/components/agent-room/canvas/HeaderIconButton.svelte';
  import OnboardingWizard from '$lib/components/agent-room/tours/OnboardingWizard.svelte';
  import { startTour } from '$lib/components/agent-room/tours/engine.svelte.js';
  import CouncilDialog from '$lib/components/agent-room/CouncilDialog.svelte';
  import WorkspaceSharingButton from '$lib/components/collaboration/WorkspaceSharingButton.svelte';
  import WorkspaceSharingDialog from '$lib/components/collaboration/WorkspaceSharingDialog.svelte';
  import WorkspaceIcon from '$lib/components/agent-room/WorkspaceIcon.svelte';
  import WorkspaceModeSwitch from '$lib/components/agent-room/WorkspaceModeSwitch.svelte';
  import AttentionCenter from '$lib/components/agent-room/AttentionCenter.svelte';
  import WorkspaceMemoryDialog from '$lib/components/agent-room/WorkspaceMemoryDialog.svelte';
  import AnnotationCenterDialog from '$lib/components/agent-room/AnnotationCenterDialog.svelte';
  import HuddleDialog from '$lib/components/agent-room/HuddleDialog.svelte';
  import WorkspacePermissionNotice from '$lib/components/agent-room/WorkspacePermissionNotice.svelte';
  import { isWorkspacePermissionError } from '$lib/components/agent-room/workspace-permission.js';
  import { isTypingTarget } from '$lib/components/agent-room/event-target.js';
  import {
    readProviderCache,
    readWorkspaceListCache,
    readWorkspaceViewCache,
    clearWorkspaceViewCache,
    removeWorkspaceViewCache,
    writeProviderCache,
    writeWorkspaceListCache,
    writeWorkspaceViewCache,
  } from '$lib/components/agent-room/workspace-view-cache.js';
  import TasksCanvasNode from '$lib/components/agent-room/canvas/TasksCanvasNode.svelte';
  import FlowCanvasNode from '$lib/components/agent-room/canvas/FlowCanvasNode.svelte';
  import ImageCanvasNode from '$lib/components/agent-room/canvas/ImageCanvasNode.svelte';
  import ImageWorkflowCanvasNode from '$lib/components/agent-room/canvas/ImageWorkflowCanvasNode.svelte';
  import ImageToolbarMenu from '$lib/components/agent-room/canvas/ImageToolbarMenu.svelte';
  import ToolbarButton from '$lib/components/agent-room/canvas/ToolbarButton.svelte';
  import RoutinePanel from '$lib/components/agent-room/canvas/RoutinePanel.svelte';
  import RolesPanel from '$lib/components/agent-room/canvas/RolesPanel.svelte';
  import UsagePanel from '$lib/components/agent-room/canvas/UsagePanel.svelte';
  import UsageCanvasNode from '$lib/components/agent-room/canvas/UsageCanvasNode.svelte';
  import CodeGraphCanvasNode from '$lib/components/agent-room/canvas/CodeGraphCanvasNode.svelte';
  import DeviceCanvasNode from '$lib/components/agent-room/canvas/DeviceCanvasNode.svelte';
  import DesignCanvasNode from '$lib/components/agent-room/canvas/DesignCanvasNode.svelte';
  import DesignEditor from '$lib/components/agent-room/design/DesignEditor.svelte';
  import DesignExplorationDialog from '$lib/components/agent-room/canvas/DesignExplorationDialog.svelte';
  import DesignToolbarMenu from '$lib/components/agent-room/canvas/DesignToolbarMenu.svelte';
  import PortsPanel from '$lib/components/agent-room/canvas/PortsPanel.svelte';
  import PresetLibraryPanel from '$lib/components/agent-room/canvas/PresetLibraryPanel.svelte';
  import AgentToolbarMenu from '$lib/components/agent-room/canvas/AgentToolbarMenu.svelte';
  import CommandPalette, { type PaletteAction } from '$lib/components/agent-room/canvas/CommandPalette.svelte';
  import { alignRects, boundingBox, distributeRects, tidyRects, type AlignMode } from '$lib/components/agent-room/canvas/layout.js';
  import { findFreeCanvasPosition } from '$lib/modules/agent-room/domain/canvas-placement.js';
  import type { TerminalThemeName } from '$lib/components/agent-room/terminal-themes.js';
  import {
    LEADER_DICTATION_COMMAND,
    LEADER_DICTATION_STATE,
    type LeaderDictationStateDetail,
    type LeaderDictationStatus,
  } from '$lib/components/agent-room/leader-dictation.js';
  import { TEXT_DICTATION_FALLBACK, type TextDictationFallbackDetail } from '$lib/components/agent-room/text-dictation.js';
  import { invalidateAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import {
    parsePinnedAgentProviders,
    PINNED_AGENT_PROVIDERS_SETTING,
    setAgentProviderPinned,
  } from '$lib/components/agent-room/provider-toolbar.js';
  import { BackgroundVariant, SvelteFlowProvider } from '@xyflow/svelte';
  import { BadgeCheck, Blocks, BookMarked, Braces, Cable, CalendarClock, ChevronLeft, ChevronRight, CircleHelp, Copy, Download, FileDiff, Folder, FolderPlus, FolderTree, Gauge, Layers, LayoutGrid, LayoutTemplate, MessageCircleMore, MonitorUp, MoreHorizontal, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Power, RadioTower, Scale, Search, Settings, Shapes, Smartphone, SquareKanban, StickyNote, Trash2, Upload, Waypoints, Workflow, X } from '@lucide/svelte';
  import ZoomBridge from '$lib/components/agent-room/canvas/ZoomBridge.svelte';
  import type {
    AgentProviderInfo,
    Floor,
    CanvasEdge,
    CanvasNode,
    CanvasNodeTransferMode,
    CanvasNodeTransferResult,
    NoteNodePayload,
    TerminalNodePayload,
    Workspace,
    WorkspaceGroup,
  } from '$lib/modules/agent-room/domain/types.js';
  import type { DesignExplorationData } from '$lib/modules/agent-room/interface/http/resources/DesignExplorationResource.js';
  import { terminalExecutionRuntime, workspaceExecutionRuntime } from '$lib/modules/agent-room/domain/runtime.js';

  const nodeTypes = {
    terminal: TerminalCanvasNode,
    note: NoteCanvasNode,
    fileTree: FileTreeCanvasNode,
    editor: EditorCanvasNode,
    diff: DiffCanvasNode,
    portal: PortalCanvasNode,
    apiClient: ApiClientCanvasNode,
    loop: LoopCanvasNode,
    group: GroupCanvasNode,
    shape: ShapeCanvasNode,
    tasks: TasksCanvasNode,
    flow: FlowCanvasNode,
    image: ImageCanvasNode,
    imageWorkflow: ImageWorkflowCanvasNode,
    usage: UsageCanvasNode,
    codeGraph: CodeGraphCanvasNode,
    device: DeviceCanvasNode,
    design: DesignCanvasNode,
  };

  let workspaces = $state<Workspace[]>([]);
  let workspaceQuery = $state('');

  // -- Pastas da barra lateral (organizam workspaces em arvore) ---------------
  let workspaceGroups = $state<WorkspaceGroup[]>([]);
  let newFolderName = $state('');
  let renamingGroupId = $state<string | null>(null);
  let renameGroupValue = $state('');
  let deletingGroup = $state<WorkspaceGroup | null>(null);
  let draggingItem = $state<{ kind: 'workspace' | 'group'; id: string } | null>(null);
  let dragOverGroupId = $state<string | null>(null);
  let dragOverRoot = $state(false);

  type WorkspaceGroupNode = { group: WorkspaceGroup; children: WorkspaceGroupNode[]; workspaces: Workspace[] };
  /** Arvore de pastas construida a partir das listas planas (groups + workspaces). */
  const workspaceTree = $derived.by(() => {
    const childGroupsByParent = new Map<string | null, WorkspaceGroup[]>();
    for (const group of workspaceGroups) {
      const key = group.parentId;
      const list = childGroupsByParent.get(key) ?? [];
      list.push(group);
      childGroupsByParent.set(key, list);
    }
    for (const list of childGroupsByParent.values()) list.sort((a, b) => a.position - b.position);

    const workspacesByGroup = new Map<string | null, Workspace[]>();
    for (const workspace of workspaces) {
      const key = workspace.groupId;
      const list = workspacesByGroup.get(key) ?? [];
      list.push(workspace);
      workspacesByGroup.set(key, list);
    }
    for (const list of workspacesByGroup.values()) list.sort((a, b) => a.position - b.position);

    function buildNode(group: WorkspaceGroup): WorkspaceGroupNode {
      return {
        group,
        children: (childGroupsByParent.get(group.id) ?? []).map(buildNode),
        workspaces: workspacesByGroup.get(group.id) ?? [],
      };
    }

    return {
      roots: (childGroupsByParent.get(null) ?? []).map(buildNode),
      rootWorkspaces: workspacesByGroup.get(null) ?? [],
    };
  });

  function isGroupCollapsed(groupId: string): boolean {
    return workspaceGroups.find((group) => group.id === groupId)?.collapsed ?? false;
  }

  /** Persistido no proprio registro da pasta (nao localStorage): sobrevive a
      limpeza de dados do navegador e e a mesma fonte de verdade da arvore. */
  async function toggleGroupCollapsed(groupId: string) {
    const collapsed = !isGroupCollapsed(groupId);
    workspaceGroups = workspaceGroups.map((group) => (group.id === groupId ? { ...group, collapsed } : group));
    try {
      await api<WorkspaceGroup>(`/api/agent-room/workspace-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ collapsed }),
      });
    } catch (error) {
      // Reverte o otimista se o servidor rejeitar (ex.: pasta apagada em outra aba).
      workspaceGroups = workspaceGroups.map((group) => (group.id === groupId ? { ...group, collapsed: !collapsed } : group));
      toast.error(workspaceGroupErrorText(error));
    }
  }

  function workspaceGroupErrorText(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    switch (code) {
      case 'group_name_required':
        return m['canvas.group_error_name_required']();
      case 'group_not_found':
        return m['canvas.group_error_not_found']();
      case 'group_cycle':
        return m['canvas.group_error_cycle']();
      case 'workspace_not_found':
        return m['canvas.group_error_not_found']();
      default:
        return m['canvas.error_api']();
    }
  }

  async function loadWorkspaceGroups() {
    workspaceGroups = await api<WorkspaceGroup[]>('/api/agent-room/workspace-groups').catch(() => []);
  }

  async function createWorkspaceGroup() {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const created = await api<WorkspaceGroup>('/api/agent-room/workspace-groups', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      workspaceGroups = [...workspaceGroups, created];
      newFolderName = '';
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  let creatingSubfolderParentId = $state<string | null>(null);
  let newSubfolderName = $state('');
  let newSubfolderCancelled = false;

  function startCreateSubfolder(parentId: string) {
    creatingSubfolderParentId = parentId;
    newSubfolderName = '';
    newSubfolderCancelled = false;
    // O input fica dentro da lista de filhos — se a pasta estava colapsada,
    // expande primeiro pra ele ficar visivel.
    if (isGroupCollapsed(parentId)) void toggleGroupCollapsed(parentId);
  }

  /** Mesma protecao contra o blur-apos-Esc do rename (ver cancelRenameGroup). */
  function cancelCreateSubfolder() {
    newSubfolderCancelled = true;
    creatingSubfolderParentId = null;
  }

  async function commitCreateSubfolder() {
    if (newSubfolderCancelled) {
      newSubfolderCancelled = false;
      return;
    }
    const parentId = creatingSubfolderParentId;
    const name = newSubfolderName.trim();
    creatingSubfolderParentId = null;
    if (!parentId || !name) return;
    try {
      const created = await api<WorkspaceGroup>('/api/agent-room/workspace-groups', {
        method: 'POST',
        body: JSON.stringify({ name, parentId }),
      });
      workspaceGroups = [...workspaceGroups, created];
      // Garante que a pasta recem-criada fique visivel: expande o pai se
      // estava colapsado, em vez do usuario ter que abrir na mao.
      if (isGroupCollapsed(parentId)) void toggleGroupCollapsed(parentId);
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  let renameGroupCancelled = false;

  function startRenameGroup(group: WorkspaceGroup) {
    renamingGroupId = group.id;
    renameGroupValue = group.name;
    renameGroupCancelled = false;
  }

  /** Esc cancela sem salvar. O input some ao ficar false, o que dispara blur
      em seguida — sem essa flag, o blur chamaria commitRenameGroup de novo e
      salvaria mesmo apos o cancelamento (bug que existia no my agents). */
  function cancelRenameGroup() {
    renameGroupCancelled = true;
    renamingGroupId = null;
  }

  async function commitRenameGroup(groupId: string) {
    if (renameGroupCancelled) {
      renameGroupCancelled = false;
      return;
    }
    const name = renameGroupValue.trim();
    renamingGroupId = null;
    const existing = workspaceGroups.find((group) => group.id === groupId);
    if (!name || !existing || name === existing.name) return;
    try {
      const updated = await api<WorkspaceGroup>(`/api/agent-room/workspace-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      workspaceGroups = workspaceGroups.map((group) => (group.id === updated.id ? updated : group));
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  async function reparentWorkspaceGroup(groupId: string, parentId: string | null) {
    try {
      const updated = await api<WorkspaceGroup>(`/api/agent-room/workspace-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId }),
      });
      workspaceGroups = workspaceGroups.map((group) => (group.id === updated.id ? updated : group));
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  async function confirmDeleteWorkspaceGroup() {
    const group = deletingGroup;
    deletingGroup = null;
    if (!group) return;
    try {
      await api(`/api/agent-room/workspace-groups/${group.id}`, { method: 'DELETE' });
      workspaceGroups = workspaceGroups.filter((item) => item.id !== group.id).map((item) => (item.parentId === group.id ? { ...item, parentId: null } : item));
      workspaces = workspaces.map((item) => (item.groupId === group.id ? { ...item, groupId: null } : item));
      writeWorkspaceListCache(workspaces);
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  async function moveWorkspaceToGroup(workspaceId: string, groupId: string | null) {
    try {
      const updated = await api<Workspace>(`/api/agent-room/workspaces/${workspaceId}/group`, {
        method: 'PATCH',
        body: JSON.stringify({ groupId }),
      });
      workspaces = workspaces.map((item) => (item.id === updated.id ? updated : item));
      writeWorkspaceListCache(workspaces);
    } catch (error) {
      toast.error(workspaceGroupErrorText(error));
    }
  }

  function handleDragStartWorkspace(event: DragEvent, workspace: Workspace) {
    draggingItem = { kind: 'workspace', id: workspace.id };
    event.dataTransfer?.setData('text/plain', workspace.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragStartGroup(event: DragEvent, group: WorkspaceGroup) {
    draggingItem = { kind: 'group', id: group.id };
    event.dataTransfer?.setData('text/plain', group.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragEnd() {
    draggingItem = null;
    dragOverGroupId = null;
    dragOverRoot = false;
  }

  function handleDragOverGroup(event: DragEvent, groupId: string) {
    if (!draggingItem || draggingItem.id === groupId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverGroupId = groupId;
  }

  function handleDragOverRoot(event: DragEvent) {
    if (!draggingItem) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragOverRoot = true;
  }

  async function handleDropOnGroup(event: DragEvent, groupId: string) {
    event.preventDefault();
    event.stopPropagation();
    const payload = draggingItem;
    handleDragEnd();
    if (!payload || payload.id === groupId) return;
    if (payload.kind === 'workspace') await moveWorkspaceToGroup(payload.id, groupId);
    else await reparentWorkspaceGroup(payload.id, groupId);
  }

  async function handleDropOnRoot(event: DragEvent) {
    event.preventDefault();
    const payload = draggingItem;
    handleDragEnd();
    if (!payload) return;
    if (payload.kind === 'workspace') await moveWorkspaceToGroup(payload.id, null);
    else await reparentWorkspaceGroup(payload.id, null);
  }

  /** Resolve quando os providers (com resumeArgs) terminam de carregar — o
      respawn de sessao nao pode disparar antes disso ou perde os args de resume. */
  let providersReadyResolve: () => void = () => {};
  const providersReady = new Promise<void>((resolve) => {
    providersReadyResolve = resolve;
  });
  /** Lista filtrada pelo campo de busca da sidebar (por nome, case-insensitive). */
  const visibleWorkspaces = $derived(
    workspaceQuery.trim()
      ? workspaces.filter((workspace) => workspace.name.toLowerCase().includes(workspaceQuery.trim().toLowerCase()))
      : workspaces
  );
  let activeWorkspace = $state<Workspace | null>(null);
  let providers = $state<AgentProviderInfo[]>([]);
  const canChooseAlternateRuntime = typeof navigator !== 'undefined' && navigator.platform.startsWith('Win');
  let nodes = $state.raw<Node[]>([]);
  let edges = $state.raw<Edge[]>([]);
  let shapePasteSequence = 0;
  let errorMessage = $state('');
  let designModeNodeId = $state<string | null>(null);
  let designRevisions = $state<Record<string, number>>({});
  let permissionWorkspace = $state<Workspace | null>(null);

  // Formulario de novo workspace
  let showWorkspaceForm = $state(false);
  let initialPresetId = $state('');
  let pendingWorkspaceGroupId = $state<string | null>(null);
  let showOnboarding = $state(false);
  let requestedTourId = $state<string | null>(null);
  let councilOpen = $state(false);
  let councilSource = $state<{ taskId?: string; taskTitle?: string; taskDescription?: string | null; leaderNodeId?: string } | null>(null);
  let designExplorationOpen = $state(false);
  let sharingOpen = $state(false);
  let memoryOpen = $state(false);
  let annotationsOpen = $state(false);
  let huddleOpen = $state(false);
  let transferOpen = $state(false);
  /** workspaceId -> sessoes PTY vivas (indicador de ativo na sidebar). */
  let activity = $state<Record<string, number>>({});
  let editingWorkspace = $state<Workspace | null>(null);
  let deletingWorkspace = $state<Workspace | null>(null);
  let selectionRequestId = 0;
  let showPalette = $state(false);
  let backgroundVariant = $state<BackgroundVariant | 'none'>(BackgroundVariant.Dots);
  let zoomApi = $state<{
    setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
    fitView: (options?: { duration?: number }) => void;
    screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
    getViewport: () => { x: number; y: number; zoom: number };
  } | null>(null);
  let flowWrapper: HTMLElement;
  const selectedTransferNodeIds = $derived(nodes.filter((node) => node.selected).map((node) => node.id));
  const selectedTransferNodeIdSet = $derived(new Set(selectedTransferNodeIds));
  const selectedTransferConnectionCount = $derived(edges.filter((edge) => (
    selectedTransferNodeIdSet.has(edge.source) && selectedTransferNodeIdSet.has(edge.target)
  )).length);

  const explorationLeader = $derived.by(() => {
    const node = nodes.find((item) => item.type === 'terminal' && Boolean((item.data?.payload as { maestro?: boolean } | undefined)?.maestro));
    if (!node) return null;
    const payload = (node.data?.payload ?? {}) as { provider?: string };
    return {
      id: node.id,
      title: String(node.data?.title ?? m['canvas.fallback_terminal']()),
      provider: providers.find((provider) => provider.id === payload.provider)?.displayName ?? payload.provider ?? '',
    };
  });

  // Undo/redo: snapshots leves de nodes+edges antes de cada mutacao estrutural.
  const undoStack: Array<{ nodes: Node[]; edges: Edge[] }> = [];
  const redoStack: Array<{ nodes: Node[]; edges: Edge[] }> = [];
  let undoArmed = true;

  function snapshot() {
    if (!undoArmed) return;
    undoStack.push({ nodes: nodes.map((node) => ({ ...node })), edges: edges.map((edge) => ({ ...edge })) });
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }

  async function undo() {
    const previous = undoStack.pop();
    if (!previous || !activeWorkspace) return;
    redoStack.push({ nodes: nodes.map((node) => ({ ...node })), edges: edges.map((edge) => ({ ...edge })) });
    await restoreSnapshot(previous);
  }

  async function redo() {
    const next = redoStack.pop();
    if (!next || !activeWorkspace) return;
    undoStack.push({ nodes: nodes.map((node) => ({ ...node })), edges: edges.map((edge) => ({ ...edge })) });
    await restoreSnapshot(next);
  }

  async function restoreSnapshot(snapshotData: { nodes: Node[]; edges: Edge[] }) {
    if (!activeWorkspace) return;
    undoArmed = false;
    try {
      // Recria o estado: apaga o que sobrou, recria o que faltava (por id).
      const currentIds = new Set(nodes.map((node) => node.id));
      const targetIds = new Set(snapshotData.nodes.map((node) => node.id));
      for (const id of currentIds) {
        if (!targetIds.has(id)) {
          await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${id}`, { method: 'DELETE' }).catch(() => {});
        }
      }
      for (const node of snapshotData.nodes) {
        await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${node.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ x: node.position.x, y: node.position.y }),
        }).catch(() => {});
      }
      nodes = snapshotData.nodes;
      edges = snapshotData.edges;
    } finally {
      undoArmed = true;
    }
  }

  // Modo "desenhar no": clique na ferramenta e arraste o retangulo no canvas.
  type DrawTool = 'terminal' | 'note' | 'fileTree' | 'diff' | 'portal' | 'apiClient' | 'device' | 'loop' | 'shape' | 'tasks' | 'flow' | 'image' | 'imageWorkflow' | 'usage' | 'codeGraph' | 'design';
  let drawTool = $state<DrawTool | null>(null);
  let drawStart = $state<{ x: number; y: number } | null>(null);
  let drawCurrent = $state<{ x: number; y: number } | null>(null);
  // Provider armado junto com a ferramenta terminal (Claude/Codex/Kimi...) —
  // sem isso o botao do agente criava um shell puro em vez do TUI do agente.
  let drawProvider = $state<AgentProviderInfo | null>(null);

  type DrawRect = { x: number; y: number; width: number; height: number };
  /** Tamanho do no criado: nunca menor que o minimo do NodeShell — desenhar
      pequeno demais vazava os botoes do header pra fora da janela. */
  function nodeSize(rect: DrawRect | undefined, minW: number, minH: number, defW: number, defH: number): { width: number; height: number } {
    return {
      width: rect?.width ? Math.max(rect.width, minW) : defW,
      height: rect?.height ? Math.max(rect.height, minH) : defH,
    };
  }
  // Criacao de terminal passa pelo dialogo (nome/modelo/esforco/lider) —
  // como no Maestri, que pergunta o nome ao soltar o retangulo no canvas.
  let pendingAgentCreation = $state<{ provider: AgentProviderInfo | null; rect?: DrawRect } | null>(null);
  const DRAW_CREATORS: Record<DrawTool, (rect: DrawRect | undefined, provider?: AgentProviderInfo | null) => Promise<void>> = {
    terminal: async (rect, provider) => { pendingAgentCreation = { provider: provider ?? null, rect }; },
    note: async (rect) => { await addNote(rect); },
    fileTree: async (rect) => { await addFileTree(rect); },
    diff: async (rect) => { await addDiff(rect); },
    portal: async (rect) => { await addPortal(rect); },
    apiClient: async (rect) => { await addApiClient(rect); },
    device: async (rect) => { await addDevice(rect); },
    loop: async (rect) => { await addLoop(rect); },
    shape: async (rect) => { await addShape(rect); },
    tasks: async (rect) => { await addTasksNode(rect); },
    flow: async (rect) => { await addFlowNode(rect); },
    image: async (rect) => { await addImageNode(rect); },
    imageWorkflow: async (rect) => { await addImageWorkflowNode(rect); },
    usage: async (rect) => { await addUsageNode(rect); },
    codeGraph: async (rect) => { await addCodeGraphNode(rect); },
    design: async (rect) => { await addDesignNode(rect); },
  };

  function toggleDrawTool(tool: DrawTool, provider?: AgentProviderInfo) {
    // Apenas arma a ferramenta: o no nasce no clique (tamanho padrao) ou
    // no arraste (tamanho customizado) sobre o canvas — como no Maestri.
    const sameTool = drawTool === tool && (provider?.id ?? null) === (drawProvider?.id ?? null);
    drawTool = sameTool ? null : tool;
    drawProvider = sameTool ? null : (provider ?? null);
    drawStart = null;
    drawCurrent = null;
  }

  function flowPoint(event: PointerEvent) {
    // Conversao manual: (cliente - rect do wrapper - pan) / zoom — robusta a
    // sidebar e a qualquer fitView aplicado.
    const wrapper = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const viewport = zoomApi?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    return {
      x: (event.clientX - wrapper.left - viewport.x) / viewport.zoom,
      y: (event.clientY - wrapper.top - viewport.y) / viewport.zoom,
    };
  }

  function handlePanePointerDown(event: PointerEvent) {
    if (!drawTool || !activeWorkspace) return;
    // So inicia o desenho no fundo vazio do canvas — cliques em nos, handles
    // e na toolbar nao contam (e o pointer capture nao rouba o clique).
    if (!(event.target as HTMLElement).classList.contains('svelte-flow__pane')) return;
    drawStart = flowPoint(event);
    drawCurrent = drawStart;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePanePointerMove(event: PointerEvent) {
    if (!drawStart) return;
    drawCurrent = flowPoint(event);
  }

  // O ghost e um overlay HTML fora do viewport do flow: precisa de coordenadas
  // de TELA (flow * zoom + pan), senao ele aparece deslocado do cursor.
  const ghostRect = $derived.by(() => {
    if (!drawStart || !drawCurrent) return null;
    const viewport = zoomApi?.getViewport() ?? { x: 0, y: 0, zoom: 1 };
    const sx = drawStart.x * viewport.zoom + viewport.x;
    const sy = drawStart.y * viewport.zoom + viewport.y;
    const cx = drawCurrent.x * viewport.zoom + viewport.x;
    const cy = drawCurrent.y * viewport.zoom + viewport.y;
    return {
      left: Math.min(sx, cx),
      top: Math.min(sy, cy),
      width: Math.abs(cx - sx),
      height: Math.abs(cy - sy),
    };
  });

  async function handlePanePointerUp(event: PointerEvent) {
    if (!drawTool || !drawStart || !drawCurrent) return;
    const rect = {
      x: Math.min(drawStart.x, drawCurrent.x),
      y: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y),
    };
    const tool = drawTool;
    const provider = drawProvider;
    drawTool = null;
    drawProvider = null;
    const start = drawStart;
    drawStart = null;
    drawCurrent = null;
    if (rect.width < 40 || rect.height < 30) {
      // Clique simples no fundo: cria com tamanho padrao nessa posicao.
      await DRAW_CREATORS[tool]({ x: start.x - 200, y: start.y - 120, width: 0, height: 0 }, provider);
      return;
    }
    await DRAW_CREATORS[tool](rect, provider);
  }
  let showFloorPanel = $state(false);
  let showRoutinePanel = $state(false);
  let showRolesPanel = $state(false);
  let showUsagePanel = $state(false);
  let showPortsPanel = $state(false);
  let showPresetPanel = $state(false);
  let leaderDictationState = $state<LeaderDictationStatus>('idle');
  let leaderDictationNodeId = $state<string | null>(null);
  let sidebarCollapsed = $state(false);
  let importInput: HTMLInputElement;
  let visibleFloorId = $state<string | null>(null);
  let floors = $state<Floor[]>([]);

  type SidePanelName = 'presets' | 'floors' | 'routines' | 'roles' | 'usage' | 'ports';

  function toggleSidePanel(panel: SidePanelName) {
    const next = panel === 'presets' ? !showPresetPanel
      : panel === 'floors' ? !showFloorPanel
      : panel === 'routines' ? !showRoutinePanel
      : panel === 'roles' ? !showRolesPanel
      : panel === 'usage' ? !showUsagePanel
      : !showPortsPanel;
    showPresetPanel = panel === 'presets' && next;
    showFloorPanel = panel === 'floors' && next;
    showRoutinePanel = panel === 'routines' && next;
    showRolesPanel = panel === 'roles' && next;
    showUsagePanel = panel === 'usage' && next;
    showPortsPanel = panel === 'ports' && next;
  }

  function createWorkspaceFromPreset(presetId: string) {
    initialPresetId = presetId;
    showPresetPanel = false;
    showWorkspaceForm = true;
  }

  function handleDesktopMenuAction(action: string) {
    if (action === 'new-workspace') {
      initialPresetId = '';
      showWorkspaceForm = true;
      return;
    }
    if (action === 'presets') toggleSidePanel('presets');
    else if (action === 'floors' && activeWorkspace) toggleSidePanel('floors');
    else if (action === 'roles' && activeWorkspace) toggleSidePanel('roles');
    else if (action === 'usage') toggleSidePanel('usage');
    else if (action === 'ports' && activeWorkspace) toggleSidePanel('ports');
    else if (action === 'memory' && activeWorkspace) memoryOpen = true;
    else if (action === 'annotations' && activeWorkspace) annotationsOpen = true;
    else if (action === 'huddles' && activeWorkspace) huddleOpen = true;
    else if (action === 'organize' && activeWorkspace) void organizeCanvas();
    else if (action === 'command-palette') showPalette = true;
  }

  async function refreshAfterPresetApply() {
    if (!activeWorkspace) return;
    await selectWorkspace(activeWorkspace.id, { force: true });
    toast.success(m['preset.applied']());
  }

  function dispatchLeaderDictation(nodeId: string) {
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(LEADER_DICTATION_COMMAND, { detail: { nodeId } }));
    });
  }

  async function toggleLeaderDictation() {
    if (!activeWorkspace || leaderDictationState === 'transcribing') return;
    if (leaderDictationState === 'recording' && leaderDictationNodeId) {
      dispatchLeaderDictation(leaderDictationNodeId);
      return;
    }
    let allNodes: CanvasNode[];
    try {
      allNodes = await api<CanvasNode[]>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`);
    } catch {
      toast.error(m['leader_dictation.error']());
      return;
    }
    const leader = allNodes.find((node) => node.type === 'terminal' && (node.payload as TerminalNodePayload).maestro);
    if (!leader) {
      leaderDictationState = 'idle';
      leaderDictationNodeId = null;
      toast.error(m['leader_dictation.no_leader']());
      return;
    }

    leaderDictationNodeId = leader.id;
    if ((leader.floorId ?? null) !== visibleFloorId) await selectFloor(leader.floorId ?? null);
    await tick();
    dispatchLeaderDictation(leader.id);
  }

  onMount(() => {
    const handleDictationState = (event: Event) => {
      const detail = (event as CustomEvent<LeaderDictationStateDetail>).detail;
      if (!detail) return;
      if (detail.nodeId !== leaderDictationNodeId) {
        const source = nodes.find((node) => node.id === detail.nodeId);
        if (source?.type !== 'terminal' || !(source.data?.payload as TerminalNodePayload | undefined)?.maestro) return;
        leaderDictationNodeId = detail.nodeId;
      }
      leaderDictationState = detail.status;
    };
    window.addEventListener(LEADER_DICTATION_STATE, handleDictationState);
    return () => window.removeEventListener(LEADER_DICTATION_STATE, handleDictationState);
  });

  onMount(() => {
    const handleFallback = (event: Event) => {
      const detail = (event as CustomEvent<TextDictationFallbackDetail>).detail;
      if (!detail || !activeWorkspace) return;
      detail.handled = true;
      void toggleLeaderDictation();
    };
    window.addEventListener(TEXT_DICTATION_FALLBACK, handleFallback);
    return () => window.removeEventListener(TEXT_DICTATION_FALLBACK, handleFallback);
  });

  onMount(() => {
    const listener = (event: Event) => handleDesktopMenuAction(String((event as CustomEvent).detail ?? ''));
    const openCouncilListener = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; source?: typeof councilSource }>).detail;
      const workspaceId = detail?.workspaceId;
      councilSource = detail?.source ?? null;
      if (workspaceId && workspaceId !== activeWorkspace?.id) {
        void selectWorkspace(workspaceId).then(() => (councilOpen = true));
        return;
      }
      councilOpen = true;
    };
    const openSharingListener = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
      if (workspaceId && workspaceId !== activeWorkspace?.id) {
        void selectWorkspace(workspaceId).then(() => (sharingOpen = true));
        return;
      }
      sharingOpen = true;
    };
    const openDesignExplorationListener = (event: Event) => {
      const workspaceId = (event as CustomEvent<{ workspaceId?: string }>).detail?.workspaceId;
      if (workspaceId && workspaceId !== activeWorkspace?.id) {
        void selectWorkspace(workspaceId).then(() => (designExplorationOpen = true));
        return;
      }
      designExplorationOpen = true;
    };
    const openFileListener = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; path?: string }>).detail;
      if (detail?.workspaceId && detail.path) void openFileFromSearch(detail.workspaceId, detail.path);
    };
    window.addEventListener('orkestrai:menu-action', listener);
    window.addEventListener('orkestrai:open-council', openCouncilListener);
    window.addEventListener('orkestrai:open-sharing', openSharingListener);
    window.addEventListener('orkestrai:open-design-exploration', openDesignExplorationListener);
    window.addEventListener('orkestrai:open-file', openFileListener);
    const pending = sessionStorage.getItem('orkestrai.menu-action');
    if (pending) {
      sessionStorage.removeItem('orkestrai.menu-action');
      requestAnimationFrame(() => handleDesktopMenuAction(pending));
    }
    return () => {
      window.removeEventListener('orkestrai:menu-action', listener);
      window.removeEventListener('orkestrai:open-council', openCouncilListener);
      window.removeEventListener('orkestrai:open-sharing', openSharingListener);
      window.removeEventListener('orkestrai:open-design-exploration', openDesignExplorationListener);
      window.removeEventListener('orkestrai:open-file', openFileListener);
    };
  });

  async function openFileFromSearch(workspaceId: string, path: string) {
    sessionStorage.setItem('orkestrai.open-file', JSON.stringify({ workspaceId, path }));
    await goto(`/terminal?workspace=${workspaceId}`);
  }

  async function openPendingSearchFile() {
    const raw = sessionStorage.getItem('orkestrai.open-file');
    if (!raw) return;
    sessionStorage.removeItem('orkestrai.open-file');
    try {
      const detail = JSON.parse(raw) as { workspaceId?: string; path?: string };
      if (detail.workspaceId && detail.path) await openFileFromSearch(detail.workspaceId, detail.path);
    } catch {
      // Pedido obsoleto ou invalido: ignora sem bloquear o workspace.
    }
  }

  function floorPath(floorId: string | null | undefined): string | null {
    if (!floorId) return null;
    return floors.find((floor) => floor.id === floorId)?.path ?? null;
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['canvas.error_api']());
    return payload.data as T;
  }

  let appSettings = $state<Record<string, string>>({});
  let pinnedProviderIds = $state<string[]>([]);
  let persistedPinnedProviderIds: string[] = [];
  let pinnedProviderSaveQueue: Promise<void> = Promise.resolve();

  function togglePinnedProvider(providerId: string, pinned: boolean) {
    const next = setAgentProviderPinned(pinnedProviderIds, providerId, pinned);
    if (next.limitReached) {
      toast.error(m['canvas.pinned_agents_limit']());
      return;
    }

    pinnedProviderIds = next.ids;
    const serialized = JSON.stringify(next.ids);
    appSettings = { ...appSettings, [PINNED_AGENT_PROVIDERS_SETTING]: serialized };

    pinnedProviderSaveQueue = pinnedProviderSaveQueue.then(async () => {
      try {
        await api<Record<string, string>>('/api/agent-room/settings', {
          method: 'PUT',
          body: JSON.stringify({ [PINNED_AGENT_PROVIDERS_SETTING]: serialized }),
        });
        persistedPinnedProviderIds = next.ids;
        invalidateAppSettings();
      } catch {
        if (JSON.stringify(pinnedProviderIds) === serialized) {
          pinnedProviderIds = persistedPinnedProviderIds;
          appSettings = {
            ...appSettings,
            [PINNED_AGENT_PROVIDERS_SETTING]: JSON.stringify(persistedPinnedProviderIds),
          };
        }
        toast.error(m['canvas.pinned_agents_save_error']());
      }
    });
  }

  // Live refresh: a bridge (CLI dos agentes) escreve direto no banco; o
  // servidor avisa via WS e a pagina recarrega nos/edges/andares do workspace
  // ativo — sem precisar trocar de andar ou recarregar a pagina.
  let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
  let graphRefreshRequestId = 0;
  const draggingNodeIds = new Set<string>();
  const localPositionOverrides = new Map<string, { x: number; y: number; confirmedAt: number | null }>();

  async function refreshCanvasGraph(workspaceId: string): Promise<boolean> {
    const requestId = ++graphRefreshRequestId;
    const refreshStartedAt = performance.now();
    const previousById = new Map(nodes.map((node) => [node.id, node]));
    const [canvasNodes, canvasEdges, floorList] = await Promise.all([
      api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`),
      api<CanvasEdge[]>(`/api/agent-room/workspaces/${workspaceId}/edges`),
      api<Floor[]>(`/api/agent-room/workspaces/${workspaceId}/floors`),
    ]);
    if (requestId !== graphRefreshRequestId || activeWorkspace?.id !== workspaceId) return false;
    floors = floorList;
    nodes = canvasNodes
      .filter((node) => (node.floorId ?? null) === visibleFloorId)
      .map((node) => {
        const refreshed = toFlowNode(node);
        const previous = previousById.get(node.id);
        const override = localPositionOverrides.get(node.id);
        if (override) {
          const serverMatches = node.x === override.x && node.y === override.y;
          if (serverMatches || (override.confirmedAt !== null && override.confirmedAt <= refreshStartedAt)) {
            localPositionOverrides.delete(node.id);
          } else {
            refreshed.position = { x: override.x, y: override.y };
          }
        } else if (draggingNodeIds.has(node.id) && previous) {
          refreshed.position = { ...previous.position };
        }
        if (previous?.selected) refreshed.selected = true;
        return refreshed;
      });
    const visibleIds = new Set(nodes.map((node) => node.id));
    edges = canvasEdges.map(toFlowEdge).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    writeWorkspaceViewCache({ workspace: activeWorkspace, nodes: canvasNodes, edges: canvasEdges, floors: floorList });
    return true;
  }

  async function refreshActivity(): Promise<void> {
    const summaries = await api<Record<string, { agents: Array<{ sessionAlive: boolean }> }>>('/api/agent-room/control-center').catch(() => ({}));
    activity = Object.fromEntries(
      Object.entries(summaries)
        .map(([workspaceId, snapshot]) => [workspaceId, snapshot.agents.filter((agent) => agent.sessionAlive).length] as const)
        .filter(([, count]) => count > 0),
    );
  }

  function connectWorkspaceEvents() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'workspaceChanged' && message.workspaceId === activeWorkspace?.id) {
          if (refreshDebounce) clearTimeout(refreshDebounce);
          refreshDebounce = setTimeout(() => {
            refreshDebounce = null;
            if (activeWorkspace) void refreshCanvasGraph(activeWorkspace.id);
          }, 250);
        }
        if (message.type === 'designChanged' && message.workspaceId === activeWorkspace?.id && message.nodeId) {
          const nodeId = String(message.nodeId);
          const revision = Number(message.revision) || 0;
          designRevisions = { ...designRevisions, [nodeId]: revision };
          nodes = nodes.map((node) => node.id === nodeId
            ? { ...node, data: { ...node.data, designRevision: revision } }
            : node);
        }
        if (message.type === 'controlCenterChanged' || message.type === 'messageDelivery') {
          void refreshActivity();
        }
      } catch {
        // frame nao-JSON: ignora
      }
    };
    socket.onclose = () => {
      // Reconecta com backoff simples enquanto a pagina estiver aberta.
      setTimeout(connectWorkspaceEvents, 3_000);
    };
    return socket;
  }

  onMount(() => {
    const eventsSocket = connectWorkspaceEvents();
    void (async () => {
      const cachedWorkspaces = readWorkspaceListCache();
      const cachedProviders = readProviderCache();
      if (cachedWorkspaces) {
        workspaces = cachedWorkspaces;
        workspacesLoaded = true;
      }
      if (cachedProviders) providers = cachedProviders;
      void loadWorkspaceGroups();
      const [workspaceList, settingsResponse] = await Promise.all([
        api<Workspace[]>('/api/agent-room/workspaces'),
        api<Record<string, string>>('/api/agent-room/settings'),
      ]);
      const params = new URLSearchParams(location.search);
      requestedTourId = params.get('tour');
      appSettings = settingsResponse ?? {};
      const availableProviderIds = new Set(providers.map((provider) => provider.id));
      pinnedProviderIds = parsePinnedAgentProviders(appSettings[PINNED_AGENT_PROVIDERS_SETTING])
        .filter((id) => availableProviderIds.size === 0 || availableProviderIds.has(id));
      persistedPinnedProviderIds = pinnedProviderIds;
      // Se o usuario ja criou/selecionou algo enquanto o fetch inicial estava
      // em voo, a lista antiga nao sobrescreve o estado mais novo.
      if (selectionRequestId === 0) {
        workspaces = workspaceList;
        writeWorkspaceListCache(workspaceList);
        const explicitWorkspaceId = params.get('workspace');
        const rememberedWorkspaceId = localStorage.getItem('orkestrai.activeWorkspaceId');
        const requestedWorkspace = workspaceList.find((workspace) => workspace.id === explicitWorkspaceId)
          ?? workspaceList.find((workspace) => workspace.id === rememberedWorkspaceId && !workspace.suspendedAt)
          ?? workspaceList.find((workspace) => !workspace.suspendedAt);
        if (requestedWorkspace) {
          await selectWorkspace(requestedWorkspace.id);
          const requestedNodeId = params.get('node');
          if (requestedNodeId && nodes.some((node) => node.id === requestedNodeId)) {
            await tick();
            const requestedNode = nodes.find((node) => node.id === requestedNodeId);
            if (requestedNode?.type === 'design' && params.get('design') === '1') {
              designModeNodeId = requestedNodeId;
            }
            requestAnimationFrame(() => requestAnimationFrame(() => (
              requestedNode?.type === 'device'
                ? jumpToNode(requestedNodeId, 0.64, 26)
                : jumpToNode(requestedNodeId)
            )));
          }
          await openPendingSearchFile();
          if (params.has('council')) councilOpen = true;
          if (requestedTourId && !params.has('onboarding')) {
            await startTour(requestedTourId, requestedWorkspace.id);
          }
        }
      }
      workspacesLoaded = true;
      await tick();
      // Indicador de workspaces ativos (sessoes PTY vivas em background).
      await refreshActivity();
      void api<{ providers: AgentProviderInfo[] }>(`/api/agent-room/status${activeWorkspace ? `?workspaceId=${encodeURIComponent(activeWorkspace.id)}` : ''}`)
        .then((status) => {
          providers = status.providers ?? [];
          writeProviderCache(providers);
          const registeredProviderIds = new Set(providers.map((provider) => provider.id));
          pinnedProviderIds = parsePinnedAgentProviders(appSettings[PINNED_AGENT_PROVIDERS_SETTING])
            .filter((id) => registeredProviderIds.has(id));
          persistedPinnedProviderIds = pinnedProviderIds;
          nodes = nodes.map((node) => ({ ...node, data: { ...node.data, providers } }));
        })
        .catch(() => undefined)
        .finally(providersReadyResolve);
      // Onboarding: automatico na primeira vez (sem workspaces) ou forcado
      // via /canvas?onboarding=1 (botao "Rever apresentacao" do /docs).
      // A intencao vai para sessionStorage: a troca de idioma remonta a arvore
      // ({#key locale}) DEPOIS do replaceState — sem a flag, o remount recriava
      // a pagina com showOnboarding=false e o wizard nunca abria fora de pt-BR.
      try {
        const forced = params.has('onboarding');
        if (forced) {
          sessionStorage.setItem('orkestrai.onboarding', '1');
          params.delete('onboarding');
        }
        if (forced || sessionStorage.getItem('orkestrai.onboarding') === '1') {
          showOnboarding = true;
        } else if (!workspaceList.length && !localStorage.getItem('orkestrai.onboarded')) {
          showOnboarding = true;
        }
        if (!forced && requestedTourId && workspaceList.length) params.delete('tour');
        if (params.has('council') && workspaceList.length) params.delete('council');
        const query = params.toString();
        history.replaceState(null, '', `/canvas${query ? `?${query}` : ''}`);
      } catch {
        // storage indisponivel — nao bloqueia
      }
    })();
    return () => {
      toolbarResizeObserver?.disconnect();
      eventsSocket.onclose = null;
      eventsSocket.close();
    };
  });

  // Overflow da toolbar: re-checa quando o tamanho/conteudo muda (resize,
  // providers carregados, janela menor). Setas aparecem so quando ha para onde rolar.
  let toolbarResizeObserver: ResizeObserver | null = null;

  $effect(() => {
    if (!toolbarEl) return;
    void providers.length;
    updateToolbarScroll();
    toolbarResizeObserver ??= new ResizeObserver(updateToolbarScroll);
    toolbarResizeObserver.observe(toolbarEl);
    return () => toolbarResizeObserver?.disconnect();
  });

  function toFlowNode(node: CanvasNode): Node {
    const workspaceRuntime = activeWorkspace ? workspaceExecutionRuntime(activeWorkspace) : { kind: 'native' as const };
    const executionRuntime = activeWorkspace && node.type === 'terminal'
      ? terminalExecutionRuntime(activeWorkspace, node.payload as TerminalNodePayload)
      : workspaceRuntime;
    return {
      id: node.id,
      type: node.type,
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      // Camadas deterministicas evitam que SVGs de edges atravessem terminais
      // em alguns compositores Chromium/Windows.
      zIndex: node.type === 'group' ? 0 : 20 + Math.max(0, node.zIndex ?? 0),
      data: {
        title: node.title ?? '',
        workspaceId: activeWorkspace?.id ?? '',
        workspaceName: activeWorkspace?.name ?? '',
        codeIntelligenceMode: activeWorkspace?.codeIntelligenceMode ?? 'assisted',
        providersReady,
        providers,
        workingDir: floorPath(node.floorId) ?? activeWorkspace?.workingDir ?? '.',
        workspaceRoot: activeWorkspace?.workingDir ?? '.',
        executionRuntime,
        workspaceRuntime,
        payload: node.payload,
        // Closures: avaliadas na hora do respawn (providers ja carregados) —
        // avaliar aqui congelaria undefined no restart (providers ainda vazios).
        exactResumeArgsFor: (agentSessionId: string) => exactResumeArgsFor(node)?.(agentSessionId) ?? null,
        freshSessionArgsFor: () => freshSessionArgsFor(node),
        sessionStorageFor: () => sessionStorageFor(node),
        onAgentSessionFound: (id: string, agentSessionId: string) => updateNodePayload(id, { agentSessionId, resumeRecovery: false }),
        connections: connectionsFor(node.id),
        onJumpToNode: jumpToNode,
        onRemoveConnection: removeConnection,
        onDelete: deleteNode,
        onDuplicate: duplicateShape,
        onResize: resizeNode,
        onSessionCreated: async (id: string, sessionId: string, options: { resumed: boolean }) => {
          await updateNodePayload(id, { sessionId });
          await api(`/api/agent-room/workspaces/${activeWorkspace?.id}/roles/apply`, {
            method: 'POST',
            body: JSON.stringify({ nodeId: id, mode: options.resumed ? 'resume' : 'fresh' }),
          }).catch(() => {});
        },
        onProviderChange: changeNodeProvider,
        onRuntimeChange: changeNodeRuntime,
        onToggleMaestro: (id: string) => {
          const current = (nodes.find((node) => node.id === id)?.data?.payload ?? {}) as Record<string, unknown>;
          updateNodePayload(id, { maestro: !current.maestro });
        },
        onThemeChange: (id: string, theme: TerminalThemeName) => updateNodePayload(id, { theme }),
        onContentChange: (id: string, content: string) => updateNodePayload(id, { content }),
        onColorChange: (id: string, color: string) => updateNodePayload(id, { color }),
        onRoleChange: (id: string, role: string | null) => updateNodePayload(id, { role }),
        onOpenFile: (path: string) => openEditor(path),
        onOpenWorkbench: (id: string) => (designModeNodeId = id),
        onUrlChange: (id: string, url: string) => updateNodePayload(id, { url }),
        onOpenNewPortal: (sourceNodeId: string, url: string) => void openPortalTab(sourceNodeId, url),
        onRename: (id: string, title: string) => {
          nodes = nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, title } } : node));
          api(`/api/agent-room/workspaces/${activeWorkspace?.id}/nodes/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ title }),
          }).catch(() => {});
        },
        onUngroup: (id: string) => ungroup(id),
        onPayloadChange: (id: string, partial: Record<string, unknown>) => updateNodePayload(id, partial),
        onTalking: handleTalking,
      },
    };
  }

  // A edge entre dois terminais acende (verde + fluxo animado) enquanto a
  // bridge esta levando uma mensagem entre eles.
  function handleTalking(payload: { from: string | null; to: string; talking: boolean }) {
    edges = edges.map((edge) => {
      const matches = payload.from
        ? (edge.source === payload.from && edge.target === payload.to) ||
          (edge.target === payload.from && edge.source === payload.to)
        : edge.source === payload.to || edge.target === payload.to;
      if (!matches) return edge;
      return { ...edge, data: { ...(edge.data ?? {}), talking: payload.talking } };
    });
  }

  function exactResumeArgsFor(node: CanvasNode): ((agentSessionId: string) => string[] | null) | undefined {
    const provider = providerForNode(node);
    const template = provider?.tui?.exactResumeArgs;
    if (!template) return undefined;
    return (agentSessionId: string) =>
      template.map((arg) => arg.replace('__ORKESTRAI_SESSION_ID__', agentSessionId));
  }

  function freshSessionArgsFor(node: CanvasNode): string[] | null {
    return providerForNode(node)?.tui?.freshSessionArgs ?? null;
  }

  function sessionStorageFor(node: CanvasNode): string | null {
    return providerForNode(node)?.sessionStorage ?? null;
  }

  function providerForNode(node: CanvasNode): AgentProviderInfo | undefined {
    const payload = node.payload as { provider?: string; command?: string };
    return providers.find((item) => item.id === payload.provider) ??
      providers.find((item) => item.tui?.command === payload.command);
  }

  async function changeNodeProvider(id: string, provider: string, profileId?: string | null, profileLabel?: string | null) {
    if (!activeWorkspace) return;
    const previousProvider = (nodes.find((node) => node.id === id)?.payload as { provider?: string } | undefined)?.provider;
    const updated = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${id}/provider`, {
      method: 'PUT',
      body: JSON.stringify({ provider, profileId: profileId ?? null }),
    });
    nodes = nodes.map((node) => node.id === id
      ? { ...node, data: { ...node.data, payload: updated.payload } }
      : node);
    if (previousProvider !== provider) {
      toast.success(m['term.provider_switched']({ provider: providerForNode(updated)?.displayName ?? provider }));
    } else {
      toast.success(m['term.profile_switched']({ profile: profileLabel ?? m['term.profile_default']() }));
    }
  }

  async function changeNodeRuntime(
    id: string,
    selection: { mode: 'default' | 'native' | 'wsl'; wslDistribution: string | null; wslWorkingDir: string | null },
  ) {
    if (!activeWorkspace) return;
    const updated = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${id}/runtime`, {
      method: 'PUT',
      body: JSON.stringify(selection),
    });
    nodes = nodes.map((node) => node.id === id ? toFlowNode(updated) : node);
    toast.success(m['term.runtime_changed']());
  }

  function connectionsFor(nodeId: string) {
    return edges
      .filter((edge) => edge.source === nodeId || edge.target === nodeId)
      .map((edge) => {
        const outgoing = edge.source === nodeId;
        const otherId = outgoing ? edge.target : edge.source;
        const other = nodes.find((node) => node.id === otherId);
        return {
          edgeId: edge.id,
          targetId: otherId,
          targetTitle: String(other?.data?.title ?? other?.type ?? m['canvas.fallback_node']()),
          targetType: String(other?.type ?? m['canvas.fallback_node']()),
          targetPayload: (other?.data?.payload ?? {}) as Record<string, unknown>,
          direction: (outgoing ? 'out' : 'in') as 'out' | 'in',
        };
      });
  }

  async function removeConnection(edgeId: string) {
    snapshot();
    selectedEdgeId = null;
    if (!activeWorkspace) return;
    await api(`/api/agent-room/workspaces/${activeWorkspace.id}/edges/${edgeId}`, { method: 'DELETE' }).catch(() => {});
    edges = edges.filter((edge) => edge.id !== edgeId);
  }

  const edgeTypes = { orkestrai: OrkestraiEdge };

  function toFlowEdge(edge: CanvasEdge): Edge {
    return {
      id: edge.id,
      source: edge.sourceNodeId,
      target: edge.targetNodeId,
      // Sempre a corda verlet — o estilo "circuit" (linhas retas) foi removido.
      type: 'orkestrai',
      zIndex: 10,
      data: {
        onRemove: removeConnection,
        renderingPreference: appSettings.canvasEdgeRendering ?? 'auto',
      },
    };
  }

  async function selectWorkspace(id: string, options: { force?: boolean } = {}) {
    // Recarregar o workspace ja ativo pode sobrescrever estado mais novo
    // (ex.: um no criado enquanto o fetch estava em voo) — exceto com force
    // (refresh disparado pela bridge, que e a fonte da verdade).
    if (!options.force && activeWorkspace?.id === id) return;
    // So a selecao mais recente pode aplicar seu resultado: fetches antigos
    // (ex.: o auto-select do mount) nao sobrescrevem escolhas posteriores.
    const changingWorkspace = activeWorkspace?.id !== id;
    const requestId = ++selectionRequestId;
    errorMessage = '';
    permissionWorkspace = null;
    const cached = !options.force && !workspaces.find((workspace) => workspace.id === id)?.suspendedAt
      ? readWorkspaceViewCache(id)
      : null;
    if (cached) {
      activeWorkspace = cached.workspace;
      floors = cached.floors;
      nodes = cached.nodes
        .filter((node) => (node.floorId ?? null) === visibleFloorId)
        .map(toFlowNode);
      const visibleIds = new Set(nodes.map((node) => node.id));
      edges = cached.edges.map(toFlowEdge).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    }
    try {
      const resumedWorkspace = changingWorkspace
        ? await api<Workspace>(`/api/agent-room/workspaces/${id}/load`, { method: 'POST' })
        : null;
      const providerStatusRequest = api<{ providers: AgentProviderInfo[] }>(
        `/api/agent-room/status?workspaceId=${encodeURIComponent(id)}`
      );
      const [workspace, canvasNodes, canvasEdges, floorList] = await Promise.all([
        resumedWorkspace ?? api<Workspace>(`/api/agent-room/workspaces/${id}`),
        api<CanvasNode[]>(`/api/agent-room/workspaces/${id}/nodes`),
        api<CanvasEdge[]>(`/api/agent-room/workspaces/${id}/edges`),
        api<Floor[]>(`/api/agent-room/workspaces/${id}/floors`),
      ]);
      if (requestId !== selectionRequestId) return;
      activeWorkspace = workspace;
      workspaces = workspaces.map((item) => item.id === workspace.id ? workspace : item);
      writeWorkspaceListCache(workspaces);
      localStorage.setItem('orkestrai.activeWorkspaceId', workspace.id);
      if (changingWorkspace) {
        leaderDictationState = 'idle';
        leaderDictationNodeId = null;
        designModeNodeId = null;
        designRevisions = {};
      }
      floors = floorList;
      if (!options.force) {
        queueMicrotask(() => {
          if (canvasNodes.length) zoomApi?.fitView({ duration: 0, maxZoom: 1 } as never);
        });
      }
      nodes = canvasNodes
        .filter((node) => (node.floorId ?? null) === visibleFloorId)
        .map(toFlowNode);
      const visibleIds = new Set(nodes.map((node) => node.id));
      edges = canvasEdges.map(toFlowEdge).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
      writeWorkspaceViewCache({ workspace, nodes: canvasNodes, edges: canvasEdges, floors: floorList });
      void providerStatusRequest.then((providerStatus) => {
        if (requestId !== selectionRequestId || activeWorkspace?.id !== id) return;
        providers = providerStatus.providers ?? [];
        writeProviderCache(providers);
        nodes = nodes.map((node) => ({ ...node, data: { ...node.data, providers } }));
      }).catch(() => undefined);
    } catch (error) {
      if (isWorkspacePermissionError(error)) {
        permissionWorkspace = workspaces.find((workspace) => workspace.id === id) ?? null;
        errorMessage = '';
      } else {
        errorMessage = error instanceof Error ? error.message : m['canvas.error_open_ws']();
      }
    }
  }

  async function retryWorkspaceAccess(): Promise<void> {
    const workspace = permissionWorkspace;
    if (!workspace) return;
    await selectWorkspace(workspace.id, { force: true });
  }

  async function selectFloor(floorId: string | null) {
    visibleFloorId = floorId;
    if (activeWorkspace) {
      const requestId = ++selectionRequestId;
      const workspaceId = activeWorkspace.id;
      const [canvasNodes, canvasEdges] = await Promise.all([
        api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`),
        api<CanvasEdge[]>(`/api/agent-room/workspaces/${workspaceId}/edges`),
      ]);
      if (requestId !== selectionRequestId || activeWorkspace?.id !== workspaceId) return;
      nodes = canvasNodes.filter((node) => (node.floorId ?? null) === visibleFloorId).map(toFlowNode);
      const visibleIds = new Set(nodes.map((node) => node.id));
      edges = canvasEdges.map(toFlowEdge).filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target));
    }
  }

  async function exportActiveWorkspace() {
    if (!activeWorkspace) return;
    const data = await api<unknown>(`/api/agent-room/workspaces/${activeWorkspace.id}/export`);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeWorkspace.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.orkestrai.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importWorkspaceFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    errorMessage = '';
    try {
      const data = JSON.parse(await file.text());
      const workspace = await api<Workspace>('/api/agent-room/workspaces/import', {
        method: 'POST',
        body: JSON.stringify({ data }),
      });
      workspaces = [workspace, ...workspaces];
      await selectWorkspace(workspace.id);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['canvas.error_import_ws']();
    } finally {
      importInput.value = '';
    }
  }

  // -- Setas de scroll da toolbar (so aparecem quando ha overflow) -----------
  let toolbarEl = $state<HTMLDivElement | null>(null);
  let canScrollLeft = $state(false);
  let canScrollRight = $state(false);

  function updateToolbarScroll() {
    if (!toolbarEl) return;
    canScrollLeft = toolbarEl.scrollLeft > 2;
    canScrollRight = toolbarEl.scrollLeft < toolbarEl.scrollWidth - toolbarEl.clientWidth - 2;
  }

  function scrollToolbar(direction: 1 | -1) {
    toolbarEl?.scrollBy({ left: direction * 220, behavior: 'smooth' });
  }

  // -- Descarregar workspace (encerra terminais vivos, mantem o layout) ---------
  let confirmUnload = $state(false);
  let unloading = $state(false);
  let unloadMessage = $state('');
  let workspacesLoaded = $state(false);

  async function unloadActiveWorkspace() {
    if (!activeWorkspace) return;
    unloading = true;
    try {
      const workspaceId = activeWorkspace.id;
      const result = await api<{ killedSessions: number; workspace: Workspace }>(`/api/agent-room/workspaces/${workspaceId}/unload`, {
        method: 'POST',
      });
      selectionRequestId += 1;
      workspaces = workspaces.map((workspace) => workspace.id === workspaceId ? result.workspace : workspace);
      writeWorkspaceListCache(workspaces);
      clearWorkspaceViewCache(workspaceId);
      activeWorkspace = null;
      nodes = [];
      edges = [];
      floors = [];
      localStorage.removeItem('orkestrai.activeWorkspaceId');
      history.replaceState(null, '', '/canvas');
      const count = result?.killedSessions ?? 0;
      unloadMessage = count > 0
        ? count === 1
          ? m['canvas.unload_done_one']({ count })
          : m['canvas.unload_done_many']({ count })
        : m['canvas.unload_none']();
    } finally {
      unloading = false;
      confirmUnload = false;
      setTimeout(() => (unloadMessage = ''), 5_000);
    }
  }

  async function handleWorkspaceCreated(workspace: Workspace) {
    selectionRequestId += 1; // invalida o auto-select do mount imediatamente
    workspaces = [workspace, ...workspaces];
    writeWorkspaceListCache(workspaces);
    showWorkspaceForm = false;
    await selectWorkspace(workspace.id);
  }

  /** Cria workspace pelo wizard de onboarding (ja seleciona e devolve). */
  async function createWorkspaceFromWizard(input: { name: string; workingDir: string }): Promise<Workspace | null> {
    const workspace = await api<Workspace>('/api/agent-room/workspaces', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    if (!workspace) return null;
    selectionRequestId += 1;
    workspaces = [workspace, ...workspaces];
    writeWorkspaceListCache(workspaces);
    await selectWorkspace(workspace.id);
    return workspace;
  }

  async function saveWorkspace(changes: {
    name: string;
    workingDir: string;
    icon: string | null;
    instructions: string | null;
    syncAgentInstructionFiles: boolean;
    runtimeKind: 'native' | 'wsl';
    wslDistribution: string | null;
    wslWorkingDir: string | null;
    repositoryRoots: Array<{ alias: string; path: string }>;
    codeIntelligenceMode: Workspace['codeIntelligenceMode'];
  }) {
    if (!editingWorkspace) return;
    const updated = await api<Workspace>(`/api/agent-room/workspaces/${editingWorkspace.id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    workspaces = workspaces.map((item) => (item.id === updated.id ? updated : item));
    writeWorkspaceListCache(workspaces);
    if (activeWorkspace?.id === updated.id) {
      activeWorkspace = updated;
      nodes = nodes.map((node) => ({
        ...node,
        data: { ...node.data, codeIntelligenceMode: updated.codeIntelligenceMode },
      }));
    }
  }

  async function confirmDeleteWorkspace() {
    const workspace = deletingWorkspace;
    deletingWorkspace = null;
    if (!workspace) return;
    await api(`/api/agent-room/workspaces/${workspace.id}`, { method: 'DELETE' });
    workspaces = workspaces.filter((item) => item.id !== workspace.id);
    removeWorkspaceViewCache(workspace.id);
    writeWorkspaceListCache(workspaces);
    if (activeWorkspace?.id === workspace.id) {
      activeWorkspace = null;
      nodes = [];
      edges = [];
      const nextWorkspace = workspaces[0] ?? null;
      if (nextWorkspace) {
        await selectWorkspace(nextWorkspace.id);
        history.replaceState(null, '', `/canvas?workspace=${encodeURIComponent(nextWorkspace.id)}`);
      } else {
        localStorage.removeItem('orkestrai.activeWorkspaceId');
        history.replaceState(null, '', '/canvas');
      }
    }
  }

  function nextFreePosition(width = 560, height = 360) {
    return findFreeCanvasPosition(nodes.map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: Number(node.width ?? node.measured?.width ?? 560),
      height: Number(node.height ?? node.measured?.height ?? 360),
    })), { x: 80, y: 80, width, height });
  }

  /** Titulo unico no canvas: "Claude" ocupado vira "Claude 2"... (ask ambiguo quebra o roteamento). */
  function uniqueNodeTitle(base: string): string {
    const taken = new Set(nodes.map((node) => String(node.data?.title ?? '').toLowerCase()));
    if (!taken.has(base.toLowerCase())) return base;
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base} ${suffix}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  async function addTerminal(
    provider?: AgentProviderInfo,
    rect?: { x: number; y: number; width: number; height: number },
    creation?: { title: string; model: string | null; effort: string | null; leader: boolean; executionRuntime: import('$lib/modules/agent-room/domain/types.js').WorkspaceExecutionRuntime | null; profileId?: string | null }
  ) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(Number(appSettings.newTerminalWidth ?? 560), Number(appSettings.newTerminalHeight ?? 340));
    let payload: TerminalNodePayload;
    if (provider) {
      // Monta o comando com model/effort escolhidos no dialogo (server-side,
      // via adapter — as flags variam por provider).
      let spec: { command: string; args: string[]; env?: Record<string, string> } | null = provider.tui
        ? { command: provider.tui.command, args: provider.tui.args, env: provider.tui.env }
        : null;
      if (creation && (creation.model || creation.effort)) {
        const params = new URLSearchParams({ provider: provider.id });
        if (creation.model) params.set('model', creation.model);
        if (creation.effort) params.set('effort', creation.effort);
        spec = await api<{ command: string; args: string[]; env?: Record<string, string> }>(`/api/agent-room/agent-spec?${params}`).catch(() => spec);
      }
      payload = spec
        ? { command: spec.command, args: spec.args, env: spec.env, provider: provider.id, ...(creation?.leader ? { maestro: true } : {}) }
        : { command: provider.id, args: [], provider: provider.id };
    } else {
      // The server resolves the native/WSL shell against the host where the PTY runs.
      payload = { command: '', args: [] };
    }
    if (creation?.executionRuntime) payload.executionRuntime = creation.executionRuntime;
    if (creation?.profileId) payload.profileId = creation.profileId;
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'terminal',
        title: uniqueNodeTitle(creation?.title || provider?.displayName || m['canvas.default_shell']()),
        ...position,
        width: nodeSize(rect, 360, 220, Number(appSettings.newTerminalWidth ?? 560), Number(appSettings.newTerminalHeight ?? 340)).width,
        height: nodeSize(rect, 360, 220, Number(appSettings.newTerminalWidth ?? 560), Number(appSettings.newTerminalHeight ?? 340)).height,
        payload: { ...payload, theme: payload.theme ?? appSettings.terminalTheme },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addFileTree(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(300, 380);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'fileTree', title: m['canvas.default_files'](), ...position, ...nodeSize(rect, 260, 200, 300, 380), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function openEditor(path: string) {
    if (!activeWorkspace) return;
    sessionStorage.setItem('orkestrai.open-file', JSON.stringify({ workspaceId: activeWorkspace.id, path }));
    await goto(`/terminal?workspace=${activeWorkspace.id}`);
  }

  const SHAPES = ['rectangle', 'ellipse', 'diamond', 'arrow'] as const;
  let shapeIndex = $state(0);

  async function addShape(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const kind = SHAPES[shapeIndex % SHAPES.length];
    shapeIndex += 1;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(kind === 'arrow' ? 220 : 160, kind === 'arrow' ? 80 : 160);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'shape',
        title: '',
        ...position,
        width: nodeSize(rect, 120, 60, kind === 'arrow' ? 220 : 160, kind === 'arrow' ? 80 : 160).width,
        height: nodeSize(rect, 120, 60, kind === 'arrow' ? 220 : 160, kind === 'arrow' ? 80 : 160).height,
        payload: { shape: kind, color: '#7C4DFF', label: '' },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addPortal(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(720, 520);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'portal', title: m['canvas.default_portal'](), ...position, ...nodeSize(rect, 360, 260, 720, 520), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function openPortalTab(sourceNodeId: string, url: string) {
    if (!activeWorkspace || url.length > 4_096) return;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    const width = 720;
    const height = 520;
    const source = nodes.find((node) => node.id === sourceNodeId);
    const position = findFreeCanvasPosition(nodes.map((node) => ({
      x: node.position.x,
      y: node.position.y,
      width: Number(node.width ?? node.measured?.width ?? 560),
      height: Number(node.height ?? node.measured?.height ?? 360),
    })), {
      x: source ? source.position.x + Number(source.width ?? source.measured?.width ?? width) + 48 : 80,
      y: source?.position.y ?? 80,
      width,
      height,
    });
    const title = parsed.hostname.replace(/^www\./i, '') || m['canvas.default_portal']();
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'portal',
        title,
        ...position,
        width,
        height,
        payload: { url: parsed.href },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
    requestAnimationFrame(() => jumpToNode(node.id, 0.72, 28));
    toast.success(m['portal.new_tab_added']({ title }));
  }

  async function addApiClient(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(820, 560);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'apiClient',
        title: m['api_client.title'](),
        ...position,
        ...nodeSize(rect, 520, 360, 820, 560),
        payload: { requests: [], selectedRequestId: null, variables: {} },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addDevice(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const existing = nodes.find((node) => node.type === 'device');
    if (existing) {
      jumpToNode(existing.id, 0.64, 26);
      toast.info(m['device.already_on_canvas']());
      return;
    }
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(560, 720);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'device',
        title: m['device.title'](),
        ...position,
        ...nodeSize(rect, 440, 560, 560, 720),
        payload: {},
      }),
    });
    if ((node.floorId ?? null) !== visibleFloorId) {
      await selectFloor(node.floorId ?? null);
      await tick();
    } else if (!nodes.some((candidate) => candidate.id === node.id)) {
      nodes = [...nodes, toFlowNode(node)];
    }
    jumpToNode(node.id, 0.64, 26);
    toast.success(m['device.added_to_canvas']());
  }

  async function addLoop(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(560, 460);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'loop', title: m['canvas.default_loop'](), ...position, ...nodeSize(rect, 380, 280, 560, 460), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addTasksNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(560, 360);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'tasks', title: m['canvas.default_tasks'](), ...position, ...nodeSize(rect, 400, 260, 560, 360), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addUsageNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const existing = nodes.find((node) => node.type === 'usage');
    if (existing) {
      jumpToNode(existing.id);
      toast.info(m['usage.already_on_canvas']());
      return;
    }
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(600, 600);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'usage',
        title: m['usage.node_title'](),
        ...position,
        ...nodeSize(rect, 380, 360, 600, 600),
        payload: { enabled: true, sourceProvider: 'claude', fallbackProvider: 'codex', windowKind: 'weekly', thresholdPercent: 90 },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addCodeGraphNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    if (activeWorkspace.codeIntelligenceMode === 'disabled') {
      toast.error(m['code_graph.disabled_toast']());
      return;
    }
    const existing = nodes.find((node) => node.type === 'codeGraph');
    if (existing) {
      jumpToNode(existing.id);
      toast.info(m['code_graph.already_on_canvas']());
      return;
    }
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(760, 560);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'codeGraph',
        title: m['code_graph.title'](),
        ...position,
        ...nodeSize(rect, 480, 420, 760, 560),
        payload: {},
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
    toast.success(m['code_graph.added']());
  }

  async function addFlowNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(480, 420);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'flow', title: m['canvas.default_flow'](), ...position, ...nodeSize(rect, 420, 300, 480, 420), payload: { steps: [], iterations: 1 }, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addImageNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(320, 240);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'image', title: m['node.image'](), ...position, ...nodeSize(rect, 220, 160, 320, 240), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addImageWorkflowNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(440, 560);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'imageWorkflow',
        title: m['image_workflow.title'](),
        ...position,
        ...nodeSize(rect, 390, 440, 440, 560),
        payload: {
          schemaVersion: 1,
          prompt: '',
          count: 1,
          transparentBackground: false,
          outputDirectory: 'generated/images',
          filePrefix: 'orkestrai-image',
          status: 'idle',
          history: [],
        },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addDesignNode(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(520, 380);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'design',
        title: m['design.default_name'](),
        ...position,
        ...nodeSize(rect, 360, 260, 520, 380),
        payload: { schemaVersion: 1 },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
    designModeNodeId = node.id;
  }

  async function handleDesignExplorationCreated(result: DesignExplorationData) {
    if (!activeWorkspace) return;
    const refreshed = await refreshCanvasGraph(activeWorkspace.id);
    if (!refreshed) return;
    await tick();
    jumpToNode(result.groupId, 0.62);
  }

  async function addDiff(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(720, 440);
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({ type: 'diff', title: m['canvas.default_diff'](), ...position, ...nodeSize(rect, 380, 240, 720, 440), payload: {}, floorId: visibleFloorId }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function addNote(rect?: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    const position = rect ? { x: rect.x, y: rect.y } : nextFreePosition(Number(appSettings.newNoteWidth ?? 320), Number(appSettings.newNoteHeight ?? 220));
    const payload: NoteNodePayload = { content: '' };
    const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'note',
        title: m['canvas.default_note'](),
        ...position,
        width: nodeSize(rect, 220, 140, Number(appSettings.newNoteWidth ?? 320), Number(appSettings.newNoteHeight ?? 220)).width,
        height: nodeSize(rect, 220, 140, Number(appSettings.newNoteWidth ?? 320), Number(appSettings.newNoteHeight ?? 220)).height,
        payload,
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(node)];
  }

  async function deleteNode(id: string) {
    // X do no passa pela mesma confirmacao do Delete do teclado (modal).
    pendingNodeDeletion = { nodeIds: [id], edgeIds: [] };
  }

  async function resizeNode(id: string, params: { x: number; y: number; width: number; height: number }) {
    if (!activeWorkspace) return;
    await persistNodePosition(id, params, { width: params.width, height: params.height });
  }

  async function persistNodePosition(
    id: string,
    position: { x: number; y: number },
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (!activeWorkspace) return;
    const override = { x: position.x, y: position.y, confirmedAt: null };
    localPositionOverrides.set(id, override);
    try {
      await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ x: position.x, y: position.y, ...extra }),
      });
      if (localPositionOverrides.get(id) === override) override.confirmedAt = performance.now();
    } catch {
      if (localPositionOverrides.get(id) === override) localPositionOverrides.delete(id);
    }
  }

  async function updateNodePayload(id: string, partial: Record<string, unknown>) {
    if (!activeWorkspace) return;
    const flowNode = nodes.find((node) => node.id === id);
    const current = (flowNode?.data?.payload ?? {}) as Record<string, unknown>;
    await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ payload: { ...current, ...partial } }),
    });
    nodes = nodes.map((node) =>
      node.id === id ? { ...node, data: { ...node.data, payload: { ...current, ...partial } } } : node
    );
  }

  function shapeClipboardEntries(ids?: string[]): ShapeClipboardEntry<ShapeStyle>[] {
    const requested = ids ? new Set(ids) : null;
    return nodes
      .filter((node) => node.type === 'shape' && (requested ? requested.has(node.id) : node.selected))
      .map((node) => ({
        title: String(node.data?.title ?? ''),
        x: node.position.x,
        y: node.position.y,
        width: Math.max(60, Number(node.width ?? node.measured?.width ?? 160)),
        height: Math.max(40, Number(node.height ?? node.measured?.height ?? 160)),
        payload: structuredClone((node.data?.payload ?? {}) as ShapeStyle),
      }));
  }

  async function createShapeCopies(entries: ShapeClipboardEntry<ShapeStyle>[], offset: number) {
    if (!activeWorkspace || !entries.length) return;
    snapshot();
    const created: Node[] = [];
    for (const entry of offsetShapeClipboard(entries, offset)) {
      const node = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
        method: 'POST',
        body: JSON.stringify({
          type: 'shape',
          title: entry.title,
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
          payload: structuredClone(entry.payload),
          floorId: visibleFloorId,
        }),
      });
      created.push({ ...toFlowNode(node), selected: true });
    }
    nodes = [...nodes.map((node) => ({ ...node, selected: false })), ...created];
  }

  async function duplicateShape(id: string) {
    const entries = shapeClipboardEntries([id]);
    await createShapeCopies(entries, 24);
    if (entries.length) toast.success(m['shape.duplicated']({ count: entries.length }));
  }

  async function duplicateSelectedShapes() {
    const entries = shapeClipboardEntries();
    await createShapeCopies(entries, 24);
    if (entries.length) toast.success(m['shape.duplicated']({ count: entries.length }));
  }

  function handleShapeCopy(event: ClipboardEvent) {
    if (isTypingTarget(event.target)) return;
    const shapes = shapeClipboardEntries();
    if (!shapes.length || !event.clipboardData) return;
    event.preventDefault();
    shapePasteSequence = 0;
    event.clipboardData.setData(SHAPE_CLIPBOARD_TYPE, serializeShapeClipboard(shapes));
    event.clipboardData.setData('text/plain', m['shape.clipboard_summary']({ count: shapes.length }));
    toast.success(m['shape.copied']({ count: shapes.length }));
  }

  function handleShapePaste(event: ClipboardEvent) {
    if (isTypingTarget(event.target)) return;
    const raw = event.clipboardData?.getData(SHAPE_CLIPBOARD_TYPE) ?? '';
    if (!raw) return;
    const shapes = parseShapeClipboard<ShapeStyle>(raw);
    if (!shapes.length) return;
    event.preventDefault();
    shapePasteSequence += 1;
    void createShapeCopies(shapes, 24 * shapePasteSequence).then(() => {
      toast.success(m['shape.pasted']({ count: shapes.length }));
    });
  }

  const preDragPositions = new Map<string, { x: number; y: number }>();

  async function groupSelection() {
    if (!activeWorkspace) return;
    const selected = nodes.filter((node) => node.selected && node.type !== 'group');
    if (selected.length < 2) return;
    const box = boundingBox(selectedRects())!;
    const padding = 40;
    const headerSpace = 20;
    const groupNode = await api<CanvasNode>(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes`, {
      method: 'POST',
      body: JSON.stringify({
        type: 'group',
        title: m['canvas.default_group'](),
        x: box.x - padding,
        y: box.y - padding - headerSpace,
        width: box.width + padding * 2,
        height: box.height + padding * 2 + headerSpace,
        zIndex: -1,
        payload: { members: selected.map((node) => node.id) },
        floorId: visibleFloorId,
      }),
    });
    nodes = [...nodes, toFlowNode(groupNode)];
  }

  async function ungroup(groupId: string) {
    if (!activeWorkspace) return;
    await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${groupId}`, { method: 'DELETE' });
    nodes = nodes.filter((node) => node.id !== groupId);
  }

  function moveGroupWithMembers(groupNode: Node, previous: { x: number; y: number }) {
    const dx = groupNode.position.x - previous.x;
    const dy = groupNode.position.y - previous.y;
    if (!dx && !dy) return;
    const members = ((groupNode.data?.payload as { members?: string[] })?.members ?? []) as string[];
    nodes = nodes.map((node) =>
      members.includes(node.id)
        ? { ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }
        : node
    );
    for (const memberId of members) {
      const member = nodes.find((node) => node.id === memberId);
      if (member) {
        void persistNodePosition(memberId, member.position);
      }
    }
  }

  function selectedRects() {
    return nodes
      .filter((node) => node.selected)
      .map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? (node.width as number) ?? 560,
        height: node.measured?.height ?? (node.height as number) ?? 360,
      }));
  }

  function organizationRects() {
    const groupedNodeIds = new Set(
      nodes
        .filter((node) => node.type === 'group')
        .flatMap((node) => ((node.data?.payload as { members?: string[] } | undefined)?.members ?? [])),
    );
    return nodes
      .filter((node) => node.type === 'group' || !groupedNodeIds.has(node.id))
      .map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.measured?.width ?? (node.width as number) ?? 560,
        height: node.measured?.height ?? (node.height as number) ?? 360,
      }));
  }

  async function organizeCanvas() {
    const rects = organizationRects();
    if (!rects.length) return;
    snapshot();
    const positions = tidyRects(rects);
    for (const group of nodes.filter((node) => node.type === 'group')) {
      const next = positions.get(group.id);
      if (!next) continue;
      const dx = next.x - group.position.x;
      const dy = next.y - group.position.y;
      const members = ((group.data?.payload as { members?: string[] } | undefined)?.members ?? []);
      for (const memberId of members) {
        const member = nodes.find((node) => node.id === memberId);
        if (member) positions.set(memberId, { x: member.position.x + dx, y: member.position.y + dy });
      }
    }
    await applyPositions(positions);
    requestAnimationFrame(() => zoomApi?.fitView({ duration: 300 }));
  }

  async function applyPositions(positions: Map<string, { x: number; y: number }>) {
    if (!activeWorkspace || !positions.size) return;
    nodes = nodes.map((node) => {
      const next = positions.get(node.id);
      return next ? { ...node, position: { x: next.x, y: next.y } } : node;
    });
    for (const [id, position] of positions) {
      await persistNodePosition(id, position);
    }
  }

  function jumpToNode(nodeId: string, zoom = 1, screenOffsetY = 0) {
    const node = nodes.find((item) => item.id === nodeId);
    if (!node) return;
    const width = node.measured?.width ?? (node.width as number) ?? 560;
    const height = node.measured?.height ?? (node.height as number) ?? 360;
    zoomApi?.setCenter(node.position.x + width / 2, node.position.y + height / 2 + screenOffsetY / zoom, { zoom, duration: 300 });
    nodes = nodes.map((item) => ({ ...item, selected: item.id === nodeId }));
  }

  function canvasRouteNodeId(): string | null {
    if (typeof location === 'undefined') return null;
    const nodeId = new URLSearchParams(location.search).get('node');
    return nodeId && nodes.some((node) => node.id === nodeId) ? nodeId : null;
  }

  const paletteActions = $derived<PaletteAction[]>([
    { id: 'shell', label: m['canvas.palette_new_shell'](), hint: m['canvas.hint_action'](), run: () => (pendingAgentCreation = { provider: null }) },
    { id: 'design', label: m['tool.design'](), hint: m['canvas.hint_action'](), run: () => void addDesignNode() },
    { id: 'api-client', label: m['api_client.title'](), hint: m['canvas.hint_action'](), run: () => void addApiClient() },
    { id: 'design-exploration', label: m['design.exploration_menu_item'](), hint: m['canvas.hint_action'](), run: () => (designExplorationOpen = true) },
    { id: 'usage-node', label: m['usage.add_canvas'](), hint: m['canvas.hint_action'](), run: () => void addUsageNode() },
    { id: 'code-graph', label: m['code_graph.title'](), hint: m['canvas.hint_action'](), run: () => void addCodeGraphNode() },
    { id: 'share-workspace', label: m['collaboration.share_workspace'](), hint: m['canvas.hint_action'](), run: () => (sharingOpen = true) },
    { id: 'device', label: m['canvas.palette_new_device'](), hint: m['canvas.hint_action'](), run: () => void addDevice() },
    { id: 'council', label: m['council.open'](), hint: m['canvas.hint_action'](), run: () => (councilOpen = true) },
    { id: 'memory', label: m['memory.title'](), hint: m['canvas.hint_view'](), run: () => (memoryOpen = true) },
    { id: 'annotations', label: m['annotations.title'](), hint: m['canvas.hint_view'](), run: () => (annotationsOpen = true) },
    { id: 'huddles', label: m['huddle.title'](), hint: m['canvas.hint_action'](), run: () => (huddleOpen = true) },
    ...providers
      .filter((provider) => (provider.installed || canChooseAlternateRuntime) && provider.tui)
      .map((provider) => ({
        id: `agent-${provider.id}`,
        label: m['canvas.palette_new_agent']({ name: provider.displayName }),
        hint: m['canvas.hint_action'](),
        run: () => (pendingAgentCreation = { provider }),
      })),
    { id: 'note', label: m['canvas.palette_new_note'](), hint: m['canvas.hint_action'](), run: () => addNote() },
    { id: 'tasks', label: m['canvas.palette_new_tasks'](), hint: m['canvas.hint_action'](), run: () => addTasksNode() },
    { id: 'files', label: m['canvas.palette_new_files'](), hint: m['canvas.hint_action'](), run: () => addFileTree() },
    { id: 'diff', label: m['canvas.palette_new_diff'](), hint: m['canvas.hint_action'](), run: () => addDiff() },
    { id: 'providers', label: m['providers.title'](), hint: m['canvas.hint_view'](), run: () => void goto('/providers') },
    { id: 'fit', label: m['canvas.palette_fit'](), hint: m['canvas.hint_view'](), run: () => zoomApi?.fitView({ duration: 300 }) },
    {
      id: 'bg',
      label: m['canvas.palette_bg']({ variant: backgroundVariant }),
      hint: m['canvas.hint_view'](),
      run: () => {
        backgroundVariant =
          backgroundVariant === BackgroundVariant.Dots
            ? BackgroundVariant.Lines
            : backgroundVariant === BackgroundVariant.Lines
              ? 'none'
              : BackgroundVariant.Dots;
      },
    },
    { id: 'align-left', label: m['canvas.palette_align_left'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'left')) },
    { id: 'align-right', label: m['canvas.palette_align_right'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'right')) },
    { id: 'align-top', label: m['canvas.palette_align_top'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'top')) },
    { id: 'align-bottom', label: m['canvas.palette_align_bottom'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'bottom')) },
    { id: 'align-centerH', label: m['canvas.palette_center_h'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'centerH')) },
    { id: 'align-centerV', label: m['canvas.palette_center_v'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(alignRects(selectedRects(), 'centerV')) },
    { id: 'dist-h', label: m['canvas.palette_dist_h'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(distributeRects(selectedRects(), 'horizontal')) },
    { id: 'dist-v', label: m['canvas.palette_dist_v'](), hint: m['canvas.hint_selection'](), run: () => applyPositions(distributeRects(selectedRects(), 'vertical')) },
    { id: 'tidy', label: m['canvas.palette_tidy'](), hint: m['canvas.hint_action'](), run: () => void organizeCanvas() },
    { id: 'group', label: m['canvas.palette_group'](), hint: m['canvas.hint_selection'](), run: () => groupSelection() },
    { id: 'zoom-sel', label: m['canvas.palette_zoom_sel'](), hint: m['canvas.hint_view'](), run: zoomToSelection },
  ]);

  function handleGlobalKeydown(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 'd' && !isTypingTarget(event.target)) {
      const selectedShapes = nodes.some((node) => node.selected && node.type === 'shape');
      if (selectedShapes) {
        event.preventDefault();
        void duplicateSelectedShapes();
      }
      return;
    }
    if (mod && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      showPalette = !showPalette;
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      jumpToNextAttention();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      const selectedGroup = nodes.find((node) => node.selected && node.type === 'group');
      if (selectedGroup) ungroup(selectedGroup.id);
      return;
    }
    if (mod && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      groupSelection();
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 't') {
      event.preventDefault();
      void organizeCanvas();
      return;
    }
    if (mod && (event.key === '+' || event.key === '=')) {
      event.preventDefault();
      zoomApi?.fitView({ duration: 200 });
      return;
    }
    if (mod && event.shiftKey && event.key === '!') {
      event.preventDefault();
      zoomToSelection();
      return;
    }
    if (isTypingTarget(event.target)) return;
    if (event.altKey && /^[1-9]$/.test(event.key)) {
      focusTerminalByIndex(Number(event.key) - 1);
      return;
    }
    switch (event.key.toLowerCase()) {
      case 'n':
        if (!mod) addNote();
        break;
      case 'l':
        if (!mod) connectFromSelection();
        break;
      case 'arrowright':
      case 'arrowleft':
        walkConnection(event.key === 'arrowright' ? 1 : -1);
        break;
    }
  }

  function jumpToNextAttention() {
    const attentive = nodes.find((node) => (node.data?.payload as { waiting?: boolean } | undefined)?.waiting);
    if (attentive) jumpToNode(attentive.id);
  }

  function focusTerminalByIndex(index: number) {
    const terminals = nodes.filter((node) => node.type === 'terminal');
    const target = terminals[index];
    if (target) jumpToNode(target.id);
  }

  function connectFromSelection() {
    const selected = nodes.filter((node) => node.selected);
    if (selected.length === 2 && activeWorkspace) {
      handleConnect({ source: selected[0].id, target: selected[1].id } as Connection);
    }
  }

  function walkConnection(direction: 1 | -1) {
    const selected = nodes.find((node) => node.selected);
    if (!selected) return;
    const links = connectionsFor(selected.id);
    if (!links.length) return;
    const target = direction === 1 ? links[0] : links[links.length - 1];
    jumpToNode(target.targetId);
  }

  function zoomToSelection() {
    const box = boundingBox(selectedRects());
    if (!box) return;
    zoomApi?.setCenter(box.x + box.width / 2, box.y + box.height / 2, { zoom: 1, duration: 300 });
  }

  async function transferSelectedNodes(destinationWorkspaceId: string, mode: CanvasNodeTransferMode) {
    if (!activeWorkspace || !selectedTransferNodeIds.length) return;
    const sourceWorkspaceId = activeWorkspace.id;
    const sourceNodeIds = [...selectedTransferNodeIds];
    const destination = workspaces.find((workspace) => workspace.id === destinationWorkspaceId);
    const result = await api<CanvasNodeTransferResult>(`/api/agent-room/workspaces/${sourceWorkspaceId}/nodes/transfer`, {
      method: 'POST',
      body: JSON.stringify({ destinationWorkspaceId, nodeIds: sourceNodeIds, mode }),
    });
    removeWorkspaceViewCache(destinationWorkspaceId);
    if (mode === 'move') {
      const removed = new Set(result.sourceNodeIds);
      nodes = nodes.filter((node) => !removed.has(node.id));
      edges = edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
      removeWorkspaceViewCache(sourceWorkspaceId);
    } else {
      nodes = nodes.map((node) => ({ ...node, selected: false }));
    }
    const message = mode === 'copy'
      ? m['canvas.transfer_success_copy']({ count: result.nodes.length, workspace: destination?.name ?? '' })
      : m['canvas.transfer_success_move']({ count: result.nodes.length, workspace: destination?.name ?? '' });
    toast.success(message);
  }

  async function handleConnect(connection: Connection) {
    if (!activeWorkspace || !connection.source || !connection.target) return;
    const edge = await api<CanvasEdge>(`/api/agent-room/workspaces/${activeWorkspace.id}/edges`, {
      method: 'POST',
      body: JSON.stringify({ sourceNodeId: connection.source, targetNodeId: connection.target }),
    });
    edges = [
      ...edges.filter(
        (item) =>
          !(item.source === connection.source && item.target === connection.target && item.type !== 'orkestrai' && item.type !== 'smoothstep')
      ),
      toFlowEdge(edge),
    ];
  }

  // O bind:edges do xyflow adiciona uma edge default (bezier solida) no
  // onconnect — dependendo do timing ela sobrevive ao filtro acima e so
  // some no reload. Esta guarda remove qualquer edge que nao seja a nossa
  // corda, nao importa quando ela apareca.
  $effect(() => {
    if (edges.some((edge) => edge.type !== 'orkestrai')) {
      edges = edges.filter((edge) => edge.type === 'orkestrai');
    }
  });

  async function handleDelete({ nodes: deletedNodes, edges: deletedEdges }: { nodes: Node[]; edges: Edge[] }) {
    if (!activeWorkspace) return;
    // So arestas chegam aqui (nos sao interceptados no onbeforedelete): apaga na API.
    snapshot();
    for (const edge of deletedEdges) {
      await api(`/api/agent-room/workspaces/${activeWorkspace.id}/edges/${edge.id}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  /**
   * Intercepta o Delete do teclado ANTES do xyflow mexer no estado: com nos,
   * retorna false (bloqueia) e abre a modal de confirmacao — o canvas nao
   * perde o no se o usuario cancelar. Arestas passam direto (barato refazer).
   */
  async function handleBeforeDelete({ nodes: deletingNodes }: { nodes: Node[]; edges: Edge[] }): Promise<boolean> {
    if (designModeNodeId) return false;
    if (!deletingNodes.length) return true;
    pendingNodeDeletion = { nodeIds: deletingNodes.map((node) => node.id), edgeIds: [] };
    return false;
  }

  /** Confirma a exclusao de nos (modal): apaga nos + arestas e atualiza o estado. */
  async function confirmNodeDeletion() {
    const pending = pendingNodeDeletion;
    pendingNodeDeletion = null;
    if (!pending || !activeWorkspace) return;
    snapshot();
    for (const edgeId of pending.edgeIds) {
      await api(`/api/agent-room/workspaces/${activeWorkspace.id}/edges/${edgeId}`, { method: 'DELETE' }).catch(() => {});
    }
    for (const nodeId of pending.nodeIds) {
      await api(`/api/agent-room/workspaces/${activeWorkspace.id}/nodes/${nodeId}`, { method: 'DELETE' }).catch(() => {});
    }
    nodes = nodes.filter((node) => !pending.nodeIds.includes(node.id));
    edges = edges.filter((edge) => !pending.edgeIds.includes(edge.id) && !pending.nodeIds.includes(edge.source) && !pending.nodeIds.includes(edge.target));
  }

  let pendingNodeDeletion = $state<{ nodeIds: string[]; edgeIds: string[] } | null>(null);
  let selectedEdgeId = $state<string | null>(null);

  function handleEdgeClick({ edge }: { edge: Edge; event: MouseEvent }) {
    if (!activeWorkspace) return;
    // Clique so fixa/desfixa o X de remover — sem troca de estilo.
    selectedEdgeId = selectedEdgeId === edge.id ? null : edge.id;
    edges = edges.map((item) => ({
      ...item,
      data: { ...(item.data ?? {}), pinned: item.id === selectedEdgeId },
    }));
  }

  async function handleDragStop({ targetNode }: { targetNode: Node | null; nodes: Node[]; event: MouseEvent | TouchEvent }) {
    if (!activeWorkspace || !targetNode) return;
    const previous = preDragPositions.get(targetNode.id);
    preDragPositions.delete(targetNode.id);
    if (targetNode.type === 'group' && previous) {
      moveGroupWithMembers(targetNode, previous);
    }
    draggingNodeIds.delete(targetNode.id);
    await persistNodePosition(targetNode.id, targetNode.position);
  }

  function handleDragStart({ targetNode }: { targetNode: Node | null }) {
    if (targetNode) {
      draggingNodeIds.add(targetNode.id);
      preDragPositions.set(targetNode.id, { x: targetNode.position.x, y: targetNode.position.y });
    }
  }
</script>

<svelte:head>
  <title>{m['canvas.page_title']()}</title>
</svelte:head>

<svelte:window onkeydown={handleGlobalKeydown} oncopy={handleShapeCopy} onpaste={handleShapePaste} />

<main class="canvas-page">
  <aside class="sidebar">
    {#if !sidebarCollapsed}
      <div class="brand-row">
        <img src="/brand/icon.svg" width="22" height="22" alt="Orkestrai" />
        <span class="brand-name">Orkestrai</span>
      </div>
      <div class="flex items-center justify-between gap-2 px-3 pb-2">
        <WorkspaceModeSwitch
          active="canvas"
          workspaceId={activeWorkspace?.id ?? null}
          nodeId={nodes.find((node) => node.selected)?.id ?? canvasRouteNodeId()}
        />
        <AttentionCenter workspaceId={activeWorkspace?.id ?? null} />
      </div>
    {/if}
      <div class="sidebar-header">
        {#if !sidebarCollapsed}
          <h2>{m['canvas.workspaces']()}</h2>
        {/if}
        <div class="sidebar-header-actions">
          {#if !sidebarCollapsed}
          <HeaderIconButton label={m['tool.presets']()} onclick={() => toggleSidePanel('presets')}>
            <LayoutTemplate size={14} />
          </HeaderIconButton>
          <HeaderIconButton class="icon-btn !bg-[var(--app-accent)] !text-[var(--app-accent-contrast)] hover:!brightness-110" label={m['canvas.new_ws']()} onclick={() => { initialPresetId = ''; showWorkspaceForm = !showWorkspaceForm; }}>
            <Plus size={15} />
          </HeaderIconButton>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger class="grid size-7 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)] data-[state=open]:bg-[var(--app-surface-raised)] data-[state=open]:text-[var(--app-text)]" aria-label={m['canvas.workspace_actions']()}>
              <MoreHorizontal size={15} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end" class="min-w-[220px]">
              <DropdownMenu.Item onclick={() => void goto('/docs')}><CircleHelp size={14} />{m['canvas.how_to_use']()}</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => void goto('/remote')}><MonitorUp size={14} />{m['remote.open']()}</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => void goto('/providers')}><Cable size={14} />{m['providers.title']()}</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => void goto(activeWorkspace ? `/skills?workspace=${activeWorkspace.id}` : '/skills')}><Blocks size={14} />{m['skills.title']()}</DropdownMenu.Item>
              <DropdownMenu.Item onclick={() => void goto('/settings')}><Settings size={14} />{m['settings.title']()}</DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onclick={() => importInput.click()}><Upload size={14} />{m['canvas.import_ws']()}</DropdownMenu.Item>
              {#if activeWorkspace}
                <DropdownMenu.Item onclick={exportActiveWorkspace}><Download size={14} />{m['canvas.export_ws']()}</DropdownMenu.Item>
                <DropdownMenu.Item onclick={() => (confirmUnload = true)}><Power size={14} />{m['canvas.unload_tooltip']()}</DropdownMenu.Item>
              {/if}
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        {/if}
        <HeaderIconButton
          label={sidebarCollapsed ? m['canvas.sidebar_expand']() : m['canvas.sidebar_collapse']()}
          side={sidebarCollapsed ? 'right' : 'bottom'}
          onclick={() => (sidebarCollapsed = !sidebarCollapsed)}
        >
          {#if sidebarCollapsed}<PanelLeftOpen size={14} />{:else}<PanelLeftClose size={14} />{/if}
        </HeaderIconButton>
      </div>
    </div>
    <input bind:this={importInput} type="file" accept=".json" class="hidden-input" onchange={importWorkspaceFile} />

    {#if !sidebarCollapsed}
      <label class="workspace-filter">
        <Search size={13} aria-hidden="true" />
        <input
          bind:value={workspaceQuery}
          placeholder={m['ph.filter_workspaces']()}
          aria-label={m['canvas.filter_ws_aria']()}
          autocomplete="off"
          spellcheck="false"
        />
      </label>
    {/if}

    <WorkspaceCreateDialog
      open={showWorkspaceForm}
      {initialPresetId}
      groups={workspaceGroups}
      initialGroupId={pendingWorkspaceGroupId}
      onCreated={handleWorkspaceCreated}
      onClose={() => { showWorkspaceForm = false; initialPresetId = ''; pendingWorkspaceGroupId = null; }}
    />

    {#if sidebarCollapsed}
      <ul class="workspace-list collapsed">
        {#if !workspacesLoaded}
          {#each [0, 1] as index (index)}
            <li class="ws-skeleton collapsed"><Skeleton class="h-6 w-6 bg-[var(--app-surface-raised)]" /></li>
          {/each}
        {:else}
        {#each visibleWorkspaces as workspace (workspace.id)}
          <li class:active={activeWorkspace?.id === workspace.id}>
            <HeaderIconButton label={workspace.suspendedAt ? m['canvas.ws_suspended']({ name: workspace.name }) : activity[workspace.id] ? m['canvas.ws_active_sessions']({ name: workspace.name, count: activity[workspace.id] }) : workspace.name} side="right" class="workspace-item" onclick={() => selectWorkspace(workspace.id)}>
              <span class="workspace-icon">
                {#if workspace.suspendedAt}<Power size={10} class="text-[var(--app-text-muted)]" aria-hidden="true" />{:else if activity[workspace.id]}<span class="live-dot rail" aria-hidden="true"></span>{/if}
                <WorkspaceIcon name={workspace.icon} size={14} />
              </span>
            </HeaderIconButton>
          </li>
        {/each}
        {/if}
      </ul>
    {:else}
      <ul
        class="workspace-list"
        class:drag-over-root={dragOverRoot}
        ondragover={handleDragOverRoot}
        ondragleave={() => (dragOverRoot = false)}
        ondrop={handleDropOnRoot}
      >
        {#if !workspacesLoaded}
          {#each [0, 1, 2] as index (index)}
            <li class="ws-skeleton"><Skeleton class="h-7 w-full bg-[var(--app-surface-raised)]" /></li>
          {/each}
        {:else if workspaceQuery.trim()}
          {#each visibleWorkspaces as workspace (workspace.id)}
            {@render workspaceListItem(workspace)}
          {/each}
          {#if workspaces.length > 0 && visibleWorkspaces.length === 0}
            <li class="empty-filter">{m['canvas.no_ws_match']({ query: workspaceQuery.trim() })}</li>
          {/if}
        {:else}
          {#each workspaceTree.roots as node (node.group.id)}
            {@render workspaceGroupNode(node)}
          {/each}
          {#each workspaceTree.rootWorkspaces as workspace (workspace.id)}
            {@render workspaceListItem(workspace)}
          {/each}
          {#if workspaces.length === 0 && workspaceGroups.length === 0}
            <li class="empty">{m['canvas.no_ws']()}</li>
          {/if}
        {/if}
      </ul>

      <div class="new-folder-row">
        <FolderPlus size={13} aria-hidden="true" />
        <input
          bind:value={newFolderName}
          placeholder={m['canvas.folder_name_placeholder']()}
          aria-label={m['canvas.new_folder']()}
          autocomplete="off"
          spellcheck="false"
          onkeydown={(event) => event.key === 'Enter' && createWorkspaceGroup()}
        />
        <HeaderIconButton label={m['canvas.new_folder']()} onclick={createWorkspaceGroup}>
          <Plus size={13} />
        </HeaderIconButton>
      </div>
    {/if}

    {#snippet workspaceListItem(workspace: Workspace)}
    <li
      class:active={activeWorkspace?.id === workspace.id}
      draggable="true"
      ondragstart={(event) => handleDragStartWorkspace(event, workspace)}
      ondragend={handleDragEnd}
    >
      <button class="workspace-item" onclick={() => selectWorkspace(workspace.id)}>
        <span class="workspace-icon">
          <WorkspaceIcon name={workspace.icon} size={14} />
        </span>
        <span class="workspace-name">{workspace.name}</span>
        {#if workspace.suspendedAt}
          <Power size={11} class="text-[var(--app-text-muted)]" aria-label={m['canvas.ws_suspended']({ name: workspace.name })} />
        {:else if activity[workspace.id]}
          <span class="live-dot" role="status" aria-label={m['canvas.active_sessions_aria']({ count: activity[workspace.id] })}></span>
        {/if}
      </button>
      <HeaderIconButton label={m['canvas.edit_ws']()} side="right" onclick={() => (editingWorkspace = workspace)}>
        <Pencil size={13} />
      </HeaderIconButton>
      <HeaderIconButton label={m['canvas.delete_ws']()} side="right" danger onclick={() => (deletingWorkspace = workspace)}>
        <X size={13} />
      </HeaderIconButton>
    </li>
  {/snippet}

  {#snippet workspaceGroupNode(node: WorkspaceGroupNode)}
    <li class="ws-group" class:drag-over={dragOverGroupId === node.group.id}>
      <div
        class="ws-group-header"
        role="group"
        aria-label={node.group.name}
        draggable="true"
        ondragstart={(event) => handleDragStartGroup(event, node.group)}
        ondragend={handleDragEnd}
        ondragover={(event) => handleDragOverGroup(event, node.group.id)}
        ondragleave={() => (dragOverGroupId = null)}
        ondrop={(event) => handleDropOnGroup(event, node.group.id)}
      >
        <button
          class="ws-group-toggle"
          onclick={() => void toggleGroupCollapsed(node.group.id)}
          aria-label={node.group.collapsed ? m['canvas.expand_folder']() : m['canvas.collapse_folder']()}
        >
          <ChevronRight size={12} class={node.group.collapsed ? '' : 'expanded'} />
        </button>
        <Folder size={13} class="ws-group-icon" aria-hidden="true" />
        {#if renamingGroupId === node.group.id}
          <input
            class="ws-group-rename"
            bind:value={renameGroupValue}
            onblur={() => commitRenameGroup(node.group.id)}
            onkeydown={(event) => {
              if (event.key === 'Enter') commitRenameGroup(node.group.id);
              if (event.key === 'Escape') cancelRenameGroup();
            }}
            autofocus
          />
        {:else}
          <span
            class="ws-group-name"
            role="button"
            tabindex="0"
            ondblclick={() => startRenameGroup(node.group)}
            onkeydown={(event) => event.key === 'Enter' && startRenameGroup(node.group)}
          >{node.group.name}</span>
        {/if}
        <span class="ws-group-actions">
          <HeaderIconButton label={m['canvas.new_ws_here']()} side="right" onclick={() => { initialPresetId = ''; pendingWorkspaceGroupId = node.group.id; showWorkspaceForm = true; }}>
            <Plus size={12} />
          </HeaderIconButton>
          <HeaderIconButton label={m['canvas.new_subfolder']()} side="right" onclick={() => startCreateSubfolder(node.group.id)}>
            <FolderPlus size={12} />
          </HeaderIconButton>
          <HeaderIconButton label={m['canvas.rename_folder']()} side="right" onclick={() => startRenameGroup(node.group)}>
            <Pencil size={12} />
          </HeaderIconButton>
          <HeaderIconButton label={m['canvas.delete_folder']()} side="right" danger onclick={() => (deletingGroup = node.group)}>
            <Trash2 size={12} />
          </HeaderIconButton>
        </span>
      </div>
      {#if !node.group.collapsed}
        <ul class="ws-group-children">
          {#if creatingSubfolderParentId === node.group.id}
            <li class="ws-subfolder-create">
              <FolderPlus size={12} aria-hidden="true" />
              <input
                bind:value={newSubfolderName}
                placeholder={m['canvas.folder_name_placeholder']()}
                aria-label={m['canvas.new_subfolder']()}
                autocomplete="off"
                spellcheck="false"
                onblur={commitCreateSubfolder}
                onkeydown={(event) => {
                  if (event.key === 'Enter') commitCreateSubfolder();
                  if (event.key === 'Escape') cancelCreateSubfolder();
                }}
                autofocus
              />
            </li>
          {/if}
          {#each node.children as child (child.group.id)}
            {@render workspaceGroupNode(child)}
          {/each}
          {#each node.workspaces as workspace (workspace.id)}
            {@render workspaceListItem(workspace)}
          {/each}
          {#if node.children.length === 0 && node.workspaces.length === 0 && creatingSubfolderParentId !== node.group.id}
            <li class="ws-group-empty">{m['canvas.folder_empty']()}</li>
          {/if}
        </ul>
      {/if}
    </li>
  {/snippet}
  </aside>

  <section class="canvas-area" class:drawing={drawTool !== null}>
    <SvelteFlowProvider>
    {#if activeWorkspace}
      {#if designModeNodeId}
        <div class="absolute inset-0 z-[70] flex min-h-0 flex-col bg-[var(--app-canvas)]" data-testid="canvas-design-mode">
          <header class="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3">
            <Palette size={15} class="text-[var(--app-secondary)]" />
            <strong class="min-w-0 flex-1 truncate text-xs">{String(nodes.find((item) => item.id === designModeNodeId)?.data?.title ?? m['design.title']())}</strong>
            <span class="text-[10px] text-[var(--app-text-muted)]">{m['workspace_view.canvas']()} · {m['design.title']()}</span>
            <HeaderIconButton label={m['onboarding.close']()} onclick={() => (designModeNodeId = null)}><X size={14} /></HeaderIconButton>
          </header>
          <div class="min-h-0 flex-1">
            <DesignEditor workspaceId={activeWorkspace.id} nodeId={designModeNodeId} externalRevision={designRevisions[designModeNodeId] ?? 0} />
          </div>
        </div>
      {/if}
      <div class="contents" inert={designModeNodeId !== null} aria-hidden={designModeNodeId ? 'true' : undefined}>
      <ZoomBridge onReady={(api) => (zoomApi = api)} />
      {#if ghostRect}
        <div
          class="draw-ghost"
          style:left={`${ghostRect.left}px`}
          style:top={`${ghostRect.top}px`}
          style:width={`${ghostRect.width}px`}
          style:height={`${ghostRect.height}px`}
        ></div>
      {/if}
      <SvelteFlow
        bind:nodes
        bind:edges
        {nodeTypes}
        {edgeTypes}
        connectionMode={ConnectionMode.Loose}
        zIndexMode="manual"
        proOptions={{ hideAttribution: true }}
        minZoom={0.05}
        maxZoom={4}
        panOnDrag={drawTool === null ? true : [1, 2]}
        deleteKey={designModeNodeId ? null : ['Backspace', 'Delete']}
        onconnect={handleConnect}
        onedgeclick={handleEdgeClick}
        onbeforedelete={handleBeforeDelete}
        ondelete={handleDelete}
        onnodedragstop={handleDragStop}
        onnodedragstart={handleDragStart}
        onpointerdown={handlePanePointerDown}
        onpointermove={handlePanePointerMove}
        onpointerup={handlePanePointerUp}
      >
        {#if backgroundVariant !== 'none'}
          <Background gap={20} variant={backgroundVariant} patternColor="var(--app-grid)" />
        {/if}
        {#if appSettings.showControls !== 'false'}
          <Controls />
        {/if}
        {#if appSettings.showMinimap !== 'false'}
          <MiniMap bgColor="var(--app-surface)" maskColor="color-mix(in srgb, var(--app-canvas) 72%, transparent)" nodeColor="var(--app-border-strong)" />
        {/if}
        {#if selectedTransferNodeIds.length > 0}
          <Panel position="top-center">
            <div class="flex h-9 items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] px-2 shadow-lg">
              <span class="whitespace-nowrap text-[11px] font-medium text-[var(--app-text-muted)]">{m['canvas.transfer_selected']({ count: selectedTransferNodeIds.length })}</span>
              <Button size="sm" class="h-7 gap-1.5 px-2 text-xs" onclick={() => (transferOpen = true)}>
                <Copy size={13} />{m['canvas.transfer_open']()}
              </Button>
            </div>
          </Panel>
        {/if}
        <Panel position="bottom-center">
          <div class="toolbar-wrap">
            {#if canScrollLeft}
              <button class="toolbar-arrow" aria-label={m['canvas.scroll_left']()} onclick={() => scrollToolbar(-1)}>
                <ChevronLeft size={14} />
              </button>
            {/if}
            <div class="toolbar" bind:this={toolbarEl} onscroll={updateToolbarScroll}>
            <ToolbarButton label={m['tool.shell']()} active={drawTool === 'terminal' && !drawProvider} onclick={() => toggleDrawTool('terminal')}>
              <img src="/images/cli.svg" width="15" height="15" alt="" class="tool-icon" /> {m['canvas.default_shell']()}
            </ToolbarButton>
            <AgentToolbarMenu
              {providers}
              {pinnedProviderIds}
              activeProviderId={drawTool === 'terminal' ? (drawProvider?.id ?? null) : null}
              allowUnavailableSelection={canChooseAlternateRuntime}
              onSelect={(provider) => toggleDrawTool('terminal', provider)}
              onTogglePin={togglePinnedProvider}
              onOpenProviderCenter={() => void goto('/providers')}
            />
            <ToolbarButton label={m['council.open']()} active={councilOpen} onclick={() => (councilOpen = true)}>
              <Scale size={15} class="tool-icon-svg" /> {m['council.title']()}
            </ToolbarButton>
            <ToolbarButton label={m['huddle.title']()} active={huddleOpen} onclick={() => (huddleOpen = true)}>
              <MessageCircleMore size={15} class="tool-icon-svg" /> {m['huddle.title']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.note']()} active={drawTool === 'note'} onclick={() => toggleDrawTool('note')}>
              <StickyNote size={15} class="tool-icon-svg" /> {m['canvas.default_note']()}
            </ToolbarButton>
            <ImageToolbarMenu active={drawTool === 'image' || drawTool === 'imageWorkflow'} onImage={() => toggleDrawTool('image')} onWorkflow={() => toggleDrawTool('imageWorkflow')} />
            <DesignToolbarMenu
              active={drawTool === 'design' || designExplorationOpen}
              onBlank={() => toggleDrawTool('design')}
              onExploration={() => (designExplorationOpen = true)}
            />
            <ToolbarButton label={m['tool.files']()} active={drawTool === 'fileTree'} onclick={() => toggleDrawTool('fileTree')}>
              <FolderTree size={15} class="tool-icon-svg" /> {m['canvas.default_files']()}
            </ToolbarButton>
            <ToolbarButton label={m['code_graph.title']()} active={drawTool === 'codeGraph'} onclick={() => toggleDrawTool('codeGraph')}>
              <Waypoints size={15} class="tool-icon-svg" /> {m['code_graph.title']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.diff']()} active={drawTool === 'diff'} onclick={() => toggleDrawTool('diff')}>
              <FileDiff size={15} class="tool-icon-svg" /> {m['canvas.default_diff']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.portal']()} active={drawTool === 'portal'} onclick={() => toggleDrawTool('portal')}>
              <img src="/images/portal.svg" width="15" height="15" alt="" class="tool-icon" /> {m['canvas.default_portal']()}
            </ToolbarButton>
            <ToolbarButton label={m['api_client.tool']()} active={drawTool === 'apiClient'} onclick={() => toggleDrawTool('apiClient')}>
              <Braces size={15} class="tool-icon-svg" /> {m['api_client.title']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.device']()} active={drawTool === 'device'} onclick={() => toggleDrawTool('device')}>
              <Smartphone size={15} class="tool-icon-svg" /> {m['device.title']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.loop']()} active={drawTool === 'loop'} onclick={() => toggleDrawTool('loop')}>
              <img src="/images/loop.svg" width="15" height="15" alt="" class="tool-icon" /> {m['canvas.label_loop']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.tasks']()} active={drawTool === 'tasks'} onclick={() => toggleDrawTool('tasks')}>
              <SquareKanban size={15} class="tool-icon-svg" /> {m['canvas.default_tasks']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.flow']()} active={drawTool === 'flow'} onclick={() => toggleDrawTool('flow')}>
              <Workflow size={15} class="tool-icon-svg" /> {m['canvas.default_flow']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.shape']()} active={drawTool === 'shape'} onclick={() => toggleDrawTool('shape')}>
              <Shapes size={15} class="tool-icon-svg" /> {m['canvas.label_shape']()}
            </ToolbarButton>
            <span class="toolbar-sep"></span>
            <ToolbarButton label={m['tool.organize']()} onclick={() => void organizeCanvas()}>
              <LayoutGrid size={15} class="tool-icon-svg" /> {m['canvas.label_organize']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.presets']()} active={showPresetPanel} onclick={() => toggleSidePanel('presets')}>
              <LayoutTemplate size={15} class="tool-icon-svg" /> {m['canvas.label_presets']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.floors']()} active={showFloorPanel} onclick={() => toggleSidePanel('floors')}>
              <Layers size={15} class="tool-icon-svg" /> {m['canvas.label_floors']()}{floors.length ? ` (${floors.length})` : ''}
            </ToolbarButton>
            <ToolbarButton label={m['tool.routines']()} active={showRoutinePanel} onclick={() => toggleSidePanel('routines')}>
              <CalendarClock size={15} class="tool-icon-svg" /> {m['canvas.label_routines']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.roles']()} active={showRolesPanel} onclick={() => toggleSidePanel('roles')}>
              <BadgeCheck size={15} class="tool-icon-svg" /> {m['canvas.label_roles']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.usage']()} active={showUsagePanel} onclick={() => toggleSidePanel('usage')}>
              <Gauge size={15} class="tool-icon-svg" /> {m['canvas.label_usage']()}
            </ToolbarButton>
            <ToolbarButton label={m['tool.ports']()} active={showPortsPanel} onclick={() => toggleSidePanel('ports')}>
              <RadioTower size={15} class="tool-icon-svg" /> {m['canvas.label_ports']()}
            </ToolbarButton>
            <WorkspaceSharingButton variant="icon" workspaceId={activeWorkspace?.id ?? null} onOpen={() => (sharingOpen = true)} />
            </div>
            {#if canScrollRight}
              <button class="toolbar-arrow" aria-label={m['canvas.scroll_right']()} onclick={() => scrollToolbar(1)}>
                <ChevronRight size={14} />
              </button>
            {/if}
          </div>
        </Panel>
      </SvelteFlow>
      </div>
    {:else}
      <div class="canvas-empty">
        <img src="/brand/icon.svg" width="56" height="56" alt="" />
        <p>{m['canvas.empty']()}</p>
      </div>
    {/if}
    {#if showPalette}
      <CommandPalette {nodes} actions={paletteActions} onJumpToNode={jumpToNode} onClose={() => (showPalette = false)} />
    {/if}
    {#if showPresetPanel}
      <PresetLibraryPanel
        workspaceId={activeWorkspace?.id ?? null}
        onCreateWorkspace={createWorkspaceFromPreset}
        onApplied={refreshAfterPresetApply}
        onClose={() => (showPresetPanel = false)}
        {api}
      />
    {/if}
    {#if showFloorPanel && activeWorkspace}
      <FloorPanel
        workspace={activeWorkspace}
        {visibleFloorId}
        onSelectFloor={selectFloor}
        onClose={() => (showFloorPanel = false)}
        {api}
      />
    {/if}
    {#if showRolesPanel && activeWorkspace}
      <RolesPanel workspace={activeWorkspace} onClose={() => (showRolesPanel = false)} {api} />
    {/if}
    {#if showRoutinePanel && activeWorkspace}
      <RoutinePanel
        workspace={activeWorkspace}
        terminals={nodes.filter((node) => node.type === 'terminal').map((node) => ({ id: node.id, title: String(node.data?.title ?? m['canvas.fallback_terminal']()) }))}
        onClose={() => (showRoutinePanel = false)}
        {api}
      />
    {/if}
    {#if showUsagePanel}
      <UsagePanel
        onClose={() => (showUsagePanel = false)}
        onAddToCanvas={() => {
          void addUsageNode();
          showUsagePanel = false;
        }}
      />
    {/if}
    {#if showPortsPanel && activeWorkspace}
      <PortsPanel workspace={activeWorkspace} onClose={() => (showPortsPanel = false)} />
    {/if}
    <AgentCreateDialog
      open={pendingAgentCreation !== null}
      provider={pendingAgentCreation?.provider ?? null}
      workspace={activeWorkspace}
      defaultLeader={!nodes.some((node) => node.type === 'terminal' && (node.data?.payload as { maestro?: boolean } | undefined)?.maestro)}
      onConfirm={async (creation) => {
        const pending = pendingAgentCreation;
        pendingAgentCreation = null;
        await addTerminal(pending?.provider ?? undefined, pending?.rect, creation);
      }}
      onCancel={() => (pendingAgentCreation = null)}
    />
    {#if activeWorkspace}
      <DesignExplorationDialog
        open={designExplorationOpen}
        workspaceId={activeWorkspace.id}
        leader={explorationLeader}
        onClose={() => (designExplorationOpen = false)}
        onCreated={handleDesignExplorationCreated}
      />
    {/if}
    <OnboardingWizard
      open={showOnboarding}
      {requestedTourId}
      onClose={() => {
        showOnboarding = false;
        requestedTourId = null;
        try {
          sessionStorage.removeItem('orkestrai.onboarding');
          sessionStorage.removeItem('orkestrai.onboarding-step');
          const params = new URLSearchParams(location.search);
          params.delete('tour');
          const query = params.toString();
          history.replaceState(null, '', `/canvas${query ? `?${query}` : ''}`);
        } catch {}
      }}
      onCreateWorkspace={createWorkspaceFromWizard}
      activeWorkspaceId={activeWorkspace?.id ?? null}
    />
    {#if activeWorkspace}
      <CouncilDialog bind:open={councilOpen} workspaceId={activeWorkspace.id} source={councilSource} />
      <WorkspaceMemoryDialog bind:open={memoryOpen} workspaceId={activeWorkspace.id} />
      <AnnotationCenterDialog bind:open={annotationsOpen} workspaceId={activeWorkspace.id} />
      <HuddleDialog bind:open={huddleOpen} workspaceId={activeWorkspace.id} />
    {/if}
    {#if sharingOpen && activeWorkspace}
      <WorkspaceSharingDialog workspaceId={activeWorkspace.id} onClose={() => (sharingOpen = false)} />
    {/if}
    {#if activeWorkspace}
      <CanvasNodeTransferDialog
        open={transferOpen}
        sourceWorkspaceId={activeWorkspace.id}
        {workspaces}
        nodeCount={selectedTransferNodeIds.length}
        connectionCount={selectedTransferConnectionCount}
        onTransfer={transferSelectedNodes}
        onClose={() => (transferOpen = false)}
      />
    {/if}
    <AlertDialog.Root open={deletingWorkspace !== null} onOpenChange={(isOpen) => !isOpen && (deletingWorkspace = null)}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{m['canvas.delete_ws']()}</AlertDialog.Title>
          <AlertDialog.Description>
            {m['canvas.delete_ws_desc']({ name: deletingWorkspace?.name ?? '' })}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
          <AlertDialog.Action onclick={confirmDeleteWorkspace}>{m['settings.delete']()}</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={deletingGroup !== null} onOpenChange={(isOpen) => !isOpen && (deletingGroup = null)}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{m['canvas.delete_folder']()}</AlertDialog.Title>
          <AlertDialog.Description>
            {m['canvas.delete_folder_desc']({ name: deletingGroup?.name ?? '' })}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
          <AlertDialog.Action onclick={confirmDeleteWorkspaceGroup}>{m['settings.delete']()}</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={pendingNodeDeletion !== null} onOpenChange={(isOpen) => !isOpen && (pendingNodeDeletion = null)}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{m['canvas.del_nodes_title']({ count: pendingNodeDeletion?.nodeIds.length ?? 0 })}</AlertDialog.Title>
          <AlertDialog.Description>
            {m['canvas.del_nodes_desc']()}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
          <AlertDialog.Action onclick={confirmNodeDeletion}>{m['settings.delete']()}</AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <AlertDialog.Root open={confirmUnload} onOpenChange={(isOpen) => !isOpen && (confirmUnload = false)}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>{m['canvas.unload_title']()}</AlertDialog.Title>
          <AlertDialog.Description>
            {m['canvas.unload_desc']()}
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
          <AlertDialog.Action disabled={unloading} onclick={unloadActiveWorkspace}>
            {unloading ? m['canvas.unloading']() : m['canvas.unload_action']()}
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>

    {#if editingWorkspace}
      <WorkspaceEditDialog workspace={editingWorkspace} onSave={saveWorkspace} onClose={() => (editingWorkspace = null)} />
    {/if}
    {#if permissionWorkspace}
      <div class="permission-banner">
        <WorkspacePermissionNotice workingDir={permissionWorkspace.workingDir} onRetry={retryWorkspaceAccess} />
      </div>
    {:else if errorMessage}
      <p class="error-banner">{errorMessage}</p>
    {/if}
    {#if unloadMessage}
      <p class="notice-banner">{unloadMessage}</p>
    {/if}
    </SvelteFlowProvider>
  </section>
</main>

<style>
  .canvas-page {
    display: flex;
    height: 100%;
    background: var(--app-canvas);
    color: var(--app-text);
  }

  .sidebar:has(.workspace-list.collapsed) {
    width: 54px;
  }

  /* Colapsada: so o botao de expandir, centralizado. */
  .sidebar:has(.workspace-list.collapsed) .sidebar-header {
    justify-content: center;
  }

  .sidebar:has(.workspace-list.collapsed) .sidebar-header-actions {
    margin-left: 0;
  }

  .sidebar {
    width: 288px;
    flex-shrink: 0;
    border-right: 1px solid var(--app-border);
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    /* A lista de workspaces rola; o cabecalho nunca encolhe (flex-shrink do
       flex container esmagava o cabecalho em 2 linhas sobre a lista). */
    overflow: hidden;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 34px;
    flex-shrink: 0;
  }

  .sidebar-header h2 {
    font-size: 10px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0;
    color: var(--app-text-muted);
    margin: 0;
    white-space: nowrap;
  }

  .brand-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 3px 9px;
    border-bottom: 1px solid var(--app-border);
  }

  .brand-name {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0;
    color: var(--app-text);
  }

  .workspace-filter {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 9px;
    min-height: 34px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-canvas) 60%, transparent);
    color: var(--app-text-muted);
    flex-shrink: 0;
    transition: border-color 140ms ease;
  }

  .workspace-filter:focus-within {
    border-color: var(--app-accent);
  }

  .workspace-filter input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .workspace-filter input:focus-visible {
    outline: none;
  }

  .empty-filter {
    padding: 8px;
    font-size: 12px;
    color: var(--app-text-muted);
    font-style: italic;
  }

  .workspace-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .workspace-list li {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 34px;
    border-radius: 6px;
    padding-right: 2px;
  }

  .workspace-list li.active {
    background: var(--app-accent-soft);
    box-shadow: inset 2px 0 0 var(--app-accent);
  }

  .workspace-list.collapsed li {
    justify-content: center;
  }

  .ws-skeleton {
    padding: 3px 6px;
  }

  .ws-skeleton.collapsed {
    display: flex;
    justify-content: center;
    padding: 3px 0;
  }

  .workspace-list.drag-over-root {
    outline: 1px dashed var(--app-accent);
    outline-offset: -2px;
    border-radius: 6px;
  }

  .workspace-list li.ws-group {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    padding-right: 0;
    border-radius: 6px;
  }

  .ws-group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 32px;
    padding: 0 4px 0 2px;
    border-radius: 6px;
    cursor: grab;
  }

  .ws-group-header:hover {
    background: color-mix(in srgb, var(--app-border) 55%, transparent);
  }

  .ws-group.drag-over > .ws-group-header {
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px var(--app-accent);
  }

  .ws-group-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .ws-group-toggle :global(svg) {
    transition: transform 120ms ease;
  }

  .ws-group-toggle :global(svg.expanded) {
    transform: rotate(90deg);
  }

  :global(.ws-group-icon) {
    color: var(--app-text-muted);
    flex-shrink: 0;
  }

  .ws-group-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 500;
    color: var(--app-text);
  }

  .ws-group-rename {
    flex: 1;
    min-width: 0;
    border: 1px solid var(--app-accent);
    border-radius: 4px;
    background: var(--app-canvas);
    color: var(--app-text);
    font-size: 12px;
    padding: 2px 5px;
  }

  .ws-group-actions {
    display: none;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .ws-group-header:hover .ws-group-actions {
    display: flex;
  }

  .ws-group-children {
    list-style: none;
    margin: 0;
    padding: 0 0 0 17px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .ws-group-empty {
    padding: 4px 8px;
    font-size: 11px;
    color: var(--app-text-muted);
    font-style: italic;
  }

  .new-folder-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    min-height: 30px;
    border-radius: 6px;
    border: 1px dashed var(--app-border);
    color: var(--app-text-muted);
    flex-shrink: 0;
  }

  .ws-subfolder-create {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    min-height: 28px;
    border-radius: 6px;
    border: 1px dashed var(--app-border);
    color: var(--app-text-muted);
  }

  .ws-subfolder-create input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .new-folder-row input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
  }

  .sidebar-header-actions {
    display: flex;
    align-items: center;
    gap: 3px;
    margin-left: auto;
  }

  .hidden-input {
    display: none;
  }

  .canvas-page :global(.workspace-item) {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
  }

  .canvas-page :global(.workspace-icon) {
    display: inline-flex;
    align-items: center;
    color: var(--app-text-muted);
    flex-shrink: 0;
    position: relative;
  }

  /* Bolinha verde = workspace com sessoes vivas em background. */
  .live-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--app-success);
    box-shadow: 0 0 6px color-mix(in srgb, var(--app-success) 80%, transparent);
    margin-left: 6px;
    flex-shrink: 0;
    animation: live-pulse 2s ease-in-out infinite;
  }

  .live-dot.rail {
    position: absolute;
    top: -3px;
    right: -4px;
    margin-left: 0;
    width: 6px;
    height: 6px;
  }

  @keyframes live-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .live-dot {
      animation: none;
    }
  }

  .canvas-page :global(.workspace-emoji) {
    font-size: 13px;
  }

  .canvas-page :global(.workspace-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* :global — o HeaderIconButton vive em outro componente; o escopo do
     Svelte nao alcança os filhos sem isso. */
  .canvas-page :global(.icon-btn) {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    font-size: 15px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 6px;
  }

  .canvas-page :global(.icon-btn:hover) {
    color: var(--app-text);
    background: var(--app-border);
  }

  .canvas-page :global(.icon-btn.danger:hover) {
    color: var(--app-danger);
  }

  .empty {
    color: var(--app-text-muted);
    font-size: 12px;
    padding: 8px;
  }

  .canvas-area {
    flex: 1;
    min-width: 0;
    position: relative;
    /* Linha: o flow ocupa o espaco e os paineis laterais (Andares/Rotinas/
       Roles) entram como irmaos de 300px na direita. */
    display: flex;
  }

  .canvas-area :global(.svelte-flow) {
    flex: 1;
    min-width: 0;
    background: var(--app-canvas);
  }

  .canvas-area :global(.svelte-flow__minimap) {
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 7px;
    overflow: hidden;
  }


  .canvas-area :global(.svelte-flow__controls) {
    border: 1px solid var(--app-border);
    border-radius: 7px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
  }

  .canvas-area :global(.svelte-flow__controls-button) {
    background: var(--app-surface);
    border-bottom: 1px solid var(--app-border);
    color: var(--app-text-soft);
  }

  .canvas-area :global(.svelte-flow__controls-button:hover) {
    background: var(--app-surface-raised);
  }

  .canvas-area :global(.svelte-flow__controls-button svg) {
    fill: var(--app-text-soft);
  }

  .canvas-area :global(.svelte-flow__edge-path) {
    stroke: var(--app-edge);
    stroke-width: 1.6;
  }

  .canvas-area :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
    stroke: var(--app-accent);
  }

  .canvas-area :global(.svelte-flow__connectionline path) {
    stroke: var(--app-accent);
    stroke-width: 1.6;
  }

  .canvas-area :global(.svelte-flow__attribution) {
    background: transparent;
    color: var(--app-text-muted);
  }

  /* Labels de edge (X de remover) acima dos nos; o tema default do xyflow
     pinta o label de branco — aqui ele precisa ser invisivel. O wrapper nao
     recebe cliques (passa para a corda → pin); so o botao X e clicavel. */
  .canvas-area :global(.svelte-flow__edge-labels) {
    /* Os paths ficam entre grupos e nodes; somente o controle de remocao
       precisa atravessar a camada dos nodes. */
    z-index: 2000 !important;
  }

  .canvas-area :global(.svelte-flow__edge-label) {
    z-index: 100 !important;
    background: transparent;
    padding: 0;
    border: none;
    box-shadow: none;
    pointer-events: none !important;
  }

  .canvas-area.drawing :global(.svelte-flow__pane) {
    cursor: crosshair;
  }

  .draw-ghost {
    position: absolute;
    border: 1.5px dashed var(--app-accent);
    background: color-mix(in srgb, var(--app-accent) 8%, transparent);
    border-radius: 10px;
    z-index: 40;
    pointer-events: none;
  }

  .toolbar-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 12px;
  }

  .toolbar-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-surface-raised) 92%, transparent);
    color: var(--app-text-soft);
    cursor: pointer;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.24);
    transition: color 120ms ease, background 120ms ease;
  }

  .toolbar-arrow:hover {
    background: var(--app-surface-raised);
    color: var(--app-text);
  }

  .toolbar {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-surface) 94%, transparent);
    border: 1px solid var(--app-border);
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    /* Muitos botoes (providers + paineis): rola em vez de cortar fora da tela.
       O painel do xyflow nao tem largura propria — limita pelo viewport
       (sidebar 332 + painel lateral 300 + setas 58 + margens). */
    max-width: max(320px, calc(100vw - 360px));
    overflow-x: auto;
    scrollbar-width: none;
  }

  .toolbar::-webkit-scrollbar {
    display: none;
  }

  .toolbar-sep {
    width: 1px;
    background: var(--app-border);
    margin: 3px 2px;
  }

  .canvas-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    height: 100%;
    text-align: center;
    color: var(--app-text-muted);
  }

  .canvas-empty img {
    opacity: 0.55;
  }

  .error-banner {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--app-danger) 15%, transparent);
    border: 1px solid var(--app-danger);
    color: var(--app-danger);
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
  }

  .permission-banner {
    position: absolute;
    z-index: 30;
    bottom: 12px;
    left: 50%;
    width: min(520px, calc(100% - 24px));
    transform: translateX(-50%);
  }

  .notice-banner {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--app-success) 55%, transparent);
    color: var(--app-success);
    padding: 6px 14px;
    border-radius: 8px;
    font-size: 12px;
  }

</style>
