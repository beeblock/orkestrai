<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { SvelteFlow, SvelteFlowProvider, type Node } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import TerminalCanvasNode from './canvas/TerminalCanvasNode.svelte';
  import NoteCanvasNode from './canvas/NoteCanvasNode.svelte';
  import FileTreeCanvasNode from './canvas/FileTreeCanvasNode.svelte';
  import EditorCanvasNode from './canvas/EditorCanvasNode.svelte';
  import DiffCanvasNode from './canvas/DiffCanvasNode.svelte';
  import PortalCanvasNode from './canvas/PortalCanvasNode.svelte';
  import ApiClientCanvasNode from './canvas/ApiClientCanvasNode.svelte';
  import LoopCanvasNode from './canvas/LoopCanvasNode.svelte';
  import TasksCanvasNode from './canvas/TasksCanvasNode.svelte';
  import FlowCanvasNode from './canvas/FlowCanvasNode.svelte';
  import ImageCanvasNode from './canvas/ImageCanvasNode.svelte';
  import UsageCanvasNode from './canvas/UsageCanvasNode.svelte';
  import DesignCanvasNode from './canvas/DesignCanvasNode.svelte';
  import WorkbenchFileView from './WorkbenchFileView.svelte';
  import type { TerminalThemeName } from './terminal-themes.js';
  import type {
    AgentProviderInfo,
    CanvasEdge,
    CanvasNode,
    Floor,
    TerminalNodePayload,
    Workspace,
  } from '$lib/modules/agent-room/domain/types.js';
  import { terminalExecutionRuntime, workspaceExecutionRuntime } from '$lib/modules/agent-room/domain/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspace,
    node,
    workspaceNodes,
    edges,
    floors,
    providers,
    onNodeUpdated,
    onDeleteRequested,
    onSelectNode,
    onOpenFile,
    onRefresh,
  }: {
    workspace: Workspace;
    node: CanvasNode;
    workspaceNodes: CanvasNode[];
    edges: CanvasEdge[];
    floors: Floor[];
    providers: AgentProviderInfo[];
    onNodeUpdated: (node: CanvasNode) => void;
    onDeleteRequested: (node: CanvasNode) => void;
    onSelectNode: (nodeId: string) => void;
    onOpenFile: (path: string) => void;
    onRefresh: () => void | Promise<void>;
  } = $props();

  const nodeTypes = {
    terminal: TerminalCanvasNode,
    note: NoteCanvasNode,
    fileTree: FileTreeCanvasNode,
    editor: EditorCanvasNode,
    diff: DiffCanvasNode,
    portal: PortalCanvasNode,
    apiClient: ApiClientCanvasNode,
    loop: LoopCanvasNode,
    tasks: TasksCanvasNode,
    flow: FlowCanvasNode,
    image: ImageCanvasNode,
    usage: UsageCanvasNode,
    design: DesignCanvasNode,
  };

  let host: HTMLDivElement;
  let hostWidth = $state(0);
  let hostHeight = $state(0);
  const providersReady = Promise.resolve();

  $effect(() => {
    if (!host) return;
    const update = () => {
      const rect = host.getBoundingClientRect();
      hostWidth = rect.width;
      hostHeight = rect.height;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    return () => observer.disconnect();
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

  function providerFor(target: CanvasNode): AgentProviderInfo | undefined {
    const payload = target.payload as TerminalNodePayload;
    return providers.find((provider) => provider.id === payload.provider)
      ?? providers.find((provider) => provider.tui?.command === payload.command);
  }

  function floorPath(floorId: string | null): string | null {
    if (!floorId) return null;
    return floors.find((floor) => floor.id === floorId)?.path ?? null;
  }

  async function patchNode(targetId: string, changes: Record<string, unknown>): Promise<CanvasNode> {
    const updated = await api<CanvasNode>(`/api/agent-room/workspaces/${workspace.id}/nodes/${targetId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    });
    onNodeUpdated(updated);
    return updated;
  }

  async function patchPayload(targetId: string, partial: Record<string, unknown>) {
    const target = workspaceNodes.find((item) => item.id === targetId) ?? node;
    await patchNode(targetId, { payload: { ...(target.payload as Record<string, unknown>), ...partial } });
  }

  async function changeProvider(targetId: string, provider: string, profileId?: string | null, profileLabel?: string | null) {
    const previousProvider = ((workspaceNodes.find((item) => item.id === targetId) ?? node).payload as TerminalNodePayload).provider;
    const updated = await api<CanvasNode>(`/api/agent-room/workspaces/${workspace.id}/nodes/${targetId}/provider`, {
      method: 'PUT',
      body: JSON.stringify({ provider, profileId: profileId ?? null }),
    });
    onNodeUpdated(updated);
    if (previousProvider !== provider) {
      toast.success(m['term.provider_switched']({ provider: providerFor(updated)?.displayName ?? provider }));
    } else {
      toast.success(m['term.profile_switched']({ profile: profileLabel ?? m['term.profile_default']() }));
    }
  }

  async function changeRuntime(
    targetId: string,
    selection: { mode: 'default' | 'native' | 'wsl'; wslDistribution: string | null; wslWorkingDir: string | null },
  ) {
    const updated = await api<CanvasNode>(`/api/agent-room/workspaces/${workspace.id}/nodes/${targetId}/runtime`, {
      method: 'PUT',
      body: JSON.stringify(selection),
    });
    onNodeUpdated(updated);
    toast.success(m['term.runtime_changed']());
  }

  function connectionsFor(nodeId: string) {
    return edges
      .filter((edge) => edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId)
      .map((edge) => {
        const outgoing = edge.sourceNodeId === nodeId;
        const targetId = outgoing ? edge.targetNodeId : edge.sourceNodeId;
        const target = workspaceNodes.find((item) => item.id === targetId);
        return {
          edgeId: edge.id,
          targetId,
          targetTitle: target?.title ?? target?.type ?? m['canvas.fallback_node'](),
          targetType: target?.type ?? m['canvas.fallback_node'](),
          direction: (outgoing ? 'out' : 'in') as 'out' | 'in',
        };
      });
  }

  async function removeConnection(edgeId: string) {
    await api(`/api/agent-room/workspaces/${workspace.id}/edges/${edgeId}`, { method: 'DELETE' });
    await onRefresh();
  }

  const focusedNodes = $derived.by((): Node[] => {
    if (!hostWidth || !hostHeight) return [];
    const payload = node.payload as TerminalNodePayload;
    const provider = providerFor(node);
    const workspaceRuntime = workspaceExecutionRuntime(workspace);
    const width = Math.max(360, hostWidth - 32);
    const height = Math.max(220, hostHeight - 32);
    return [{
      id: node.id,
      type: node.type,
      position: { x: 16, y: 16 },
      width,
      height,
      style: `width:${width}px;height:${height}px`,
      draggable: false,
      selectable: false,
      connectable: false,
      data: {
        title: node.title ?? '',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        providersReady,
        providers,
        workingDir: floorPath(node.floorId) ?? workspace.workingDir,
        workspaceRoot: workspace.workingDir,
        executionRuntime: terminalExecutionRuntime(workspace, payload),
        workspaceRuntime,
        payload: node.payload,
        resumeArgsFor: () => provider?.tui?.resumeArgs ?? null,
        exactResumeArgsFor: (agentSessionId: string) => provider?.tui?.exactResumeArgs?.map(
          (arg) => arg.replace('__ORKESTRAI_SESSION_ID__', agentSessionId)
        ) ?? null,
        freshSessionArgsFor: () => provider?.tui?.freshSessionArgs ?? null,
        sessionStorageFor: () => provider?.sessionStorage ?? null,
        onAgentSessionFound: (id: string, agentSessionId: string) => patchPayload(id, { agentSessionId, resumeRecovery: false }),
        connections: connectionsFor(node.id),
        onJumpToNode: onSelectNode,
        onRemoveConnection: removeConnection,
        onDelete: () => onDeleteRequested(node),
        onResize: undefined,
        onSessionCreated: async (id: string, sessionId: string, options: { resumed: boolean }) => {
          await patchPayload(id, { sessionId });
          await api(`/api/agent-room/workspaces/${workspace.id}/roles/apply`, {
            method: 'POST',
            body: JSON.stringify({ nodeId: id, mode: options.resumed ? 'resume' : 'fresh' }),
          }).catch(() => {});
        },
        onProviderChange: changeProvider,
        onRuntimeChange: changeRuntime,
        onToggleMaestro: (id: string) => patchPayload(id, { maestro: !payload.maestro }),
        onThemeChange: (id: string, theme: TerminalThemeName) => patchPayload(id, { theme }),
        onContentChange: (id: string, content: string) => patchPayload(id, { content }),
        onColorChange: (id: string, color: string) => patchPayload(id, { color }),
        onRoleChange: (id: string, role: string | null) => patchPayload(id, { role }),
        onOpenFile,
        onUrlChange: (id: string, url: string) => patchPayload(id, { url }),
        onRename: (id: string, title: string) => patchNode(id, { title }),
        onPayloadChange: (id: string, partial: Record<string, unknown>) => patchPayload(id, partial),
      },
    }];
  });
</script>

<div class="focused-node-host h-full min-h-0 w-full overflow-hidden" bind:this={host}>
  {#if node.type === 'editor' && (node.payload as { path?: string }).path}
    <WorkbenchFileView
      workspaceId={workspace.id}
      workingDir={floorPath(node.floorId) ?? workspace.workingDir}
      path={(node.payload as { path: string }).path}
      connections={connectionsFor(node.id)}
    />
  {:else}
    <SvelteFlowProvider>
      <SvelteFlow
        nodes={focusedNodes}
        edges={[]}
        {nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      />
    </SvelteFlowProvider>
  {/if}
</div>

<style>
  .focused-node-host {
    background: var(--app-canvas);
  }

  .focused-node-host :global(.svelte-flow__pane) {
    cursor: default;
  }

  .focused-node-host :global(.svelte-flow__handle),
  .focused-node-host :global(.react-flow__resize-control),
  .focused-node-host :global(.svelte-flow__resize-control) {
    display: none !important;
  }

  .focused-node-host :global(.svelte-flow__node) {
    cursor: default;
  }

  .focused-node-host :global(.node-shell) {
    border-radius: 6px;
    box-shadow: 0 8px 28px color-mix(in srgb, black 22%, transparent);
  }

  .focused-node-host :global(.node-header) {
    border-radius: 5px 5px 0 0;
    cursor: default;
  }
</style>
