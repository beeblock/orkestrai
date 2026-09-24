<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, Maximize2, MessageSquareWarning, Palette, RefreshCw, ScanEye, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import DesignRenderer from '../design/DesignRenderer.svelte';
  import type { DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import { designDeliveryReadiness, type DesignDeliveryRequirement } from '$lib/modules/agent-room/domain/design-delivery-readiness.js';
  import { resolveDesignElements } from '$lib/modules/agent-room/domain/design-variables.js';
  import { isDesignExplorationPayload, isDesignExplorationStalled } from '$lib/modules/agent-room/domain/design-exploration.js';
  import * as m from '$lib/paraglide/messages.js';

  export type DesignNodeData = {
    title: string;
    workspaceId: string;
    onDelete: (id: string) => void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
    onOpenWorkbench?: (id: string) => void;
    designRevision?: number;
    payload?: {
      workflowKind?: string;
      explorationId?: string;
      explorationWork?: {
        phase?: string;
        stage?: 'concept' | 'expand' | 'implement' | 'validate';
        startedAt?: string | null;
        lastProgressAt?: string | null;
        revision?: number | null;
      };
      visualReview?: {
        status?: string;
        revision?: number | null;
      };
    };
  };

  let { id, data, selected } = $props<NodeProps & { data: DesignNodeData }>();
  let document = $state<DesignDocument | null>(null);
  let loading = $state(true);
  let failed = $state(false);
  let thumbnailFailed = $state(false);
  let thumbnailAttempt = $state(0);
  let thumbnailRetry: ReturnType<typeof setTimeout> | null = null;
  let clock = $state(Date.now());
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  const page = $derived(document?.pages.find((item) => item.id === document?.activePageId) ?? document?.pages[0] ?? null);
  const elements = $derived(document && page ? resolveDesignElements(document, document.elements.filter((element) => element.pageId === page.id)) : []);
  const delivery = $derived(document && isDesignExplorationPayload(data.payload) ? designDeliveryReadiness(document, data.payload) : null);

  function deliveryRequirementLabel(requirement: DesignDeliveryRequirement): string {
    if (requirement === 'responsiveFrames') return m['design.delivery_requirement_responsiveFrames']();
    if (requirement === 'brandBoard') return m['design.delivery_requirement_brandBoard']();
    if (requirement === 'tokenSystem') return m['design.delivery_requirement_tokenSystem']();
    if (requirement === 'tokenBindings') return m['design.delivery_requirement_tokenBindings']();
    if (requirement === 'components') return m['design.delivery_requirement_components']();
    if (requirement === 'prototype') return m['design.delivery_requirement_prototype']();
    if (requirement === 'codeArtifact') return m['design.delivery_requirement_codeArtifact']();
    return m['design.delivery_requirement_currentApproval']();
  }
  const explorationStatus = $derived.by(() => {
    if (!isDesignExplorationPayload(data.payload) || !document) return null;
    const review = data.payload.visualReview;
    if (review?.revision === document.revision && review.status === 'approved') {
      return { label: m['design.exploration_status_approved'](), tone: 'success', icon: CheckCircle2 };
    }
    if (review?.revision === document.revision && review.status === 'changes_requested') {
      return { label: m['design.exploration_status_changes'](), tone: 'warning', icon: MessageSquareWarning };
    }
    const work = data.payload.explorationWork;
    if (isDesignExplorationStalled(work, clock)) {
      return { label: m['design.exploration_status_stalled'](), tone: 'danger', icon: AlertTriangle };
    }
    if (work?.phase === 'ready_for_review' || (document.revision > 0 && work?.phase !== 'active')) {
      return { label: m['design.exploration_status_ready'](), tone: 'info', icon: ScanEye };
    }
    if (work?.phase === 'active') {
      return { label: m['design.exploration_status_working'](), tone: 'active', icon: Clock3 };
    }
    return { label: m['design.exploration_status_waiting'](), tone: 'muted', icon: Clock3 };
  });

  async function load() {
    loading = true;
    failed = false;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${data.workspaceId}/designs/${id}`);
      const payload = await response.json();
      if (!response.ok || payload.error) throw new Error(payload.error);
      document = payload.data;
      thumbnailFailed = false;
      thumbnailAttempt = 0;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  function retryThumbnail() {
    thumbnailFailed = true;
    if (thumbnailAttempt >= 6) return;
    if (thumbnailRetry) clearTimeout(thumbnailRetry);
    thumbnailRetry = setTimeout(() => {
      thumbnailAttempt += 1;
      thumbnailFailed = false;
    }, 900);
  }

  onMount(() => {
    void load();
    clockTimer = setInterval(() => (clock = Date.now()), 30_000);
    return () => {
      if (thumbnailRetry) clearTimeout(thumbnailRetry);
      if (clockTimer) clearInterval(clockTimer);
    };
  });

  $effect(() => {
    const revision = data.designRevision ?? 0;
    if (!revision || loading || revision <= (document?.revision ?? -1)) return;
    void load();
  });
</script>

<NodeShell
  {id}
  {selected}
  accent="var(--app-secondary)"
  minWidth={360}
  minHeight={260}
  onResize={data.onResize}
  connections={data.connections ?? []}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
  titleText={data.title}
  onRename={data.onRename}
  class="canvas-design"
>
  {#snippet icon()}<Palette size={14} />{/snippet}
  {#snippet title()}{data.title}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['design.edit']()} class="node-action-btn" side="left" onclick={() => data.onOpenWorkbench?.(id)}><Maximize2 size={13} /></HeaderIconButton>
    <HeaderIconButton label={m['usage.refresh']()} class="node-action-btn" side="left" onclick={() => void load()}><RefreshCw size={13} /></HeaderIconButton>
    <HeaderIconButton label={m['settings.delete']()} class="node-action-btn" danger side="left" onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>
  {/snippet}

  {#if loading || failed || !document || !page}
    <!-- Carregando/erro: mesmo duplo-clique para abrir o editor, mas sem
         botao envolvendo a acao de recuperacao. -->
    <div class="nodrag nowheel relative h-full min-h-0 w-full bg-[var(--app-canvas)]" ondblclick={() => data.onOpenWorkbench?.(id)} role="presentation">
      {#if loading}
        <span class="absolute inset-0 grid place-items-center"><span class="dn-pill" role="status"><LoaderCircle size={13} class="animate-spin" />{m['design.loading']()}</span></span>
      {:else}
        <NodeEmptyState icon={AlertTriangle} tone="danger" title={m['design.error_load']()}>
          {#snippet actions()}<Button size="sm" variant="outline" onclick={() => void load()}><RefreshCw size={13} />{m['portal.retry']()}</Button>{/snippet}
        </NodeEmptyState>
      {/if}
    </div>
  {:else}
  {@const stats = `${m['design.layers_count']({ count: elements.length })} · ${document.components.length} ${m['design.components']()} · ${document.variables.length} ${m['design.tokens']()} · ${document.codeArtifacts.length} ${m['design.delivery_artifacts']()} · ${m['design.revision']({ revision: document.revision })}`}
  <!-- Miniatura ocupa o espaco; metadados ficam num rodape proprio em vez
       de flutuar por cima do desenho. -->
  <button class="dn-preview nodrag nowheel flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--app-canvas)] text-left" ondblclick={() => data.onOpenWorkbench?.(id)} aria-label={m['design.edit']()}>
    <span class="relative block min-h-0 w-full flex-1">
      {#if !thumbnailFailed}
        <img
          class="h-full w-full object-contain p-4"
          src={`/api/agent-room/workspaces/${data.workspaceId}/designs/${id}/thumbnail?revision=${document.revision}&attempt=${thumbnailAttempt}`}
          alt=""
          onerror={retryThumbnail}
        />
      {:else}
        <svg class="h-full w-full p-4" viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="xMidYMid meet" style:background={page.background}>
          <DesignRenderer {elements} assets={document.assets} workspaceId={data.workspaceId} />
        </svg>
      {/if}
      {#if explorationStatus}
        {@const StatusIcon = explorationStatus.icon}
        <span class="dn-status absolute top-2 left-2" data-tone={explorationStatus.tone}>
          <StatusIcon size={11} class="shrink-0" aria-hidden="true" />
          <span class="truncate">{explorationStatus.label}</span>
        </span>
      {/if}
    </span>
    {#if delivery}
      <span
        class="dn-bar flex items-center gap-2"
        title={delivery.missing.length ? m['design.delivery_missing']({ items: delivery.missing.map(deliveryRequirementLabel).join(', ') }) : m['design.delivery_complete']()}
      >
        <span class="shrink-0 font-medium text-[var(--app-text)] tabular-nums">{m['design.delivery_progress']({ completed: String(delivery.completed.length), total: String(delivery.total) })}</span>
        <span class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--app-hover)]"><span class={`block h-full rounded-full ${delivery.deliveryComplete ? 'bg-[var(--app-success)]' : 'bg-[var(--app-warning)]'}`} style:width={`${delivery.completed.length / delivery.total * 100}%`}></span></span>
        {#if delivery.missing.length}<span class="min-w-0 truncate text-[var(--app-text-muted)]">{deliveryRequirementLabel(delivery.missing[0])}</span>{:else}<CheckCircle2 size={12} class="shrink-0 text-[var(--app-success)]" aria-hidden="true" />{/if}
      </span>
    {/if}
    <span class="dn-bar block truncate text-[var(--app-text-muted)] tabular-nums" title={stats}>{stats}</span>
  </button>
  {/if}
</NodeShell>

<style>
  .dn-preview:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .dn-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .dn-bar {
    flex-shrink: 0;
    width: 100%;
    min-width: 0;
    min-height: 30px;
    padding: 7px 12px;
    border-top: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent);
    background: var(--app-surface);
    font-size: 11px;
    line-height: 16px;
  }

  .dn-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    max-width: calc(100% - 1rem);
    height: 24px;
    padding: 0 9px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--app-surface-raised) 90%, transparent);
    box-shadow: var(--app-shadow-border);
    backdrop-filter: blur(6px);
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .dn-status[data-tone='success'] {
    background: color-mix(in srgb, var(--app-success) 16%, var(--app-surface-raised));
    color: var(--app-success);
  }

  .dn-status[data-tone='warning'] {
    background: color-mix(in srgb, var(--app-warning) 16%, var(--app-surface-raised));
    color: var(--app-warning);
  }

  .dn-status[data-tone='danger'] {
    background: color-mix(in srgb, var(--app-danger) 16%, var(--app-surface-raised));
    color: var(--app-danger);
  }

  .dn-status[data-tone='info'] {
    background: color-mix(in srgb, var(--app-info) 16%, var(--app-surface-raised));
    color: var(--app-info);
  }

  .dn-status[data-tone='active'] {
    background: color-mix(in srgb, var(--app-secondary) 16%, var(--app-surface-raised));
    color: var(--app-secondary);
  }
</style>
