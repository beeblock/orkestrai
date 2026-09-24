<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { AlertCircle, CheckCircle2, Clock3, Eye, History, Info, LayoutTemplate, MessageSquareWarning, RotateCcw, ShieldCheck, TriangleAlert, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type { DesignDocument } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import type { DesignMaintenanceStatus } from '$lib/modules/agent-room/application/services/DesignDocumentService.js';
  import { auditDesignDocument, type DesignQualityIssue, type DesignQualityRule } from '$lib/modules/agent-room/domain/design-quality.js';
  import { designTemplateIds, type DesignTemplateId } from '$lib/modules/agent-room/domain/design-templates.js';
  import { isDesignExplorationPayload } from '$lib/modules/agent-room/domain/design-exploration.js';
  import { designDeliveryReadiness, type DesignDeliveryRequirement } from '$lib/modules/agent-room/domain/design-delivery-readiness.js';
  import * as m from '$lib/paraglide/messages.js';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';

  let {
    workspaceId,
    nodeId,
    document,
    saving,
    onSelect,
    onDocumentChange,
  }: {
    workspaceId: string;
    nodeId: string;
    document: DesignDocument;
    saving: boolean;
    onSelect: (elementId: string) => void;
    onDocumentChange: (document: DesignDocument) => void;
  } = $props();

  let maintenance = $state<DesignMaintenanceStatus | null>(null);
  let busy = $state(false);
  let restoreOpen = $state(false);
  let templateConfirmOpen = $state(false);
  let pendingTemplate = $state<DesignTemplateId | null>(null);
  let reviewNode = $state<{
    payload: {
      workflowKind?: string;
      explorationId?: string;
      explorationWork?: { phase?: string };
      visualReview?: { status?: string; revision?: number | null; note?: string; reviewedAt?: string | null };
    };
  } | null>(null);
  let reviewMode = $state(false);
  let reviewNote = $state('');
  let reviewing = $state(false);
  let reviewError = $state('');
  const report = $derived(auditDesignDocument(document));
  const isExploration = $derived(isDesignExplorationPayload(reviewNode?.payload));
  const visualReview = $derived(reviewNode?.payload.visualReview ?? null);
  const reviewIsCurrent = $derived(Boolean(visualReview?.revision && visualReview.revision === document.revision));
  const reviewWorkActive = $derived(reviewNode?.payload.explorationWork?.phase === 'active');
  const delivery = $derived(isExploration ? designDeliveryReadiness(document, reviewNode?.payload) : null);

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

  async function request<T>(init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/quality`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['design.quality_action_error']());
    return payload.data as T;
  }

  async function loadMaintenance() {
    try {
      const data = await request<{ maintenance: DesignMaintenanceStatus }>();
      maintenance = data.maintenance;
    } catch {
      maintenance = null;
    }
  }

  async function loadReviewNode() {
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/nodes/${nodeId}`);
      const payload = await response.json();
      reviewNode = response.ok && !payload.error ? payload.data : null;
    } catch {
      reviewNode = null;
    }
  }

  async function submitVisualReview(status: 'approved' | 'changes_requested') {
    if (reviewing || !isExploration) return;
    const note = reviewNote.trim();
    if (status === 'changes_requested' && !note) {
      reviewError = m['design.visual_review_feedback_required']();
      return;
    }
    reviewing = true;
    reviewError = '';
    try {
      const csrf = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/designs/${nodeId}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        body: JSON.stringify({ status, revision: document.revision, note }),
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        if (payload.error === 'design_review_empty') throw new Error(m['design.visual_review_empty']());
        if (payload.error === 'design_review_work_active') throw new Error(m['design.visual_review_work_active']());
        throw new Error(m['design.visual_review_error']());
      }
      await loadReviewNode();
      reviewMode = false;
      reviewNote = '';
      toast.success(m['design.visual_review_saved']());
    } catch (error) {
      reviewError = error instanceof Error ? error.message : m['design.visual_review_error']();
    } finally {
      reviewing = false;
    }
  }

  async function act(body: Record<string, unknown>) {
    if (busy || saving) return;
    busy = true;
    try {
      const data = await request<{ document?: DesignDocument; maintenance?: DesignMaintenanceStatus }>({ method: 'POST', body: JSON.stringify(body) });
      if (data.document) onDocumentChange(data.document);
      if (data.maintenance) maintenance = data.maintenance;
      await loadMaintenance();
      toast.success(m['design.quality_action_done']());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['design.quality_action_error']());
    } finally {
      busy = false;
      restoreOpen = false;
    }
  }

  function ruleLabel(rule: DesignQualityRule): string {
    if (rule === 'naming') return m['design.quality_rule_naming']();
    if (rule === 'text-clipping') return m['design.quality_rule_text_clipping']();
    if (rule === 'content-clipping') return m['design.quality_rule_content_clipping']();
    if (rule === 'overlap') return m['design.quality_rule_overlap']();
    if (rule === 'contrast') return m['design.quality_rule_contrast']();
    return m['design.quality_rule_accessibility']();
  }

  function issueDetail(issue: DesignQualityIssue): string {
    if (issue.rule === 'naming') return m['design.quality_detail_naming']({ name: String(issue.data.name ?? '') });
    if (issue.rule === 'text-clipping') return m['design.quality_detail_text_clipping']({ required: String(issue.data.requiredHeight), current: String(issue.data.height) });
    if (issue.rule === 'content-clipping') return m['design.quality_detail_content_clipping']({ parent: String(issue.data.parent ?? '') });
    if (issue.rule === 'overlap') return m['design.quality_detail_overlap']({ name: String(issue.data.relatedName ?? ''), percent: String(issue.data.percent ?? 0) });
    if (issue.rule === 'contrast') return m['design.quality_detail_contrast']({ ratio: String(issue.data.ratio), threshold: String(issue.data.threshold) });
    return m['design.quality_detail_accessibility']({ role: String(issue.data.role ?? '') });
  }

  function templateLabel(id: DesignTemplateId): string {
    if (id === 'product') return m['design.template_product']();
    if (id === 'marketing') return m['design.template_marketing']();
    if (id === 'mobile') return m['design.template_mobile']();
    return m['design.template_design_system']();
  }

  function requestTemplate(templateId: DesignTemplateId) {
    if (!document.elements.length) {
      void act({ action: 'apply-template', templateId, baseRevision: document.revision });
      return;
    }
    pendingTemplate = templateId;
    templateConfirmOpen = true;
  }

  function applyPendingTemplate() {
    if (!pendingTemplate) return;
    const templateId = pendingTemplate;
    pendingTemplate = null;
    templateConfirmOpen = false;
    void act({ action: 'apply-template', templateId, baseRevision: document.revision });
  }

  function bytes(value: number): string {
    return value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
  }

  onMount(() => {
    void loadMaintenance();
    void loadReviewNode();
  });
</script>

<div class="flex h-full min-h-0 flex-col text-ui-sm">
  <div class="min-h-0 flex-1 overflow-y-auto">
    <div class="space-y-6 p-4">
      {#if isExploration}
        {#if delivery}
          <section class="space-y-2 rounded-xl bg-[var(--app-surface-raised)] p-3 shadow-[var(--app-shadow-border)]" aria-labelledby="design-delivery-readiness">
            <div class="flex items-center justify-between gap-2">
              <h3 id="design-delivery-readiness" class="text-ui-lg font-semibold">{m['design.delivery_readiness_title']()}</h3>
              <span class={`rounded-full px-2 py-0.5 text-ui-xs font-semibold tabular-nums ${delivery.deliveryComplete ? 'bg-[var(--app-success-soft)] text-[var(--app-success)]' : 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]'}`}>{delivery.completed.length}/{delivery.total}</span>
            </div>
            <p class="text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.delivery_readiness_description']()}</p>
            <div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
              {#each [...delivery.completed, ...delivery.missing] as requirement (requirement)}
                {@const complete = delivery.completed.includes(requirement)}
                <span class={`flex min-w-0 items-center gap-1.5 text-ui-sm ${complete ? 'text-[var(--app-text-soft)]' : 'text-[var(--app-warning)]'}`}>
                  {#if complete}<CheckCircle2 size={13} class="shrink-0 text-[var(--app-success)]" />{:else}<AlertCircle size={13} class="shrink-0" />{/if}
                  <span class="truncate">{deliveryRequirementLabel(requirement)}</span>
                </span>
              {/each}
            </div>
          </section>
        {/if}
        <section class="space-y-3 rounded-xl bg-[var(--app-surface-raised)] p-3 shadow-[var(--app-shadow-border)]" aria-labelledby="design-visual-review">
          <div class="flex items-start gap-2.5">
            <span class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--app-hover)] text-[var(--app-text-soft)]"><Eye size={14} /></span>
            <div class="min-w-0">
              <h3 id="design-visual-review" class="text-ui-lg font-semibold">{m['design.visual_review_title']()}</h3>
              <p class="mt-0.5 text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.visual_review_description']()}</p>
            </div>
          </div>

          {#if visualReview?.revision && !reviewIsCurrent}
            <p class="flex items-start gap-1.5 rounded-lg bg-[var(--app-warning-soft)] p-2 text-ui-sm leading-5"><Clock3 size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{m['design.visual_review_stale']()}</p>
          {:else if reviewIsCurrent && visualReview?.status === 'approved'}
            <p class="flex items-center gap-1.5 rounded-lg bg-[var(--app-success-soft)] p-2 text-ui-sm leading-5"><CheckCircle2 size={13} class="shrink-0 text-[var(--app-success)]" />{m['design.visual_review_approved']({ revision: document.revision })}</p>
          {:else if reviewIsCurrent && visualReview?.status === 'changes_requested'}
            <div class="space-y-1.5 rounded-lg bg-[var(--app-warning-soft)] p-2 text-ui-sm leading-5">
              <p class="flex items-center gap-1.5"><MessageSquareWarning size={13} class="shrink-0 text-[var(--app-warning)]" />{m['design.visual_review_changes']({ revision: document.revision })}</p>
              {#if visualReview.note}<p class="text-[var(--app-text-muted)]">{visualReview.note}</p>{/if}
            </div>
          {:else}
            <p class="rounded-lg bg-[var(--app-hover)] p-2 text-ui-sm leading-5 text-[var(--app-text-soft)]">{m['design.visual_review_pending']({ revision: document.revision })}</p>
          {/if}

          {#if reviewWorkActive}
            <p class="flex items-start gap-1.5 rounded-lg bg-[var(--app-warning-soft)] p-2 text-ui-sm leading-5"><Clock3 size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{m['design.visual_review_work_active']()}</p>
          {/if}

          {#if reviewMode}
            <div class="space-y-2">
              <Textarea bind:value={reviewNote} rows={4} class="min-h-24 resize-y text-ui-md md:text-ui-md" placeholder={m['design.visual_review_feedback']()} aria-label={m['design.visual_review_feedback']()} />
              {#if reviewError}<p class="flex items-center gap-1.5 text-ui-sm text-[var(--app-danger)]" role="alert"><AlertCircle size={13} class="shrink-0" />{reviewError}</p>{/if}
              <div class="flex gap-1.5">
                <Button size="sm" variant="outline" class="min-w-0 flex-1" disabled={reviewing} onclick={() => { reviewMode = false; reviewError = ''; }}><X size={13} /><span class="truncate">{m['design.visual_review_cancel']()}</span></Button>
                <Button size="sm" variant="destructive" class="min-w-0 flex-1" disabled={reviewing} onclick={() => void submitVisualReview('changes_requested')}><MessageSquareWarning size={13} /><span class="truncate">{m['design.visual_review_request_changes']()}</span></Button>
              </div>
            </div>
          {:else}
            {#if reviewError}<p class="flex items-center gap-1.5 text-ui-sm text-[var(--app-danger)]" role="alert"><AlertCircle size={13} class="shrink-0" />{reviewError}</p>{/if}
            <div class="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="outline" class="h-auto min-h-8 whitespace-normal px-2 py-1.5" disabled={reviewing || document.revision < 1} onclick={() => { reviewMode = true; reviewError = ''; }}><MessageSquareWarning size={13} />{m['design.visual_review_request_changes']()}</Button>
              <Button size="sm" class="h-auto min-h-8 whitespace-normal px-2 py-1.5" disabled={reviewing || reviewWorkActive || document.revision < 1} onclick={() => void submitVisualReview('approved')}><CheckCircle2 size={13} />{m['design.visual_review_approve']()}</Button>
            </div>
          {/if}
        </section>
      {/if}

      <section class="space-y-3" aria-labelledby="design-quality-summary">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 id="design-quality-summary" class="flex items-center gap-1.5 text-ui-lg font-semibold"><ShieldCheck size={15} class="text-[var(--app-text-soft)]" />{m['design.quality_summary']()}</h3>
            <p class="mt-1 text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['design.quality_audited']({ count: String(report.auditedElements), duration: String(report.durationMs) })}</p>
            <p class="mt-0.5 text-ui-xs leading-4 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.quality_structural_notice']()}</p>
          </div>
        </div>
        <div class="grid grid-cols-3 gap-2">
          {#each [{ value: report.counts.error, label: m['design.quality_errors'](), tone: 'var(--app-danger)' }, { value: report.counts.warning, label: m['design.quality_warnings'](), tone: 'var(--app-warning)' }, { value: report.counts.info, label: m['design.quality_info'](), tone: 'var(--app-info)' }] as stat (stat.label)}
            <div class="rounded-lg bg-[var(--app-surface-raised)] px-2.5 py-2 shadow-[var(--app-shadow-border)]"><span class="block text-lg leading-6 font-semibold tabular-nums" style:color={stat.value ? stat.tone : 'var(--app-text-muted)'}>{stat.value}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{stat.label}</span></div>
          {/each}
        </div>
        {#if !report.issues.length}
          <div class="rounded-xl bg-[var(--app-success-soft)]">
            <NodeEmptyState compact icon={CheckCircle2} title={m['design.quality_clean_title']()} description={m['design.quality_clean']()} />
          </div>
        {:else}
          <div class="space-y-1">
            {#each report.issues as issue (issue.id)}
              <button type="button" class="flex w-full items-start gap-2.5 rounded-lg bg-[var(--app-surface-raised)] p-2.5 text-left shadow-[var(--app-shadow-border)] transition-shadow duration-150 hover:shadow-[var(--app-shadow-border-hover)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]" onclick={() => onSelect(issue.elementId)}>
                {#if issue.severity === 'error'}<AlertCircle size={14} class="mt-px shrink-0 text-[var(--app-danger)]" />{:else if issue.severity === 'warning'}<TriangleAlert size={14} class="mt-px shrink-0 text-[var(--app-warning)]" />{:else}<Info size={14} class="mt-px shrink-0 text-[var(--app-info)]" />{/if}
                <span class="min-w-0"><strong class="block truncate text-ui-md font-semibold">{ruleLabel(issue.rule)}</strong><span class="mt-0.5 block text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{issueDetail(issue)}</span></span>
              </button>
            {/each}
          </div>
        {/if}
      </section>

      <section class="space-y-2.5 border-t border-[var(--app-border)] pt-5">
        <div><h3 class="flex items-center gap-1.5 text-ui-lg font-semibold"><LayoutTemplate size={15} class="text-[var(--app-text-soft)]" />{m['design.templates']()}</h3><p class="mt-1 text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.templates_description']()}</p></div>
        <div class="grid grid-cols-2 gap-2">
          {#each designTemplateIds as templateId}
            <Button variant="outline" size="sm" class="h-auto min-h-12 justify-start whitespace-normal px-2.5 py-2 text-left text-ui-md" disabled={busy || saving} onclick={() => requestTemplate(templateId)}>{templateLabel(templateId)}</Button>
          {/each}
        </div>
        <AlertDialog.Root bind:open={templateConfirmOpen}>
          <AlertDialog.Content>
            <AlertDialog.Header><AlertDialog.Title>{m['design.apply_template']()}</AlertDialog.Title><AlertDialog.Description>{m['design.apply_template_confirm']({ template: pendingTemplate ? templateLabel(pendingTemplate) : '' })}</AlertDialog.Description></AlertDialog.Header>
            <AlertDialog.Footer><AlertDialog.Cancel onclick={() => pendingTemplate = null}>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={applyPendingTemplate}>{m['design.apply_template']()}</AlertDialog.Action></AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </section>

      <section class="space-y-2.5 border-t border-[var(--app-border)] pt-5">
        <div><h3 class="flex items-center gap-1.5 text-ui-lg font-semibold"><History size={15} class="text-[var(--app-text-soft)]" />{m['design.recovery']()}</h3><p class="mt-1 text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{m['design.recovery_description']()}</p></div>
        {#if maintenance?.recoveredAt}<p class="flex items-start gap-1.5 rounded-lg bg-[var(--app-warning-soft)] p-2 text-ui-sm leading-5"><TriangleAlert size={13} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{m['design.recovered_backup']({ revision: String(maintenance.recoveredRevision ?? '') })}</p>{/if}
        <dl class="space-y-1 rounded-lg bg-[var(--app-hover)] p-2.5 text-ui-sm">
          <div class="flex items-center justify-between gap-2"><dt class="text-[var(--app-text-muted)]">{m['design.automatic_backup']()}</dt><dd class="font-medium tabular-nums">{maintenance?.backupRevision === null || maintenance?.backupRevision === undefined ? m['design.not_available']() : m['design.revision']({ revision: maintenance.backupRevision })}</dd></div>
          <div class="flex items-center justify-between gap-2"><dt class="text-[var(--app-text-muted)]">{m['design.history_size']()}</dt><dd class="font-medium tabular-nums">{bytes(maintenance?.historyBytes ?? 0)}</dd></div>
        </dl>
        <div class="flex gap-1.5">
          <AlertDialog.Root bind:open={restoreOpen}>
            <AlertDialog.Trigger>{#snippet child({ props })}<Button {...props} variant="outline" size="sm" class="min-w-0 flex-1" disabled={busy || saving || maintenance?.backupRevision == null}><RotateCcw size={13} /><span class="truncate">{m['design.restore_backup']()}</span></Button>{/snippet}</AlertDialog.Trigger>
            <AlertDialog.Content>
              <AlertDialog.Header><AlertDialog.Title>{m['design.restore_backup']()}</AlertDialog.Title><AlertDialog.Description>{m['design.restore_backup_confirm']()}</AlertDialog.Description></AlertDialog.Header>
              <AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => void act({ action: 'restore-backup' })}>{m['design.restore_backup']()}</AlertDialog.Action></AlertDialog.Footer>
            </AlertDialog.Content>
          </AlertDialog.Root>
          <Button variant="outline" size="sm" class="min-w-0 flex-1" disabled={busy || saving || !maintenance?.historyBytes} onclick={() => void act({ action: 'compact-history' })}><Clock3 size={13} /><span class="truncate">{m['design.compact_history']()}</span></Button>
        </div>
        <div class="space-y-1 pt-1">
          <h4 class="section-label">{m['design.recent_history']()}</h4>
          {#each maintenance?.historyEntries.slice(0, 5) ?? [] as entry (`${entry.revision}-${entry.createdAt}`)}
            <div class="flex items-start gap-2.5 border-b border-[var(--app-border)] py-1.5 text-ui-sm last:border-b-0"><span class="meta-mono shrink-0 pt-px">r{entry.revision}</span><span class="min-w-0 flex-1 text-[var(--app-text-soft)]">{entry.summary}</span></div>
          {:else}<p class="text-ui-sm text-[var(--app-text-muted)]">{m['design.no_history']()}</p>{/each}
        </div>
      </section>
    </div>
  </div>
</div>
