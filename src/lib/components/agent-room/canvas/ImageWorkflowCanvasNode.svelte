<script lang="ts">
  import { onMount } from 'svelte';
  import { useEdges, useNodes, type NodeProps } from '@xyflow/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { Bot, CircleStop, Image as ImageIcon, Info, LoaderCircle, Play, Sparkles, StickyNote, TriangleAlert, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import { Textarea } from '$lib/components/ui/textarea';
  import type { ImageWorkflowNodePayload, ImageWorkflowOutputPreset, ImageWorkflowRun } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import { connectedEdgesFor, nodeIndexFor } from './floating-anchor.js';

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
    onPayloadDraftChange?: (id: string, partial: Record<string, unknown>) => void;
    onPayloadChange: (id: string, partial: Record<string, unknown>) => Promise<void> | void;
    onJumpToNode?: (id: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: Data }>();

  const presetDimensions: Record<Exclude<ImageWorkflowOutputPreset, 'auto' | 'custom'>, { width: number; height: number }> = {
    'instagram-square': { width: 1080, height: 1080 },
    'instagram-portrait': { width: 1080, height: 1350 },
    'instagram-story': { width: 1080, height: 1920 },
    tiktok: { width: 1080, height: 1920 },
  };

  function initialConfig() {
    const payload = data.payload;
    const preset = (payload.outputPreset ?? 'auto') as ImageWorkflowOutputPreset;
    const dimensions = preset === 'auto' || preset === 'custom' ? null : presetDimensions[preset];
    return {
      prompt: String(payload.prompt ?? ''),
      count: Math.min(10, Math.max(1, Number(payload.count ?? 1))),
      transparentBackground: Boolean(payload.transparentBackground),
      outputPreset: preset,
      targetWidth: payload.targetWidth ?? dimensions?.width ?? 1080,
      targetHeight: payload.targetHeight ?? dimensions?.height ?? 1920,
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
  let outputPreset = $state<ImageWorkflowOutputPreset>(initial.outputPreset);
  let targetWidth = $state(initial.targetWidth);
  let targetHeight = $state(initial.targetHeight);
  let outputDirectory = $state(initial.outputDirectory);
  let filePrefix = $state(initial.filePrefix);
  let status = $state<Status | null>(null);
  let running = $state(initial.running);
  let errorCode = $state<string | null>(initial.lastError);

  $effect(() => {
    prompt = String(data.payload.prompt ?? '');
    count = Math.min(10, Math.max(1, Number(data.payload.count ?? 1)));
    transparentBackground = Boolean(data.payload.transparentBackground);
    outputPreset = (data.payload.outputPreset ?? 'auto') as ImageWorkflowOutputPreset;
    const dimensions = outputPreset === 'auto' || outputPreset === 'custom' ? null : presetDimensions[outputPreset];
    targetWidth = data.payload.targetWidth ?? dimensions?.width ?? 1080;
    targetHeight = data.payload.targetHeight ?? dimensions?.height ?? 1920;
    outputDirectory = String(data.payload.outputDirectory ?? 'generated/images');
    filePrefix = String(data.payload.filePrefix ?? 'orkestrai-image');
  });

  const flowEdges = useEdges();
  const flowNodes = useNodes();
  const connections = $derived.by(() => connectedEdgesFor(id, flowEdges.current)
    .map((edge): ConnectedNode => {
      const outgoing = edge.source === id;
      const targetId = outgoing ? edge.target : edge.source;
      const target = nodeIndexFor(flowNodes.current).get(targetId);
      return {
        edgeId: edge.id,
        targetId,
        targetTitle: String(target?.data?.title ?? target?.type ?? m['canvas.fallback_node']()),
        targetType: String(target?.type ?? m['canvas.fallback_node']()),
        targetPayload: (target?.data?.payload ?? {}) as Record<string, unknown>,
        direction: outgoing ? 'out' : 'in',
      };
    }));
  function orderedConnections(items: ConnectedNode[], order: string[] | undefined) {
    if (!order?.length) return items;
    const index = new Map(order.map((nodeId, position) => [nodeId, position]));
    return items.map((item, position) => ({ item, position })).sort((left, right) => {
      const leftOrder = index.get(left.item.targetId);
      const rightOrder = index.get(right.item.targetId);
      if (leftOrder == null && rightOrder == null) return left.position - right.position;
      if (leftOrder == null) return 1;
      if (rightOrder == null) return -1;
      return leftOrder - rightOrder;
    }).map(({ item }) => item);
  }
  const references = $derived(orderedConnections(connections.filter((connection) => {
    if (connection.targetType !== 'image') return false;
    const generatedBy = connection.targetPayload?.generatedBy as { workflowNodeId?: unknown } | undefined;
    return generatedBy?.workflowNodeId !== id;
  }), data.payload.referenceOrder));
  const contexts = $derived(orderedConnections(connections.filter((connection) => connection.targetType === 'note'), data.payload.contextOrder));
  const executors = $derived(connections.filter((connection) => connection.targetType === 'terminal'));
  const codexExecutors = $derived(executors.filter((connection) => connection.targetPayload?.provider === 'codex'));
  const outputs = $derived(connections.filter((connection) => {
    const generatedBy = connection.targetPayload?.generatedBy as { workflowNodeId?: unknown } | undefined;
    return connection.targetType === 'image' && generatedBy?.workflowNodeId === id;
  }));
  const history = $derived((data.payload.history ?? []) as ImageWorkflowRun[]);
  const latest = $derived(history.at(-1) ?? null);

  // Leitura do estado ja existente para a interface: quem executa, se esta
  // pronto e, quando o botao Gerar esta bloqueado, o motivo em uma linha.
  const executorState = $derived.by((): 'missing' | 'checking' | 'ready' | 'offline' => {
    if (!codexExecutors.length) return 'missing';
    if (!status) return 'checking';
    return status.executorReady ? 'ready' : 'offline';
  });
  const executorName = $derived(status?.executorTitle ?? codexExecutors[0]?.targetTitle ?? m['image_workflow.no_executor']());
  const blockedHint = $derived.by(() => {
    if (running) return null;
    if (executorState === 'missing') return m['image_workflow.blocked_executor']();
    if (executorState === 'offline') return m['image_workflow.blocked_offline']();
    if (!prompt.trim()) return m['image_workflow.blocked_prompt']();
    return null;
  });

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
      outputPreset,
      targetWidth: outputPreset === 'auto' ? null : targetWidth,
      targetHeight: outputPreset === 'auto' ? null : targetHeight,
      outputDirectory: outputDirectory.trim(),
      filePrefix: filePrefix.trim(),
    };
  }

  function stage(partial: Record<string, unknown>): void {
    data.onPayloadDraftChange?.(id, { schemaVersion: 1, ...config(), ...partial });
  }

  async function persist(): Promise<void> {
    const partial = { schemaVersion: 1, ...config() };
    await data.onPayloadChange(id, partial);
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

  function presetLabel(preset: ImageWorkflowOutputPreset): string {
    const labels: Record<ImageWorkflowOutputPreset, () => string> = {
      auto: m['image_workflow.size_auto'],
      'instagram-square': m['image_workflow.size_instagram_square'],
      'instagram-portrait': m['image_workflow.size_instagram_portrait'],
      'instagram-story': m['image_workflow.size_instagram_story'],
      tiktok: m['image_workflow.size_tiktok'],
      custom: m['image_workflow.size_custom'],
    };
    return labels[preset]();
  }

  function choosePreset(next: string) {
    outputPreset = next as ImageWorkflowOutputPreset;
    const dimensions = outputPreset === 'auto' || outputPreset === 'custom' ? null : presetDimensions[outputPreset];
    if (dimensions) {
      targetWidth = dimensions.width;
      targetHeight = dimensions.height;
    }
    void persist();
  }

  function changeDimension(axis: 'width' | 'height', value: string) {
    const parsed = Math.min(3840, Math.max(256, Number.parseInt(value, 10) || 256));
    if (axis === 'width') targetWidth = parsed;
    else targetHeight = parsed;
    stage({ targetWidth, targetHeight });
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
      image_workflow_output_dimensions_invalid: m['image_workflow.error_output_dimensions'],
      image_workflow_output_aspect_mismatch: m['image_workflow.error_output_aspect'],
      image_workflow_target_dimensions_required: m['image_workflow.error_target_dimensions'],
      image_workflow_target_dimensions_invalid: m['image_workflow.error_target_dimensions'],
      image_workflow_output_alpha_missing: m['image_workflow.error_output_alpha'],
      image_workflow_timed_out: m['image_workflow.error_timeout'],
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
  deferOffscreen
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
      <HeaderIconButton class="node-action-btn" label={m['image_workflow.cancel']()} danger onclick={() => void cancel()}><CircleStop size={13} /></HeaderIconButton>
    {:else}
      <HeaderIconButton class="node-action-btn" label={m['image_workflow.run']()} onclick={() => void run()}><Play size={13} /></HeaderIconButton>
    {/if}
    <HeaderIconButton class="node-action-btn" label={m['image_workflow.delete']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  <div class="iw nodrag nowheel flex h-full min-h-0 flex-col overflow-y-auto text-ui-sm overscroll-contain">
    <div class="flex flex-col gap-5 p-3">
      <!-- Quem executa: um cartao com estado em vez de caixas de aviso
           empilhadas; a explicacao da conta fica a um clique no (i). -->
      <section class="iw-executor" data-state={executorState} aria-label={m['image_workflow.native_tool_title']()}>
        <span class="iw-executor-tile" aria-hidden="true"><Bot size={15} /></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1">
            <strong class="text-ui-lg font-semibold text-[var(--app-text)]">{m['image_workflow.native_tool_title']()}</strong>
            <Popover.Root>
              <Popover.Trigger class="iw-info-btn" aria-label={m['image_workflow.about_executor']()} title={m['image_workflow.about_executor']()}>
                <Info size={13} />
              </Popover.Trigger>
              <Popover.Content align="start" class="w-80 gap-2 text-ui-md leading-5 text-[var(--app-text-soft)]">
                <p class="font-semibold text-[var(--app-text)]">{m['image_workflow.about_executor']()}</p>
                <p class="text-pretty">{m['image_workflow.native_tool_help']()}</p>
                <p class="text-pretty">{m['image_workflow.account_requirement']()}</p>
              </Popover.Content>
            </Popover.Root>
          </div>
          <p class="mt-0.5 flex min-w-0 items-center gap-1.5 text-ui-md text-[var(--app-text-soft)]">
            <span class="iw-dot" aria-hidden="true"></span>
            <span class="min-w-0 truncate" title={executorName}>{executorName}</span>
            {#if executorState === 'ready'}
              <span class="shrink-0 text-[var(--app-text-muted)]">· {m['image_workflow.executor_state_ready']()}</span>
            {:else if executorState === 'offline'}
              <span class="shrink-0 text-[var(--app-warning)]">· {m['image_workflow.executor_state_offline']()}</span>
            {:else if executorState === 'checking'}
              <span class="shrink-0 text-[var(--app-text-muted)]">· {m['image_workflow.executor_state_checking']()}</span>
            {/if}
          </p>
          {#if executorState === 'missing'}
            <p class="mt-1.5 text-ui-md leading-[1.45] text-pretty text-[var(--app-text-muted)]">{m['image_workflow.executor_required']()}</p>
          {:else if executorState === 'offline'}
            <p class="mt-1.5 text-ui-md leading-[1.45] text-pretty text-[var(--app-text-muted)]">{m['image_workflow.executor_offline']()}</p>
          {/if}
        </div>
      </section>

      <section class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between gap-2">
          <label for={`image-prompt-${id}`} class="text-ui-lg font-semibold text-[var(--app-text)]">{m['image_workflow.prompt']()}</label>
          <span class="meta-mono">{prompt.length}/32000</span>
        </div>
        <Textarea id={`image-prompt-${id}`} value={prompt} maxlength={32000} class="min-h-24 resize-y text-ui-lg leading-5" placeholder={m['image_workflow.prompt_placeholder']()} oninput={(event: Event & { currentTarget: HTMLTextAreaElement }) => { prompt = event.currentTarget.value; stage({ prompt }); }} onblur={() => void persist()} />
        <div class="flex flex-wrap gap-1.5">
          <span class="iw-chip"><StickyNote size={12} aria-hidden="true" />{m['image_workflow.context_count']({ count: String(contexts.length) })}</span>
          <span class="iw-chip"><ImageIcon size={12} aria-hidden="true" />{m['image_workflow.reference_count']({ count: String(references.length) })}</span>
        </div>
        {#if references.length}
          <div class="flex gap-2 overflow-x-auto p-0.5 pb-1">
            {#each references as reference, index (reference.edgeId)}
              <button class="iw-ref" title={`${index + 1}. ${reference.targetTitle}`} aria-label={`${index + 1}. ${reference.targetTitle}`} onclick={() => data.onJumpToNode?.(reference.targetId)}>
                {#if reference.targetPayload?.path}<img class="size-full object-cover" loading="lazy" decoding="async" src={`/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(String(reference.targetPayload.path))}`} alt={reference.targetTitle} />{:else}<ImageIcon size={16} aria-hidden="true" />{/if}
                <span class="iw-ref-index" aria-hidden="true">{index + 1}</span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="flex flex-col gap-2.5">
        <h3 class="section-label">{m['image_workflow.section_delivery']()}</h3>
        <label class="flex flex-col gap-1.5">
          <span class="iw-field-label">{m['image_workflow.output_size']()}</span>
          <Select.Root type="single" value={outputPreset} onValueChange={choosePreset}>
            <Select.Trigger class="h-8 w-full" aria-label={m['image_workflow.output_size']()}>{presetLabel(outputPreset)}</Select.Trigger>
            <Select.Content>
              {#each ['auto', 'instagram-square', 'instagram-portrait', 'instagram-story', 'tiktok', 'custom'] as preset}
                <Select.Item value={preset} label={presetLabel(preset as ImageWorkflowOutputPreset)}>{presetLabel(preset as ImageWorkflowOutputPreset)}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </label>
        {#if outputPreset === 'custom'}
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1.5"><span class="iw-field-label">{m['image_workflow.width']()}</span><Input type="number" min="256" max="3840" value={targetWidth} class="h-8 font-mono tabular-nums" oninput={(event: Event & { currentTarget: HTMLInputElement }) => changeDimension('width', event.currentTarget.value)} onblur={() => void persist()} /></label>
            <label class="flex flex-col gap-1.5"><span class="iw-field-label">{m['image_workflow.height']()}</span><Input type="number" min="256" max="3840" value={targetHeight} class="h-8 font-mono tabular-nums" oninput={(event: Event & { currentTarget: HTMLInputElement }) => changeDimension('height', event.currentTarget.value)} onblur={() => void persist()} /></label>
          </div>
        {/if}
        <p class="text-ui-sm leading-[1.45] text-pretty text-[var(--app-text-muted)]">
          {#if outputPreset === 'auto'}
            {m['image_workflow.output_size_auto_help']()}
          {:else}
            {m['image_workflow.output_size_exact_help']({ width: String(targetWidth), height: String(targetHeight) })}
          {/if}
        </p>
        <!-- Lista agrupada: rotulo a esquerda, controle a direita. -->
        <div class="iw-group">
          <div class="iw-row">
            <label for={`image-count-${id}`} class="text-ui-lg text-[var(--app-text)]">{m['image_workflow.count']()}</label>
            <NativeSelect.Root id={`image-count-${id}`} size="sm" class="w-20 shrink-0 tabular-nums" value={String(count)} onchange={(event: Event) => chooseCount((event.currentTarget as HTMLSelectElement).value)}>{#each Array.from({ length: 10 }, (_, index) => index + 1) as option}<option value={String(option)}>{option}</option>{/each}</NativeSelect.Root>
          </div>
          <label class="iw-row cursor-pointer">
            <span class="min-w-0"><span class="block text-ui-lg text-[var(--app-text)]">{m['image_workflow.transparent']()}</span><small class="mt-0.5 block text-ui-sm leading-[1.4] text-pretty text-[var(--app-text-muted)]">{m['image_workflow.transparent_help']()}</small></span>
            <Switch checked={transparentBackground} onCheckedChange={(checked: boolean) => { transparentBackground = checked; void persist(); }} />
          </label>
        </div>
      </section>

      <section class="flex flex-col gap-2.5">
        <h3 class="section-label">{m['image_workflow.section_destination']()}</h3>
        <div class="grid grid-cols-[minmax(0,1fr)_minmax(100px,.55fr)] gap-2">
          <label class="flex min-w-0 flex-col gap-1.5"><span class="iw-field-label">{m['image_workflow.output_folder']()}</span><Input value={outputDirectory} class="h-8 font-mono text-ui-md md:text-ui-md" oninput={(event: Event & { currentTarget: HTMLInputElement }) => { outputDirectory = event.currentTarget.value; stage({ outputDirectory }); }} onblur={() => void persist()} /></label>
          <label class="flex min-w-0 flex-col gap-1.5"><span class="iw-field-label">{m['image_workflow.file_prefix']()}</span><Input value={filePrefix} class="h-8 font-mono text-ui-md md:text-ui-md" oninput={(event: Event & { currentTarget: HTMLInputElement }) => { filePrefix = event.currentTarget.value; stage({ filePrefix }); }} onblur={() => void persist()} /></label>
        </div>
        <p class="text-ui-sm leading-[1.45] text-pretty text-[var(--app-text-muted)]">{m['image_workflow.output_help']()}</p>
      </section>
    </div>

    <!-- Rodape fixo: a acao principal nunca some com a rolagem e, quando
         bloqueada, diz o motivo em vez de ficar so apagada. -->
    <footer class="iw-footer">
      {#if errorCode}
        <div class="iw-alert" role="alert"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" /><span>{errorLabel(errorCode)}</span></div>
      {/if}
      <div class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-ui-sm text-[var(--app-text-muted)]" role="status">
          {#if running}{m['image_workflow.running_hint']()}{:else if blockedHint}{blockedHint}{:else if latest}{m['image_workflow.last_run']({ count: String(latest.outputPaths.length) })}{:else if outputs.length}{m['image_workflow.output_count']({ count: String(outputs.length) })}{:else}{m['image_workflow.no_runs']()}{/if}
        </span>
        {#if running}
          <Button size="sm" variant="ghost" onclick={() => void cancel()}>{m['image_workflow.cancel']()}</Button>
        {/if}
        <Button size="sm" class="shrink-0 px-3 disabled:bg-[var(--app-hover)] disabled:text-[var(--app-text-muted)] disabled:opacity-100" disabled={running || !prompt.trim() || !status?.executorReady} onclick={() => void run()}>
          {#if running}<LoaderCircle size={13} class="animate-spin" />{:else}<Sparkles size={13} />{/if}{running ? m['image_workflow.running']() : m['image_workflow.run']()}
        </Button>
      </div>
    </footer>
  </div>
</NodeShell>

<style>
  .iw-executor {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .iw-executor-tile {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text-soft);
  }

  /* Bolinha de estado: cor so para estado, sempre acompanhada de texto. */
  .iw-dot {
    width: 7px;
    height: 7px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  [data-state='ready'] .iw-dot {
    background: var(--app-success);
  }

  [data-state='missing'] .iw-dot,
  [data-state='offline'] .iw-dot {
    background: var(--app-warning);
  }

  .iw :global(.iw-info-btn) {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .iw :global(.iw-info-btn:hover),
  .iw :global(.iw-info-btn[data-state='open']) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .iw :global(.iw-info-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .iw-field-label {
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
  }

  /* Informacao neutra: fundo de hover e texto suave, sem cor de estado. */
  .iw-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .iw-chip :global(svg) {
    color: var(--app-text-muted);
  }

  .iw-ref {
    position: relative;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    padding: 0;
    border: 0;
    border-radius: 8px;
    overflow: hidden;
    background: var(--app-canvas);
    color: var(--app-text-muted);
    cursor: pointer;
    outline: 1px solid var(--app-image-outline);
    outline-offset: -1px;
    transition: box-shadow var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .iw-ref:hover {
    box-shadow: 0 0 0 2px var(--app-secondary);
  }

  .iw-ref:active {
    transform: scale(var(--scale-press));
  }

  .iw-ref:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .iw-ref-index {
    position: absolute;
    top: 3px;
    left: 3px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--app-surface-raised) 88%, transparent);
    color: var(--app-text);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 16px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .iw-group {
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .iw-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    padding: 8px 12px;
  }

  .iw-row + .iw-row {
    border-top: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  .iw-footer {
    position: sticky;
    bottom: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: auto;
    padding: 10px 12px;
    border-top: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    background: var(--app-surface);
  }

  .iw-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
    animation: iw-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes iw-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro));
    }
  }
</style>
