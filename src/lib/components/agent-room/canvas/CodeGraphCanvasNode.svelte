<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import {
    AlertTriangle,
    ArrowDownToLine,
    ArrowUpFromLine,
    Box,
    Braces,
    FileCode2,
    GitCompareArrows,
    GitPullRequestArrow,
    ListTodo,
    ExternalLink,
    Network,
    RefreshCw,
    Search,
    Waypoints,
    X,
  } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
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
  let handoffBusy = $state<string | null>(null);
  let viewMode = $state<'overview' | 'changes' | 'contracts'>('overview');
  let error = $state('');
  let graphHost: HTMLDivElement;
  let renderer: { kill: () => void; on: (event: string, handler: (payload: { node: string }) => void) => void } | null = null;
  let renderSequence = 0;

  const currentProject = $derived(snapshot?.projects.find((project) => project.id === projectId) ?? null);
  const hasIndexedGraph = $derived(Boolean(snapshot?.projects.some((project) => project.currentRevisionId)));
  const changedFileCount = $derived(changes?.scopes.reduce((total, scope) => total + scope.files.length, 0) ?? 0);

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

  function symbolColor(kind: CodeGraphSymbol['kind']): string {
    if (kind === 'module') return '#0ea5e9';
    if (kind === 'class' || kind === 'interface') return '#8b5cf6';
    if (kind === 'endpoint') return '#22c55e';
    if (kind === 'apiRequest') return '#06b6d4';
    if (kind === 'schema') return '#a855f7';
    if (kind === 'gateway') return '#f97316';
    if (kind === 'function' || kind === 'method') return '#10b981';
    if (kind === 'external') return '#94a3b8';
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
      case 'external': return m['code_graph.kind_external']();
    }
  }

  function stablePosition(value: string, axis: number): number {
    let code = axis ? 5381 : 2166136261;
    for (let index = 0; index < value.length; index += 1) code = ((code << 5) - code + value.charCodeAt(index)) | 0;
    return ((code >>> 0) % 10_000) / 1_000 - 5;
  }

  async function renderGraph(next: CodeGraphSubgraph | null): Promise<void> {
    const sequence = ++renderSequence;
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
    for (const node of next.nodes) {
      model.addNode(node.id, {
        label: node.name,
        x: stablePosition(node.id, 0),
        y: stablePosition(node.id, 1),
        size: changed.has(node.id) || node.id === next.centerSymbolId ? 11 : node.kind === 'module' ? 7 : 5,
        color: changed.has(node.id) ? '#ef4444' : node.path && tests.has(node.path) ? '#f59e0b' : symbolColor(node.kind),
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
    renderer = sigma;
  }

  async function loadStatus(): Promise<void> {
    snapshot = await api<CodeGraphSnapshot>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph`);
  }

  async function loadOverview(): Promise<void> {
    viewMode = 'overview';
    selectedSymbol = null;
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
      results = await api<CodeGraphSymbol[]>(`/api/agent-room/workspaces/${data.workspaceId}/code-graph/search?${params}`);
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
      viewMode = 'overview';
      graph = nextGraph;
      results = [];
      await renderGraph(nextGraph);
    } catch (reason) {
      error = reason instanceof Error ? reason.message : m['code_graph.load_error']();
    }
  }

  async function openGraphSymbol(symbolId: string): Promise<void> {
    const artifact = contracts?.graph.nodes.find((node) => node.id === symbolId && node.revisionId === 'live');
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
    window.dispatchEvent(new CustomEvent('orkestrai:open-file', {
      detail: { workspaceId: data.workspaceId, path },
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
    let socket: WebSocket | null = null;
    const connect = () => {
      if (destroyed) return;
      const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${protocol}://${location.host}/ws/agent-room/pty`);
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data));
          if (message.type === 'codeGraphChanged' && message.workspaceId === data.workspaceId) void load();
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
          class="h-8 w-full rounded border border-[var(--app-border)] bg-[var(--app-surface-raised)] pr-8 pl-7 text-xs outline-none focus:border-[var(--app-accent)]"
          bind:value={query}
          placeholder={m['code_graph.search_placeholder']()}
          aria-label={m['code_graph.search_placeholder']()}
        />
        <button type="submit" class="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]" aria-label={m['code_graph.search']()}>
          <ArrowDownToLine size={12} />
        </button>
      </form>
      <Button
        size="sm"
        class="h-8 bg-[var(--app-accent)] text-[11px] text-[var(--app-accent-foreground)] hover:brightness-105"
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
      <Button
        size="sm"
        variant={viewMode === 'contracts' ? 'default' : 'outline'}
        class="h-8 text-[11px]"
        disabled={!hasIndexedGraph || contractLoading}
        onclick={() => void loadContracts()}
      >
        <Network size={12} class={contractLoading ? 'animate-pulse' : undefined} />
        {m['code_graph.contracts']()}{contracts ? ` (${contracts.matches.length})` : ''}
      </Button>
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
        {#if viewMode === 'changes' && changes}
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
        {:else if results.length}
          <div class="mb-2 text-[9px] font-semibold uppercase text-[var(--app-text-muted)]">{m['code_graph.search_results']()}</div>
          <div class="space-y-1">
            {#each results as result (result.id)}
              <button class="w-full rounded border border-transparent p-2 text-left hover:border-[var(--app-border)] hover:bg-[var(--app-hover)]" onclick={() => void openSymbol(result.id)}>
                <span class="block truncate text-[11px] font-semibold">{result.name}</span>
                <span class="block truncate text-[9px] text-[var(--app-text-muted)]">{symbolKind(result.kind)} · {result.path ?? result.projectName}</span>
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
            <Button size="xs" variant="outline" class="mt-3 w-full" onclick={openSource}>
              <ExternalLink size={11} /> {m['code_graph.open_source']()}
            </Button>
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
