<script lang="ts">
  import { onMount } from 'svelte';
  import { useEdges, useNodes, type NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { Bot, CircleStop, Image as ImageIcon, Info, LoaderCircle, Play, Sparkles, StickyNote, TriangleAlert, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { ImageWorkflowNodePayload, ImageWorkflowRun } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import IconAction from './IconAction.svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';

  type ConnectedNode = NodeConnection & { targetPayload?: Record<string, unknown> };
  type Status = {
    running: boolean;
    runId: string | null;
    lastError: string | null;
    executorReady: boolean;
    executorNodeId: string | null;
    executorTitle: string | null;
  };
  type Data = {
    title: string;
    workspaceId: string;
    payload: ImageWorkflowNodePayload;
    connections?: ConnectedNode[];
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    onPayloadChange: (id: string, partial: Record<string, unknown>) => Promise<void> | void;
    onJumpToNode?: (id: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: Data }>();

  function initialConfig() {
    const payload = data.payload;
    return {
      prompt: String(payload.prompt ?? ''),
      count: Number(payload.count ?? 1),
      transparentBackground: Boolean(payload.transparentBackground),
      outputDirectory: String(payload.outputDirectory ?? 'generated/images'),
      filePrefix: String(payload.filePrefix ?? 'orkestrai-image'),
      running: payload.status === 'running',
      lastError: payload.lastError ?? null,
    };
  }

  const initial = initialConfig();
  let prompt = $state(initial.prompt);
  let count = $state(initial.count);
  let transparentBackground = $state(initial.transparentBackground);
  let outputDirectory = $state(initial.outputDirectory);
  let filePrefix = $state(initial.filePrefix);
  let status = $state<Status | null>(null);
  let running = $state(initial.running);
  let errorCode = $state<string | null>(initial.lastError);

  const flowEdges = useEdges();
  const flowNodes = useNodes();
  const connections = $derived.by(() => flowEdges.current
    .filter((edge) => edge.source === id || edge.target === id)
    .map((edge): ConnectedNode => {
      const outgoing = edge.source === id;
      const targetId = outgoing ? edge.target : edge.source;
      const target = flowNodes.current.find((node) => node.id === targetId);
      return {
        edgeId: edge.id,
        targetId,
        targetTitle: String(target?.data?.title ?? target?.type ?? m['canvas.fallback_node']()),
        targetType: String(target?.type ?? m['canvas.fallback_node']()),
        targetPayload: (target?.data?.payload ?? {}) as Record<string, unknown>,
        direction: outgoing ? 'out' : 'in',
      };
    }));
  const references = $derived(connections.filter((connection) => {
    if (connection.targetType !== 'image') return false;
    const generatedBy = connection.targetPayload?.generatedBy as { workflowNodeId?: unknown } | undefined;
    return generatedBy?.workflowNodeId !== id;
  }));
  const contexts = $derived(connections.filter((connection) => connection.targetType === 'note'));
  const executors = $derived(connections.filter((connection) => connection.targetType === 'terminal'));
  const codexExecutors = $derived(executors.filter((connection) => connection.targetPayload?.provider === 'codex'));
  const outputs = $derived(connections.filter((connection) => {
    const generatedBy = connection.targetPayload?.generatedBy as { workflowNodeId?: unknown } | undefined;
    return connection.targetType === 'image' && generatedBy?.workflowNodeId === id;
  }));
  const history = $derived((data.payload.history ?? []) as ImageWorkflowRun[]);
  const latest = $derived(history.at(-1) ?? null);

  function headers(): HeadersInit {
    const csrf = getCsrfToken();
    return { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
  }

  async function request<T>(init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/image-workflows/${id}`, {
      ...init,
      headers: { ...headers(), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(String(payload.error ?? 'image_workflow_failed'));
    return payload.data as T;
  }

  function config() {
    return {
      prompt: prompt.trim(),
      count,
      transparentBackground,
      outputDirectory: outputDirectory.trim(),
      filePrefix: filePrefix.trim(),
    };
  }

  async function persist() {
    await data.onPayloadChange(id, { schemaVersion: 1, ...config() });
  }

  async function loadStatus() {
    try {
      status = await request<Status>();
      running = status.running;
      errorCode = status.lastError;
    } catch {
      status = { running: false, runId: null, lastError: null, executorReady: false, executorNodeId: null, executorTitle: null };
    }
  }

  async function run() {
    errorCode = null;
    if (!prompt.trim()) {
      errorCode = 'image_workflow_prompt_required';
      return;
    }
    if (!codexExecutors.length) {
      errorCode = 'image_workflow_executor_missing';
      return;
    }
    if (!status?.executorReady) {
      errorCode = 'image_workflow_executor_offline';
      return;
    }
    running = true;
    try {
      await persist();
      await request({ method: 'POST', body: JSON.stringify(config()) });
      await loadStatus();
    } catch (error) {
      errorCode = error instanceof Error ? error.message : 'image_workflow_failed';
      running = false;
    }
  }

  async function cancel() {
    await request({ method: 'DELETE' }).catch(() => null);
    running = false;
    await loadStatus();
  }

  function chooseCount(next: string) {
    count = Number(next);
    void persist();
  }

  function errorLabel(code: string): string {
    const labels: Record<string, () => string> = {
      image_workflow_prompt_required: m['image_workflow.error_prompt'],
      image_workflow_executor_missing: m['image_workflow.error_executor_missing'],
      image_workflow_executor_offline: m['image_workflow.error_executor_offline'],
      image_workflow_executor_unauthorized: m['image_workflow.error_executor_unauthorized'],
      image_workflow_interrupted: m['image_workflow.error_interrupted'],
      image_workflow_reference_missing: m['image_workflow.error_reference_missing'],
      image_workflow_reference_unavailable: m['image_workflow.error_reference_unavailable'],
      image_workflow_reference_too_large: m['image_workflow.error_reference_size'],
      image_workflow_references_too_large: m['image_workflow.error_reference_total'],
      image_workflow_too_many_references: m['image_workflow.error_reference_count'],
      image_workflow_reference_format_invalid: m['image_workflow.error_reference_format'],
      image_gen_tool_failed: m['image_workflow.error_tool'],
      image_gen_output_missing: m['image_workflow.error_output_missing'],
      image_workflow_output_missing: m['image_workflow.error_output_missing'],
      image_workflow_output_path_mismatch: m['image_workflow.error_output_path'],
      image_workflow_output_format_invalid: m['image_workflow.error_output_format'],
    };
    return labels[code]?.() ?? m['image_workflow.error_generic']();
  }

  onMount(() => {
    void loadStatus();
    const timer = window.setInterval(() => {
      if (running) void loadStatus();
    }, 2_000);
    return () => window.clearInterval(timer);
  });
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-image-workflow"
  accent="var(--app-secondary)"
  minWidth={390}
  minHeight={420}
  onResize={data.onResize}
  {connections}
  titleText={data.title}
  onRename={data.onRename}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<Sparkles size={13} />{/snippet}
  {#snippet title()}{data.title || m['image_workflow.title']()}{/snippet}
  {#snippet actions()}
    {#if running}
      <IconAction label={m['image_workflow.cancel']()} danger onclick={() => void cancel()}><CircleStop size={13} /></IconAction>
    {:else}
      <IconAction label={m['image_workflow.run']()} onclick={() => void run()}><Play size={13} /></IconAction>
    {/if}
    <IconAction label={m['image_workflow.delete']()} danger onclick={() => data.onDelete(id)}><X size={13} /></IconAction>
  {/snippet}

  <div class="nodrag nowheel flex h-full min-h-0 flex-col overflow-y-auto text-[11px] overscroll-contain">
    {#if running}
      <div class="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-accent-soft)] px-3 py-2 text-[var(--app-accent)]" role="status">
        <LoaderCircle size={13} class="animate-spin" />
        <span class="font-medium">{m['image_workflow.running']()}</span>
        <span class="ml-auto text-[9px] text-[var(--app-text-muted)]">{m['image_workflow.running_hint']()}</span>
      </div>
    {/if}

    <section class="space-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface-raised)] p-3">
      <div class="flex items-center gap-2">
        <span class="grid size-7 shrink-0 place-items-center border border-[var(--app-border)] bg-[var(--app-canvas)] text-[var(--app-accent)]"><Bot size={14} /></span>
        <div class="min-w-0">
          <strong class="block text-[10px] text-[var(--app-text)]">{m['image_workflow.native_tool_title']()}</strong>
          <p class="mt-0.5 text-[9px] leading-4 text-[var(--app-text-muted)]">{m['image_workflow.native_tool_help']()}</p>
        </div>
      </div>
      <div class="flex items-start gap-2 border border-[var(--app-accent)]/30 bg-[var(--app-accent-soft)] p-2 text-[9px] leading-4 text-[var(--app-text)]">
        <Info size={12} class="mt-0.5 shrink-0 text-[var(--app-accent)]" />
        <span>{m['image_workflow.account_requirement']()}</span>
      </div>
      {#if !codexExecutors.length}
        <div class="flex items-start gap-2 border border-[var(--app-warning)]/40 bg-[var(--app-warning-soft)] p-2 text-[9px] leading-4 text-[var(--app-warning)]"><TriangleAlert size={12} class="mt-0.5 shrink-0" /><span>{m['image_workflow.executor_required']()}</span></div>
      {:else if status && !status.executorReady}
        <div class="flex items-start gap-2 border border-[var(--app-warning)]/40 bg-[var(--app-warning-soft)] p-2 text-[9px] leading-4 text-[var(--app-warning)]"><TriangleAlert size={12} class="mt-0.5 shrink-0" /><span>{m['image_workflow.executor_offline']()}</span></div>
      {/if}
    </section>

    <section class="space-y-2 border-b border-[var(--app-border)] p-3">
      <div class="flex items-center justify-between gap-2">
        <label for={`image-prompt-${id}`} class="font-semibold text-[var(--app-text)]">{m['image_workflow.prompt']()}</label>
        <span class="font-mono text-[9px] text-[var(--app-text-muted)]">{prompt.length}/32000</span>
      </div>
      <Textarea id={`image-prompt-${id}`} bind:value={prompt} maxlength={32000} class="min-h-24 resize-y text-[11px] leading-4" placeholder={m['image_workflow.prompt_placeholder']()} onblur={() => void persist()} />
      <div class="flex flex-wrap gap-1">
        <span class="inline-flex h-5 items-center gap-1 border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-1.5 text-[9px] text-[var(--app-text-muted)]"><StickyNote size={9} class="text-[var(--app-warning)]" />{m['image_workflow.context_count']({ count: String(contexts.length) })}</span>
        <span class="inline-flex h-5 items-center gap-1 border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-1.5 text-[9px] text-[var(--app-text-muted)]"><ImageIcon size={9} class="text-cyan-500" />{m['image_workflow.reference_count']({ count: String(references.length) })}</span>
        <span class="inline-flex h-5 items-center gap-1 border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-1.5 text-[9px] text-[var(--app-text-muted)]"><Bot size={9} class="text-[var(--app-accent)]" />{status?.executorTitle ?? codexExecutors[0]?.targetTitle ?? m['image_workflow.no_executor']()}</span>
      </div>
      {#if references.length}
        <div class="flex gap-1.5 overflow-x-auto pb-1">
          {#each references as reference, index (reference.edgeId)}
            <button class="group relative size-12 shrink-0 overflow-hidden border border-[var(--app-border)] bg-[var(--app-canvas)]" title={`${index + 1}. ${reference.targetTitle}`} onclick={() => data.onJumpToNode?.(reference.targetId)}>
              {#if reference.targetPayload?.path}<img class="size-full object-cover" src={`/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(String(reference.targetPayload.path))}`} alt={reference.targetTitle} />{/if}
              <span class="absolute top-0 left-0 grid size-4 place-items-center bg-black/70 text-[8px] text-white">{index + 1}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <section class="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-[var(--app-border)] p-3">
      <label class="space-y-1"><span class="text-[9px] font-medium text-[var(--app-text-muted)]">{m['image_workflow.count']()}</span><NativeSelect.Root size="sm" class="w-full" value={String(count)} onchange={(event) => chooseCount((event.currentTarget as HTMLSelectElement).value)}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option></NativeSelect.Root></label>
      <label class="flex min-w-0 items-center justify-between gap-3 border border-[var(--app-border)] bg-[var(--app-surface-raised)] px-2.5 py-2">
        <span class="min-w-0"><strong class="block text-[9px] text-[var(--app-text)]">{m['image_workflow.transparent']()}</strong><small class="mt-0.5 block text-[8px] leading-3 text-[var(--app-text-muted)]">{m['image_workflow.transparent_help']()}</small></span>
        <Switch checked={transparentBackground} onCheckedChange={(checked: boolean) => { transparentBackground = checked; void persist(); }} />
      </label>
    </section>

    <section class="space-y-2 border-b border-[var(--app-border)] p-3">
      <div class="grid grid-cols-[minmax(0,1fr)_minmax(100px,.55fr)] gap-2">
        <label class="space-y-1"><span class="text-[9px] font-medium text-[var(--app-text-muted)]">{m['image_workflow.output_folder']()}</span><Input bind:value={outputDirectory} class="h-7 font-mono text-[10px]" onblur={() => void persist()} /></label>
        <label class="space-y-1"><span class="text-[9px] font-medium text-[var(--app-text-muted)]">{m['image_workflow.file_prefix']()}</span><Input bind:value={filePrefix} class="h-7 font-mono text-[10px]" onblur={() => void persist()} /></label>
      </div>
      <p class="text-[9px] leading-4 text-[var(--app-text-muted)]">{m['image_workflow.output_help']()}</p>
    </section>

    {#if errorCode}
      <div class="m-3 flex items-start gap-2 border border-[var(--app-danger)]/35 bg-[var(--app-danger-soft)] p-2 text-[10px] leading-4 text-[var(--app-danger)]" role="alert"><TriangleAlert size={12} class="mt-0.5 shrink-0" /><span>{errorLabel(errorCode)}</span></div>
    {/if}

    <section class="mt-auto flex items-center gap-2 p-3">
      <Button class="min-w-0 flex-1" size="sm" disabled={running || !prompt.trim() || !status?.executorReady} onclick={() => void run()}>
        {#if running}<LoaderCircle size={12} class="animate-spin" />{:else}<Sparkles size={12} />{/if}{running ? m['image_workflow.running']() : m['image_workflow.run']()}
      </Button>
      <span class="text-right text-[9px] leading-3 text-[var(--app-text-muted)]">{#if latest}{m['image_workflow.last_run']({ count: String(latest.outputPaths.length) })}{:else if outputs.length}{m['image_workflow.output_count']({ count: String(outputs.length) })}{:else}{m['image_workflow.no_runs']()}{/if}</span>
    </section>
  </div>
</NodeShell>
