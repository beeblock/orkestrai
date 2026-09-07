<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { onDestroy } from 'svelte';
  import {
    AlertTriangle, Check, CircleDot, GitMerge, History, LoaderCircle, RefreshCw,
    Scale, ShieldCheck, Sparkles, Users, XCircle,
  } from '@lucide/svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import * as Table from '$lib/components/ui/table';
  import { Textarea } from '$lib/components/ui/textarea';
  import type {
    CouncilCriterion,
    CouncilData,
    CouncilMode,
    CouncilPerspectiveData,
  } from '$lib/modules/agent-room/contracts/schemas/council.schema.js';
  import { createCouncilSchema, decideCouncilSchema } from '$lib/modules/agent-room/contracts/schemas/council.schema.js';
  import type { ProviderUsage } from '$lib/modules/agent-room/application/services/UsageService.js';
  import * as m from '$lib/paraglide/messages.js';

  type AgentOption = {
    id: string;
    title: string;
    provider: string;
    model: string | null;
    role: string | null;
    maestro: boolean;
  };
  type TaskOption = { id: string; title: string; description: string | null };
  type CouncilSnapshot = {
    councils: CouncilData[];
    agents: AgentOption[];
    tasks: TaskOption[];
    usage: ProviderUsage[];
  };
  type CouncilSource = { taskId?: string; taskTitle?: string; taskDescription?: string | null; leaderNodeId?: string };
  type LandingPreview = { floor: string; from: string; to: string; stat: string; conflicts: string[]; targetDirty: boolean };

  let {
    open = $bindable(false),
    workspaceId,
    source = null,
  }: { open?: boolean; workspaceId: string; source?: CouncilSource | null } = $props();

  let snapshot = $state<CouncilSnapshot | null>(null);
  let loading = $state(false);
  let busy = $state(false);
  let errorMessage = $state('');
  let view = $state<'create' | 'details'>('create');
  let activeCouncilId = $state<string | null>(null);
  let title = $state('');
  let objective = $state('');
  let taskId = $state('');
  let mode = $state<CouncilMode>('advisory');
  let criterion = $state<CouncilCriterion>('balanced');
  let customCriterion = $state('');
  let requestLeaderRecommendation = $state(true);
  let leaderNodeId = $state('');
  let selectedAgents = $state<string[]>([]);
  let approaches = $state<Record<string, string>>({});
  let decisionNote = $state('');
  let selectedPerspectiveId = $state('');
  let landingPerspective = $state<CouncilPerspectiveData | null>(null);
  let landingPreview = $state<LandingPreview | null>(null);
  let landingLoading = $state(false);
  let loadedOpenCycle = false;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const activeCouncil = $derived(snapshot?.councils.find((item) => item.id === activeCouncilId) ?? null);
  const requiredExecutions = $derived(selectedAgents.length + (requestLeaderRecommendation ? 1 : 0));
  const canStart = $derived(
    title.trim().length > 0
      && objective.trim().length >= 10
      && selectedAgents.length >= 2
      && selectedAgents.length <= 5
      && (!requestLeaderRecommendation || Boolean(leaderNodeId))
      && (criterion !== 'custom' || customCriterion.trim().length >= 3),
  );

  function headers(): HeadersInit {
    const csrf = getCsrfToken();
    return { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
  }

  async function api<T>(path: string, init?: RequestInit, fallback = m['council.error_api']()): Promise<T> {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || payload.error) throw new Error(fallback);
    return payload.data as T;
  }

  function resetForm(): void {
    title = source?.taskTitle ? m['council.title_from_task']({ title: source.taskTitle }) : '';
    objective = [source?.taskTitle, source?.taskDescription].filter(Boolean).join('\n\n');
    taskId = source?.taskId ?? '';
    mode = 'advisory';
    criterion = 'balanced';
    customCriterion = '';
    requestLeaderRecommendation = true;
    leaderNodeId = source?.leaderNodeId ?? snapshot?.agents.find((agent) => agent.maestro)?.id ?? '';
    selectedAgents = [];
    approaches = {};
    decisionNote = '';
    selectedPerspectiveId = '';
    view = 'create';
    activeCouncilId = null;
  }

  async function refresh(preserve = true): Promise<void> {
    errorMessage = '';
    try {
      const next = await api<CouncilSnapshot>(
        `/api/agent-room/workspaces/${workspaceId}/councils`,
        undefined,
        m['council.error_load'](),
      );
      snapshot = next;
      if (!leaderNodeId) leaderNodeId = source?.leaderNodeId ?? next.agents.find((agent) => agent.maestro)?.id ?? '';
      if (preserve && activeCouncilId) {
        activeCouncilId = next.councils.some((item) => item.id === activeCouncilId) ? activeCouncilId : null;
      }
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['council.error_load']();
    } finally {
      loading = false;
    }
  }

  function usageFor(provider: string): ProviderUsage | null {
    return snapshot?.usage.find((item) => item.provider === provider) ?? null;
  }

  function usageSummary(provider: string): string {
    const usage = usageFor(provider);
    if (!usage || usage.error || usage.windows.length === 0) return m['council.usage_unavailable']();
    return usage.windows.map((window) => `${window.label} ${window.usedPercent}%`).join(' · ');
  }

  function toggleAgent(agentId: string, checked: boolean): void {
    if (checked && !selectedAgents.includes(agentId) && selectedAgents.length < 5) selectedAgents = [...selectedAgents, agentId];
    if (!checked) selectedAgents = selectedAgents.filter((id) => id !== agentId);
  }

  async function startCouncil(): Promise<void> {
    errorMessage = '';
    const input = createCouncilSchema.safeParse({
      title,
      objective,
      taskId: taskId || null,
      leaderNodeId: requestLeaderRecommendation ? leaderNodeId || null : null,
      mode,
      criterion,
      customCriterion: criterion === 'custom' ? customCriterion : null,
      requestLeaderRecommendation,
      maxExecutions: requiredExecutions,
      perspectives: selectedAgents.map((agentNodeId) => ({ agentNodeId, approach: approaches[agentNodeId] ?? '' })),
    });
    if (!input.success) {
      errorMessage = m['council.error_form']();
      return;
    }
    busy = true;
    try {
      const council = await api<CouncilData>(`/api/agent-room/workspaces/${workspaceId}/councils`, {
        method: 'POST', headers: headers(), body: JSON.stringify(input.data),
      }, m['council.error_start']());
      await refresh(false);
      activeCouncilId = council.id;
      view = 'details';
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['council.error_start']();
    } finally {
      busy = false;
    }
  }

  function openCouncil(council: CouncilData): void {
    activeCouncilId = council.id;
    selectedPerspectiveId = council.selectedPerspectiveId ?? council.recommendation?.perspectiveId ?? '';
    decisionNote = council.decisionNote ?? '';
    view = 'details';
  }

  async function decide(status: 'selected' | 'consensus_requested' | 'rejected'): Promise<void> {
    if (!activeCouncil) return;
    const input = decideCouncilSchema.safeParse({
      status,
      selectedPerspectiveId: status === 'selected' ? selectedPerspectiveId || null : null,
      note: decisionNote || null,
    });
    if (!input.success) {
      errorMessage = m['council.error_decision']();
      return;
    }
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/councils/${activeCouncil.id}`, {
        method: 'PATCH', headers: headers(), body: JSON.stringify(input.data),
      }, m['council.error_decision']());
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['council.error_decision']();
    } finally {
      busy = false;
    }
  }

  async function inspectLanding(perspective: CouncilPerspectiveData): Promise<void> {
    if (!activeCouncil) return;
    landingPerspective = perspective;
    landingPreview = null;
    landingLoading = true;
    try {
      landingPreview = await api<LandingPreview>(
        `/api/agent-room/workspaces/${workspaceId}/councils/${activeCouncil.id}/perspectives/${perspective.id}/preview`,
        undefined,
        m['council.error_preview'](),
      );
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['council.error_preview']();
      landingPerspective = null;
    } finally {
      landingLoading = false;
    }
  }

  async function landSelected(): Promise<void> {
    if (!activeCouncil || !landingPerspective || !landingPreview) return;
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/councils/${activeCouncil.id}/perspectives/${landingPerspective.id}/land`, {
        method: 'POST', headers: headers(), body: JSON.stringify({ confirm: true, targetBranch: landingPreview.to }),
      }, m['council.error_land']());
      landingPerspective = null;
      landingPreview = null;
      await refresh();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['council.error_land']();
    } finally {
      busy = false;
    }
  }

  function statusLabel(status: CouncilData['status'] | CouncilPerspectiveData['status']): string {
    if (status === 'pending') return m['council.status_pending']();
    if (status === 'running') return m['council.status_running']();
    if (status === 'completed') return m['council.status_completed']();
    if (status === 'ready') return m['council.status_ready']();
    if (status === 'partial') return m['council.status_partial']();
    if (status === 'failed') return m['council.status_failed']();
    if (status === 'selected') return m['council.status_selected']();
    if (status === 'consensus_requested') return m['council.status_consensus_requested']();
    return m['council.status_rejected']();
  }

  function criterionLabel(value: CouncilCriterion): string {
    if (value === 'quality') return m['council.criterion_quality']();
    if (value === 'speed') return m['council.criterion_speed']();
    if (value === 'risk') return m['council.criterion_risk']();
    if (value === 'cost') return m['council.criterion_cost']();
    if (value === 'custom') return m['council.criterion_custom']();
    return m['council.criterion_balanced']();
  }

  function confidenceTone(value: number): string {
    if (value >= 75) return 'text-[var(--app-success)]';
    if (value >= 50) return 'text-[var(--app-warning)]';
    return 'text-[var(--app-danger)]';
  }

  $effect(() => {
    if (open && !loadedOpenCycle) {
      loadedOpenCycle = true;
      loading = true;
      void refresh(false).then(() => resetForm());
    } else if (!open) {
      loadedOpenCycle = false;
    }
  });

  $effect(() => {
    const shouldPoll = open && view === 'details' && activeCouncil?.status === 'running';
    if (shouldPoll && !pollTimer) pollTimer = setInterval(() => void refresh(), 1_500);
    if (!shouldPoll && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  onDestroy(() => pollTimer && clearInterval(pollTimer));
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[90vh] min-h-[min(720px,90vh)] flex-col gap-0 overflow-hidden p-0 [--app-text-muted:var(--app-text-soft)] sm:max-w-[min(1120px,calc(100vw-3rem))]" data-testid="council-dialog">
    <Dialog.Header class="border-b border-[var(--app-border)] px-5 py-4 pr-12">
      <div class="flex items-center gap-2.5">
        <span class="grid size-8 place-items-center rounded-md bg-[var(--app-accent)]/12 text-[var(--app-accent)]"><Scale size={17} /></span>
        <div>
          <Dialog.Title>{m['council.title']()}</Dialog.Title>
          <Dialog.Description class="text-[var(--app-text-soft)]">{m['council.description']()}</Dialog.Description>
        </div>
      </div>
    </Dialog.Header>

    {#if loading}
      <div class="grid flex-1 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={22} /><span class="sr-only">{m['council.loading']()}</span></div>
    {:else}
      <div class="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] max-[760px]:grid-cols-1">
        <aside class="min-h-0 overflow-y-auto border-r border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3 max-[760px]:max-h-36 max-[760px]:border-b max-[760px]:border-r-0">
          <Button class="mb-3 w-full justify-start" variant={view === 'create' ? 'secondary' : 'ghost'} onclick={() => resetForm()}>
            <Sparkles size={14} />{m['council.new']()}
          </Button>
          <div class="mb-1.5 flex items-center gap-1.5 px-2 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><History size={11} />{m['council.history']()}</div>
          <div class="space-y-1">
            {#each snapshot?.councils ?? [] as council (council.id)}
              <button type="button" class={`w-full rounded-md px-2 py-2 text-left hover:bg-[var(--app-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent)] ${activeCouncilId === council.id ? 'bg-[var(--app-surface)]' : ''}`} onclick={() => openCouncil(council)}>
                <span class="block truncate text-ui-sm font-medium">{council.title}</span>
                <span class="mt-1 flex items-center justify-between gap-2 text-ui-xs text-[var(--app-text-muted)]"><span>{council.perspectives.length} {m['council.perspectives_short']()}</span><span>{statusLabel(council.status)}</span></span>
              </button>
            {:else}
              <p class="px-2 py-3 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['council.history_empty']()}</p>
            {/each}
          </div>
        </aside>

        <div class="min-h-0 overflow-y-auto overscroll-contain">
          {#if view === 'create'}
            <div class="mx-auto max-w-3xl space-y-5 p-5">
              <section class="grid gap-3 sm:grid-cols-2">
                <label class="sm:col-span-2"><span class="mb-1.5 block text-xs font-medium">{m['council.field_title']()}</span><Input name="council-title" autocomplete="off" bind:value={title} maxlength={180} placeholder={m['council.field_title_placeholder']()} /></label>
                <label class="sm:col-span-2"><span class="mb-1.5 block text-xs font-medium">{m['council.field_objective']()}</span><Textarea class="min-h-28 resize-y" name="council-objective" autocomplete="off" bind:value={objective} maxlength={12000} placeholder={m['council.field_objective_placeholder']()} /></label>
                <label><span class="mb-1.5 block text-xs font-medium">{m['council.field_task']()}</span><NativeSelect.Root class="w-full" name="council-task" autocomplete="off" bind:value={taskId}><NativeSelect.Option value="">{m['council.no_task']()}</NativeSelect.Option>{#each snapshot?.tasks ?? [] as task (task.id)}<NativeSelect.Option value={task.id}>{task.title}</NativeSelect.Option>{/each}</NativeSelect.Root></label>
                <label><span class="mb-1.5 block text-xs font-medium">{m['council.field_mode']()}</span><NativeSelect.Root class="w-full" name="council-mode" autocomplete="off" bind:value={mode}><NativeSelect.Option value="advisory">{m['council.mode_advisory']()}</NativeSelect.Option><NativeSelect.Option value="implementation">{m['council.mode_implementation']()}</NativeSelect.Option></NativeSelect.Root></label>
                <label><span class="mb-1.5 block text-xs font-medium">{m['council.field_criterion']()}</span><NativeSelect.Root class="w-full" name="council-criterion" autocomplete="off" bind:value={criterion}><NativeSelect.Option value="balanced">{m['council.criterion_balanced']()}</NativeSelect.Option><NativeSelect.Option value="quality">{m['council.criterion_quality']()}</NativeSelect.Option><NativeSelect.Option value="speed">{m['council.criterion_speed']()}</NativeSelect.Option><NativeSelect.Option value="risk">{m['council.criterion_risk']()}</NativeSelect.Option><NativeSelect.Option value="cost">{m['council.criterion_cost']()}</NativeSelect.Option><NativeSelect.Option value="custom">{m['council.criterion_custom']()}</NativeSelect.Option></NativeSelect.Root></label>
                {#if criterion === 'custom'}<label><span class="mb-1.5 block text-xs font-medium">{m['council.field_custom_criterion']()}</span><Input name="council-custom-criterion" autocomplete="off" bind:value={customCriterion} maxlength={1000} /></label>{/if}
              </section>

              <section>
                <div class="mb-2 flex items-end justify-between gap-3"><div><h3 class="text-xs font-semibold">{m['council.choose_agents']()}</h3><p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">{m['council.choose_agents_hint']()}</p></div><Badge variant="secondary">{selectedAgents.length}/5</Badge></div>
                <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
                  {#each snapshot?.agents ?? [] as agent (agent.id)}
                    <div class="grid grid-cols-[20px_minmax(150px,0.8fr)_minmax(180px,1.2fr)] items-center gap-3 py-2.5 max-[700px]:grid-cols-[20px_1fr]">
                      <Checkbox checked={selectedAgents.includes(agent.id)} disabled={!selectedAgents.includes(agent.id) && selectedAgents.length >= 5} onCheckedChange={(checked) => toggleAgent(agent.id, checked === true)} aria-label={m['council.select_agent']({ agent: agent.title })} />
                      <div class="min-w-0"><div class="flex items-center gap-1.5"><span class="truncate text-ui-sm font-medium">{agent.title}</span>{#if agent.maestro}<Badge variant="outline">{m['council.leader']()}</Badge>{/if}</div><p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{agent.provider}{agent.model ? ` · ${agent.model}` : ''}{agent.role ? ` · ${agent.role}` : ''}</p><p class="mt-0.5 truncate text-ui-xs text-[var(--app-text-muted)]">{usageSummary(agent.provider)}</p></div>
                      <Input class="h-8 text-ui-sm max-[700px]:col-start-2" name={`council-approach-${agent.id}`} autocomplete="off" aria-label={`${agent.title}: ${m['council.approach_placeholder']()}`} value={approaches[agent.id] ?? ''} disabled={!selectedAgents.includes(agent.id)} placeholder={m['council.approach_placeholder']()} oninput={(event) => (approaches = { ...approaches, [agent.id]: (event.currentTarget as HTMLInputElement).value })} />
                    </div>
                  {/each}
                </div>
              </section>

              <section class="grid gap-3 border-y border-[var(--app-border)] py-4 sm:grid-cols-[1fr_220px]">
                <label class="flex items-start gap-3"><Switch aria-label={m['council.leader_synthesis']()} checked={requestLeaderRecommendation} onCheckedChange={(checked) => (requestLeaderRecommendation = checked)} /><span><span class="block text-xs font-medium">{m['council.leader_synthesis']()}</span><span class="mt-1 block text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['council.leader_synthesis_hint']()}</span></span></label>
                {#if requestLeaderRecommendation}<NativeSelect.Root class="w-full" name="council-leader" autocomplete="off" aria-label={m['council.leader']()} bind:value={leaderNodeId}>{#each (snapshot?.agents ?? []).filter((agent) => agent.maestro) as agent (agent.id)}<NativeSelect.Option value={agent.id}>{agent.title} · {agent.provider}</NativeSelect.Option>{/each}</NativeSelect.Root>{/if}
              </section>

              <div class="flex items-center justify-between gap-4 border-l-2 border-[var(--app-accent)] pl-3"><div><p class="text-xs font-medium">{m['council.execution_budget']({ count: requiredExecutions })}</p><p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">{mode === 'implementation' ? m['council.implementation_isolation']() : m['council.advisory_isolation']()}</p></div><Button disabled={busy || !canStart} onclick={startCouncil}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<Users />{/if}{m['council.start']()}</Button></div>
            </div>
          {:else if activeCouncil}
            <div class="space-y-5 p-5">
              <header class="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--app-border)] pb-4"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><h2 class="text-base font-semibold">{activeCouncil.title}</h2><Badge variant="secondary">{statusLabel(activeCouncil.status)}</Badge>{#if activeCouncil.taskTitle}<Badge variant="outline">{activeCouncil.taskTitle}</Badge>{/if}</div><p class="mt-2 max-w-3xl whitespace-pre-wrap text-ui-sm leading-5 text-[var(--app-text-soft)]">{activeCouncil.objective}</p></div><Button size="sm" variant="outline" onclick={() => refresh()}><RefreshCw />{m['council.refresh']()}</Button></header>

              <div class="grid grid-cols-2 gap-px bg-[var(--app-border)] sm:grid-cols-4"><div class="bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.field_mode']()}</span><p class="mt-1 text-xs font-medium">{activeCouncil.mode === 'advisory' ? m['council.mode_advisory']() : m['council.mode_implementation']()}</p></div><div class="bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.field_criterion']()}</span><p class="mt-1 text-xs font-medium">{activeCouncil.customCriterion || criterionLabel(activeCouncil.criterion)}</p></div><div class="bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.executions']()}</span><p class="mt-1 text-xs font-medium tabular-nums">{activeCouncil.executionCount || activeCouncil.perspectives.filter((item) => item.status !== 'pending').length}/{activeCouncil.maxExecutions}</p></div><div class="bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.leader']()}</span><p class="mt-1 truncate text-xs font-medium">{activeCouncil.leaderTitle ?? m['council.no_synthesis']()}</p></div></div>

              {#if activeCouncil.status === 'running'}
                <div class="flex items-center gap-2 border-l-2 border-[var(--app-accent)] bg-[var(--app-accent)]/6 px-3 py-2 text-ui-sm"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={14} />{m['council.running_hint']()}</div>
              {/if}

              {#if activeCouncil.recommendation}
                <section class="border-l-2 border-[var(--app-success)] bg-[var(--app-success)]/6 p-4"><div class="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={15} class="text-[var(--app-success)]" />{m['council.leader_recommendation']()}<Badge variant="outline">{activeCouncil.recommendation.consensus}</Badge></div><p class="mt-2 whitespace-pre-wrap text-ui-sm leading-5">{activeCouncil.recommendation.recommendation}</p>{#if activeCouncil.recommendation.rationale.length}<ul class="mt-2 space-y-1 text-ui-xs text-[var(--app-text-soft)]">{#each activeCouncil.recommendation.rationale as item}<li class="flex gap-1.5"><Check size={11} class="mt-0.5 shrink-0 text-[var(--app-success)]" />{item}</li>{/each}</ul>{/if}{#if activeCouncil.recommendation.divergences.length}<ul class="mt-2 space-y-1 border-t border-[var(--app-border)] pt-2 text-ui-xs text-[var(--app-text-soft)]">{#each activeCouncil.recommendation.divergences as item}<li class="flex gap-1.5"><AlertTriangle size={11} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{item}</li>{/each}</ul>{/if}</section>
              {:else if activeCouncil.recommendationError}
                <div class="flex items-start gap-2 border-l-2 border-[var(--app-warning)] bg-[var(--app-warning)]/6 p-3 text-ui-sm"><AlertTriangle size={14} class="mt-0.5 shrink-0 text-[var(--app-warning)]" /><span>{m['council.synthesis_failed']({ error: activeCouncil.recommendationError })}</span></div>
              {/if}

              <section><div class="mb-2 flex items-center justify-between"><h3 class="text-xs font-semibold">{m['council.comparison']()}</h3><span class="text-ui-xs text-[var(--app-text-muted)]">{m['council.comparison_hint']()}</span></div><div class="overflow-x-auto border border-[var(--app-border)]"><Table.Root><Table.Header><Table.Row><Table.Head class="min-w-40">{m['council.agent_approach']()}</Table.Head><Table.Head class="min-w-64">{m['council.proposal']()}</Table.Head><Table.Head class="min-w-52">{m['council.evidence']()}</Table.Head><Table.Head class="min-w-52">{m['council.risks_tests']()}</Table.Head><Table.Head class="min-w-48">{m['council.divergences']()}</Table.Head></Table.Row></Table.Header><Table.Body>
                {#each activeCouncil.perspectives as perspective (perspective.id)}
                  <Table.Row class={selectedPerspectiveId === perspective.id ? 'bg-[var(--app-accent)]/5' : ''}><Table.Cell class="align-top"><label class="flex items-start gap-2"><input class="mt-0.5 size-3.5 accent-[var(--app-accent)]" type="radio" name={`council-${activeCouncil.id}`} value={perspective.id} aria-label={`${m['council.select_perspective']()}: ${perspective.agentTitle}`} checked={selectedPerspectiveId === perspective.id} disabled={perspective.status !== 'completed'} onchange={() => (selectedPerspectiveId = perspective.id)} /><span><span class="block text-ui-sm font-medium">{perspective.agentTitle}</span><span class="mt-0.5 block text-ui-xs text-[var(--app-text-muted)]">{perspective.provider}{perspective.model ? ` · ${perspective.model}` : ''}</span><span class="mt-1 block text-ui-xs leading-4">{perspective.approach || m['council.independent_approach']()}</span><Badge class="mt-2" variant="outline">{statusLabel(perspective.status)}</Badge>{#if perspective.floorName}<span class="mt-1 block font-mono text-ui-xs text-[var(--app-text-muted)]">{perspective.floorName}</span>{/if}</span></label></Table.Cell>
                    {#if perspective.output}<Table.Cell class="align-top text-ui-xs leading-4"><p class="whitespace-pre-wrap">{perspective.output.proposal}</p><div class="mt-2 border-t border-[var(--app-border)] pt-2"><p class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['council.perspective_recommendation']()}</p><p class="mt-1 whitespace-pre-wrap">{perspective.output.recommendation}</p></div><p class={`mt-2 font-semibold tabular-nums ${confidenceTone(perspective.output.confidence)}`}>{m['council.confidence']({ value: perspective.output.confidence })}</p></Table.Cell><Table.Cell class="align-top">{#each perspective.output.evidence as item}<p class="mb-1 flex gap-1.5 text-ui-xs leading-4"><Check size={10} class="mt-0.5 shrink-0 text-[var(--app-success)]" />{item}</p>{/each}</Table.Cell><Table.Cell class="align-top">{#each perspective.output.risks as item}<p class="mb-1 flex gap-1.5 text-ui-xs leading-4"><AlertTriangle size={10} class="mt-0.5 shrink-0 text-[var(--app-warning)]" />{item}</p>{/each}{#each perspective.output.tests as item}<p class="mb-1 flex gap-1.5 text-ui-xs leading-4"><CircleDot size={10} class="mt-0.5 shrink-0 text-[var(--app-accent)]" />{item}</p>{/each}</Table.Cell><Table.Cell class="align-top">{#each perspective.output.divergences as item}<p class="mb-1 text-ui-xs leading-4">{item}</p>{/each}</Table.Cell>
                    {:else}<Table.Cell colspan={4} class="align-top"><div class="flex items-center gap-2 text-ui-xs text-[var(--app-text-muted)]">{#if perspective.status === 'running' || perspective.status === 'pending'}<LoaderCircle size={12} class="animate-spin" />{:else}<XCircle size={12} class="text-[var(--app-danger)]" />{/if}{perspective.error || statusLabel(perspective.status)}</div></Table.Cell>{/if}
                  </Table.Row>
                {/each}
              </Table.Body></Table.Root></div></section>

              {#if activeCouncil.status !== 'running' && activeCouncil.status !== 'failed'}
                <section class="border-t border-[var(--app-border)] pt-4"><div class="grid gap-3 sm:grid-cols-[1fr_auto]"><Textarea class="min-h-20 resize-y" name="council-decision-note" autocomplete="off" aria-label={m['council.decision_note_placeholder']()} bind:value={decisionNote} placeholder={m['council.decision_note_placeholder']()} /><div class="flex flex-col gap-2"><Button disabled={busy || !selectedPerspectiveId} onclick={() => decide('selected')}><Check />{m['council.select_perspective']()}</Button><Button variant="outline" disabled={busy} onclick={() => decide('consensus_requested')}><Users />{m['council.request_consensus']()}</Button><Button variant="outline" class="text-[var(--app-danger)]" disabled={busy} onclick={() => decide('rejected')}><XCircle />{m['council.reject_all']()}</Button></div></div>
                  {#if activeCouncil.status === 'selected' && activeCouncil.mode === 'implementation'}{@const selected = activeCouncil.perspectives.find((item) => item.id === activeCouncil.selectedPerspectiveId)}{#if selected?.floorId}<div class="mt-4 flex items-center justify-between gap-3 border-l-2 border-[var(--app-warning)] pl-3"><p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['council.landing_guardrail']()}</p><Button variant="outline" onclick={() => inspectLanding(selected)}><GitMerge />{m['council.preview_landing']()}</Button></div>{/if}{/if}
                </section>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    {#if errorMessage}<div class="border-t border-[var(--app-danger)]/30 bg-[var(--app-danger)]/8 px-5 py-2.5 text-xs text-[var(--app-danger)]" role="alert">{errorMessage}</div>{/if}
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={Boolean(landingPerspective)} onOpenChange={(next) => { if (!next) { landingPerspective = null; landingPreview = null; } }}>
  <AlertDialog.Content class="sm:max-w-xl"><AlertDialog.Header><AlertDialog.Title>{m['council.landing_title']()}</AlertDialog.Title><AlertDialog.Description>{m['council.landing_description']()}</AlertDialog.Description></AlertDialog.Header>
    {#if landingLoading}<div class="flex items-center gap-2 py-4 text-sm"><LoaderCircle class="animate-spin" />{m['council.loading_preview']()}</div>{:else if landingPreview}<div class="space-y-3 text-xs"><div class="grid grid-cols-2 gap-px bg-[var(--app-border)]"><div class="min-w-0 bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.from_branch']()}</span><p class="mt-1 break-words font-mono">{landingPreview.from}</p></div><div class="min-w-0 bg-[var(--app-surface)] p-3"><span class="text-ui-xs uppercase text-[var(--app-text-muted)]">{m['council.to_branch']()}</span><p class="mt-1 break-words font-mono">{landingPreview.to}</p></div></div><pre class="max-h-40 overflow-auto whitespace-pre-wrap border border-[var(--app-border)] bg-[var(--app-canvas)] p-3 font-mono text-ui-xs">{landingPreview.stat || m['council.no_diff']()}</pre>{#if landingPreview.targetDirty}<p class="flex gap-2 text-[var(--app-danger)]"><AlertTriangle size={14} />{m['council.target_dirty']()}</p>{/if}{#if landingPreview.conflicts.length}<p class="flex gap-2 text-[var(--app-danger)]"><AlertTriangle size={14} />{m['council.conflicts']({ files: landingPreview.conflicts.join(', ') })}</p>{/if}</div>{/if}
    <AlertDialog.Footer><AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel><AlertDialog.Action disabled={busy || landingLoading || !landingPreview || landingPreview.targetDirty || landingPreview.conflicts.length > 0} onclick={landSelected}>{m['council.confirm_landing']()}</AlertDialog.Action></AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
