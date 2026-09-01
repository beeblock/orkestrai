<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    AlertTriangle,
    Activity,
    ArrowDownToLine,
    ArrowUpFromLine,
    Box,
    Braces,
    FileCode2,
    GitCompareArrows,
    GitPullRequestArrow,
    Bookmark,
    Bot,
    Send,
    ListTodo,
    ExternalLink,
    Network,
    MoreHorizontal,
    RefreshCw,
    Search,
    ShieldCheck,
    Sparkles,
    Trash2,
    Waypoints,
    X,
  } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import type {
    CodeGraphProject,
    CodeGraphContractSnapshot,
    CodeGraphChangeIntelligence,
    CodeGraphChangeScope,
    CodeGraphChangedFile,
    CodeGraphHandoffResult,
    CodeGraphFinding,
    CodeGraphQualitySnapshot,
    CodeGraphRuntimeEvidenceSnapshot,
    CodeGraphContextPackage,
    CodeGraphContextPurpose,
    CodeGraphContextSelection,
    CodeGraphInvestigation,
    CodeGraphInvestigationState,
    CodeGraphOperationsSnapshot,
    CodeGraphRelationshipExplanation,
    CodeGraphRevisionComparison,
    CodeGraphRevisionSummary,
    CodeGraphSemanticMatch,
    CodeGraphSemanticStatus,
    CodeGraphSnapshot,
    CodeGraphSubgraph,
    CodeGraphSymbol,
  } from '$lib/modules/agent-room/domain/code-graph.js';
  import * as m from '$lib/paraglide/messages.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';

  export type CodeGraphNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: CodeGraphNodeData }>();
  let snapshot = $state<CodeGraphSnapshot | null>(null);
  let graph = $state<CodeGraphSubgraph | null>(null);
  let changes = $state<CodeGraphChangeIntelligence | null>(null);
  let contracts = $state<CodeGraphContractSnapshot | null>(null);
  let quality = $state<CodeGraphQualitySnapshot | null>(null);
  let semanticStatus = $state<CodeGraphSemanticStatus | null>(null);
  let semanticMatches = $state<CodeGraphSemanticMatch[]>([]);
  let runtime = $state<CodeGraphRuntimeEvidenceSnapshot | null>(null);
  let operations = $state<CodeGraphOperationsSnapshot | null>(null);
  let revisions = $state<CodeGraphRevisionSummary[]>([]);
  let comparison = $state<CodeGraphRevisionComparison | null>(null);
  let investigations = $state<CodeGraphInvestigation[]>([]);
  let pendingInvestigationDelete = $state<CodeGraphInvestigation | null>(null);
  let selectedRelationship = $state<CodeGraphRelationshipExplanation | null>(null);
  let selectedSymbol = $state<CodeGraphSymbol | null>(null);
  let results = $state<CodeGraphSymbol[]>([]);
  let query = $state('');
  let projectId = $state('all');
  let direction = $state<'incoming' | 'outgoing' | 'both'>('both');
  let depth = $state(2);
  let loading = $state(true);
  let indexing = $state(false);
  let changeLoading = $state(false);
  let contractLoading = $state(false);
  let qualityLoading = $state(false);
  let semanticLoading = $state(false);
  let runtimeLoading = $state(false);
  let operationsLoading = $state(false);
  let comparisonLoading = $state(false);
  let investigationsOpen = $state(false);
  let investigationBusy = $state(false);
  let investigationName = $state('');
  let currentInvestigationId = $state<string | null>(null);
  let compareFrom = $state('');
  let compareTo = $state('');
  let contextOpen = $state(false);
  let contextBusy = $state(false);
  let contextPackage = $state<CodeGraphContextPackage | null>(null);
  let contextSelection = $state<CodeGraphContextSelection | null>(null);
  let contextPurpose = $state<CodeGraphContextPurpose>('investigate');
  let contextTokens = $state('4000');
  let contextHandoff = $state<'task' | 'leader' | 'agent' | 'council'>('leader');
  let contextTarget = $state('');
  let councilTargets = $state<string[]>([]);
  let evidenceImporting = $state(false);
  let evidencePath = $state('');
  let evidenceKind = $state<'auto' | 'coverage' | 'test' | 'trace'>('auto');
  let searchMode = $state<'lexical' | 'semantic'>('lexical');
  let handoffBusy = $state<string | null>(null);
  let viewMode = $state<CodeGraphInvestigationState['viewMode']>('overview');
  let error = $state('');
  let graphHost: HTMLDivElement;
  type CameraState = { x: number; y: number; ratio: number; angle: number };
  type GraphRenderer = {
    kill: () => void;
    getCamera: () => {
      getState: () => CameraState;
      setState: (state: CameraState) => void;
      on: (event: 'updated', callback: (state: CameraState) => void) => void;
    };
  };
  let renderer: GraphRenderer | null = null;
  let cameraState = $state<CameraState | null>(null);
  let renderSequence = 0;
  const AGENT_COLORS = ['#22c55e', '#0ea5e9', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

  const currentProject = $derived(snapshot?.projects.find((project) => project.id === projectId) ?? null);
  const hasIndexedGraph = $derived(Boolean(snapshot?.projects.some((project) => project.currentRevisionId)));
  const changedFileCount = $derived(changes?.scopes.reduce((total, scope) => total + scope.files.length, 0) ?? 0);
  const activeAgents = $derived(operations?.agents.filter((agent) => agent.state !== 'disconnected') ?? []);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const body = await response.text();
    const payload = body ? JSON.parse(body) : { error: m['code_graph.load_error']() };
    if (!response.ok || payload.error) throw new Error(payload.error || m['code_graph.load_error']());
    return payload.data as T;
  }

  function projectStatus(project: CodeGraphProject): string {
    if (project.status === 'ready') return m['code_graph.status_ready']();
    if (project.status === 'indexing') return m['code_graph.status_indexing']();
    if (project.status === 'stale') return m['code_graph.status_stale']();
    if (project.status === 'error') return m['code_graph.status_error']();
    return m['code_graph.status_idle']();
  }

  function agentStateLabel(state: CodeGraphOperationsSnapshot['agents'][number]['state']): string {
    switch (state) {
      case 'starting': return m['control_center.state_starting']();
      case 'working': return m['control_center.state_working']();
      case 'waiting_input': return m['control_center.state_waiting_input']();
      case 'waiting_permission': return m['control_center.state_waiting_permission']();
      case 'blocked': return m['control_center.state_blocked']();
      case 'idle': return m['control_center.state_idle']();
      case 'done': return m['control_center.state_done']();
      case 'error': return m['control_center.state_error']();
      case 'disconnected': return m['control_center.state_disconnected']();
    }
  }

  function viewModeLabel(mode: CodeGraphInvestigationState['viewMode']): string {
    switch (mode) {
      case 'overview': return m['code_graph.overview']();
      case 'changes': return m['code_graph.changes']();
      case 'contracts': return m['code_graph.contracts']();
      case 'quality': return m['code_graph.quality']();
      case 'semantic': return m['code_graph.semantic']();
      case 'runtime': return m['code_graph.runtime']();
      case 'operations': return m['code_graph.operations']();
      case 'compare': return m['code_graph.compare']();
    }
  }

  function comparisonStateLabel(state: 'added' | 'modified' | 'removed'): string {
    if (state === 'added') return m['code_graph.comparison_added']();
    if (state === 'modified') return m['code_graph.comparison_modified']();
    return m['code_graph.comparison_removed']();
  }

  function symbolColor(kind: CodeGraphSymbol['kind']): string {
    if (kind === 'module') return '#0ea5e9';
    if (kind === 'class' || kind === 'interface') return '#8b5cf6';
    if (kind === 'endpoint') return '#22c55e';
    if (kind === 'apiRequest') return '#06b6d4';
    if (kind === 'schema') return '#a855f7';
    if (kind === 'gateway') return '#f97316';
    if (kind === 'resource') return '#ec4899';
    if (kind === 'function' || kind === 'method') return '#10b981';
    if (kind === 'external') return '#94a3b8';
    if (kind === 'evidence') return '#f59e0b';
    return '#f59e0b';
  }

  function symbolKind(kind: CodeGraphSymbol['kind']): string {
    switch (kind) {
      case 'module': return m['code_graph.kind_module']();
      case 'namespace': return m['code_graph.kind_namespace']();
      case 'class': return m['code_graph.kind_class']();
      case 'interface': return m['code_graph.kind_interface']();
      case 'type': return m['code_graph.kind_type']();
      case 'enum': return m['code_graph.kind_enum']();
      case 'function': return m['code_graph.kind_function']();
      case 'method': return m['code_graph.kind_method']();
      case 'variable': return m['code_graph.kind_variable']();
      case 'endpoint': return m['code_graph.kind_endpoint']();
      case 'apiRequest': return m['code_graph.kind_api_request']();
      case 'schema': return m['code_graph.kind_schema']();
      case 'gateway': return m['code_graph.kind_gateway']();
      case 'resource': return m['code_graph.kind_resource']();
      case 'external': return m['code_graph.kind_external']();
      case 'evidence': return m['code_graph.kind_evidence']();
    }
  }

  function stablePosition(value: string, axis: number): number {
    let code = axis ? 5381 : 2166136261;
    for (let index = 0; index < value.length; index += 1) code = ((code << 5) - code + value.charCodeAt(index)) | 0;
    return ((code >>> 0) % 10_000) / 1_000 - 5;
  }

  async function renderGraph(next: CodeGraphSubgraph | null): Promise<void> {
    const sequence = ++renderSequence;
    cameraState = renderer?.getCamera().getState() ?? cameraState;
    renderer?.kill();
    renderer = null;
    if (!next?.nodes.length || !graphHost) return;
    const [{ default: Graph }, { default: Sigma }, { default: forceAtlas2 }] = await Promise.all([
      import('graphology'),
      import('sigma'),
      import('graphology-layout-forceatlas2'),
    ]);
    if (sequence !== renderSequence || !graphHost) return;
    const model = new Graph({ multi: true, type: 'directed' });
    const changed = new Set(viewMode === 'changes' ? changes?.scopes.flatMap((scope) => scope.changedSymbolIds) ?? [] : []);
    const tests = new Set(viewMode === 'changes' ? changes?.likelyTests ?? [] : []);
    const ownerColors = new Map<string, string>();
    if (viewMode === 'operations') {
      operations?.agents.forEach((agent, index) => agent.symbolIds.forEach((symbolId) => ownerColors.set(symbolId, AGENT_COLORS[index % AGENT_COLORS.length])));
    }
    const comparisonKey = (value: { projectName?: string | null; path: string | null; kind: string; qualifiedName: string; startLine: number | null }) =>
      `${value.projectName ?? currentProject?.name ?? ''}\0${value.path ?? ''}\0${value.kind}\0${value.qualifiedName}\0${value.startLine ?? ''}`;
    const added = new Set(viewMode === 'compare' ? comparison?.added.map((item) => comparisonKey({ ...item, projectName: comparison.projectName })) ?? [] : []);
    const modified = new Set(viewMode === 'compare' ? comparison?.modified.map((item) => comparisonKey({ ...item.after, projectName: comparison.projectName })) ?? [] : []);
    for (const node of next.nodes) {
      const key = comparisonKey(node);
      model.addNode(node.id, {
        label: node.name,
        x: stablePosition(node.id, 0),
        y: stablePosition(node.id, 1),
        size: changed.has(node.id) || node.id === next.centerSymbolId ? 11 : node.kind === 'module' ? 7 : 5,
        color: ownerColors.get(node.id) ?? (added.has(key) ? '#22c55e' : modified.has(key) ? '#f59e0b' : changed.has(node.id) ? '#ef4444' : node.path && tests.has(node.path) ? '#f59e0b' : symbolColor(node.kind)),
      });
    }
    for (const edge of next.edges) {
      if (!model.hasNode(edge.sourceSymbolId) || !model.hasNode(edge.targetSymbolId)) continue;
      model.addEdgeWithKey(edge.id, edge.sourceSymbolId, edge.targetSymbolId, {
        size: Math.max(0.7, edge.confidence / 80),
        color: edge.kind === 'calls' || edge.kind === 'handles' ? '#10b981'
          : edge.kind === 'imports' ? '#0ea5e9'
            : edge.kind === 'matches' || edge.kind === 'generatedFrom' || edge.kind === 'requests' ? '#06b6d4'
              : edge.kind === 'validates' ? '#a855f7'
                : edge.kind === 'routesTo' ? '#f97316'
                  : edge.kind === 'reads' || edge.kind === 'writes' ? '#f59e0b'
                    : edge.kind === 'queries' ? '#e879f9'
                      : edge.kind === 'usesEnv' ? '#f43f5e'
                    : edge.kind === 'sends' || edge.kind === 'receives' ? '#14b8a6'
                      : edge.kind === 'coveredBy' ? '#22c55e'
                        : edge.kind === 'failsAt' ? '#ef4444'
                          : edge.kind === 'observedCalls' ? (edge.metadata.runtimeOnly ? '#f59e0b' : '#06b6d4')
                  : '#64748b',
      });
    }
    if (model.order > 1 && model.size > 0) forceAtlas2.assign(model, { iterations: Math.min(120, 30 + model.order) });
    const labelColor = getComputedStyle(graphHost).getPropertyValue('--app-text').trim() || '#e5e7eb';
    const sigma = new Sigma(model, graphHost, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      labelColor: { color: labelColor },
      labelDensity: 0.08,
      labelRenderedSizeThreshold: 8,
      minCameraRatio: 0.08,
      maxCameraRatio: 8,
    });
    sigma.on('clickNode', ({ node }: { node: string }) => void openGraphSymbol(node));
    sigma.on('clickEdge', ({ edge }: { edge: string }) => void openRelationship(edge));
    if (cameraState) sigma.getCamera().setState(cameraState);
    sigma.getCamera().on('updated', (state: CameraState) => {
      cameraState = state;
      sessionStorage.setItem(`orkestrai:code-graph-camera:${data.workspaceId}:${id}`, JSON.stringify(state));
    });
    renderer = sigma as GraphRenderer;
  }

  async function loadStatus(): Promise<void> {
    snapshot = await api<CodeGraphSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph`);
  }

  async function loadOverview(): Promise<void> {
    viewMode = 'overview';
    selectedSymbol = null;
    selectedRelationship = null;
    results = [];
    semanticMatches = [];
    const params = new URLSearchParams();
    if (projectId !== 'all') params.set('projectId', projectId);
    graph = await api<CodeGraphSubgraph>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/graph?${params}`);
    await renderGraph(graph);
  }

  async function loadChanges(): Promise<void> {
    if (!hasIndexedGraph) return;
    changeLoading = true;
    error = '';
    try {
      changes = await api<CodeGraphChangeIntelligence>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/changes?depth=2&limit=500`);
      viewMode = 'changes';
      selectedSymbol = null;
      results = [];
      graph = changes.impact;
      await renderGraph(graph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.changes_error']();
    } finally {
      changeLoading = false;
    }
  }

  async function loadContracts(): Promise<void> {
    if (!hasIndexedGraph) return;
    contractLoading = true;
    error = '';
    try {
      contracts = await api<CodeGraphContractSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/contracts?limit=500&includeGraph=true`);
      viewMode = 'contracts';
      selectedSymbol = null;
      results = [];
      graph = contracts.graph;
      await renderGraph(graph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.contracts_error']();
    } finally {
      contractLoading = false;
    }
  }

  async function loadQuality(): Promise<void> {
    if (!hasIndexedGraph) return;
    qualityLoading = true;
    error = '';
    try {
      quality = await api<CodeGraphQualitySnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/quality?limit=500&includeGraph=true`);
      viewMode = 'quality';
      selectedSymbol = null;
      results = [];
      graph = quality.graph;
      await renderGraph(graph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.quality_error']();
    } finally {
      qualityLoading = false;
    }
  }

  async function loadSemantic(): Promise<void> {
    if (!hasIndexedGraph) return;
    semanticLoading = true;
    error = '';
    try {
      semanticStatus = await api<CodeGraphSemanticStatus>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/semantic`);
      viewMode = 'semantic';
      selectedSymbol = null;
      results = [];
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.semantic_error']();
    } finally {
      semanticLoading = false;
    }
  }

  async function updateSemantic(action: 'build' | 'clear'): Promise<void> {
    semanticLoading = true;
    error = '';
    try {
      semanticStatus = await api<CodeGraphSemanticStatus>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/semantic`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      semanticMatches = [];
      toast.success(action === 'build' ? m['code_graph.semantic_built']() : m['code_graph.semantic_cleared']());
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.semantic_error']();
      toast.error(error);
    } finally {
      semanticLoading = false;
    }
  }

  async function loadRuntime(): Promise<void> {
    if (!hasIndexedGraph) return;
    runtimeLoading = true;
    error = '';
    try {
      runtime = await api<CodeGraphRuntimeEvidenceSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/evidence?limit=2000`);
      viewMode = 'runtime';
      selectedSymbol = null;
      results = [];
      graph = runtime.graph;
      await renderGraph(graph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.runtime_error']();
    } finally {
      runtimeLoading = false;
    }
  }

  async function loadOperations(): Promise<void> {
    if (!hasIndexedGraph) return;
    operationsLoading = true;
    error = '';
    try {
      operations = await api<CodeGraphOperationsSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/operations`);
      viewMode = 'operations';
      selectedSymbol = null;
      selectedRelationship = null;
      results = [];
      graph = operations.graph;
      await renderGraph(graph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.operations_error']();
    } finally {
      operationsLoading = false;
    }
  }

  async function loadComparison(): Promise<void> {
    const targetProjectId = projectId !== 'all' ? projectId : snapshot?.projects[0]?.id;
    if (!targetProjectId) return;
    comparisonLoading = true;
    error = '';
    try {
      projectId = targetProjectId;
      revisions = await api<CodeGraphRevisionSummary[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/revisions?projectId=${encodeURIComponent(targetProjectId)}&limit=30`);
      compareTo = compareTo && revisions.some((item) => item.id === compareTo) ? compareTo : revisions[0]?.id ?? '';
      compareFrom = compareFrom && revisions.some((item) => item.id === compareFrom) ? compareFrom : revisions.find((item) => item.id !== compareTo)?.id ?? '';
      viewMode = 'compare';
      selectedSymbol = null;
      selectedRelationship = null;
      if (compareFrom && compareTo) await compareRevisions(targetProjectId);
      else {
        comparison = null;
        graph = await api<CodeGraphSubgraph>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/graph?projectId=${encodeURIComponent(targetProjectId)}`);
        await renderGraph(graph);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.compare_error']();
    } finally {
      comparisonLoading = false;
    }
  }

  async function compareRevisions(targetProjectId = projectId): Promise<void> {
    if (!compareFrom || !compareTo || targetProjectId === 'all') return;
    const params = new URLSearchParams({ projectId: targetProjectId, from: compareFrom, to: compareTo });
    comparison = await api<CodeGraphRevisionComparison>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/compare?${params}`);
    graph = await api<CodeGraphSubgraph>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/graph?projectId=${encodeURIComponent(targetProjectId)}`);
    await renderGraph(graph);
  }

  async function openRelationship(edgeId: string): Promise<void> {
    try {
      selectedRelationship = await api<CodeGraphRelationshipExplanation>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/relationships/${edgeId}`);
      selectedSymbol = null;
      results = [];
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : m['code_graph.relationship_error']());
    }
  }

  async function openContext(selection: CodeGraphContextSelection): Promise<void> {
    contextSelection = selection;
    contextPackage = null;
    contextHandoff = 'leader';
    contextTarget = '';
    councilTargets = [];
    contextOpen = true;
    if (!operations) operations = await api<CodeGraphOperationsSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/operations`).catch(() => null);
    await buildContext();
  }

  async function buildContext(): Promise<void> {
    if (!contextSelection) return;
    contextBusy = true;
    try {
      contextPackage = await api<CodeGraphContextPackage>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/context`, {
        method: 'POST',
        body: JSON.stringify({
          selection: contextSelection,
          purpose: contextPurpose,
          maxTokens: Number(contextTokens),
          depth: Math.min(depth, 3),
          includeSource: true,
        }),
      });
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : m['code_graph.context_error']());
    } finally {
      contextBusy = false;
    }
  }

  async function handoffContext(): Promise<void> {
    if (!contextSelection || !contextPackage) return;
    if (contextHandoff === 'agent' && !contextTarget) return;
    if (contextHandoff === 'council' && councilTargets.length < 2) return;
    contextBusy = true;
    try {
      const result = await api<CodeGraphHandoffResult>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/handoffs`, {
        method: 'POST',
        body: JSON.stringify({
          kind: contextHandoff,
          title: m['code_graph.context_task_title']({ symbol: contextPackage.symbols[0]?.name ?? m['code_graph.context']() }),
          locale: localeState.current,
          context: {
            selection: contextSelection,
            purpose: contextPurpose,
            maxTokens: Number(contextTokens),
            depth: Math.min(depth, 3),
            includeSource: true,
          },
          targetNodeId: contextHandoff === 'agent' ? contextTarget : undefined,
          targetNodeIds: contextHandoff === 'council' ? councilTargets : undefined,
        }),
      });
      toast.success(m['code_graph.context_sent']({ title: result.artifact.title }));
      contextOpen = false;
      if (result.artifact.type === 'council') {
        window.dispatchEvent(new CustomEvent('orkestrai:open-council', {
          detail: { workspaceId: data.workspaceId, councilId: result.artifact.id },
        }));
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : m['code_graph.handoff_error']());
    } finally {
      contextBusy = false;
    }
  }

  function investigationState(): CodeGraphInvestigationState {
    return {
      projectId: projectId === 'all' ? null : projectId,
      viewMode,
      query,
      searchMode,
      selectedSymbolIds: selectedSymbol ? [selectedSymbol.id] : [],
      direction,
      depth,
      camera: cameraState,
      openPath: selectedSymbol?.path ?? null,
    };
  }

  async function loadInvestigations(): Promise<void> {
    investigations = await api<CodeGraphInvestigation[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/investigations`);
    investigationsOpen = true;
  }

  async function saveInvestigation(): Promise<void> {
    if (!investigationName.trim()) return;
    investigationBusy = true;
    try {
      const path = currentInvestigationId
        ? `/api/agent-room/workspaces/${data.workspaceId}/code-graph/investigations/${currentInvestigationId}`
        : `/api/agent-room/workspaces/${data.workspaceId}/code-graph/investigations`;
      const saved = await api<CodeGraphInvestigation>(path, {
        method: currentInvestigationId ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: investigationName.trim(), state: investigationState() }),
      });
      currentInvestigationId = saved.id;
      investigations = await api<CodeGraphInvestigation[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/investigations`);
      toast.success(m['code_graph.investigation_saved']());
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : m['code_graph.investigation_error']());
    } finally {
      investigationBusy = false;
    }
  }

  async function restoreInvestigation(item: CodeGraphInvestigation): Promise<void> {
    currentInvestigationId = item.id;
    investigationName = item.name;
    projectId = item.state.projectId ?? 'all';
    query = item.state.query;
    searchMode = item.state.searchMode;
    direction = item.state.direction;
    depth = item.state.depth;
    cameraState = item.state.camera;
    investigationsOpen = false;
    if (item.state.viewMode === 'changes') await loadChanges();
    else if (item.state.viewMode === 'contracts') await loadContracts();
    else if (item.state.viewMode === 'quality') await loadQuality();
    else if (item.state.viewMode === 'semantic') await loadSemantic();
    else if (item.state.viewMode === 'runtime') await loadRuntime();
    else if (item.state.viewMode === 'operations') await loadOperations();
    else if (item.state.viewMode === 'compare') await loadComparison();
    else if (item.state.selectedSymbolIds[0]) {
      await openSymbol(item.state.selectedSymbolIds[0]);
      if (item.state.openPath) openSource();
    }
    else await loadOverview();
  }

  async function deleteInvestigation(item: CodeGraphInvestigation): Promise<void> {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/investigations/${item.id}`, { method: 'DELETE' });
    if (currentInvestigationId === item.id) {
      currentInvestigationId = null;
      investigationName = '';
    }
    investigations = investigations.filter((candidate) => candidate.id !== item.id);
  }

  async function importEvidence(): Promise<void> {
    const targetProjectId = projectId !== 'all'
      ? projectId
      : snapshot?.projects.length === 1 ? snapshot.projects[0].id : null;
    if (!targetProjectId) {
      toast.error(m['code_graph.runtime_select_repository']());
      return;
    }
    if (!evidencePath.trim()) return;
    evidenceImporting = true;
    error = '';
    try {
      await api(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/evidence`, {
        method: 'POST',
        body: JSON.stringify({ projectId: targetProjectId, path: evidencePath.trim(), kind: evidenceKind }),
      });
      evidencePath = '';
      await loadRuntime();
      toast.success(m['code_graph.runtime_imported']());
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.runtime_error']();
      toast.error(error);
    } finally {
      evidenceImporting = false;
    }
  }

  function findingTitle(finding: CodeGraphFinding): string {
    switch (finding.rule) {
      case 'duplicate-structure': return m['code_graph.finding_duplicate_structure']();
      case 'import-cycle': return m['code_graph.finding_import_cycle']();
      case 'high-coupling': return m['code_graph.finding_high_coupling']();
      case 'layer-boundary': return m['code_graph.finding_layer_boundary']();
      case 'long-symbol': return m['code_graph.finding_long_symbol']();
      case 'oversized-module': return m['code_graph.finding_oversized_module']();
      case 'security-sensitive-execution': return m['code_graph.finding_security_sensitive_execution']();
      case 'unreferenced-symbol': return m['code_graph.finding_unreferenced_symbol']();
    }
  }

  function findingMetrics(finding: CodeGraphFinding): string {
    const metric = (key: string): string | number => {
      const value = finding.metrics[key];
      return Array.isArray(value) ? value.join(', ') : value ?? 0;
    };
    switch (finding.rule) {
      case 'duplicate-structure': return m['code_graph.metric_duplicate']({ candidates: metric('candidates'), nodes: metric('structureNodes') });
      case 'import-cycle': return m['code_graph.metric_cycle']({ modules: metric('modules') });
      case 'high-coupling': return m['code_graph.metric_coupling']({ incoming: metric('fanIn'), outgoing: metric('fanOut') });
      case 'layer-boundary': return m['code_graph.metric_boundary']({ source: metric('sourceLayer'), target: metric('targetLayer') });
      case 'long-symbol': return m['code_graph.metric_lines']({ lines: metric('lines'), threshold: metric('threshold') });
      case 'oversized-module': return m['code_graph.metric_symbols']({ symbols: metric('symbols'), threshold: metric('threshold') });
      case 'security-sensitive-execution': return m['code_graph.metric_operation']({ operation: metric('operation') });
      case 'unreferenced-symbol': return m['code_graph.metric_reference']({
        state: metric('rule') === 'no-indexed-consumer'
          ? m['code_graph.metric_reference_public']()
          : m['code_graph.metric_reference_private'](),
      });
    }
  }

  function resourceTypeLabel(type: string): string {
    if (type === 'environment') return m['code_graph.resource_environment']();
    if (type === 'file') return m['code_graph.resource_file']();
    if (type === 'network') return m['code_graph.resource_network']();
    if (type === 'database') return m['code_graph.resource_database']();
    if (type === 'ipc') return m['code_graph.resource_ipc']();
    return m['code_graph.resource_unknown']();
  }

  function semanticStateLabel(state: CodeGraphSemanticStatus['state']): string {
    if (state === 'ready') return m['code_graph.semantic_ready']();
    if (state === 'stale') return m['code_graph.semantic_stale']();
    return m['code_graph.semantic_empty']();
  }

  function evidenceKindLabel(kind: string): string {
    if (kind === 'coverage') return m['code_graph.evidence_coverage']();
    if (kind === 'test') return m['code_graph.evidence_test']();
    if (kind === 'trace') return m['code_graph.evidence_trace']();
    return m['code_graph.evidence_auto']();
  }

  function purposeLabel(purpose: CodeGraphContextPurpose): string {
    if (purpose === 'implement') return m['code_graph.purpose_implement']();
    if (purpose === 'review') return m['code_graph.purpose_review']();
    if (purpose === 'test') return m['code_graph.purpose_test']();
    return m['code_graph.purpose_investigate']();
  }

  function revisionLabel(revisionId: string, fallback: string): string {
    const revision = revisions.find((item) => item.id === revisionId);
    return revision ? `#${revision.sequence} · ${revision.gitHead?.slice(0, 8) ?? revision.sourceHash.slice(0, 8)}` : fallback;
  }

  async function createHandoff(kind: 'review' | 'task', scope: CodeGraphChangeScope): Promise<void> {
    const operation = `${kind}:${scope.id}`;
    handoffBusy = operation;
    try {
      const result = await api<CodeGraphHandoffResult>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/handoffs`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          scopeId: scope.id,
          title: kind === 'review'
            ? m['code_graph.review_title']({ name: scope.name })
            : m['code_graph.task_title']({ name: scope.name }),
          locale: localeState.current,
        }),
      });
      toast.success(kind === 'review'
        ? m['code_graph.review_created']({ title: result.artifact.title })
        : m['code_graph.task_created']({ title: result.artifact.title }));
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : m['code_graph.handoff_error']());
    } finally {
      handoffBusy = null;
    }
  }

  async function load(): Promise<void> {
    loading = true;
    error = '';
    try {
      await loadStatus();
      if (hasIndexedGraph) await loadOverview();
      else {
        graph = null;
        await renderGraph(null);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.load_error']();
    } finally {
      loading = false;
    }
  }

  async function refreshCurrentView(): Promise<void> {
    await loadStatus();
    if (!hasIndexedGraph) {
      graph = null;
      await renderGraph(null);
      return;
    }
    if (viewMode === 'changes') await loadChanges();
    else if (viewMode === 'contracts') await loadContracts();
    else if (viewMode === 'quality') await loadQuality();
    else if (viewMode === 'semantic') await loadSemantic();
    else if (viewMode === 'runtime') await loadRuntime();
    else if (viewMode === 'operations') await loadOperations();
    else if (viewMode === 'compare') await loadComparison();
    else if (selectedSymbol) await openSymbol(selectedSymbol.id);
    else if (query.trim()) await searchSymbols();
    else await loadOverview();
  }

  async function indexWorkspace(): Promise<void> {
    indexing = true;
    error = '';
    try {
      await api(`/api/agent-room/workspaces/${data.workspaceId}/code-graph`, {
        method: 'POST',
        body: JSON.stringify({ projectIds: projectId === 'all' ? undefined : [projectId] }),
      });
      await loadStatus();
      await loadOverview();
      toast.success(m['code_graph.index_success']());
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.index_error']();
      toast.error(error);
    } finally {
      indexing = false;
    }
  }

  async function searchSymbols(): Promise<void> {
    const value = query.trim();
    if (!value) {
      results = [];
      return;
    }
    const params = new URLSearchParams({ q: value, limit: '30' });
    if (projectId !== 'all') params.set('projectId', projectId);
    try {
      viewMode = 'overview';
      selectedSymbol = null;
      if (searchMode === 'semantic') {
        semanticMatches = await api<CodeGraphSemanticMatch[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/semantic?${params}`);
        results = semanticMatches.map((match) => match.symbol);
      } else {
        semanticMatches = [];
        results = await api<CodeGraphSymbol[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/search?${params}`);
      }
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.load_error']();
    }
  }

  async function openSymbol(symbolId: string): Promise<void> {
    const params = new URLSearchParams({ direction, depth: String(depth), limit: '350' });
    try {
      const [symbol, nextGraph] = await Promise.all([
        api<CodeGraphSymbol>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/symbols/${symbolId}`),
        api<CodeGraphSubgraph>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/symbols/${symbolId}/graph?${params}`),
      ]);
      selectedSymbol = symbol;
      selectedRelationship = null;
      viewMode = 'overview';
      graph = nextGraph;
      results = [];
      await renderGraph(nextGraph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.load_error']();
    }
  }

  async function openGraphSymbol(symbolId: string): Promise<void> {
    const artifact = contracts?.graph.nodes.find((node) => node.id === symbolId && node.revisionId === 'live')
      ?? runtime?.graph.nodes.find((node) => node.id === symbolId && node.kind === 'evidence');
    if (artifact) {
      selectedSymbol = artifact;
      viewMode = 'overview';
      results = [];
      return;
    }
    await openSymbol(symbolId);
  }

  function contractSymbol(symbolId: string): CodeGraphSymbol | null {
    return contracts?.graph.nodes.find((node) => node.id === symbolId) ?? null;
  }

  function openApiClient(symbol: CodeGraphSymbol): void {
    const nodeId = typeof symbol.metadata.nodeId === 'string' ? symbol.metadata.nodeId : null;
    if (nodeId) data.onJumpToNode?.(nodeId);
  }

  async function changeProject(value: string): Promise<void> {
    projectId = value;
    await loadOverview();
  }

  function openSource(): void {
    if (!selectedSymbol?.path) return;
    const root = selectedSymbol.projectRelativePath;
    const path = !root || root === '.' ? selectedSymbol.path : `${root}/${selectedSymbol.path}`;
    sessionStorage.setItem(`orkestrai:file-reveal:${data.workspaceId}:${path}`, JSON.stringify({
      line: selectedSymbol.startLine ?? 1,
      column: Math.max(1, (selectedSymbol.startColumn ?? 0) + 1),
    }));
    window.dispatchEvent(new CustomEvent('orkestrai:open-file', {
      detail: { workspaceId: data.workspaceId, path, direction: 'horizontal' },
    }));
  }

  function openChangedFile(file: CodeGraphChangedFile): void {
    const project = snapshot?.projects.find((candidate) => candidate.id === file.projectId);
    const root = project?.relativePath;
    const path = !root || root === '.' ? file.path : `${root}/${file.path}`;
    window.dispatchEvent(new CustomEvent('orkestrai:open-file', {
      detail: { workspaceId: data.workspaceId, path },
    }));
  }

  onMount(() => {
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let liveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;
    const storedCamera = sessionStorage.getItem(`orkestrai:code-graph-camera:${data.workspaceId}:${id}`);
    if (storedCamera) {
      try { cameraState = JSON.parse(storedCamera) as CameraState; } catch { /* ignore invalid session state */ }
    }
    let editorLocateTimer: ReturnType<typeof setTimeout> | null = null;
    const handleEditorLocation = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; path?: string; line?: number }>).detail;
      if (detail?.workspaceId !== data.workspaceId || !detail.path || !detail.line) return;
      if (editorLocateTimer) clearTimeout(editorLocateTimer);
      editorLocateTimer = setTimeout(async () => {
        const params = new URLSearchParams({ path: detail.path!, line: String(detail.line) });
        const symbol = await api<CodeGraphSymbol | null>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/locate?${params}`).catch(() => null);
        if (symbol && selectedSymbol?.id !== symbol.id) await openSymbol(symbol.id);
      }, 180);
    };
    window.addEventListener('orkestrai:editor-location', handleEditorLocation);
    const connect = () => {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.workspaceId !== data.workspaceId) return;
          if (message.type === 'codeGraphChanged') void refreshCurrentView();
          else if (viewMode === 'operations' && ['controlCenterChanged', 'workspaceChanged'].includes(message.type)) {
            if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
            liveRefreshTimer = setTimeout(() => void loadOperations(), 250);
          }
        } catch {
          // PTY binary and non-JSON frames are unrelated to this node.
        }
      };
      socket.onclose = () => {
        if (!destroyed) reconnectTimer = setTimeout(connect, 3_000);
      };
    };
    connect();
    void load();
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      if (editorLocateTimer) clearTimeout(editorLocateTimer);
      window.removeEventListener('orkestrai:editor-location', handleEditorLocation);
      socket?.close();
      renderSequence += 1;
      renderer?.kill();
    };
  });
</script>

<NodeShell
  {id}
  {selected}
  accent="var(--app-secondary)"
  minWidth={480}
  minHeight={420}
  onResize={data.onResize}
  connections={data.connections}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
  titleText={data.title}
  onRename={data.onRename}
  class="canvas-code-graph"
>
  {#snippet icon()}<Waypoints size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['code_graph.refresh']()} class="node-action-btn" side="left" onclick={() => void load()}>
      <RefreshCw size={12} class={loading ? 'animate-spin' : undefined} />
    </HeaderIconButton>
    <HeaderIconButton label={m['settings.delete']()} class="node-action-btn danger" side="left" onclick={() => data.onDelete(id)}>
      <X size={12} />
    </HeaderIconButton>
  {/snippet}

  <div
    class="nodrag nowheel flex h-full min-h-0 flex-col overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)]"
    role="region"
    aria-label={m['code_graph.title']()}
    onwheel={(event) => event.stopPropagation()}
  >
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] p-2">
      <Select.Root type="single" value={projectId} onValueChange={(value: string) => void changeProject(value)}>
        <Select.Trigger size="sm" class="min-w-36 max-w-52">{currentProject?.name ?? m['code_graph.all_repositories']()}</Select.Trigger>
        <Select.Content>
          <Select.Item value="all">{m['code_graph.all_repositories']()}</Select.Item>
          {#each snapshot?.projects ?? [] as project (project.id)}
            <Select.Item value={project.id}>{project.name}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      <form class="relative flex min-w-44 flex-1" onsubmit={(event) => { event.preventDefault(); void searchSymbols(); }}>
        <Search size={13} class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--app-text-muted)]" />
        <input
          class="h-8 w-full rounded border border-[var(--app-border)] bg-[var(--app-surface-raised)] pr-14 pl-7 text-xs outline-none focus:border-[var(--app-accent)]"
          bind:value={query}
          placeholder={m['code_graph.search_placeholder']()}
          aria-label={m['code_graph.search_placeholder']()}
        />
        <button
          type="button"
          class="absolute top-1/2 right-7 grid size-6 -translate-y-1/2 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]"
          class:bg-[var(--app-accent-soft)]={searchMode === 'semantic'}
          class:text-[var(--app-accent)]={searchMode === 'semantic'}
          aria-label={searchMode === 'semantic' ? m['code_graph.semantic_search_enabled']() : m['code_graph.semantic_search_disabled']()}
          title={searchMode === 'semantic' ? m['code_graph.semantic_search_enabled']() : m['code_graph.semantic_search_disabled']()}
          onclick={() => { searchMode = searchMode === 'semantic' ? 'lexical' : 'semantic'; }}
        >
          <Sparkles size={12} />
        </button>
        <button type="submit" class="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]" aria-label={m['code_graph.search']()}>
          <ArrowDownToLine size={12} />
        </button>
      </form>
      <Button
        size="sm"
        class="h-8 bg-[var(--app-accent)] text-[11px] text-[var(--app-accent-contrast)] hover:brightness-105"
        disabled={indexing}
        onclick={() => void indexWorkspace()}
      >
        <RefreshCw size={12} class={indexing ? 'animate-spin' : undefined} />
        {indexing ? m['code_graph.indexing']() : m['code_graph.index']()}
      </Button>
      <Button
        size="sm"
        variant={viewMode === 'changes' ? 'default' : 'outline'}
        class="h-8 text-[11px]"
        disabled={!hasIndexedGraph || changeLoading}
        onclick={() => void loadChanges()}
      >
        <GitCompareArrows size={12} class={changeLoading ? 'animate-pulse' : undefined} />
        {m['code_graph.changes']()}{changes ? ` (${changedFileCount})` : ''}
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={`inline-flex h-8 items-center gap-1.5 rounded border border-[var(--app-border)] px-2 text-[11px] text-[var(--app-text)] hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] data-[state=open]:bg-[var(--app-accent-soft)] ${['contracts', 'quality', 'semantic', 'runtime', 'operations', 'compare'].includes(viewMode) ? 'bg-[var(--app-accent-soft)]' : ''}`}
          disabled={!hasIndexedGraph}
          aria-label={m['code_graph.intelligence_views']()}
        >
          <MoreHorizontal size={13} />
          {m['code_graph.intelligence']()}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="z-[140] min-w-52">
          <DropdownMenu.Label>{m['code_graph.intelligence_views']()}</DropdownMenu.Label>
          <DropdownMenu.Item onclick={() => void loadContracts()}>
            <Network size={13} class={contractLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.contracts']()}{contracts ? ` (${contracts.matches.length})` : ''}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void loadQuality()}>
            <ShieldCheck size={13} class={qualityLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.quality']()}{quality ? ` (${quality.counts.findings})` : ''}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void loadSemantic()}>
            <Sparkles size={13} class={semanticLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.semantic']()}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void loadRuntime()}>
            <Activity size={13} class={runtimeLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.runtime']()}{runtime ? ` (${runtime.counts.runs})` : ''}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => void loadOperations()}>
            <Bot size={13} class={operationsLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.operations']()}{operations ? ` (${activeAgents.length})` : ''}
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={() => void loadComparison()}>
            <GitCompareArrows size={13} class={comparisonLoading ? 'animate-pulse' : undefined} />
            {m['code_graph.compare']()}
          </DropdownMenu.Item>
          <DropdownMenu.Separator />
          <DropdownMenu.Item onclick={() => void loadInvestigations()}>
            <Bookmark size={13} /> {m['code_graph.investigations']()}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    {#if snapshot}
      <div class="grid shrink-0 grid-cols-4 divide-x divide-[var(--app-border)] border-b border-[var(--app-border)] bg-[var(--app-surface)]">
        <div class="min-w-0 px-2 py-1.5"><strong class="block text-xs">{snapshot.totals.files}</strong><span class="block truncate text-[9px] text-[var(--app-text-muted)]">{m['code_graph.files']()}</span></div>
        <div class="min-w-0 px-2 py-1.5"><strong class="block text-xs">{snapshot.totals.symbols}</strong><span class="block truncate text-[9px] text-[var(--app-text-muted)]">{m['code_graph.symbols']()}</span></div>
        <div class="min-w-0 px-2 py-1.5"><strong class="block text-xs">{snapshot.totals.edges}</strong><span class="block truncate text-[9px] text-[var(--app-text-muted)]">{m['code_graph.relationships']()}</span></div>
        <div class="min-w-0 px-2 py-1.5"><strong class="block text-xs">{snapshot.projects.length}</strong><span class="block truncate text-[9px] text-[var(--app-text-muted)]">{m['code_graph.repositories']()}</span></div>
      </div>
    {/if}

    {#if error}
      <div class="flex shrink-0 items-center gap-2 border-b border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 px-3 py-2 text-[10px] text-[var(--app-danger)]">
        <AlertTriangle size={12} /> <span class="min-w-0 truncate">{error}</span>
      </div>
    {/if}

    <div class="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(150px,0.34fr)]">
      <div class="relative min-h-0 min-w-0 overflow-hidden border-r border-[var(--app-border)]">
        {#if loading}
          <div class="absolute inset-0 grid place-items-center text-xs text-[var(--app-text-muted)]"><RefreshCw size={18} class="animate-spin" /></div>
        {:else if !hasIndexedGraph}
          <div class="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <Network size={28} class="text-[var(--app-secondary)]" />
            <strong class="text-sm">{m['code_graph.empty_title']()}</strong>
            <p class="max-w-80 text-[11px] leading-5 text-[var(--app-text-muted)]">{m['code_graph.empty_description']()}</p>
          </div>
        {:else if graph && graph.nodes.length === 0}
          <div class="absolute inset-0 grid place-items-center text-xs text-[var(--app-text-muted)]">{m['code_graph.no_results']()}</div>
        {/if}
        <div bind:this={graphHost} class="absolute inset-0" aria-label={m['code_graph.visualization']()}></div>
        {#if graph?.truncated}
          <span class="absolute bottom-2 left-2 rounded bg-[var(--app-surface)]/90 px-2 py-1 text-[9px] text-[var(--app-warning)] shadow">{m['code_graph.truncated']()}</span>
        {/if}
      </div>

      <aside class="min-h-0 overflow-y-auto overscroll-contain bg-[var(--app-surface)] p-2">
        {#if selectedRelationship}
          <button class="mb-2 inline-flex items-center gap-1 text-[10px] text-[var(--app-secondary)] hover:underline" onclick={() => { selectedRelationship = null; }}>
            <ArrowUpFromLine size={11} /> {m['code_graph.back_to_graph']()}
          </button>
          <div class="mb-3 rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2.5">
            <span class="mb-2 inline-flex rounded bg-[var(--app-accent-soft)] px-1.5 py-0.5 text-[8px] font-semibold text-[var(--app-accent)]">{selectedRelationship.classification === 'runtime' ? m['code_graph.runtime_relationship']() : selectedRelationship.classification === 'inferred' ? m['code_graph.inferred_relationship']() : m['code_graph.static_relationship']()}</span>
            <strong class="block break-words text-[10px] leading-4">{selectedRelationship.summary}</strong>
            <dl class="mt-2 space-y-1 text-[8px] text-[var(--app-text-muted)]">
              <div><dt>{m['code_graph.provenance']()}</dt><dd class="break-all font-mono text-[var(--app-text)]">{selectedRelationship.provenance.path ?? m['code_graph.index_inference']()}:{selectedRelationship.provenance.line ?? 1}</dd></div>
              <div><dt>{m['code_graph.confidence']()}</dt><dd class="text-[var(--app-text)]">{Math.round(selectedRelationship.provenance.confidence)}%</dd></div>
            </dl>
          </div>
          <div class="grid grid-cols-2 gap-1">
            <Button size="xs" variant="outline" onclick={() => void openSymbol(selectedRelationship!.source.id)}>{m['code_graph.source_symbol']()}</Button>
            <Button size="xs" variant="outline" onclick={() => void openSymbol(selectedRelationship!.target.id)}>{m['code_graph.target_symbol']()}</Button>
          </div>
        {:else if viewMode === 'changes' && changes}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.change_impact']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          {#if changes.scopes.length === 0}
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.no_changes']()}</div>
          {:else}
            <div class="space-y-3">
              {#each changes.scopes as scope (scope.id)}
                <section>
                  <div class="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">
                    <span class="truncate">{scope.kind === 'floor' ? m['code_graph.floor_scope']({ name: scope.name }) : m['code_graph.workspace_scope']()}</span>
                    <span class="ml-auto tabular-nums">{scope.files.length}</span>
                    {#if scope.kind === 'workspace'}
                      <HeaderIconButton
                        label={m['code_graph.create_review']()}
                        class="nodrag grid size-6 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]"
                        side="top"
                        disabled={handoffBusy !== null}
                        onclick={() => void createHandoff('review', scope)}
                      ><GitPullRequestArrow size={12} class={handoffBusy === `review:${scope.id}` ? 'animate-pulse' : undefined} /></HeaderIconButton>
                    {/if}
                    <HeaderIconButton
                      label={m['code_graph.context']()}
                      class="nodrag grid size-6 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]"
                      side="top"
                      onclick={() => void openContext({ scopeId: scope.id })}
                    ><Send size={12} /></HeaderIconButton>
                    <HeaderIconButton
                      label={m['code_graph.create_task']()}
                      class="nodrag grid size-6 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]"
                      side="top"
                      disabled={handoffBusy !== null}
                      onclick={() => void createHandoff('task', scope)}
                    ><ListTodo size={12} class={handoffBusy === `task:${scope.id}` ? 'animate-pulse' : undefined} /></HeaderIconButton>
                  </div>
                  <div class="space-y-1">
                    {#each scope.files.slice(0, 20) as file (`${scope.id}:${file.projectId}:${file.path}`)}
                      <button class="flex w-full min-w-0 items-center gap-2 rounded border border-transparent px-1.5 py-1 text-left hover:border-[var(--app-border)] hover:bg-[var(--app-hover)]" onclick={() => openChangedFile(file)}>
                        <span class="grid size-5 shrink-0 place-items-center rounded bg-[var(--app-canvas)] font-mono text-[9px] text-[var(--app-warning)]">{file.status}</span>
                        <span class="min-w-0 flex-1"><span class="block truncate text-[10px]">{file.path}</span><span class="block truncate text-[8px] text-[var(--app-text-muted)]">{file.projectName} · {file.symbolIds.length} {m['code_graph.symbols']()}</span></span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/each}
              {#if changes.conflicts.length}
                <section class="rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 p-2">
                  <strong class="mb-1 block text-[10px] text-[var(--app-danger)]">{m['code_graph.floor_conflicts']()}</strong>
                  {#each changes.conflicts as conflict (conflict.id)}
                    <div class="border-t border-[var(--app-danger)]/20 py-1.5 first:border-0">
                      <span class="block text-[10px] font-semibold">{conflict.leftFloorName} ↔ {conflict.rightFloorName}</span>
                      <span class="block text-[8px] leading-3 text-[var(--app-text-muted)]">{conflict.sharedPaths.length} {m['code_graph.shared_files']()} · {conflict.sharedImpactSymbolIds.length + conflict.sharedSymbolIds.length} {m['code_graph.shared_symbols']()}</span>
                    </div>
                  {/each}
                </section>
              {/if}
              {#if changes.likelyTests.length}
                <section>
                  <strong class="mb-1 block text-[10px]">{m['code_graph.likely_tests']()}</strong>
                  <div class="space-y-0.5">
                    {#each changes.likelyTests.slice(0, 20) as path (path)}
                      <div class="truncate rounded bg-[var(--app-canvas)] px-2 py-1 font-mono text-[8px] text-[var(--app-text-muted)]">{path}</div>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {/if}
        {:else if viewMode === 'contracts' && contracts}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.contract_map']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-1">
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-emerald-500">{contracts.endpoints.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.endpoints']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-cyan-500">{contracts.requests.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.requests']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-violet-500">{contracts.schemas.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.schemas']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-orange-500">{contracts.gateways.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.gateways']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-[var(--app-success)]">{contracts.matches.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.contract_matches']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-[var(--app-warning)]">{contracts.unmatchedRequestIds.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.unmatched_requests']()}</span></div>
          </div>
          {#if contracts.conflicts.length}
            <section class="mb-3 rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/10 p-2">
              <strong class="mb-1 block text-[10px] text-[var(--app-danger)]">{m['code_graph.contract_conflicts']()}</strong>
              {#each contracts.conflicts.slice(0, 20) as conflict (conflict.id)}
                <div class="border-t border-[var(--app-danger)]/20 py-1.5 first:border-0">
                  <span class="block truncate font-mono text-[9px]">{conflict.method} {conflict.path}</span>
                  <span class="block truncate text-[8px] text-[var(--app-text-muted)]">{conflict.projectNames.join(' · ')}</span>
                </div>
              {/each}
            </section>
          {/if}
          <section>
            <strong class="mb-1 block text-[10px]">{m['code_graph.contract_matches']()}</strong>
            <div class="space-y-1">
              {#each contracts.matches.slice(0, 30) as match (match.id)}
                {@const request = contractSymbol(match.requestSymbolId)}
                {@const endpoint = contractSymbol(match.endpointSymbolId)}
                {#if request && endpoint}
                  <button class="w-full rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 text-left hover:bg-[var(--app-hover)]" onclick={() => void openGraphSymbol(request.id)}>
                    <span class="block truncate font-mono text-[9px]">{request.name}</span>
                    <span class="mt-0.5 block truncate text-[8px] text-[var(--app-text-muted)]">{request.projectName} → {endpoint.projectName} · {match.reason === 'exact' ? m['code_graph.match_exact']() : m['code_graph.match_gateway']()} · {match.confidence}%</span>
                  </button>
                {/if}
              {/each}
            </div>
          </section>
          {#if contracts.unmatchedRequestIds.length}
            <section class="mt-3 border-t border-[var(--app-border)] pt-3">
              <strong class="mb-1 block text-[10px] text-[var(--app-warning)]">{m['code_graph.unmatched_requests']()}</strong>
              <div class="space-y-1">
                {#each contracts.unmatchedRequestIds.slice(0, 30) as symbolId (symbolId)}
                  {@const request = contractSymbol(symbolId)}
                  {#if request}
                    <button class="w-full rounded border border-[var(--app-warning)]/25 bg-[var(--app-warning)]/5 p-2 text-left hover:bg-[var(--app-warning)]/10" onclick={() => void openGraphSymbol(request.id)}>
                      <span class="block truncate font-mono text-[9px]">{request.name}</span>
                      <span class="mt-0.5 block truncate text-[8px] text-[var(--app-text-muted)]">{request.projectName ?? request.projectId}</span>
                    </button>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}
        {:else if viewMode === 'quality' && quality}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.quality_title']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-1">
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-[var(--app-text)]">{quality.counts.findings}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_findings']()}</span></div>
            <div class="rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-2"><strong class="block text-sm text-[var(--app-danger)]">{quality.counts.errors}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_errors']()}</span></div>
            <div class="rounded border border-[var(--app-warning)]/30 bg-[var(--app-warning)]/5 p-2"><strong class="block text-sm text-[var(--app-warning)]">{quality.counts.warnings}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_warnings']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-cyan-500">{quality.counts.duplicates}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_duplicates']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-violet-500">{quality.counts.cycles}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_cycles']()}</span></div>
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm text-orange-500">{quality.counts.deadCode}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.quality_dead_code']()}</span></div>
          </div>
          <section class="mb-3">
            <strong class="mb-1 block text-[10px]">{m['code_graph.data_flow']()}</strong>
            <div class="flex flex-wrap gap-1">
              {#each Object.entries(quality.dataFlow.byType) as [type, count] (type)}
                <span class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] px-1.5 py-1 text-[8px] text-[var(--app-text-muted)]"><strong class="text-[var(--app-text)]">{count}</strong> {resourceTypeLabel(type)}</span>
              {/each}
              {#if Object.keys(quality.dataFlow.byType).length === 0}
                <span class="text-[9px] text-[var(--app-text-muted)]">{m['code_graph.quality_resources_empty']()}</span>
              {/if}
            </div>
          </section>
          <section>
            <strong class="mb-1 block text-[10px]">{m['code_graph.quality_findings']()}</strong>
            {#if quality.findings.length === 0}
              <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.quality_empty']()}</div>
            {:else}
              <div class="space-y-1">
                {#each quality.findings as finding (finding.id)}
                  <div class="flex items-start gap-1 rounded border p-1 {finding.severity === 'error' ? 'border-[var(--app-danger)]/30' : finding.severity === 'warning' ? 'border-[var(--app-warning)]/30' : 'border-[var(--app-border)]'}">
                    <button class="min-w-0 flex-1 rounded p-1 text-left hover:bg-[var(--app-hover)]" onclick={() => finding.symbolIds[0] && void openSymbol(finding.symbolIds[0])}>
                      <span class="flex items-start gap-2">
                        <span class="mt-0.5 size-1.5 shrink-0 rounded-full {finding.severity === 'error' ? 'bg-[var(--app-danger)]' : finding.severity === 'warning' ? 'bg-[var(--app-warning)]' : 'bg-[var(--app-secondary)]'}"></span>
                        <span class="min-w-0 flex-1">
                          <strong class="block text-[9px] leading-3">{findingTitle(finding)}</strong>
                          <span class="mt-0.5 block break-words text-[8px] leading-3 text-[var(--app-text-muted)]">{finding.paths.slice(0, 3).join(' · ') || finding.projectNames.join(' · ')}</span>
                          <span class="mt-0.5 block break-words font-mono text-[8px] leading-3 text-[var(--app-text-muted)]">{findingMetrics(finding)}</span>
                          <span class="mt-1 block text-[8px] font-semibold text-[var(--app-secondary)]">{m['code_graph.quality_confidence']({ confidence: finding.confidence })}</span>
                        </span>
                      </span>
                    </button>
                    <HeaderIconButton label={m['code_graph.context']()} class="grid size-6 shrink-0 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]" side="left" onclick={() => void openContext({ findingId: finding.id })}><Send size={11} /></HeaderIconButton>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {:else if viewMode === 'semantic' && semanticStatus}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.semantic_title']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          <section class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2.5">
            <div class="flex items-center gap-2">
              <span class="grid size-7 place-items-center rounded bg-[var(--app-accent-soft)] text-[var(--app-accent)]"><Sparkles size={14} /></span>
              <div class="min-w-0 flex-1">
                <strong class="block text-[10px]">{semanticStateLabel(semanticStatus.state)}</strong>
                <span class="block truncate text-[8px] text-[var(--app-text-muted)]">{semanticStatus.model}</span>
              </div>
            </div>
            <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-border)]">
              <div class="h-full bg-[var(--app-accent)]" style={`width: ${semanticStatus.totalSymbols ? Math.round((semanticStatus.indexedSymbols / semanticStatus.totalSymbols) * 100) : 0}%`}></div>
            </div>
            <span class="mt-1 block text-[8px] text-[var(--app-text-muted)]">{m['code_graph.semantic_symbols']({ indexed: semanticStatus.indexedSymbols, total: semanticStatus.totalSymbols })}</span>
            <div class="mt-3 grid grid-cols-2 gap-1">
              <Button size="xs" class="w-full" disabled={semanticLoading || !hasIndexedGraph || semanticStatus.totalSymbols === 0} onclick={() => void updateSemantic('build')}>
                <RefreshCw size={11} class={semanticLoading ? 'animate-spin' : undefined} />
                {semanticStatus.state === 'empty' ? m['code_graph.semantic_build']() : m['code_graph.semantic_rebuild']()}
              </Button>
              <Button size="xs" variant="outline" class="w-full" disabled={semanticLoading || semanticStatus.state === 'empty'} onclick={() => void updateSemantic('clear')}>
                <Trash2 size={11} /> {m['code_graph.semantic_clear']()}
              </Button>
            </div>
          </section>
          <p class="mt-2 text-[9px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.semantic_privacy']()}</p>
        {:else if viewMode === 'runtime' && runtime}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.runtime_title']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-1">
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm">{runtime.counts.runs}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.evidence_runs']()}</span></div>
            <div class="rounded border border-emerald-500/30 bg-emerald-500/5 p-2"><strong class="block text-sm text-emerald-500">{runtime.counts.coveredSymbols}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.evidence_covered']()}</span></div>
            <div class="rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-2"><strong class="block text-sm text-[var(--app-danger)]">{runtime.counts.failures}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.evidence_failures']()}</span></div>
            <div class="rounded border border-[var(--app-warning)]/30 bg-[var(--app-warning)]/5 p-2"><strong class="block text-sm text-[var(--app-warning)]">{runtime.counts.runtimeOnlyCalls}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.evidence_runtime_only']()}</span></div>
          </div>
          <form class="mb-3 space-y-1.5 rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2" onsubmit={(event) => { event.preventDefault(); void importEvidence(); }}>
            <strong class="block text-[10px]">{m['code_graph.evidence_import']()}</strong>
            <Select.Root type="single" value={evidenceKind} onValueChange={(value: string) => { evidenceKind = value as typeof evidenceKind; }}>
              <Select.Trigger size="sm" class="w-full">{evidenceKindLabel(evidenceKind)}</Select.Trigger>
              <Select.Content>
                {#each ['auto', 'coverage', 'test', 'trace'] as kind (kind)}
                  <Select.Item value={kind}>{evidenceKindLabel(kind)}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <input
              class="h-8 w-full rounded border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2 font-mono text-[9px] outline-none focus:border-[var(--app-accent)]"
              bind:value={evidencePath}
              placeholder={m['code_graph.evidence_path_placeholder']()}
              aria-label={m['code_graph.evidence_path']()}
            />
            <Button type="submit" size="xs" class="w-full" disabled={evidenceImporting || !evidencePath.trim()}>
              <ArrowDownToLine size={11} class={evidenceImporting ? 'animate-pulse' : undefined} /> {m['code_graph.evidence_import_action']()}
            </Button>
          </form>
          <section>
            <strong class="mb-1 block text-[10px]">{m['code_graph.evidence_recent']()}</strong>
            {#if runtime.runs.length === 0}
              <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-[9px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.evidence_empty']()}</div>
            {:else}
              <div class="space-y-1">
                {#each runtime.runs.slice(0, 50) as run (run.id)}
                  <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2">
                    <span class="flex items-center gap-1.5"><span class="size-1.5 rounded-full {run.kind === 'coverage' ? 'bg-emerald-500' : run.kind === 'test' ? 'bg-[var(--app-danger)]' : 'bg-cyan-500'}"></span><strong class="min-w-0 flex-1 truncate text-[9px]">{run.label}</strong></span>
                    <span class="mt-1 block truncate font-mono text-[8px] text-[var(--app-text-muted)]">{run.projectName}/{run.sourcePath}</span>
                    <span class="mt-1 block text-[8px] text-[var(--app-text-muted)]">{run.stats.coveredSymbols} {m['code_graph.evidence_covered']()} · {run.stats.failures} {m['code_graph.evidence_failures']()} · {run.stats.observedCalls} {m['code_graph.evidence_calls']()}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {:else if viewMode === 'operations' && operations}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.operations_title']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          <div class="mb-3 grid grid-cols-2 gap-1">
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2"><strong class="block text-sm">{activeAgents.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.active_agents']()}</span></div>
            <div class="rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-2"><strong class="block text-sm text-[var(--app-danger)]">{operations.conflicts.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.edit_conflicts']()}</span></div>
          </div>
          {#if operations.conflicts.length}
            <section class="mb-3 space-y-1 rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-2">
              <strong class="block text-[10px] text-[var(--app-danger)]">{m['code_graph.conflict_warning']()}</strong>
              {#each operations.conflicts as conflict (conflict.id)}
                {@const left = operations.agents.find((agent) => agent.nodeId === conflict.leftNodeId)}
                {@const right = operations.agents.find((agent) => agent.nodeId === conflict.rightNodeId)}
                <div class="border-t border-[var(--app-danger)]/20 pt-1.5 text-[8px] first:border-0 first:pt-0">
                  <strong class="block text-[var(--app-text)]">{left?.title} ↔ {right?.title}</strong>
                  <span class="block break-words text-[var(--app-text-muted)]">{conflict.sharedPaths.slice(0, 3).join(' · ') || m['code_graph.shared_symbols_count']({ count: conflict.sharedSymbolIds.length })}</span>
                </div>
              {/each}
            </section>
          {/if}
          <section class="space-y-1">
            {#each activeAgents as agent (agent.nodeId)}
              {@const agentIndex = operations.agents.findIndex((candidate) => candidate.nodeId === agent.nodeId)}
              <button class="w-full rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 text-left hover:bg-[var(--app-hover)]" onclick={() => data.onJumpToNode?.(agent.nodeId)}>
                <span class="flex items-center gap-1.5"><span class="size-2 rounded-full ring-1 ring-black/10" style={`background:${AGENT_COLORS[Math.max(0, agentIndex) % AGENT_COLORS.length]}`}></span><strong class="min-w-0 flex-1 truncate text-[9px]">{agent.title}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{agentStateLabel(agent.state)}</span></span>
                <span class="mt-1 block truncate text-[8px] text-[var(--app-text-muted)]">{agent.task?.title ?? m['code_graph.no_active_task']()} · {agent.floorName ?? m['code_graph.main_workspace']()}</span>
                <span class="mt-1 block text-[8px] text-[var(--app-secondary)]">{m['code_graph.active_symbols_count']({ count: agent.symbolIds.length })}</span>
              </button>
            {/each}
          </section>
        {:else if viewMode === 'compare'}
          <div class="mb-2 flex items-center justify-between gap-2">
            <strong class="text-xs">{m['code_graph.compare_title']()}</strong>
            <button class="text-[9px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>{m['code_graph.overview']()}</button>
          </div>
          {#if revisions.length < 2}
            <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 text-[9px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.compare_empty']()}</div>
          {:else}
            <div class="mb-3 space-y-1.5">
              <Select.Root type="single" value={compareFrom} onValueChange={(value: string) => { compareFrom = value; void compareRevisions(projectId); }}>
                <Select.Trigger size="sm" class="w-full">{revisionLabel(compareFrom, m['code_graph.compare_from']())}</Select.Trigger>
                <Select.Content>{#each revisions as revision (revision.id)}<Select.Item value={revision.id} disabled={revision.id === compareTo}>#{revision.sequence} · {revision.gitHead?.slice(0, 8) ?? revision.sourceHash.slice(0, 8)}</Select.Item>{/each}</Select.Content>
              </Select.Root>
              <Select.Root type="single" value={compareTo} onValueChange={(value: string) => { compareTo = value; void compareRevisions(projectId); }}>
                <Select.Trigger size="sm" class="w-full">{revisionLabel(compareTo, m['code_graph.compare_to']())}</Select.Trigger>
                <Select.Content>{#each revisions as revision (revision.id)}<Select.Item value={revision.id} disabled={revision.id === compareFrom}>#{revision.sequence} · {revision.gitHead?.slice(0, 8) ?? revision.sourceHash.slice(0, 8)}</Select.Item>{/each}</Select.Content>
              </Select.Root>
            </div>
            {#if comparison}
              <div class="mb-3 grid grid-cols-3 gap-1">
                <div class="rounded border border-emerald-500/30 bg-emerald-500/5 p-2"><strong class="block text-sm text-emerald-500">+{comparison.added.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.comparison_added']()}</span></div>
                <div class="rounded border border-[var(--app-warning)]/30 bg-[var(--app-warning)]/5 p-2"><strong class="block text-sm text-[var(--app-warning)]">~{comparison.modified.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.comparison_modified']()}</span></div>
                <div class="rounded border border-[var(--app-danger)]/30 bg-[var(--app-danger)]/5 p-2"><strong class="block text-sm text-[var(--app-danger)]">-{comparison.removed.length}</strong><span class="text-[8px] text-[var(--app-text-muted)]">{m['code_graph.comparison_removed']()}</span></div>
              </div>
              <div class="mb-3 rounded border border-[var(--app-border)] bg-[var(--app-canvas)] px-2 py-1.5 text-[8px] text-[var(--app-text-muted)]">
                {m['code_graph.relationship_changes']({ added: comparison.relationships.added.length, modified: comparison.relationships.modified.length, removed: comparison.relationships.removed.length })}
              </div>
              <div class="space-y-1">
                {#each [...comparison.added.map((symbol) => ({ symbol, state: 'added' })), ...comparison.modified.map((item) => ({ symbol: item.after, state: 'modified' })), ...comparison.removed.map((symbol) => ({ symbol, state: 'removed' }))].slice(0, 80) as item (`${item.state}:${item.symbol.fingerprint}`)}
                  <div class="rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2">
                    <span class="block truncate text-[9px] font-semibold">{item.symbol.name}</span>
                    <span class="block truncate font-mono text-[8px] text-[var(--app-text-muted)]">{comparisonStateLabel(item.state)} · {item.symbol.path ?? item.symbol.qualifiedName}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {:else if results.length}
          <div class="mb-2 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['code_graph.search_results']()}</div>
          <div class="space-y-1">
            {#each results as result (result.id)}
              <button class="w-full rounded border border-transparent p-2 text-left hover:border-[var(--app-border)] hover:bg-[var(--app-hover)]" onclick={() => void openSymbol(result.id)}>
                <span class="block truncate text-[11px] font-semibold">{result.name}</span>
                <span class="block truncate text-[9px] text-[var(--app-text-muted)]">{symbolKind(result.kind)} · {result.path ?? result.projectName}</span>
                {#if searchMode === 'semantic'}
                  {@const semantic = semanticMatches.find((match) => match.symbol.id === result.id)}
                  {#if semantic}<span class="mt-1 block text-[8px] font-semibold text-[var(--app-accent)]">{m['code_graph.semantic_score']({ score: semantic.score })}</span>{/if}
                {/if}
              </button>
            {/each}
          </div>
        {:else if selectedSymbol}
          <button class="mb-2 inline-flex items-center gap-1 text-[10px] text-[var(--app-secondary)] hover:underline" onclick={() => void loadOverview()}>
            <ArrowUpFromLine size={11} /> {m['code_graph.overview']()}
          </button>
          <div class="mb-3 flex items-start gap-2">
            {#if selectedSymbol.kind === 'module'}<FileCode2 size={16} class="mt-0.5 shrink-0 text-sky-500" />{:else if selectedSymbol.kind === 'class' || selectedSymbol.kind === 'interface'}<Box size={16} class="mt-0.5 shrink-0 text-violet-500" />{:else}<Braces size={16} class="mt-0.5 shrink-0 text-emerald-500" />{/if}
            <div class="min-w-0"><strong class="block break-words text-xs">{selectedSymbol.name}</strong><span class="block break-words text-[9px] text-[var(--app-text-muted)]">{symbolKind(selectedSymbol.kind)}</span></div>
          </div>
          <dl class="space-y-2 text-[10px]">
            <div><dt class="text-[var(--app-text-muted)]">{m['code_graph.qualified_name']()}</dt><dd class="mt-0.5 break-all font-mono">{selectedSymbol.qualifiedName}</dd></div>
            {#if selectedSymbol.path}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.location']()}</dt><dd class="mt-0.5 break-all font-mono">{selectedSymbol.projectName}/{selectedSymbol.path}:{selectedSymbol.startLine ?? 1}</dd></div>{/if}
            {#if selectedSymbol.signature}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.signature']()}</dt><dd class="mt-0.5 break-words font-mono leading-4">{selectedSymbol.signature}</dd></div>{/if}
            {#if selectedSymbol.documentation}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.documentation']()}</dt><dd class="mt-0.5 break-words leading-4">{selectedSymbol.documentation}</dd></div>{/if}
          </dl>
          {#if selectedSymbol.path}
            <div class="mt-3 grid grid-cols-2 gap-1">
              <Button size="xs" variant="outline" class="w-full" onclick={openSource}>
                <ExternalLink size={11} /> {m['code_graph.open_source']()}
              </Button>
              <Button size="xs" variant="outline" class="w-full" onclick={() => void openContext({ symbolIds: [selectedSymbol!.id] })}>
                <Send size={11} /> {m['code_graph.context']()}
              </Button>
            </div>
          {/if}
          {#if selectedSymbol.revisionId === 'live' && typeof selectedSymbol.metadata.nodeId === 'string'}
            <Button size="xs" variant="outline" class="mt-3 w-full" onclick={() => openApiClient(selectedSymbol!)}>
              <ExternalLink size={11} /> {m['code_graph.open_api_client']()}
            </Button>
          {/if}
          {#if selectedSymbol.revisionId !== 'live'}
          <div class="mt-3 border-t border-[var(--app-border)] pt-2">
            <span class="mb-1 block text-[9px] font-semibold text-[var(--app-text-muted)]">{m['code_graph.direction']()}</span>
            <div class="grid grid-cols-3 rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-0.5">
              {#each ['incoming', 'both', 'outgoing'] as value}
                <button class="rounded px-1 py-1 text-[9px]" class:bg-[var(--app-surface-raised)]={direction === value} class:text-[var(--app-secondary)]={direction === value} onclick={() => { direction = value as typeof direction; void openSymbol(selectedSymbol!.id); }}>{value === 'incoming' ? m['code_graph.incoming']() : value === 'outgoing' ? m['code_graph.outgoing']() : m['code_graph.both']()}</button>
              {/each}
            </div>
            <label class="mt-2 block text-[9px] text-[var(--app-text-muted)]">
              {m['code_graph.depth']({ depth })}
              <input class="mt-1 w-full accent-[var(--app-accent)]" type="range" min="1" max="4" bind:value={depth} onchange={() => void openSymbol(selectedSymbol!.id)} />
            </label>
          </div>
          {/if}
        {:else}
          <div class="space-y-2">
            <strong class="text-xs">{m['code_graph.repositories']()}</strong>
            {#each snapshot?.projects ?? [] as project (project.id)}
              <button class="w-full rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 text-left hover:bg-[var(--app-hover)]" onclick={() => void changeProject(project.id)}>
                <span class="flex items-center justify-between gap-2"><strong class="min-w-0 truncate text-[10px]">{project.name}</strong><span class="text-[9px] text-[var(--app-text-muted)]">{projectStatus(project)}</span></span>
                <span class="mt-1 block text-[9px] text-[var(--app-text-muted)]">{project.stats.files} {m['code_graph.files']()} · {project.stats.symbols} {m['code_graph.symbols']()}</span>
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    </div>
  </div>
</NodeShell>

<Dialog.Root bind:open={investigationsOpen}>
  <Dialog.Content class="flex max-h-[min(760px,88vh)] flex-col gap-0 overflow-hidden overscroll-contain p-0 sm:max-w-[min(720px,92vw)]">
    <Dialog.Header class="border-b border-[var(--app-border)] px-5 py-4 pr-12">
      <Dialog.Title>{m['code_graph.investigations_title']()}</Dialog.Title>
      <Dialog.Description>{m['code_graph.investigations_description']()}</Dialog.Description>
    </Dialog.Header>
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_220px] max-[620px]:grid-cols-1">
      <div class="min-h-0 overflow-y-auto p-4">
        <div class="mb-2 flex gap-2">
          <Input bind:value={investigationName} maxlength={120} placeholder={m['code_graph.investigation_name']()} />
          <Button disabled={investigationBusy || !investigationName.trim()} onclick={() => void saveInvestigation()}><Bookmark size={14} /> {m['code_graph.save']()}</Button>
        </div>
        <p class="text-[10px] leading-4 text-[var(--app-text-muted)]">{m['code_graph.investigation_current_state']()}</p>
      </div>
      <aside class="min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3 max-[620px]:max-h-64 max-[620px]:border-t max-[620px]:border-l-0">
        <strong class="mb-2 block text-[10px] uppercase text-[var(--app-text-muted)]">{m['code_graph.saved_investigations']()}</strong>
        <div class="space-y-1">
          {#each investigations as item (item.id)}
            <div class="flex items-center gap-1 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
              <button class="min-w-0 flex-1 rounded px-1.5 py-1 text-left hover:bg-[var(--app-hover)]" onclick={() => void restoreInvestigation(item)}>
                <strong class="block truncate text-[10px]">{item.name}</strong>
                <span class="block truncate text-[8px] text-[var(--app-text-muted)]">{viewModeLabel(item.state.viewMode)} · {new Date(item.updatedAt).toLocaleString(localeState.current)}</span>
              </button>
              <HeaderIconButton label={m['settings.delete']()} class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger)]/10 hover:text-[var(--app-danger)]" side="left" onclick={() => { pendingInvestigationDelete = item; }}><Trash2 size={12} /></HeaderIconButton>
            </div>
          {:else}
            <p class="py-4 text-center text-[9px] text-[var(--app-text-muted)]">{m['code_graph.investigations_empty']()}</p>
          {/each}
        </div>
      </aside>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={contextOpen}>
  <Dialog.Content class="flex max-h-[min(820px,92vh)] min-h-[min(620px,86vh)] flex-col gap-0 overflow-hidden overscroll-contain p-0 sm:max-w-[min(1040px,94vw)]">
    <Dialog.Header class="border-b border-[var(--app-border)] px-5 py-4 pr-12">
      <Dialog.Title>{m['code_graph.context_title']()}</Dialog.Title>
      <Dialog.Description>{m['code_graph.context_description']()}</Dialog.Description>
    </Dialog.Header>
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[760px]:grid-cols-1">
      <div class="min-h-0 overflow-auto bg-[var(--app-canvas)] p-4">
        {#if contextBusy && !contextPackage}
          <div class="grid h-full place-items-center"><RefreshCw size={20} class="animate-spin text-[var(--app-accent)]" /></div>
        {:else if contextPackage}
          <div class="mb-3 flex flex-wrap gap-1.5 text-[9px] text-[var(--app-text-muted)]">
            <span class="rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1">{m['code_graph.context_tokens']({ used: contextPackage.estimatedTokens, max: contextPackage.maxTokens })}</span>
            <span class="rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1">{m['code_graph.context_symbols']({ count: contextPackage.symbols.length })}</span>
            <span class="rounded border border-[var(--app-border)] bg-[var(--app-surface)] px-2 py-1">{m['code_graph.context_relationships']({ count: contextPackage.relationships.length })}</span>
            {#if contextPackage.truncated}<span class="rounded border border-[var(--app-warning)]/30 bg-[var(--app-warning)]/5 px-2 py-1 text-[var(--app-warning)]">{m['code_graph.truncated']()}</span>{/if}
          </div>
          <pre class="whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-[var(--app-text)]">{contextPackage.markdown}</pre>
        {/if}
      </div>
      <aside class="min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface)] p-4 max-[760px]:border-t max-[760px]:border-l-0">
        <div class="space-y-4">
          <label class="block"><span class="mb-1.5 block text-[10px] font-medium">{m['code_graph.context_purpose']()}</span>
            <Select.Root type="single" value={contextPurpose} onValueChange={(value: string) => { contextPurpose = value as CodeGraphContextPurpose; void buildContext(); }}>
              <Select.Trigger class="w-full">{purposeLabel(contextPurpose)}</Select.Trigger>
              <Select.Content>
                <Select.Item value="investigate">{m['code_graph.purpose_investigate']()}</Select.Item>
                <Select.Item value="implement">{m['code_graph.purpose_implement']()}</Select.Item>
                <Select.Item value="review">{m['code_graph.purpose_review']()}</Select.Item>
                <Select.Item value="test">{m['code_graph.purpose_test']()}</Select.Item>
              </Select.Content>
            </Select.Root>
          </label>
          <label class="block"><span class="mb-1.5 block text-[10px] font-medium">{m['code_graph.token_budget']()}</span><Input type="number" min="500" max="16000" step="500" bind:value={contextTokens} onblur={() => void buildContext()} /></label>
          <div>
            <span class="mb-1.5 block text-[10px] font-medium">{m['code_graph.send_to']()}</span>
            <div class="grid grid-cols-2 gap-1">
              {#each ['leader', 'agent', 'council', 'task'] as target (target)}
                <Button size="xs" variant={contextHandoff === target ? 'secondary' : 'outline'} onclick={() => { contextHandoff = target as typeof contextHandoff; }}>{target === 'leader' ? m['code_graph.leader']() : target === 'agent' ? m['code_graph.agent']() : target === 'council' ? m['code_graph.council']() : m['code_graph.task']()}</Button>
              {/each}
            </div>
          </div>
          {#if contextHandoff === 'agent'}
            <label class="block"><span class="mb-1.5 block text-[10px] font-medium">{m['code_graph.target_agent']()}</span>
              <Select.Root type="single" value={contextTarget} onValueChange={(value: string) => { contextTarget = value; }}>
                <Select.Trigger class="w-full">{activeAgents.find((agent) => agent.nodeId === contextTarget)?.title ?? m['code_graph.select_agent']()}</Select.Trigger>
                <Select.Content>{#each activeAgents as agent (agent.nodeId)}<Select.Item value={agent.nodeId}>{agent.title}</Select.Item>{/each}</Select.Content>
              </Select.Root>
            </label>
          {:else if contextHandoff === 'council'}
            <div><span class="mb-1.5 block text-[10px] font-medium">{m['code_graph.council_agents']()}</span>
              <div class="space-y-1">
                {#each activeAgents as agent (agent.nodeId)}
                  <label class="flex min-h-8 items-center gap-2 rounded border border-[var(--app-border)] px-2 text-[10px] hover:bg-[var(--app-hover)]"><Checkbox checked={councilTargets.includes(agent.nodeId)} disabled={!councilTargets.includes(agent.nodeId) && councilTargets.length >= 5} onCheckedChange={(checked: boolean | 'indeterminate') => { councilTargets = checked === true ? [...councilTargets, agent.nodeId] : councilTargets.filter((id) => id !== agent.nodeId); }} /><span class="truncate">{agent.title}</span></label>
                {/each}
              </div>
            </div>
          {/if}
          <Button variant="outline" class="w-full" disabled={contextBusy} onclick={() => void buildContext()}><RefreshCw size={14} class={contextBusy ? 'animate-spin' : undefined} /> {m['code_graph.rebuild_context']()}</Button>
          <Button class="w-full" disabled={contextBusy || !contextPackage || (contextHandoff === 'agent' && !contextTarget) || (contextHandoff === 'council' && councilTargets.length < 2)} onclick={() => void handoffContext()}><Send size={14} /> {m['code_graph.send_context']()}</Button>
        </div>
      </aside>
    </div>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={Boolean(pendingInvestigationDelete)} onOpenChange={(open) => !open && (pendingInvestigationDelete = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['code_graph.delete_investigation_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['code_graph.delete_investigation_description']({ name: pendingInvestigationDelete?.name ?? '' })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['automation.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-[var(--app-danger)] text-white hover:opacity-90" onclick={() => { if (pendingInvestigationDelete) void deleteInvestigation(pendingInvestigationDelete); pendingInvestigationDelete = null; }}>{m['settings.delete']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
