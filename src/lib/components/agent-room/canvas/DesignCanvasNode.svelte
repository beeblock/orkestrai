<script lang="ts">
  import { onMount } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { AlertTriangle, CheckCircle2, Clock3, Maximize2, MessageSquareWarning, Palette, RefreshCw, ScanEye, X } from '@lucide/svelte';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
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
    <HeaderIconButton label={m['design.edit']()} class="node-action-btn" side="left" onclick={() => data.onOpenWorkbench?.(id)}><Maximize2 size={12} /></HeaderIconButton>
    <HeaderIconButton label={m['usage.refresh']()} class="node-action-btn" side="left" onclick={() => void load()}><RefreshCw size={12} /></HeaderIconButton>
    <HeaderIconButton label={m['settings.delete']()} class="node-action-btn danger" side="left" onclick={() => data.onDelete(id)}><X size={12} /></HeaderIconButton>
  {/snippet}

  <button class="nodrag nowheel relative block h-full min-h-0 w-full overflow-hidden bg-[var(--app-canvas)] text-left" ondblclick={() => data.onOpenWorkbench?.(id)} aria-label={m['design.edit']()}>
    {#if loading}
      <span class="absolute inset-0 grid place-items-center text-xs text-[var(--app-text-muted)]">{m['design.loading']()}</span>
    {:else if failed || !document || !page}
      <span class="absolute inset-0 grid place-items-center text-xs text-[var(--app-danger)]">{m['design.error_load']()}</span>
    {:else}
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
        <span
          class="absolute top-2 left-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded border px-2 py-1 text-[9px] font-medium shadow-sm backdrop-blur-sm"
          class:border-[color-mix(in_srgb,var(--app-success)_45%,var(--app-border))]={explorationStatus.tone === 'success'}
          class:bg-[color-mix(in_srgb,var(--app-success)_14%,var(--app-surface))]={explorationStatus.tone === 'success'}
          class:text-[var(--app-success)]={explorationStatus.tone === 'success'}
          class:border-[color-mix(in_srgb,var(--app-warning)_45%,var(--app-border))]={explorationStatus.tone === 'warning'}
          class:bg-[color-mix(in_srgb,var(--app-warning)_14%,var(--app-surface))]={explorationStatus.tone === 'warning'}
          class:text-[var(--app-warning)]={explorationStatus.tone === 'warning'}
          class:border-[color-mix(in_srgb,var(--app-danger)_45%,var(--app-border))]={explorationStatus.tone === 'danger'}
          class:bg-[color-mix(in_srgb,var(--app-danger)_14%,var(--app-surface))]={explorationStatus.tone === 'danger'}
          class:text-[var(--app-danger)]={explorationStatus.tone === 'danger'}
          class:border-[color-mix(in_srgb,var(--app-info)_45%,var(--app-border))]={explorationStatus.tone === 'info'}
          class:bg-[color-mix(in_srgb,var(--app-info)_14%,var(--app-surface))]={explorationStatus.tone === 'info'}
          class:text-[var(--app-info)]={explorationStatus.tone === 'info'}
          class:border-[color-mix(in_srgb,var(--app-secondary)_45%,var(--app-border))]={explorationStatus.tone === 'active'}
          class:bg-[color-mix(in_srgb,var(--app-secondary)_14%,var(--app-surface))]={explorationStatus.tone === 'active'}
          class:text-[var(--app-secondary)]={explorationStatus.tone === 'active'}
          class:border-[var(--app-border)]={explorationStatus.tone === 'muted'}
          class:bg-[var(--app-surface)]={explorationStatus.tone === 'muted'}
          class:text-[var(--app-text-muted)]={explorationStatus.tone === 'muted'}
        >
          <StatusIcon size={11} class="shrink-0" />
          <span class="truncate">{explorationStatus.label}</span>
        </span>
      {/if}
      {#if delivery}
        <span
          class="absolute right-2 bottom-8 left-2 flex items-center gap-2 rounded border border-[var(--app-border)] bg-[var(--app-surface)]/95 px-2 py-1 text-[9px] shadow-sm backdrop-blur-sm"
          title={delivery.missing.length ? m['design.delivery_missing']({ items: delivery.missing.map(deliveryRequirementLabel).join(', ') }) : m['design.delivery_complete']()}
        >
          <span class="shrink-0 font-medium text-[var(--app-text)]">{m['design.delivery_progress']({ completed: String(delivery.completed.length), total: String(delivery.total) })}</span>
          <span class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--app-surface-subtle)]"><span class={`block h-full ${delivery.deliveryComplete ? 'bg-[var(--app-success)]' : 'bg-[var(--app-warning)]'}`} style:width={`${delivery.completed.length / delivery.total * 100}%`}></span></span>
          {#if delivery.missing.length}<span class="min-w-0 truncate text-[var(--app-text-muted)]">{deliveryRequirementLabel(delivery.missing[0])}</span>{:else}<CheckCircle2 size={11} class="shrink-0 text-[var(--app-success)]" />{/if}
        </span>
      {/if}
      <span class="absolute right-2 bottom-2 left-2 truncate rounded bg-[var(--app-surface)]/90 px-1.5 py-1 text-[9px] text-[var(--app-text-muted)] shadow-sm">
        {m['design.layers_count']({ count: elements.length })} · {document.components.length} {m['design.components']()} · {document.variables.length} {m['design.tokens']()} · {document.codeArtifacts.length} {m['design.delivery_artifacts']()} · {m['design.revision']({ revision: document.revision })}
      </span>
    {/if}
  </button>
</NodeShell>
