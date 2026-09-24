<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    AlertTriangle,
    Activity,
    ArrowDownToLine,
    ArrowLeft,
    ArrowRight,
    ArrowDownLeft,
    ArrowLeftRight,
    ArrowUpRight,
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
    Layers,
    LoaderCircle,
    DatabaseZap,
    SearchX,
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
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Input } from '$lib/components/ui/input';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Button } from '$lib/components/ui/button';
  import { Slider } from '$lib/components/ui/slider';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
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
    codeIntelligenceMode: 'assisted' | 'manual' | 'disabled';
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
  let sessionStateReady = $state(false);
  let restoredSymbolId: string | null = null;
  let restoredViewMode: CodeGraphInvestigationState['viewMode'] = 'overview';
  let graphHost: HTMLDivElement;
  type CameraState = { x: number; y: number; ratio: number; angle: number };
  type GraphRenderer = {
    kill: () => void;
    resize: (force?: boolean) => GraphRenderer;
    refresh: (options?: { schedule?: boolean; skipIndexation?: boolean }) => GraphRenderer;
    scheduleRender: () => GraphRenderer;
    getNodeDisplayData: (nodeId: string) => { x: number; y: number; size: number } | undefined;
    getCamera: () => {
      getState: () => CameraState;
      setState: (state: CameraState) => void;
      animate: (state: Partial<CameraState>, options?: { duration?: number; easing?: string }) => Promise<void>;
      on: (event: 'updated', callback: (state: CameraState) => void) => void;
    };
  };
  type GraphPointerEvent = {
    node?: string;
    edge?: string;
    preventSigmaDefault: () => void;
  };
  type GraphFocusStrength = 'soft' | 'strong';
  type CodeGraphSessionState = {
    projectId: string;
    viewMode: CodeGraphInvestigationState['viewMode'];
    query: string;
    searchMode: 'lexical' | 'semantic';
    selectedSymbolId: string | null;
    direction: 'incoming' | 'outgoing' | 'both';
    depth: number;
  };
  let renderer: GraphRenderer | null = null;
  let cameraState = $state<CameraState | null>(null);
  let renderSequence = 0;
  let graphViewportMetrics = { width: 1, height: 1, outerScale: 1 };
  let requestedGraphFocus: { symbolId: string; strength: GraphFocusStrength } | null = null;
  let openSymbolTimer: ReturnType<typeof setTimeout> | null = null;
  let previousIntelligenceMode: CodeGraphNodeData['codeIntelligenceMode'] | null = null;
  const AGENT_COLORS = ['#22c55e', '#0ea5e9', '#f97316', '#a855f7', '#ec4899', '#14b8a6', '#eab308', '#ef4444'];

  const currentProject = $derived(snapshot?.projects.find((project) => project.id === projectId) ?? null);
  const hasIndexedGraph = $derived(Boolean(snapshot?.projects.some((project) => project.currentRevisionId)));
  const changedFileCount = $derived(changes?.scopes.reduce((total, scope) => total + scope.files.length, 0) ?? 0);
  const activeAgents = $derived(operations?.agents.filter((agent) => agent.state !== 'disconnected') ?? []);
  const trackedAgents = $derived(
    operations?.agents.filter((agent) => agent.state !== 'disconnected' || Boolean(agent.task)) ?? [],
  );
  const intelligenceDisabled = $derived(data.codeIntelligenceMode === 'disabled');

  $effect(() => {
    const nextMode = data.codeIntelligenceMode;
    if (previousIntelligenceMode === null) {
      previousIntelligenceMode = nextMode;
      return;
    }
    if (nextMode === previousIntelligenceMode) return;
    const wasDisabled = previousIntelligenceMode === 'disabled';
    previousIntelligenceMode = nextMode;
    if (nextMode === 'disabled') {
      snapshot = null;
      graph = null;
      error = '';
      void renderGraph(null);
    } else if (wasDisabled) {
      void load();
    }
  });

  $effect(() => {
    if (!sessionStateReady || typeof sessionStorage === 'undefined') return;
    const state: CodeGraphSessionState = {
      projectId,
      viewMode,
      query,
      searchMode,
      selectedSymbolId: selectedSymbol?.id ?? null,
      direction,
      depth,
    };
    sessionStorage.setItem(`orkestrai:code-graph-state:${data.workspaceId}:${id}`, JSON.stringify(state));
  });

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

  function projectScopeLabel(project: CodeGraphProject | null): string {
    if (!project) return m['code_graph.all_repositories']();
    if (project.relativePath === '.') return m['code_graph.main_repository']({ name: project.name });
    return project.relativePath?.startsWith('@') ? project.relativePath : project.name;
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

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  }

  function measureGraphViewport(): void {
    const bounds = graphHost.getBoundingClientRect();
    const width = Math.max(1, graphHost.offsetWidth);
    const height = Math.max(1, graphHost.offsetHeight);
    graphViewportMetrics = {
      width,
      height,
      outerScale: bounds.width ? Math.max(0.35, Math.min(4, bounds.width / width)) : 1,
    };
  }

  function focusGraphSymbol(
    targetRenderer: GraphRenderer,
    symbolId: string,
    strength: GraphFocusStrength = 'soft',
  ): void {
    const displayData = targetRenderer.getNodeDisplayData(symbolId);
    if (!displayData) return;
    const camera = targetRenderer.getCamera();
    const current = camera.getState();
    const targetRatio = Math.min(current.ratio, strength === 'strong' ? 0.32 : 0.64);
    graphHost.dataset.focusedSymbol = symbolId;
    void camera.animate(
      { x: displayData.x, y: displayData.y, ratio: targetRatio },
      { duration: prefersReducedMotion() ? 0 : strength === 'strong' ? 320 : 220, easing: 'quadraticInOut' },
    );
  }

  async function renderGraph(
    next: CodeGraphSubgraph | null,
    focusSymbolId?: string,
    focusStrength: GraphFocusStrength = 'soft',
  ): Promise<void> {
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
    let focusedSymbolId = focusSymbolId ?? next.centerSymbolId ?? null;
    for (const node of next.nodes) {
      const key = comparisonKey(node);
      model.addNode(node.id, {
        label: node.name,
        x: stablePosition(node.id, 0),
        y: stablePosition(node.id, 1),
        size: changed.has(node.id) || node.id === next.centerSymbolId ? 14 : node.kind === 'module' ? 11 : 9,
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
    const hoverBackground = getComputedStyle(graphHost).getPropertyValue('--app-surface-raised').trim() || '#18181b';
    const hoverBorder = getComputedStyle(graphHost).getPropertyValue('--app-border').trim() || '#3f3f46';
    const accentColor = getComputedStyle(graphHost).getPropertyValue('--app-secondary').trim() || '#0ea5e9';
    measureGraphViewport();
    const sigma = new Sigma(model, graphHost, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      labelColor: { color: labelColor },
      labelSize: 12,
      labelWeight: '600',
      labelDensity: 0.16,
      labelGridCellSize: 110,
      labelRenderedSizeThreshold: 6,
      enableEdgeEvents: true,
      nodeReducer: (node, attributes) => node === focusedSymbolId
        ? { ...attributes, highlighted: true, forceLabel: true, size: Math.max(Number(attributes.size ?? 0), 14) }
        : attributes,
      defaultDrawNodeLabel: (context, displayData, settings) => {
        const label = String(displayData.label ?? '');
        if (!label) return;
        const scale = graphViewportMetrics.outerScale;
        const fontSize = Math.min(30, Math.max(settings.labelSize, 12 / scale));
        const offset = Math.max(5, 6 / scale);
        context.save();
        context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
        context.textBaseline = 'middle';
        context.lineJoin = 'round';
        context.strokeStyle = hoverBackground;
        context.lineWidth = Math.max(2.5, 3 / scale);
        context.strokeText(label, displayData.x + displayData.size + offset, displayData.y);
        context.fillStyle = labelColor;
        context.fillText(label, displayData.x + displayData.size + offset, displayData.y);
        context.restore();
      },
      defaultDrawNodeHover: (context, displayData, settings) => {
        const fullLabel = String(displayData.label ?? '');
        const scale = graphViewportMetrics.outerScale;
        const fontSize = Math.min(32, Math.max(14, 14 / scale));
        const paddingX = Math.max(8, 8 / scale);
        const paddingY = Math.max(6, 6 / scale);
        const gap = Math.max(8, 8 / scale);
        context.save();
        context.font = `${settings.labelWeight} ${fontSize}px ${settings.labelFont}`;
        const maxTextWidth = Math.max(120, graphViewportMetrics.width * 0.72 - paddingX * 2);
        let label = fullLabel;
        if (context.measureText(label).width > maxTextWidth) {
          let lower = 0;
          let upper = fullLabel.length;
          while (lower < upper) {
            const middle = Math.ceil((lower + upper) / 2);
            if (context.measureText(`${fullLabel.slice(0, middle)}...`).width <= maxTextWidth) lower = middle;
            else upper = middle - 1;
          }
          label = `${fullLabel.slice(0, lower)}...`;
        }
        const textWidth = Math.ceil(context.measureText(label).width);
        const boxWidth = textWidth + paddingX * 2;
        const boxHeight = fontSize + paddingY * 2;
        const preferredX = displayData.x + displayData.size + gap;
        const x = preferredX + boxWidth <= graphViewportMetrics.width - paddingX
          ? preferredX
          : displayData.x - displayData.size - gap - boxWidth;
        const y = Math.max(paddingY, Math.min(graphViewportMetrics.height - boxHeight - paddingY, displayData.y - boxHeight / 2));
        context.beginPath();
        context.arc(displayData.x, displayData.y, displayData.size + Math.max(3, 3 / scale), 0, Math.PI * 2);
        context.strokeStyle = accentColor;
        context.lineWidth = Math.max(2, 2 / scale);
        context.stroke();
        context.fillStyle = hoverBackground;
        context.strokeStyle = hoverBorder;
        context.lineWidth = Math.max(1, 1 / scale);
        context.fillRect(x, y, boxWidth, boxHeight);
        context.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
        context.fillStyle = labelColor;
        context.textBaseline = 'middle';
        context.fillText(label, x + paddingX, y + boxHeight / 2);
        context.restore();
      },
      minCameraRatio: 0.08,
      maxCameraRatio: 8,
    });
    sigma.on('clickNode', ({ node, preventSigmaDefault }: GraphPointerEvent & { node: string }) => {
      preventSigmaDefault();
      focusedSymbolId = node;
      requestedGraphFocus = { symbolId: node, strength: 'soft' };
      sigma.refresh({ schedule: true });
      focusGraphSymbol(sigma as GraphRenderer, node);
      if (openSymbolTimer) clearTimeout(openSymbolTimer);
      openSymbolTimer = setTimeout(() => {
        openSymbolTimer = null;
        void openGraphSymbol(node);
      }, 180);
    });
    sigma.on('doubleClickNode', ({ node, preventSigmaDefault }: GraphPointerEvent & { node: string }) => {
      preventSigmaDefault();
      focusedSymbolId = node;
      requestedGraphFocus = { symbolId: node, strength: 'strong' };
      if (openSymbolTimer) clearTimeout(openSymbolTimer);
      openSymbolTimer = null;
      sigma.refresh({ schedule: true });
      focusGraphSymbol(sigma as GraphRenderer, node, 'strong');
      void openGraphSymbol(node);
    });
    sigma.on('doubleClickEdge', ({ preventSigmaDefault }: GraphPointerEvent) => preventSigmaDefault());
    sigma.on('doubleClickStage', ({ preventSigmaDefault }: GraphPointerEvent) => preventSigmaDefault());
    sigma.on('clickEdge', ({ edge }: { edge: string }) => void openRelationship(edge));
    sigma.on('enterNode', ({ node }: { node: string }) => {
      graphHost.dataset.hoveredSymbol = node;
      graphHost.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      delete graphHost.dataset.hoveredSymbol;
      graphHost.style.cursor = '';
    });
    sigma.on('enterEdge', () => { graphHost.style.cursor = 'pointer'; });
    sigma.on('leaveEdge', () => { graphHost.style.cursor = ''; });
    if (cameraState) sigma.getCamera().setState(cameraState);
    sigma.getCamera().on('updated', (state: CameraState) => {
      cameraState = state;
      sessionStorage.setItem(`orkestrai:code-graph-camera:${data.workspaceId}:${id}`, JSON.stringify(state));
    });
    renderer = sigma as GraphRenderer;
    if (focusedSymbolId) focusGraphSymbol(renderer, focusedSymbolId, focusStrength);
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
    if (state === 'stale') return data.codeIntelligenceMode === 'assisted'
      ? m['code_graph.semantic_updating']()
      : m['code_graph.semantic_stale']();
    return data.codeIntelligenceMode === 'assisted'
      ? m['code_graph.semantic_preparing']()
      : m['code_graph.semantic_empty']();
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
    if (intelligenceDisabled) {
      snapshot = null;
      graph = null;
      await renderGraph(null);
      loading = false;
      return;
    }
    try {
      await loadStatus();
      if (hasIndexedGraph) {
        if (restoredSymbolId) {
          const symbolId = restoredSymbolId;
          restoredSymbolId = null;
          await openSymbol(symbolId);
        } else if (restoredViewMode === 'changes') await loadChanges();
        else if (restoredViewMode === 'contracts') await loadContracts();
        else if (restoredViewMode === 'quality') await loadQuality();
        else if (restoredViewMode === 'semantic') await loadSemantic();
        else if (restoredViewMode === 'runtime') await loadRuntime();
        else if (restoredViewMode === 'operations') await loadOperations();
        else if (restoredViewMode === 'compare') await loadComparison();
        else if (query.trim()) await searchSymbols();
        else await loadOverview();
        restoredViewMode = 'overview';
      }
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

  async function toggleSearchMode(): Promise<void> {
    if (searchMode === 'semantic') {
      searchMode = 'lexical';
      if (query.trim()) await searchSymbols();
      return;
    }
    semanticLoading = true;
    error = '';
    try {
      const status = await api<CodeGraphSemanticStatus>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/semantic`);
      semanticStatus = status;
      if (status.state !== 'ready') {
        viewMode = 'semantic';
        selectedSymbol = null;
        results = [];
        semanticMatches = [];
        toast.info(m['code_graph.semantic_build_required']());
        return;
      }
      searchMode = 'semantic';
      if (query.trim()) await searchSymbols();
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.semantic_error']();
      toast.error(error);
    } finally {
      semanticLoading = false;
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
      const focusStrength = requestedGraphFocus?.symbolId === symbolId
        ? requestedGraphFocus.strength
        : 'soft';
      await renderGraph(nextGraph, symbolId, focusStrength);
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
    let graphResizeFrame: number | null = null;
    let socket: WebSocket | null = null;
    const synchronizeGraphViewport = () => {
      if (graphResizeFrame !== null) return;
      graphResizeFrame = requestAnimationFrame(() => {
        graphResizeFrame = null;
        if (destroyed || !renderer) return;
        measureGraphViewport();
        // Sigma owns separate visible and picking buffers. Keep both aligned
        // with the resizable and CSS-scaled node before the next interaction.
        renderer.resize(true).scheduleRender();
      });
    };
    const graphResizeObserver = new ResizeObserver(synchronizeGraphViewport);
    graphResizeObserver.observe(graphHost);
    const flowViewport = graphHost.closest('.svelte-flow__viewport');
    const graphScaleObserver = new MutationObserver(synchronizeGraphViewport);
    if (flowViewport) graphScaleObserver.observe(flowViewport, { attributes: true, attributeFilter: ['style'] });
    const storedCamera = sessionStorage.getItem(`orkestrai:code-graph-camera:${data.workspaceId}:${id}`);
    if (storedCamera) {
      try { cameraState = JSON.parse(storedCamera) as CameraState; } catch { /* ignore invalid session state */ }
    }
    const storedState = sessionStorage.getItem(`orkestrai:code-graph-state:${data.workspaceId}:${id}`);
    if (storedState) {
      try {
        const state = JSON.parse(storedState) as Partial<CodeGraphSessionState>;
        if (typeof state.projectId === 'string') projectId = state.projectId;
        if (typeof state.query === 'string') query = state.query.slice(0, 120);
        if (state.searchMode === 'lexical' || state.searchMode === 'semantic') searchMode = state.searchMode;
        if (typeof state.selectedSymbolId === 'string') restoredSymbolId = state.selectedSymbolId;
        if (state.direction === 'incoming' || state.direction === 'outgoing' || state.direction === 'both') direction = state.direction;
        if (typeof state.depth === 'number' && Number.isInteger(state.depth) && state.depth >= 1 && state.depth <= 4) depth = state.depth;
        if (['overview', 'changes', 'contracts', 'quality', 'semantic', 'runtime', 'operations', 'compare'].includes(state.viewMode ?? '')) {
          restoredViewMode = state.viewMode!;
        }
      } catch {
        sessionStorage.removeItem(`orkestrai:code-graph-state:${data.workspaceId}:${id}`);
      }
    }
    sessionStateReady = true;
    let editorLocateTimer: ReturnType<typeof setTimeout> | null = null;
    const handleEditorLocation = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId?: string; path?: string; line?: number }>).detail;
      if (detail?.workspaceId !== data.workspaceId || !detail.path || !detail.line) return;
      if (editorLocateTimer) clearTimeout(editorLocateTimer);
      if (openSymbolTimer) clearTimeout(openSymbolTimer);
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
    if (!intelligenceDisabled) void load();
    return () => {
      destroyed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (liveRefreshTimer) clearTimeout(liveRefreshTimer);
      if (editorLocateTimer) clearTimeout(editorLocateTimer);
      if (graphResizeFrame !== null) cancelAnimationFrame(graphResizeFrame);
      graphResizeObserver.disconnect();
      graphScaleObserver.disconnect();
      window.removeEventListener('orkestrai:editor-location', handleEditorLocation);
      socket?.close();
      renderSequence += 1;
      renderer?.kill();
    };
  });
</script>

{#snippet indexAction()}
  <Button
    size="sm"
    class="bg-[var(--app-accent)] text-[var(--app-accent-contrast)] hover:bg-[var(--app-accent)] hover:brightness-105"
    disabled={indexing || intelligenceDisabled}
    onclick={() => void indexWorkspace()}
  >
    {#if indexing}<LoaderCircle size={13} class="animate-spin" />{:else}<DatabaseZap size={13} />{/if}
    {indexing ? m['code_graph.indexing']() : m['code_graph.index']()}
  </Button>
{/snippet}

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
    class="cg nodrag nowheel flex h-full min-h-0 flex-col overflow-hidden bg-[var(--app-canvas)] text-[var(--app-text)]"
    role="region"
    aria-label={m['code_graph.title']()}
    onwheel={(event) => event.stopPropagation()}
  >
    <!-- Barra: explorar (busca + escopo) a esquerda; visoes e reindexacao discretas a direita. -->
    <div class="cg-toolbar">
      <form class="relative flex min-w-40 flex-1" onsubmit={(event) => { event.preventDefault(); void searchSymbols(); }}>
        <Search size={13} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" aria-hidden="true" />
        <input
          class="cg-search"
          bind:value={query}
          disabled={intelligenceDisabled}
          placeholder={m['code_graph.search_placeholder']()}
          aria-label={m['code_graph.search_placeholder']()}
        />
        <HeaderIconButton
          label={searchMode === 'semantic' ? m['code_graph.semantic_search_enabled']() : m['code_graph.semantic_search_disabled']()}
          class={`cg-inset-btn right-7 ${searchMode === 'semantic' ? 'is-on' : ''}`}
          active={searchMode === 'semantic'}
          disabled={intelligenceDisabled}
          side="bottom"
          onclick={() => void toggleSearchMode()}
        >
          <Sparkles size={12} />
        </HeaderIconButton>
        <HeaderIconButton label={m['code_graph.search']()} class="cg-inset-btn right-1" side="bottom" type="submit" disabled={intelligenceDisabled}>
          <ArrowRight size={12} />
        </HeaderIconButton>
      </form>
      <Select.Root type="single" value={projectId} disabled={intelligenceDisabled} onValueChange={(value: string) => void changeProject(value)}>
        <Select.Trigger size="sm" class="h-8 max-w-48 min-w-0 shrink text-xs"><span class="truncate">{projectScopeLabel(currentProject)}</span></Select.Trigger>
        <Select.Content>
          <Select.Item value="all">{m['code_graph.all_repositories']()}</Select.Item>
          {#each snapshot?.projects ?? [] as project (project.id)}
            <Select.Item value={project.id}>{projectScopeLabel(project)}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
      {#if hasIndexedGraph}
        <div class="flex shrink-0 items-center gap-0.5">
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button
                  {...props}
                  type="button"
                  class="cg-tool"
                  class:is-on={viewMode === 'changes'}
                  disabled={!hasIndexedGraph || changeLoading || intelligenceDisabled}
                  onclick={() => void loadChanges()}
                >
                  <GitCompareArrows size={14} class={changeLoading ? 'animate-pulse' : undefined} />
                  <span class="cg-tool-label">{m['code_graph.changes']()}</span>{#if changes}<span class="cg-tool-count">{changedFileCount}</span>{/if}
                </button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom" class="max-w-64 text-pretty">{m['code_graph.changes_description']()}</Tooltip.Content>
          </Tooltip.Root>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              class={`cg-tool ${['contracts', 'quality', 'semantic', 'runtime', 'operations', 'compare'].includes(viewMode) ? 'is-on' : ''}`}
              disabled={!hasIndexedGraph || intelligenceDisabled}
              aria-label={m['code_graph.intelligence_views']()}
              title={m['code_graph.intelligence_views']()}
            >
              <Layers size={14} />
              <span class="cg-tool-label">{m['code_graph.intelligence']()}</span>
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
                {m['code_graph.operations']()}{operations ? ` (${trackedAgents.length})` : ''}
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
          <span class="mx-1 h-4 w-px bg-[var(--app-border)]" aria-hidden="true"></span>
          <Tooltip.Root>
            <Tooltip.Trigger>
              {#snippet child({ props })}
                <button {...props} type="button" class="cg-tool" disabled={indexing || intelligenceDisabled} onclick={() => void indexWorkspace()}>
                  {#if indexing}<LoaderCircle size={14} class="animate-spin" />{:else}<DatabaseZap size={14} />{/if}
                  <span class="cg-tool-label">{indexing ? m['code_graph.indexing']() : m['code_graph.index']()}</span>
                </button>
              {/snippet}
            </Tooltip.Trigger>
            <Tooltip.Content side="bottom">{m['code_graph.index']()}</Tooltip.Content>
          </Tooltip.Root>
        </div>
      {/if}
    </div>

    {#if snapshot && hasIndexedGraph}
      <!-- Metricas discretas: numero tabular + rotulo, sem divisorias. -->
      <div class="cg-stats">
        <span class="cg-stat"><span class="cg-stat-value">{snapshot.totals.files}</span><span class="cg-stat-label">{m['code_graph.files']()}</span></span>
        <span class="cg-stat"><span class="cg-stat-value">{snapshot.totals.symbols}</span><span class="cg-stat-label">{m['code_graph.symbols']()}</span></span>
        <span class="cg-stat"><span class="cg-stat-value">{snapshot.totals.edges}</span><span class="cg-stat-label">{m['code_graph.relationships']()}</span></span>
        <span class="cg-stat"><span class="cg-stat-value">{snapshot.projects.length}</span><span class="cg-stat-label">{m['code_graph.repositories']()}</span></span>
      </div>
    {/if}

    {#if error}
      <div class="flex shrink-0 items-center gap-2 bg-[var(--app-danger-soft)] px-3 py-2 text-[12px] text-[var(--app-text)]" role="alert">
        <AlertTriangle size={13} class="shrink-0 text-[var(--app-danger)]" /> <span class="min-w-0 truncate" title={error}>{error}</span>
      </div>
    {/if}

    <div class="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(190px,0.36fr)]">
      <div class="relative min-h-0 min-w-0 overflow-hidden">
        {#if loading}
          <div class="absolute inset-0 z-10 grid place-items-center"><span class="cg-pill" role="status"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['code_graph.loading']()}</span></div>
        {:else if !hasIndexedGraph}
          <!-- Acima do host do grafo (vazio) para o botao receber o clique. -->
          <div class="absolute inset-0 z-10 bg-[var(--app-canvas)]">
            <NodeEmptyState
              icon={Network}
              title={intelligenceDisabled ? m['code_graph.disabled_title']() : m['code_graph.empty_title']()}
              description={intelligenceDisabled ? m['code_graph.disabled_description']() : m['code_graph.empty_description']()}
              actions={intelligenceDisabled ? undefined : indexAction}
            />
          </div>
        {:else if graph && graph.nodes.length === 0}
          <div class="pointer-events-none absolute inset-0 z-10">
            <NodeEmptyState compact icon={SearchX} title={m['code_graph.no_results']()} />
          </div>
        {/if}
        <div
          bind:this={graphHost}
          class="absolute inset-0"
          data-testid="code-graph-visualization"
          aria-label={m['code_graph.visualization']()}
        ></div>
        {#if graph?.truncated}
          <span class="cg-pill cg-float absolute bottom-3 left-3 max-w-[calc(100%-24px)]"><span class="size-1.5 shrink-0 rounded-full bg-[var(--app-warning)]" aria-hidden="true"></span><span class="truncate">{m['code_graph.truncated']()}</span></span>
        {/if}
      </div>

      <aside class="cg-aside min-h-0 overflow-y-auto overscroll-contain">
        {#if selectedRelationship}
          <button class="cg-back" onclick={() => { selectedRelationship = null; }}>
            <ArrowLeft size={12} /> {m['code_graph.back_to_graph']()}
          </button>
          <div class="cg-card mb-3">
            <span class="cg-chip mb-2">{selectedRelationship.classification === 'runtime' ? m['code_graph.runtime_relationship']() : selectedRelationship.classification === 'inferred' ? m['code_graph.inferred_relationship']() : m['code_graph.static_relationship']()}</span>
            <strong class="block text-[12px] leading-snug font-medium break-words">{selectedRelationship.summary}</strong>
            <dl class="mt-2.5 space-y-1.5 text-ui-xs text-[var(--app-text-muted)]">
              <div><dt>{m['code_graph.provenance']()}</dt><dd class="mt-0.5 font-mono text-[11px] break-all text-[var(--app-text)]">{selectedRelationship.provenance.path ?? m['code_graph.index_inference']()}:{selectedRelationship.provenance.line ?? 1}</dd></div>
              <div><dt>{m['code_graph.confidence']()}</dt><dd class="mt-0.5 tabular-nums text-[var(--app-text)]">{Math.round(selectedRelationship.provenance.confidence)}%</dd></div>
            </dl>
          </div>
          <div class="cg-pair">
            <Button size="xs" variant="outline" onclick={() => void openSymbol(selectedRelationship!.source.id)}>{m['code_graph.source_symbol']()}</Button>
            <Button size="xs" variant="outline" onclick={() => void openSymbol(selectedRelationship!.target.id)}>{m['code_graph.target_symbol']()}</Button>
          </div>
        {:else if viewMode === 'changes' && changes}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.change_impact']()}</strong>
          {#if changes.scopes.length === 0}
            <p class="cg-note">{m['code_graph.no_changes']()}</p>
          {:else}
            <div class="space-y-4">
              {#each changes.scopes as scope (scope.id)}
                <section class="cg-scope">
                  <div class="cg-scope-head">
                    <span class="section-label min-w-0 truncate">{scope.kind === 'floor' ? m['code_graph.floor_scope']({ name: scope.name }) : m['code_graph.workspace_scope']()}</span>
                    <span class="cg-count">{scope.files.length}</span>
                    <span class="cg-reveal">
                      {#if scope.kind === 'workspace'}
                        <HeaderIconButton
                          label={m['code_graph.create_review']()}
                          class="nodrag cg-icon-btn"
                          side="top"
                          disabled={handoffBusy !== null}
                          onclick={() => void createHandoff('review', scope)}
                        ><GitPullRequestArrow size={12} class={handoffBusy === `review:${scope.id}` ? 'animate-pulse' : undefined} /></HeaderIconButton>
                      {/if}
                      <HeaderIconButton
                        label={m['code_graph.context']()}
                        class="nodrag cg-icon-btn"
                        side="top"
                        onclick={() => void openContext({ scopeId: scope.id })}
                      ><Send size={12} /></HeaderIconButton>
                      <HeaderIconButton
                        label={m['code_graph.create_task']()}
                        class="nodrag cg-icon-btn"
                        side="top"
                        disabled={handoffBusy !== null}
                        onclick={() => void createHandoff('task', scope)}
                      ><ListTodo size={12} class={handoffBusy === `task:${scope.id}` ? 'animate-pulse' : undefined} /></HeaderIconButton>
                    </span>
                  </div>
                  <div class="space-y-0.5">
                    {#each scope.files.slice(0, 20) as file (`${scope.id}:${file.projectId}:${file.path}`)}
                      <button class="cg-row items-center" onclick={() => openChangedFile(file)}>
                        <span class="cg-file-status">{file.status}</span>
                        <span class="min-w-0 flex-1"><span class="block truncate text-[12px]" title={file.path}>{file.path}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{file.projectName} · <span class="tabular-nums">{file.symbolIds.length}</span> {m['code_graph.symbols']()}</span></span>
                      </button>
                    {/each}
                  </div>
                </section>
              {/each}
              {#if changes.conflicts.length}
                <section class="cg-callout" data-tone="danger">
                  <strong class="mb-1 block text-[12px] font-semibold">{m['code_graph.floor_conflicts']()}</strong>
                  {#each changes.conflicts as conflict (conflict.id)}
                    <div class="border-t border-[color-mix(in_srgb,var(--app-danger)_20%,transparent)] py-1.5 first:border-0">
                      <span class="block text-[12px] font-medium">{conflict.leftFloorName} ↔ {conflict.rightFloorName}</span>
                      <span class="block text-ui-xs leading-4 text-[var(--app-text-muted)]">{conflict.sharedPaths.length} {m['code_graph.shared_files']()} · {conflict.sharedImpactSymbolIds.length + conflict.sharedSymbolIds.length} {m['code_graph.shared_symbols']()}</span>
                    </div>
                  {/each}
                </section>
              {/if}
              {#if changes.likelyTests.length}
                <section>
                  <span class="section-label mb-1.5 block">{m['code_graph.likely_tests']()}</span>
                  <div class="space-y-0.5">
                    {#each changes.likelyTests.slice(0, 20) as path (path)}
                      <div class="truncate rounded-md bg-[var(--app-surface-subtle)] px-2 py-1 font-mono text-[11px] text-[var(--app-text-muted)]" title={path}>{path}</div>
                    {/each}
                  </div>
                </section>
              {/if}
            </div>
          {/if}
        {:else if viewMode === 'contracts' && contracts}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.contract_map']()}</strong>
          <div class="cg-tiles">
            <div class="cg-tile"><strong><span class="cg-kind-dot" style:background={symbolColor('endpoint')}></span>{contracts.endpoints.length}</strong><span>{m['code_graph.endpoints']()}</span></div>
            <div class="cg-tile"><strong><span class="cg-kind-dot" style:background={symbolColor('apiRequest')}></span>{contracts.requests.length}</strong><span>{m['code_graph.requests']()}</span></div>
            <div class="cg-tile"><strong><span class="cg-kind-dot" style:background={symbolColor('schema')}></span>{contracts.schemas.length}</strong><span>{m['code_graph.schemas']()}</span></div>
            <div class="cg-tile"><strong><span class="cg-kind-dot" style:background={symbolColor('gateway')}></span>{contracts.gateways.length}</strong><span>{m['code_graph.gateways']()}</span></div>
            <div class="cg-tile" data-tone="success"><strong>{contracts.matches.length}</strong><span>{m['code_graph.contract_matches']()}</span></div>
            <div class="cg-tile" data-tone="warning"><strong>{contracts.unmatchedRequestIds.length}</strong><span>{m['code_graph.unmatched_requests']()}</span></div>
          </div>
          {#if contracts.conflicts.length}
            <section class="cg-callout mb-3" data-tone="danger">
              <strong class="mb-1 block text-[12px] font-semibold">{m['code_graph.contract_conflicts']()}</strong>
              {#each contracts.conflicts.slice(0, 20) as conflict (conflict.id)}
                <div class="border-t border-[color-mix(in_srgb,var(--app-danger)_20%,transparent)] py-1.5 first:border-0">
                  <span class="block truncate font-mono text-[11px]">{conflict.method} {conflict.path}</span>
                  <span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{conflict.projectNames.join(' · ')}</span>
                </div>
              {/each}
            </section>
          {/if}
          <section>
            <span class="section-label mb-1.5 block">{m['code_graph.contract_matches']()}</span>
            <div class="space-y-1">
              {#each contracts.matches.slice(0, 30) as match (match.id)}
                {@const request = contractSymbol(match.requestSymbolId)}
                {@const endpoint = contractSymbol(match.endpointSymbolId)}
                {#if request && endpoint}
                  <button class="cg-row cg-row-card flex-col" onclick={() => void openGraphSymbol(request.id)}>
                    <span class="block w-full truncate font-mono text-[11px]">{request.name}</span>
                    <span class="block w-full truncate text-ui-xs text-[var(--app-text-muted)]">{request.projectName} → {endpoint.projectName} · {match.reason === 'exact' ? m['code_graph.match_exact']() : m['code_graph.match_gateway']()} · <span class="tabular-nums">{match.confidence}%</span></span>
                  </button>
                {/if}
              {/each}
            </div>
          </section>
          {#if contracts.unmatchedRequestIds.length}
            <section class="mt-4">
              <span class="section-label mb-1.5 block">{m['code_graph.unmatched_requests']()}</span>
              <div class="space-y-1">
                {#each contracts.unmatchedRequestIds.slice(0, 30) as symbolId (symbolId)}
                  {@const request = contractSymbol(symbolId)}
                  {#if request}
                    <button class="cg-row cg-row-card flex-col" data-tone="warning" onclick={() => void openGraphSymbol(request.id)}>
                      <span class="block w-full truncate font-mono text-[11px]">{request.name}</span>
                      <span class="block w-full truncate text-ui-xs text-[var(--app-text-muted)]">{request.projectName ?? request.projectId}</span>
                    </button>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}
        {:else if viewMode === 'quality' && quality}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.quality_title']()}</strong>
          <div class="cg-tiles">
            <div class="cg-tile"><strong>{quality.counts.findings}</strong><span>{m['code_graph.quality_findings']()}</span></div>
            <div class="cg-tile" data-tone="danger"><strong>{quality.counts.errors}</strong><span>{m['code_graph.quality_errors']()}</span></div>
            <div class="cg-tile" data-tone="warning"><strong>{quality.counts.warnings}</strong><span>{m['code_graph.quality_warnings']()}</span></div>
            <div class="cg-tile"><strong>{quality.counts.duplicates}</strong><span>{m['code_graph.quality_duplicates']()}</span></div>
            <div class="cg-tile"><strong>{quality.counts.cycles}</strong><span>{m['code_graph.quality_cycles']()}</span></div>
            <div class="cg-tile"><strong>{quality.counts.deadCode}</strong><span>{m['code_graph.quality_dead_code']()}</span></div>
          </div>
          <section class="mb-4">
            <span class="section-label mb-1.5 block">{m['code_graph.data_flow']()}</span>
            <div class="flex flex-wrap gap-1">
              {#each Object.entries(quality.dataFlow.byType) as [type, count] (type)}
                <span class="cg-chip"><strong class="tabular-nums text-[var(--app-text)]">{count}</strong> {resourceTypeLabel(type)}</span>
              {/each}
              {#if Object.keys(quality.dataFlow.byType).length === 0}
                <span class="text-ui-sm text-[var(--app-text-muted)]">{m['code_graph.quality_resources_empty']()}</span>
              {/if}
            </div>
          </section>
          <section>
            <span class="section-label mb-1.5 block">{m['code_graph.quality_findings']()}</span>
            {#if quality.findings.length === 0}
              <p class="cg-note">{m['code_graph.quality_empty']()}</p>
            {:else}
              <div class="space-y-1">
                {#each quality.findings as finding (finding.id)}
                  <div class="cg-finding">
                    <button class="cg-row min-w-0 flex-1" onclick={() => finding.symbolIds[0] && void openSymbol(finding.symbolIds[0])}>
                      <span class="mt-1 size-1.5 shrink-0 rounded-full {finding.severity === 'error' ? 'bg-[var(--app-danger)]' : finding.severity === 'warning' ? 'bg-[var(--app-warning)]' : 'bg-[var(--app-info)]'}"></span>
                      <span class="min-w-0 flex-1">
                        <strong class="block text-[12px] leading-4 font-medium">{findingTitle(finding)}</strong>
                        <span class="mt-0.5 block text-ui-xs leading-4 break-words text-[var(--app-text-muted)]">{finding.paths.slice(0, 3).join(' · ') || finding.projectNames.join(' · ')}</span>
                        <span class="mt-0.5 block font-mono text-[11px] leading-4 break-words text-[var(--app-text-muted)]">{findingMetrics(finding)}</span>
                        <span class="mt-1 block text-ui-xs text-[var(--app-text-soft)] tabular-nums">{m['code_graph.quality_confidence']({ confidence: finding.confidence })}</span>
                      </span>
                    </button>
                    <span class="cg-reveal"><HeaderIconButton label={m['code_graph.context']()} class="cg-icon-btn" side="left" onclick={() => void openContext({ findingId: finding.id })}><Send size={12} /></HeaderIconButton></span>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {:else if viewMode === 'semantic' && semanticStatus}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.semantic_title']()}</strong>
          <section class="cg-card">
            <div class="flex items-center gap-2.5">
              <span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]"><Sparkles size={14} /></span>
              <div class="min-w-0 flex-1">
                <strong class="block text-[12px] font-medium">{semanticStateLabel(semanticStatus.state)}</strong>
                <span class="block truncate font-mono text-[11px] text-[var(--app-text-muted)]" title={semanticStatus.model}>{semanticStatus.model}</span>
              </div>
            </div>
            <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--app-hover)]">
              <div class="h-full rounded-full bg-[var(--app-accent)] transition-[width] duration-250 ease-smooth-out" style={`width: ${semanticStatus.totalSymbols ? Math.round((semanticStatus.indexedSymbols / semanticStatus.totalSymbols) * 100) : 0}%`}></div>
            </div>
            <span class="mt-1.5 block text-ui-xs text-[var(--app-text-muted)] tabular-nums">{m['code_graph.semantic_symbols']({ indexed: semanticStatus.indexedSymbols, total: semanticStatus.totalSymbols })}</span>
            <div class={`mt-3 grid gap-1.5 ${data.codeIntelligenceMode === 'assisted' ? 'grid-cols-1' : 'grid-cols-2'}`}>
              <Button size="xs" class="w-full" disabled={semanticLoading || !hasIndexedGraph || semanticStatus.totalSymbols === 0} onclick={() => void updateSemantic('build')}>
                <RefreshCw size={11} class={semanticLoading ? 'animate-spin' : undefined} />
                {data.codeIntelligenceMode === 'assisted'
                  ? m['code_graph.semantic_refresh']()
                  : semanticStatus.state === 'empty'
                    ? m['code_graph.semantic_build']()
                    : m['code_graph.semantic_rebuild']()}
              </Button>
              {#if data.codeIntelligenceMode !== 'assisted'}
                <Button size="xs" variant="outline" class="w-full" disabled={semanticLoading || semanticStatus.state === 'empty'} onclick={() => void updateSemantic('clear')}>
                  <Trash2 size={11} /> {m['code_graph.semantic_clear']()}
                </Button>
              {/if}
            </div>
          </section>
          {#if data.codeIntelligenceMode === 'assisted'}
            <p class="cg-help mt-3">{m['code_graph.semantic_auto']()}</p>
          {/if}
          <p class="cg-help mt-2">{m['code_graph.semantic_privacy']()}</p>
        {:else if viewMode === 'runtime' && runtime}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.runtime_title']()}</strong>
          <div class="cg-tiles">
            <div class="cg-tile"><strong>{runtime.counts.runs}</strong><span>{m['code_graph.evidence_runs']()}</span></div>
            <div class="cg-tile" data-tone="success"><strong>{runtime.counts.coveredSymbols}</strong><span>{m['code_graph.evidence_covered']()}</span></div>
            <div class="cg-tile" data-tone="danger"><strong>{runtime.counts.failures}</strong><span>{m['code_graph.evidence_failures']()}</span></div>
            <div class="cg-tile" data-tone="warning"><strong>{runtime.counts.runtimeOnlyCalls}</strong><span>{m['code_graph.evidence_runtime_only']()}</span></div>
          </div>
          <form class="cg-card mb-4 space-y-2" onsubmit={(event) => { event.preventDefault(); void importEvidence(); }}>
            <strong class="block text-[12px] font-semibold">{m['code_graph.evidence_import']()}</strong>
            <Select.Root type="single" value={evidenceKind} onValueChange={(value: string) => { evidenceKind = value as typeof evidenceKind; }}>
              <Select.Trigger size="sm" class="w-full text-xs">{evidenceKindLabel(evidenceKind)}</Select.Trigger>
              <Select.Content>
                {#each ['auto', 'coverage', 'test', 'trace'] as kind (kind)}
                  <Select.Item value={kind}>{evidenceKindLabel(kind)}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
            <Input
              class="h-8 font-mono text-[11px]"
              bind:value={evidencePath}
              placeholder={m['code_graph.evidence_path_placeholder']()}
              aria-label={m['code_graph.evidence_path']()}
            />
            <Button type="submit" size="xs" class="w-full" disabled={evidenceImporting || !evidencePath.trim()}>
              <ArrowDownToLine size={11} class={evidenceImporting ? 'animate-pulse' : undefined} /> {m['code_graph.evidence_import_action']()}
            </Button>
          </form>
          <section>
            <span class="section-label mb-1.5 block">{m['code_graph.evidence_recent']()}</span>
            {#if runtime.runs.length === 0}
              <p class="cg-note">{m['code_graph.evidence_empty']()}</p>
            {:else}
              <div class="space-y-1">
                {#each runtime.runs.slice(0, 50) as run (run.id)}
                  <div class="cg-card">
                    <span class="flex items-center gap-1.5"><span class="size-1.5 shrink-0 rounded-full {run.kind === 'coverage' ? 'bg-[var(--app-success)]' : run.kind === 'test' ? 'bg-[var(--app-danger)]' : 'bg-[var(--app-info)]'}"></span><strong class="min-w-0 flex-1 truncate text-[12px] font-medium">{run.label}</strong></span>
                    <span class="mt-1 block truncate font-mono text-[11px] text-[var(--app-text-muted)]">{run.projectName}/{run.sourcePath}</span>
                    <span class="mt-1 block text-ui-xs text-[var(--app-text-muted)] tabular-nums">{run.stats.coveredSymbols} {m['code_graph.evidence_covered']()} · {run.stats.failures} {m['code_graph.evidence_failures']()} · {run.stats.observedCalls} {m['code_graph.evidence_calls']()}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </section>
        {:else if viewMode === 'operations' && operations}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.operations_title']()}</strong>
          <div class="cg-tiles">
            <div class="cg-tile"><strong>{activeAgents.length}</strong><span>{m['code_graph.active_agents']()}</span></div>
            <div class="cg-tile" data-tone="danger"><strong>{operations.conflicts.length}</strong><span>{m['code_graph.edit_conflicts']()}</span></div>
          </div>
          {#if operations.conflicts.length}
            <section class="cg-callout mb-3 space-y-1" data-tone="danger">
              <strong class="block text-[12px] font-semibold">{m['code_graph.conflict_warning']()}</strong>
              {#each operations.conflicts as conflict (conflict.id)}
                {@const left = operations.agents.find((agent) => agent.nodeId === conflict.leftNodeId)}
                {@const right = operations.agents.find((agent) => agent.nodeId === conflict.rightNodeId)}
                <div class="border-t border-[color-mix(in_srgb,var(--app-danger)_20%,transparent)] pt-1.5 text-ui-xs first:border-0 first:pt-0">
                  <strong class="block font-medium text-[var(--app-text)]">{left?.title} ↔ {right?.title}</strong>
                  <span class="block break-words text-[var(--app-text-muted)]">{conflict.sharedPaths.slice(0, 3).join(' · ') || m['code_graph.shared_symbols_count']({ count: conflict.sharedSymbolIds.length })}</span>
                </div>
              {/each}
            </section>
          {/if}
          <section class="space-y-1">
            {#each trackedAgents as agent (agent.nodeId)}
              {@const agentIndex = operations.agents.findIndex((candidate) => candidate.nodeId === agent.nodeId)}
              <button class="cg-row cg-row-card flex-col" onclick={() => data.onJumpToNode?.(agent.nodeId)}>
                <span class="flex w-full items-center gap-1.5"><span class="size-2 shrink-0 rounded-full" style={`background:${AGENT_COLORS[Math.max(0, agentIndex) % AGENT_COLORS.length]}`}></span><strong class="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.title}</strong><span class="text-ui-xs text-[var(--app-text-muted)]">{agentStateLabel(agent.state)}</span></span>
                <span class="block w-full truncate text-ui-xs text-[var(--app-text-muted)]">{agent.task?.title ?? m['code_graph.no_active_task']()} · {agent.floorName ?? m['code_graph.main_workspace']()}</span>
                <span class="block w-full text-ui-xs text-[var(--app-text-soft)] tabular-nums">{m['code_graph.active_symbols_count']({ count: agent.symbolIds.length })}</span>
              </button>
            {/each}
          </section>
        {:else if viewMode === 'compare'}
          <button class="cg-back" onclick={() => void loadOverview()}><ArrowLeft size={12} /> {m['code_graph.overview']()}</button>
          <strong class="cg-h">{m['code_graph.compare_title']()}</strong>
          {#if revisions.length < 2}
            <p class="cg-note">{m['code_graph.compare_empty']()}</p>
          {:else}
            <div class="mb-3 space-y-1.5">
              <Select.Root type="single" value={compareFrom} onValueChange={(value: string) => { compareFrom = value; void compareRevisions(projectId); }}>
                <Select.Trigger size="sm" class="w-full text-xs">{revisionLabel(compareFrom, m['code_graph.compare_from']())}</Select.Trigger>
                <Select.Content>{#each revisions as revision (revision.id)}<Select.Item value={revision.id} disabled={revision.id === compareTo}>#{revision.sequence} · {revision.gitHead?.slice(0, 8) ?? revision.sourceHash.slice(0, 8)}</Select.Item>{/each}</Select.Content>
              </Select.Root>
              <Select.Root type="single" value={compareTo} onValueChange={(value: string) => { compareTo = value; void compareRevisions(projectId); }}>
                <Select.Trigger size="sm" class="w-full text-xs">{revisionLabel(compareTo, m['code_graph.compare_to']())}</Select.Trigger>
                <Select.Content>{#each revisions as revision (revision.id)}<Select.Item value={revision.id} disabled={revision.id === compareFrom}>#{revision.sequence} · {revision.gitHead?.slice(0, 8) ?? revision.sourceHash.slice(0, 8)}</Select.Item>{/each}</Select.Content>
              </Select.Root>
            </div>
            {#if comparison}
              <div class="cg-tiles cg-tiles-3">
                <div class="cg-tile" data-tone="success"><strong>+{comparison.added.length}</strong><span>{m['code_graph.comparison_added']()}</span></div>
                <div class="cg-tile" data-tone="warning"><strong>~{comparison.modified.length}</strong><span>{m['code_graph.comparison_modified']()}</span></div>
                <div class="cg-tile" data-tone="danger"><strong>-{comparison.removed.length}</strong><span>{m['code_graph.comparison_removed']()}</span></div>
              </div>
              <p class="cg-note mb-3 tabular-nums">
                {m['code_graph.relationship_changes']({ added: comparison.relationships.added.length, modified: comparison.relationships.modified.length, removed: comparison.relationships.removed.length })}
              </p>
              <div class="space-y-1">
                {#each [...comparison.added.map((symbol) => ({ symbol, state: 'added' })), ...comparison.modified.map((item) => ({ symbol: item.after, state: 'modified' })), ...comparison.removed.map((symbol) => ({ symbol, state: 'removed' }))].slice(0, 80) as item (`${item.state}:${item.symbol.fingerprint}`)}
                  <div class="cg-card">
                    <span class="block truncate text-[12px] font-medium">{item.symbol.name}</span>
                    <span class="block truncate font-mono text-[11px] text-[var(--app-text-muted)]">{comparisonStateLabel(item.state as 'added' | 'modified' | 'removed')} · {item.symbol.path ?? item.symbol.qualifiedName}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        {:else if results.length}
          <span class="section-label mb-2 block">{m['code_graph.search_results']()}</span>
          <div class="space-y-0.5">
            {#each results as result (result.id)}
              <button class="cg-row" onclick={() => void openSymbol(result.id)}>
                <span class="cg-kind-dot mt-1.5" style:background={symbolColor(result.kind)} aria-hidden="true"></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12px] font-medium">{result.name}</span>
                  <span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{symbolKind(result.kind)} · {result.path ?? result.projectName}</span>
                  {#if searchMode === 'semantic'}
                    {@const semantic = semanticMatches.find((match) => match.symbol.id === result.id)}
                    {#if semantic}<span class="mt-1 block text-ui-xs font-medium text-[var(--app-accent)] tabular-nums">{m['code_graph.semantic_score']({ score: semantic.score })}</span>{/if}
                  {/if}
                </span>
              </button>
            {/each}
          </div>
        {:else if selectedSymbol}
          <button class="cg-back" onclick={() => void loadOverview()}>
            <ArrowLeft size={12} /> {m['code_graph.overview']()}
          </button>
          <div class="mb-3 flex items-start gap-2.5">
            <span class="cg-symbol-icon" style:color={symbolColor(selectedSymbol.kind)}>{#if selectedSymbol.kind === 'module'}<FileCode2 size={15} />{:else if selectedSymbol.kind === 'class' || selectedSymbol.kind === 'interface'}<Box size={15} />{:else}<Braces size={15} />{/if}</span>
            <div class="min-w-0"><strong class="block text-[13px] leading-snug font-semibold break-words">{selectedSymbol.name}</strong><span class="block text-ui-xs break-words text-[var(--app-text-muted)]">{symbolKind(selectedSymbol.kind)}</span></div>
          </div>
          <dl class="space-y-2.5 text-ui-xs">
            <div><dt class="text-[var(--app-text-muted)]">{m['code_graph.qualified_name']()}</dt><dd class="mt-0.5 font-mono text-[11px] leading-relaxed break-all">{selectedSymbol.qualifiedName}</dd></div>
            {#if selectedSymbol.path}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.location']()}</dt><dd class="mt-0.5 font-mono text-[11px] leading-relaxed break-all">{selectedSymbol.projectName}/{selectedSymbol.path}:{selectedSymbol.startLine ?? 1}</dd></div>{/if}
            {#if selectedSymbol.signature}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.signature']()}</dt><dd class="mt-0.5 font-mono text-[11px] leading-relaxed break-words">{selectedSymbol.signature}</dd></div>{/if}
            {#if selectedSymbol.documentation}<div><dt class="text-[var(--app-text-muted)]">{m['code_graph.documentation']()}</dt><dd class="mt-0.5 leading-relaxed break-words">{selectedSymbol.documentation}</dd></div>{/if}
          </dl>
          {#if selectedSymbol.path}
            <div class="cg-pair mt-3">
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
          <div class="mt-4 space-y-3 border-t border-[var(--app-border)] pt-3">
            <div>
              <span class="mb-1.5 block text-ui-xs font-medium text-[var(--app-text-soft)]">{m['code_graph.direction']()}</span>
              <SegmentedControl
                size="sm"
                fill
                label={m['code_graph.direction']()}
                value={direction}
                onValueChange={(value) => { direction = value; void openSymbol(selectedSymbol!.id); }}
                options={[
                  { value: 'incoming', label: m['code_graph.incoming'](), icon: ArrowDownLeft },
                  { value: 'both', label: m['code_graph.both'](), icon: ArrowLeftRight },
                  { value: 'outgoing', label: m['code_graph.outgoing'](), icon: ArrowUpRight },
                ]}
              />
            </div>
            <div>
              <span class="mb-2 block text-ui-xs font-medium text-[var(--app-text-soft)] tabular-nums">{m['code_graph.depth']({ depth })}</span>
              <Slider type="single" min={1} max={4} step={1} value={depth} aria-label={m['code_graph.depth']({ depth })} onValueChange={(value: number) => { depth = value; }} onValueCommit={() => void openSymbol(selectedSymbol!.id)} />
            </div>
          </div>
          {/if}
        {:else}
          <div class="space-y-1.5">
            <span class="section-label mb-1 block">{m['code_graph.repositories']()}</span>
            {#each snapshot?.projects ?? [] as project (project.id)}
              <button class="cg-row cg-row-card flex-col" onclick={() => void changeProject(project.id)}>
                <strong class="block w-full truncate text-[12px] font-medium" title={project.name}>{project.name}</strong>
                <span class="flex w-full flex-wrap items-center gap-x-2 gap-y-1"><span class="cg-chip" data-tone={project.status === 'ready' ? 'success' : project.status === 'error' ? 'danger' : project.status === 'stale' ? 'warning' : undefined}>{projectStatus(project)}</span><span class="text-ui-xs text-[var(--app-text-muted)] tabular-nums">{project.stats.files} {m['code_graph.files']()} · {project.stats.symbols} {m['code_graph.symbols']()}</span></span>
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
        <p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['code_graph.investigation_current_state']()}</p>
      </div>
      <aside class="min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3 max-[620px]:max-h-64 max-[620px]:border-t max-[620px]:border-l-0">
        <strong class="mb-2 block text-ui-xs uppercase text-[var(--app-text-muted)]">{m['code_graph.saved_investigations']()}</strong>
        <div class="space-y-1">
          {#each investigations as item (item.id)}
            <div class="flex items-center gap-1 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-1">
              <button class="min-w-0 flex-1 rounded px-1.5 py-1 text-left hover:bg-[var(--app-hover)]" onclick={() => void restoreInvestigation(item)}>
                <strong class="block truncate text-ui-xs">{item.name}</strong>
                <span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{viewModeLabel(item.state.viewMode)} · {new Date(item.updatedAt).toLocaleString(localeState.current)}</span>
              </button>
              <HeaderIconButton label={m['settings.delete']()} class="grid size-7 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-danger)]/10 hover:text-[var(--app-danger)]" side="left" onclick={() => { pendingInvestigationDelete = item; }}><Trash2 size={12} /></HeaderIconButton>
            </div>
          {:else}
            <p class="py-4 text-center text-ui-xs text-[var(--app-text-muted)]">{m['code_graph.investigations_empty']()}</p>
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
          <div class="mb-3 flex flex-wrap gap-1.5 text-ui-xs text-[var(--app-text-muted)]">
            <span class="rounded-full bg-[var(--app-hover)] px-2.5 py-1 tabular-nums">{m['code_graph.context_tokens']({ used: contextPackage.estimatedTokens, max: contextPackage.maxTokens })}</span>
            <span class="rounded-full bg-[var(--app-hover)] px-2.5 py-1 tabular-nums">{m['code_graph.context_symbols']({ count: contextPackage.symbols.length })}</span>
            <span class="rounded-full bg-[var(--app-hover)] px-2.5 py-1 tabular-nums">{m['code_graph.context_relationships']({ count: contextPackage.relationships.length })}</span>
            {#if contextPackage.truncated}<span class="rounded-full bg-[var(--app-warning-soft)] px-2.5 py-1 text-[var(--app-warning)]">{m['code_graph.truncated']()}</span>{/if}
          </div>
          <pre class="whitespace-pre-wrap break-words font-mono text-ui-xs leading-5 text-[var(--app-text)]">{contextPackage.markdown}</pre>
        {/if}
      </div>
      <aside class="min-h-0 overflow-y-auto border-l border-[var(--app-border)] bg-[var(--app-surface)] p-4 max-[760px]:border-t max-[760px]:border-l-0">
        <div class="space-y-4">
          <label class="block"><span class="mb-1.5 block text-ui-xs font-medium">{m['code_graph.context_purpose']()}</span>
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
          <div>
            <span class="mb-2 flex items-baseline justify-between gap-2 text-ui-xs font-medium"><span>{m['code_graph.token_budget']()}</span><span class="font-mono text-[11px] text-[var(--app-text-soft)] tabular-nums">{Number(contextTokens).toLocaleString(localeState.current)}</span></span>
            <Slider type="single" min={500} max={16000} step={500} value={Number(contextTokens) || 4000} aria-label={m['code_graph.token_budget']()} onValueChange={(value: number) => { contextTokens = String(value); }} onValueCommit={() => void buildContext()} />
          </div>
          <div>
            <span class="mb-1.5 block text-ui-xs font-medium">{m['code_graph.send_to']()}</span>
            <SegmentedControl
              size="sm"
              fill
              label={m['code_graph.send_to']()}
              value={contextHandoff}
              onValueChange={(value) => { contextHandoff = value; }}
              options={[
                { value: 'leader', label: m['code_graph.leader']() },
                { value: 'agent', label: m['code_graph.agent']() },
                { value: 'council', label: m['code_graph.council']() },
                { value: 'task', label: m['code_graph.task']() },
              ]}
            />
          </div>
          {#if contextHandoff === 'agent'}
            <label class="block"><span class="mb-1.5 block text-ui-xs font-medium">{m['code_graph.target_agent']()}</span>
              <Select.Root type="single" value={contextTarget} onValueChange={(value: string) => { contextTarget = value; }}>
                <Select.Trigger class="w-full">{activeAgents.find((agent) => agent.nodeId === contextTarget)?.title ?? m['code_graph.select_agent']()}</Select.Trigger>
                <Select.Content>{#each activeAgents as agent (agent.nodeId)}<Select.Item value={agent.nodeId}>{agent.title}</Select.Item>{/each}</Select.Content>
              </Select.Root>
            </label>
          {:else if contextHandoff === 'council'}
            <div><span class="mb-1.5 block text-ui-xs font-medium">{m['code_graph.council_agents']()}</span>
              <div class="space-y-1">
                {#each activeAgents as agent (agent.nodeId)}
                  <label class="flex min-h-8 items-center gap-2 rounded border border-[var(--app-border)] px-2 text-ui-xs hover:bg-[var(--app-hover)]"><Checkbox checked={councilTargets.includes(agent.nodeId)} disabled={!councilTargets.includes(agent.nodeId) && councilTargets.length >= 5} onCheckedChange={(checked: boolean | 'indeterminate') => { councilTargets = checked === true ? [...councilTargets, agent.nodeId] : councilTargets.filter((id) => id !== agent.nodeId); }} /><span class="truncate">{agent.title}</span></label>
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

<style>
  .cg {
    container: code-graph / inline-size;
  }

  .cg-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    padding: 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    background: var(--app-surface);
  }

  .cg-search {
    width: 100%;
    height: 32px;
    padding: 0 56px 0 30px;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-surface-subtle);
    color: var(--app-text);
    font-size: 12px;
    outline: none;
    transition: border-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .cg-search::placeholder {
    color: var(--app-text-muted);
  }

  .cg-search:focus {
    border-color: var(--app-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .cg-search:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .cg :global(.cg-inset-btn) {
    position: absolute;
    top: 50%;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    translate: 0 -50%;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .cg :global(.cg-inset-btn:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .cg :global(.cg-inset-btn.is-on) {
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .cg :global(.cg-inset-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  /* Ferramentas secundarias: fantasmas com rotulo; viram so icone em nos estreitos. */
  .cg :global(.cg-tool) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    min-width: 32px;
    justify-content: center;
    padding: 0 9px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .cg :global(.cg-tool:hover:not(:disabled)),
  .cg :global(.cg-tool[data-state='open']) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .cg :global(.cg-tool:active:not(:disabled)) {
    transform: scale(var(--scale-press));
  }

  .cg :global(.cg-tool.is-on) {
    background: var(--app-secondary-soft);
    color: var(--app-secondary);
  }

  .cg :global(.cg-tool:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .cg :global(.cg-tool:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .cg-tool-count {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 999px;
    background: var(--app-hover);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  @container code-graph (max-width: 760px) {
    .cg-tool-label {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }

    .cg :global(.cg-tool) {
      padding: 0 8px;
    }
  }

  .cg-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex-shrink: 0;
    padding: 6px 8px;
    border-bottom: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    background: var(--app-surface);
  }

  .cg-stat {
    display: inline-flex;
    align-items: baseline;
    gap: 5px;
    min-width: 0;
    padding: 3px 9px;
    border-radius: 999px;
    background: var(--app-hover);
  }

  .cg-stat-value {
    color: var(--app-text);
    font-size: 12px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .cg-stat-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .cg-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 26px;
    padding: 0 10px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
    white-space: nowrap;
  }

  .cg-pill.cg-float {
    background: var(--app-surface-raised);
    color: var(--app-text-soft);
    box-shadow: var(--app-shadow-panel);
  }

  .cg-aside {
    container: cg-aside / inline-size;
    padding: 10px;
    background: var(--app-surface);
    box-shadow: inset 1px 0 0 var(--app-border);
  }

  .cg-h {
    display: block;
    margin-bottom: 10px;
    font-size: 12.5px;
    font-weight: 600;
    line-height: 1.35;
    text-wrap: balance;
  }

  .cg-pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
  }

  @container cg-aside (min-width: 250px) {
    .cg-pair {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  /* Aside estreito: segmentos so com icone (o rotulo segue acessivel). */
  @container cg-aside (max-width: 249px) {
    .cg-aside :global(.segment-label) {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }

  .cg-back {
    flex-shrink: 0;
    border: 0;
    background: transparent;
    color: var(--app-text-muted);
    font-size: 11.5px;
    cursor: pointer;
    transition: color var(--duration-quick) ease-out;
  }

  .cg-back:hover {
    color: var(--app-text);
  }

  .cg-back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 10px;
    padding: 0;
  }

  .cg-back:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
    border-radius: 4px;
  }

  .cg-card {
    padding: 9px 10px;
    border-radius: 9px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .cg-note,
  .cg-help {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .cg-note {
    padding: 10px;
    border-radius: 9px;
    background: var(--app-surface-subtle);
  }

  .cg-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    width: fit-content;
    height: 20px;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .cg-chip[data-tone='success'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .cg-chip[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .cg-chip[data-tone='danger'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .cg-count {
    flex-shrink: 0;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* Blocos de metricas: numero tabular neutro; cor apenas para estado. */
  .cg-tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
    margin-bottom: 14px;
  }

  .cg-tiles.cg-tiles-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .cg-tile {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding: 7px 9px;
    border-radius: 9px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .cg-tile strong {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--app-text);
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .cg-tile > span {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    color: var(--app-text-muted);
    font-size: 11px;
    line-height: 1.3;
    hyphens: auto;
    overflow-wrap: break-word;
  }

  .cg-tile[data-tone='success'] strong {
    color: var(--app-success);
  }

  .cg-tile[data-tone='warning'] strong {
    color: var(--app-warning);
  }

  .cg-tile[data-tone='danger'] strong {
    color: var(--app-danger);
  }

  .cg-kind-dot {
    display: inline-block;
    flex-shrink: 0;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .cg-callout {
    padding: 8px 10px;
    border-radius: 9px;
    background: var(--app-danger-soft);
    color: var(--app-text);
  }

  .cg-callout[data-tone='danger'] > strong {
    color: var(--app-danger);
  }

  .cg-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .cg-row:hover {
    background: var(--app-hover);
  }

  .cg-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .cg-row.cg-row-card {
    gap: 3px;
    padding: 8px 10px;
    border-radius: 9px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .cg-row.cg-row-card:hover {
    box-shadow: var(--app-shadow-border-hover);
  }

  .cg-row.cg-row-card[data-tone='warning'] {
    background: color-mix(in srgb, var(--app-warning) 7%, var(--app-surface-subtle));
  }

  .cg-file-status {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
  }

  .cg-symbol-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .cg-scope-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    margin-bottom: 4px;
  }

  .cg-scope-head .section-label {
    flex: 1;
  }

  .cg-finding {
    display: flex;
    align-items: flex-start;
    gap: 2px;
    border-radius: 8px;
  }

  .cg :global(.cg-icon-btn) {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .cg :global(.cg-icon-btn:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .cg :global(.cg-icon-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  /* Acoes de linha/escopo aparecem ao apontar ou focar (sem roubar largura). */
  .cg-reveal {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .cg-scope:hover .cg-reveal,
  .cg-scope:focus-within .cg-reveal,
  .cg-finding:hover .cg-reveal,
  .cg-finding:focus-within .cg-reveal {
    opacity: 1;
  }

  @media (hover: none) {
    .cg-reveal {
      opacity: 1;
    }
  }
</style>
