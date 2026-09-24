<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import {
    Activity, CheckCircle2, History, LoaderCircle, PlugZap,
    Pencil, Play, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2,
    Workflow, Wrench, X, XCircle,
  } from '@lucide/svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import AutonomySecurityPanel from './AutonomySecurityPanel.svelte';
  import IntegrationCenterPanel from './IntegrationCenterPanel.svelte';
  import ToolWorkshopPanel from './ToolWorkshopPanel.svelte';
  import CalendarScheduleFields from './CalendarScheduleFields.svelte';
  import { calendarScheduleSchema } from '$lib/modules/agent-room/contracts/schemas/calendar-schedule.schema.js';
  import { automationFormSchema, type AutomationFormInput } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
  import type { AutomationRecipe } from '$lib/modules/agent-room/application/catalogs/AutomationRecipeCatalog.js';
  import type { AutomationIntegration, AutomationRun, CanvasNode, Routine } from '$lib/modules/agent-room/domain/types.js';
  import type { WorkspaceToolRecord } from '$lib/modules/agent-room/infrastructure/repositories/AgentWorkspaceToolRepository.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    workspaceId,
    terminals,
    compact = false,
    onClose,
  }: {
    workspaceId: string;
    terminals: Array<{ id: string; title: string }>;
    compact?: boolean;
    onClose?: () => void;
  } = $props();

  const emptyForm: AutomationFormInput = {
    name: '', triggerType: 'manual', intervalMinutes: null, taskEvent: null,
    taskStatus: null, messageContains: null, gitBranch: null, githubEvent: null,
    webhookSecret: null, filePath: null, usageProvider: null, usageWindow: null,
    usagePercent: null, actionType: 'prompt_agent', targetNodeId: null, prompt: null,
    taskTitle: null, taskDescription: null, notificationTitle: null,
    notificationMessage: null, enabled: true, recipeId: null,
    portalNodeId: null, portalAction: null, portalUrl: null, portalRef: null,
    portalText: null, portalSubmit: false,
    integrationId: null, integrationAction: null, integrationPayload: '{}',
    toolId: null, toolInput: '{}',
  };
  const schema = automationFormSchema as unknown as Parameters<typeof zod>[0];
  const form = superForm<AutomationFormInput>(defaults(emptyForm, zod(schema)) as never, {
    SPA: true,
    validators: zod(schema) as never,
    async onUpdate({ form: result }) {
      if (!result.valid) return;
      await save(result.data as AutomationFormInput);
    },
  });
  const { form: formData, enhance } = form;

  let activeTab = $state('overview');
  let automations = $state<Routine[]>([]);
  let runs = $state<AutomationRun[]>([]);
  let recipes = $state<AutomationRecipe[]>([]);
  let integrations = $state<AutomationIntegration[]>([]);
  let tools = $state<WorkspaceToolRecord[]>([]);
  let portals = $state<Array<{ id: string; title: string }>>([]);
  let loading = $state(true);
  let busy = $state(false);
  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let pendingDelete = $state<Routine | null>(null);
  const companionText = m as unknown as Record<string, () => string>;

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
    if (!response.ok || payload.error) throw new Error(payload.error || m['automation.error_load']());
    return payload.data as T;
  }

  async function refresh(): Promise<void> {
    loading = true;
    try {
      const loaded = await Promise.all([
        api<Routine[]>(`/api/agent-room/workspaces/${workspaceId}/automations`),
        api<AutomationRun[]>(`/api/agent-room/workspaces/${workspaceId}/automations/history`),
        api<AutomationRecipe[]>(`/api/agent-room/workspaces/${workspaceId}/automations/recipes`),
        api<{ integrations: AutomationIntegration[] }>(`/api/agent-room/workspaces/${workspaceId}/integrations`),
        api<CanvasNode[]>(`/api/agent-room/workspaces/${workspaceId}/nodes`),
        api<WorkspaceToolRecord[]>(`/api/agent-room/workspaces/${workspaceId}/tools`),
      ]);
      automations = loaded[0] as Routine[];
      runs = loaded[1] as AutomationRun[];
      recipes = loaded[2] as AutomationRecipe[];
      integrations = (loaded[3] as { integrations: AutomationIntegration[] }).integrations;
      portals = (loaded[4] as CanvasNode[]).filter((node) => node.type === 'portal').map((node) => ({ id: node.id, title: node.title ?? m['portal.default_title']() }));
      tools = loaded[5] as WorkspaceToolRecord[];
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['automation.error_load']());
    } finally {
      loading = false;
    }
  }

  function resetEditor(): void {
    editingId = null;
    $formData = structuredClone(emptyForm);
    if (terminals[0]) $formData.targetNodeId = terminals[0].id;
    editorOpen = false;
  }

  function openNew(): void {
    resetEditor();
    editorOpen = true;
  }

  function edit(automation: Routine): void {
    editingId = automation.id;
    const trigger = automation.triggerConfig;
    const action = automation.actionConfig;
    $formData = {
      ...structuredClone(emptyForm),
      name: automation.name,
      triggerType: automation.triggerType,
      intervalMinutes: Number(trigger.intervalMinutes ?? automation.intervalMinutes ?? 0) || null,
      calendar: calendarScheduleSchema.safeParse(trigger.calendar).success ? calendarScheduleSchema.parse(trigger.calendar) : null,
      taskEvent: (trigger.event as AutomationFormInput['taskEvent']) ?? null,
      taskStatus: String(trigger.status ?? '') || null,
      messageContains: String(trigger.contains ?? '') || null,
      gitBranch: String(trigger.branch ?? '') || null,
      githubEvent: (trigger.event as AutomationFormInput['githubEvent']) ?? null,
      webhookSecret: automation.triggerType === 'webhook' ? '****************' : null,
      filePath: String(trigger.path ?? '') || null,
      usageProvider: (trigger.provider as AutomationFormInput['usageProvider']) ?? null,
      usageWindow: (trigger.window as AutomationFormInput['usageWindow']) ?? null,
      usagePercent: Number(trigger.percent ?? 0) || null,
      actionType: automation.actionType,
      targetNodeId: String(action.targetNodeId ?? automation.targetNodeId ?? '') || null,
      prompt: String(action.prompt ?? automation.prompt ?? '') || null,
      taskTitle: String(action.title ?? '') || null,
      taskDescription: String(action.description ?? '') || null,
      notificationTitle: String(action.title ?? '') || null,
      notificationMessage: String(action.message ?? '') || null,
      portalNodeId: String(action.portalNodeId ?? '') || null,
      portalAction: (action.action as AutomationFormInput['portalAction']) ?? null,
      portalUrl: String(action.url ?? '') || null,
      portalRef: String(action.ref ?? '') || null,
      portalText: String(action.text ?? '') || null,
      portalSubmit: Boolean(action.submit),
      integrationId: String(action.integrationId ?? '') || null,
      integrationAction: String(action.integrationAction ?? '') || null,
      integrationPayload: JSON.stringify(action.payload ?? {}, null, 2),
      toolId: String(action.toolId ?? '') || null,
      toolInput: JSON.stringify(action.input ?? {}, null, 2),
      enabled: automation.enabled,
      recipeId: automation.recipeId,
    };
    editorOpen = true;
  }

  function recipeName(id: string): string {
    const names: Record<string, () => string> = {
      'development-pr-review': m['automation.recipe_development_pr_review'],
      'design-feedback-triage': m['automation.recipe_design_feedback_triage'],
      'marketing-handoff': m['automation.recipe_marketing_handoff'],
      'research-digest': m['automation.recipe_research_digest'],
      'operations-usage-guard': m['automation.recipe_operations_usage_guard'],
    };
    return names[id]?.() ?? id;
  }

  function applyRecipe(recipe: AutomationRecipe): void {
    openNew();
    $formData = { ...$formData, ...recipe.defaults, name: recipeName(recipe.id), recipeId: recipe.id } as AutomationFormInput;
    activeTab = 'overview';
  }

  async function save(input: AutomationFormInput): Promise<void> {
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/automations${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PUT' : 'POST', body: JSON.stringify(input),
      });
      toast.success(m['automation.success_save']());
      resetEditor();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['automation.error_save']());
    } finally {
      busy = false;
    }
  }

  async function toggle(automation: Routine): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/${automation.id}`, {
      method: 'PATCH', body: JSON.stringify({ enabled: !automation.enabled }),
    });
    await refresh();
  }

  async function runNow(automation: Routine): Promise<void> {
    busy = true;
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/automations/${automation.id}/run`, { method: 'POST' });
      toast.success(m['automation.success_run']());
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['automation.error_save']());
    } finally {
      busy = false;
    }
  }

  async function remove(automation: Routine): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/${automation.id}`, { method: 'DELETE' });
    pendingDelete = null;
    await refresh();
  }

  async function retry(run: AutomationRun): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/retry/${run.id}`, { method: 'POST' });
    await refresh();
  }

  async function cancelRun(run: AutomationRun): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/cancel/${run.id}`, { method: 'POST' });
    toast.success(m['automation.success_cancel']());
    await refresh();
  }

  function triggerLabel(type: Routine['triggerType']): string {
    return ({
      manual: m['automation.trigger_manual'], schedule: m['automation.trigger_schedule'],
      task: m['automation.trigger_task'], message: m['automation.trigger_message'],
      git_commit: m['automation.trigger_git_commit'], github_pull_request: m['automation.trigger_github_pr'],
      webhook: m['automation.trigger_webhook'], file_change: m['automation.trigger_file'],
      usage_threshold: m['automation.trigger_usage'],
    }[type])();
  }

  function actionLabel(type: Routine['actionType']): string {
    return ({ prompt_agent: m['automation.action_prompt'], create_task: m['automation.action_task'], notify: m['automation.action_notify'], browser: m['automation.action_browser'], integration: m['automation.action_integration'], tool: m['automation.action_tool'] }[type])();
  }

  function browserActionLabel(type: NonNullable<AutomationFormInput['portalAction']>): string {
    return ({
      navigate: m['automation.browser_navigate'], snapshot: m['automation.browser_snapshot'],
      click: m['automation.browser_click'], type: m['automation.browser_type'], wait: m['automation.browser_wait'],
      extract: m['automation.browser_extract'], screenshot: m['automation.browser_screenshot'],
    }[type])();
  }

  function statusLabel(status: AutomationRun['status']): string {
    return ({
      queued: m['automation.status_queued'],
      running: m['automation.status_running'],
      waiting_approval: m['automation.status_waiting_approval'],
      succeeded: m['automation.status_succeeded'],
      failed: m['automation.status_failed'],
      cancelled: m['automation.status_cancelled'],
      dead_letter: m['automation.status_dead_letter'],
    }[status])();
  }

  function recipeCategoryLabel(category: AutomationRecipe['category']): string {
    const labels: Record<string, () => string> = {
      development: m['automation.category_development'], design: m['automation.category_design'],
      marketing: m['automation.category_marketing'], research: m['automation.category_research'],
      operations: m['automation.category_operations'],
    };
    return labels[category]?.() ?? category;
  }

  function runTone(status: AutomationRun['status']): string {
    if (status === 'succeeded') return 'bg-[var(--app-success-soft)] text-[var(--app-success)]';
    if (status === 'failed' || status === 'dead_letter') return 'bg-[var(--app-danger-soft)] text-[var(--app-danger)]';
    if (status === 'waiting_approval') return 'bg-[var(--app-warning-soft)] text-[var(--app-warning)]';
    return 'bg-[var(--app-hover)] text-[var(--app-text-soft)]';
  }

  function describeTrigger(automation: Routine): string {
    if (automation.triggerType === 'schedule' && automation.triggerConfig.calendar) {
      const calendar = calendarScheduleSchema.parse(automation.triggerConfig.calendar);
      return `${companionText[`companion.${calendar.frequency}`]()} · ${calendar.time} · ${calendar.timeZone}${automation.nextRunAt ? ` · ${companionText['companion.next']()} ${new Date(automation.nextRunAt).toLocaleString()}` : ''}`;
    }
    if (automation.triggerType === 'schedule') return m['automation.every']({ minutes: Number(automation.triggerConfig.intervalMinutes ?? 0) });
    if (automation.triggerType === 'usage_threshold') return `${automation.triggerConfig.provider} · ${automation.triggerConfig.window} · ${automation.triggerConfig.percent}%`;
    if (automation.triggerType === 'file_change') return String(automation.triggerConfig.path ?? '');
    return triggerLabel(automation.triggerType);
  }

  $effect(() => {
    workspaceId;
    void refresh();
  });
</script>

<section class={`flex h-full min-h-0 flex-col bg-[var(--app-sidebar)] text-[var(--app-text)] ${compact ? 'w-[min(430px,42vw)] border-l border-[var(--app-border)]' : 'w-full'}`} data-testid="automation-workspace">
  <header class="flex shrink-0 items-start gap-3 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-4 py-3.5">
    <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-accent)]" aria-hidden="true"><Workflow size={17} /></span>
    <div class="min-w-0 flex-1">
      <h1 class="truncate font-display text-[15px] font-semibold tracking-[-0.01em]">{m['automation.title']()}</h1>
      <p class={`mt-0.5 text-ui-sm leading-[1.45] text-[var(--app-text-muted)] ${compact ? 'line-clamp-2 text-pretty' : 'truncate'}`} title={m['automation.description']()}>{m['automation.description']()}</p>
    </div>
    {#if onClose}<Button variant="ghost" size="icon-sm" aria-label={m['routine.close']()} onclick={onClose}><X size={15} /></Button>{/if}
  </header>

  <Tabs.Root bind:value={activeTab} class="grid min-h-0 flex-1 grid-rows-[40px_minmax(0,1fr)] gap-0">
    <!-- Abas em linha: ativa neutra com sublinhado de acento, alinhadas a esquerda. -->
    <Tabs.List variant="line" class="automation-tabs h-10 w-full justify-start gap-0.5 overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-[var(--app-surface)] px-2">
      <Tabs.Trigger value="overview" class="automation-tab"><Activity size={13} />{m['automation.overview']()}</Tabs.Trigger>
      <Tabs.Trigger value="recipes" class="automation-tab"><Sparkles size={13} />{m['automation.recipes']()}</Tabs.Trigger>
      <Tabs.Trigger value="history" class="automation-tab"><History size={13} />{m['automation.history']()}</Tabs.Trigger>
      <Tabs.Trigger value="integrations" class="automation-tab"><PlugZap size={13} />{m['automation.integrations']()}</Tabs.Trigger>
      <Tabs.Trigger value="tools" class="automation-tab"><Wrench size={13} />{m['automation.tools']()}</Tabs.Trigger>
      <Tabs.Trigger value="security" class="automation-tab"><ShieldCheck size={13} />{m['autonomy.title']()}</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="overview" class="m-0 min-h-0 overflow-y-auto p-4">
      <div class="mb-3 flex items-center justify-between gap-3">
        <p class="text-ui-sm tabular-nums text-[var(--app-text-muted)]">{m['automation.run_count']({ count: runs.length })}</p>
        <Button size="sm" onclick={openNew}><Plus size={14} />{m['automation.new']()}</Button>
      </div>
      {#if loading}
        <div class="grid min-h-40 place-items-center">
          <span class="inline-flex items-center gap-2 rounded-full bg-[var(--app-surface)] px-3 py-1.5 text-ui-sm text-[var(--app-text-muted)] shadow-border" role="status"><LoaderCircle size={13} class="animate-spin text-[var(--app-accent)]" aria-hidden="true" />{m['automation.loading']()}</span>
        </div>
      {:else if automations.length === 0 && !editorOpen}
        <div class="grid min-h-56 rounded-xl bg-[var(--app-surface)] shadow-border">
          <NodeEmptyState icon={Workflow} title={m['automation.empty']()} description={m['automation.empty_hint']()}>
            {#snippet actions()}<Button variant="outline" size="sm" onclick={() => (activeTab = 'recipes')}><Sparkles size={13} />{m['automation.browse_recipes']()}</Button>{/snippet}
          </NodeEmptyState>
        </div>
      {/if}

      {#if editorOpen}
        <form method="POST" use:enhance class="automation-form mb-4 rounded-xl bg-[var(--app-surface)] p-4 shadow-border">
          <div class="mb-4 flex items-center justify-between gap-3"><h3 class="font-display text-[14px] font-semibold">{editingId ? m['automation.edit']() : m['automation.new']()}</h3><Button type="button" variant="ghost" size="icon-sm" aria-label={m['automation.cancel']()} onclick={resetEditor}><X size={14} /></Button></div>
          <div class={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <label class="block"><span class="mb-1.5 block text-ui-md font-medium">{m['automation.name']()}</span><Input name="automation-name" bind:value={$formData.name} autocomplete="off" /></label>
            <label class="block"><span class="mb-1.5 block text-ui-md font-medium">{m['automation.trigger']()}</span><Select.Root type="single" value={$formData.triggerType} onValueChange={(value) => { $formData.triggerType = value as AutomationFormInput['triggerType']; if (value === 'webhook' && !$formData.webhookSecret) $formData.webhookSecret = crypto.randomUUID(); }}><Select.Trigger class="w-full">{triggerLabel($formData.triggerType)}</Select.Trigger><Select.Content>{#each ['manual','schedule','task','message','git_commit','github_pull_request','webhook','file_change','usage_threshold'] as type}<Select.Item value={type}>{triggerLabel(type as Routine['triggerType'])}</Select.Item>{/each}</Select.Content></Select.Root></label>
            {#if $formData.triggerType === 'schedule'}
              <label class="block"><span class="mb-1.5 block text-ui-md font-medium">{companionText['companion.schedule_mode']()}</span><Select.Root type="single" value={$formData.calendar ? 'calendar' : 'interval'} onValueChange={mode => { $formData.calendar = mode === 'calendar' ? calendarScheduleSchema.parse({ frequency: 'weekly', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', time: '14:00', weekdays: [1] }) : null; $formData.intervalMinutes = mode === 'calendar' ? null : 60; }}><Select.Trigger class="w-full">{$formData.calendar ? companionText['companion.calendar']() : m['automation.interval']()}</Select.Trigger><Select.Content><Select.Item value="interval">{m['automation.interval']()}</Select.Item><Select.Item value="calendar">{companionText['companion.calendar']()}</Select.Item></Select.Content></Select.Root></label>
              {#if $formData.calendar}<div class={compact ? '' : 'col-span-2'}><CalendarScheduleFields bind:value={$formData.calendar} /></div>
              {:else}<label class="block"><span class="mb-1.5 block text-ui-md font-medium">{m['automation.interval']()}</span><Input type="number" min="1" class="tabular-nums" bind:value={$formData.intervalMinutes} /></label>{/if}
            {/if}
            {#if $formData.triggerType === 'task'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.task_event']()}</span><Select.Root type="single" value={$formData.taskEvent ?? undefined} onValueChange={(value) => ($formData.taskEvent = value as AutomationFormInput['taskEvent'])}><Select.Trigger class="w-full">{$formData.taskEvent ? ({created:m['automation.event_created'],updated:m['automation.event_updated'],status_changed:m['automation.event_status_changed'],completed:m['automation.event_completed']}[$formData.taskEvent])() : m['automation.task_event']()}</Select.Trigger><Select.Content><Select.Item value="created">{m['automation.event_created']()}</Select.Item><Select.Item value="updated">{m['automation.event_updated']()}</Select.Item><Select.Item value="status_changed">{m['automation.event_status_changed']()}</Select.Item><Select.Item value="completed">{m['automation.event_completed']()}</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.task_status']()}</span><Input bind:value={$formData.taskStatus} /></label>{/if}
            {#if $formData.triggerType === 'message'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.message_contains']()}</span><Input bind:value={$formData.messageContains} /></label>{/if}
            {#if $formData.triggerType === 'git_commit'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.git_branch']()}</span><Input bind:value={$formData.gitBranch} /></label>{/if}
            {#if $formData.triggerType === 'github_pull_request'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.pr_event']()}</span><Select.Root type="single" value={$formData.githubEvent ?? undefined} onValueChange={(value) => ($formData.githubEvent = value as AutomationFormInput['githubEvent'])}><Select.Trigger class="w-full">{$formData.githubEvent ?? m['automation.pr_event']()}</Select.Trigger><Select.Content><Select.Item value="opened">{m['automation.pr_opened']()}</Select.Item><Select.Item value="updated">{m['automation.pr_updated']()}</Select.Item><Select.Item value="merged">{m['automation.pr_merged']()}</Select.Item><Select.Item value="closed">{m['automation.pr_closed']()}</Select.Item></Select.Content></Select.Root></label>{/if}
            {#if $formData.triggerType === 'webhook'}
              <div class={compact ? '' : 'col-span-2'}>
                <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.webhook_secret']()}</span><Input type="password" bind:value={$formData.webhookSecret} autocomplete="new-password" /></label>
                <p class="mt-1.5 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['automation.webhook_hint']()}</p>
                {#if editingId}
                  <code class="mt-2 block select-all overflow-x-auto rounded-md bg-[var(--app-canvas)] px-2.5 py-2 font-mono text-ui-xs text-[var(--app-text-soft)] shadow-border">{typeof window !== 'undefined' ? window.location.origin : ''}/api/agent-room/workspaces/{workspaceId}/automations/webhook/{editingId}</code>
                  <p class="mt-2 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['automation.webhook_local']()}</p>
                {/if}
              </div>
            {/if}
            {#if $formData.triggerType === 'file_change'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.file_path']()}</span><Input bind:value={$formData.filePath} placeholder="src" /></label>{/if}
            {#if $formData.triggerType === 'usage_threshold'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.provider']()}</span><Select.Root type="single" value={$formData.usageProvider ?? undefined} onValueChange={(value) => ($formData.usageProvider = value as AutomationFormInput['usageProvider'])}><Select.Trigger class="w-full">{$formData.usageProvider ?? m['automation.provider']()}</Select.Trigger><Select.Content><Select.Item value="claude">Claude</Select.Item><Select.Item value="codex">Codex</Select.Item><Select.Item value="kimi">Kimi</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.usage_window']()}</span><Select.Root type="single" value={$formData.usageWindow ?? undefined} onValueChange={(value) => ($formData.usageWindow = value as AutomationFormInput['usageWindow'])}><Select.Trigger class="w-full">{$formData.usageWindow ?? m['automation.usage_window']()}</Select.Trigger><Select.Content><Select.Item value="5h">5h</Select.Item><Select.Item value="weekly">Weekly</Select.Item><Select.Item value="monthly">Monthly</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.threshold']()}</span><div class="relative"><Input type="number" min="1" max="100" class="pr-8 tabular-nums" bind:value={$formData.usagePercent} /><span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ui-md text-[var(--app-text-muted)]" aria-hidden="true">%</span></div></label>{/if}
            <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.action']()}</span><Select.Root type="single" value={$formData.actionType} onValueChange={(value) => ($formData.actionType = value as AutomationFormInput['actionType'])}><Select.Trigger class="w-full">{actionLabel($formData.actionType)}</Select.Trigger><Select.Content><Select.Item value="prompt_agent">{m['automation.action_prompt']()}</Select.Item><Select.Item value="create_task">{m['automation.action_task']()}</Select.Item><Select.Item value="notify">{m['automation.action_notify']()}</Select.Item><Select.Item value="browser">{m['automation.action_browser']()}</Select.Item><Select.Item value="integration">{m['automation.action_integration']()}</Select.Item><Select.Item value="tool">{m['automation.action_tool']()}</Select.Item></Select.Content></Select.Root></label>
            {#if $formData.actionType === 'prompt_agent'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.target']()}</span><Select.Root type="single" value={$formData.targetNodeId ?? undefined} onValueChange={(value) => ($formData.targetNodeId = value)}><Select.Trigger class="w-full">{terminals.find((item) => item.id === $formData.targetNodeId)?.title ?? m['automation.target']()}</Select.Trigger><Select.Content>{#each terminals as terminal}<Select.Item value={terminal.id}>{terminal.title}</Select.Item>{/each}</Select.Content></Select.Root></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.prompt']()}</span><Textarea class="min-h-24 resize-y" bind:value={$formData.prompt} /></label>{/if}
            {#if $formData.actionType === 'create_task'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.task_title']()}</span><Input bind:value={$formData.taskTitle} /></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.task_description']()}</span><Textarea class="min-h-20 resize-y" bind:value={$formData.taskDescription} /></label>{/if}
            {#if $formData.actionType === 'notify'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.notification_title']()}</span><Input bind:value={$formData.notificationTitle} /></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.notification_message']()}</span><Textarea class="min-h-20 resize-y" bind:value={$formData.notificationMessage} /></label>{/if}
            {#if $formData.actionType === 'browser'}
              <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.browser_portal']()}</span><Select.Root type="single" value={$formData.portalNodeId ?? undefined} onValueChange={(value) => ($formData.portalNodeId = value)}><Select.Trigger class="w-full">{portals.find((item) => item.id === $formData.portalNodeId)?.title ?? m['automation.browser_portal']()}</Select.Trigger><Select.Content>{#each portals as portal}<Select.Item value={portal.id}>{portal.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
              <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.browser_operation']()}</span><Select.Root type="single" value={$formData.portalAction ?? undefined} onValueChange={(value) => ($formData.portalAction = value as AutomationFormInput['portalAction'])}><Select.Trigger class="w-full">{$formData.portalAction ? browserActionLabel($formData.portalAction) : m['automation.browser_operation']()}</Select.Trigger><Select.Content>{#each ['navigate','snapshot','click','type','wait','extract','screenshot'] as operation}<Select.Item value={operation}>{browserActionLabel(operation as NonNullable<AutomationFormInput['portalAction']>)}</Select.Item>{/each}</Select.Content></Select.Root></label>
              {#if $formData.portalAction === 'navigate'}<label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.browser_url']()}</span><Input bind:value={$formData.portalUrl} placeholder="https://example.com" /></label>{/if}
              {#if $formData.portalAction === 'click' || $formData.portalAction === 'type'}<label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.browser_ref']()}</span><Input bind:value={$formData.portalRef} placeholder="e1" /></label>{/if}
              {#if $formData.portalAction === 'type' || $formData.portalAction === 'wait'}<label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.browser_text']()}</span><Textarea class="min-h-20 resize-y" bind:value={$formData.portalText} /></label>{/if}
              {#if $formData.portalAction === 'type'}<label class="flex cursor-pointer items-center gap-2 text-ui-md"><Switch checked={$formData.portalSubmit} onCheckedChange={(checked: boolean) => ($formData.portalSubmit = checked)} />{m['automation.browser_submit']()}</label>{/if}
            {/if}
            {#if $formData.actionType === 'integration'}
              <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.integration_account']()}</span><Select.Root type="single" value={$formData.integrationId ?? undefined} onValueChange={(value) => { $formData.integrationId = value; $formData.integrationAction = null; }}><Select.Trigger class="w-full">{integrations.find((item) => item.id === $formData.integrationId)?.name ?? m['automation.integration_account']()}</Select.Trigger><Select.Content>{#each integrations.filter((item) => item.enabled && item.status === 'connected') as integration}<Select.Item value={integration.id}>{integration.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
              <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.integration_operation']()}</span><Select.Root type="single" value={$formData.integrationAction ?? undefined} onValueChange={(value) => ($formData.integrationAction = value)}><Select.Trigger class="w-full">{$formData.integrationAction ?? m['automation.integration_operation']()}</Select.Trigger><Select.Content>{#each integrations.find((item) => item.id === $formData.integrationId)?.permissions ?? [] as permission}<Select.Item value={permission}>{permission}</Select.Item>{/each}</Select.Content></Select.Root></label>
              <label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.integration_payload']()}</span><Textarea class="min-h-32 resize-y font-mono" spellcheck={false} bind:value={$formData.integrationPayload} /><span class="mt-1.5 block text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['automation.integration_payload_help']()}</span></label>
            {/if}
            {#if $formData.actionType === 'tool'}
              <label><span class="mb-1.5 block text-ui-md font-medium">{m['automation.tool']()}</span><Select.Root type="single" value={$formData.toolId ?? undefined} onValueChange={(value) => ($formData.toolId = value)}><Select.Trigger class="w-full">{tools.find((item) => item.id === $formData.toolId)?.name ?? m['automation.tool']()}</Select.Trigger><Select.Content>{#each tools.filter((item) => item.status !== 'archived' && item.publishedRevision != null) as tool}<Select.Item value={tool.id}>{tool.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
              <label class={compact ? '' : 'col-span-2'}><span class="mb-1.5 block text-ui-md font-medium">{m['automation.tool_input']()}</span><Textarea class="min-h-32 resize-y font-mono" spellcheck={false} bind:value={$formData.toolInput} /><span class="mt-1.5 block text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{m['automation.tool_input_help']()}</span></label>
            {/if}
          </div>
          <div class="mt-5 flex items-center justify-between gap-3 border-t border-[var(--app-border)] pt-4"><label class="flex cursor-pointer items-center gap-2 text-ui-md"><Switch checked={$formData.enabled} onCheckedChange={(checked: boolean) => ($formData.enabled = checked)} />{m['automation.enable']()}</label><div class="flex gap-2"><Button type="button" variant="ghost" size="sm" onclick={resetEditor}>{m['automation.cancel']()}</Button><Button type="submit" size="sm" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{m['automation.save']()}</Button></div></div>
        </form>
      {/if}

      {#if automations.length}
        <div class="overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">
          {#each automations as automation (automation.id)}
            <article class="automation-row relative flex items-center gap-3 px-3.5 py-3">
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 items-center gap-2">
                  <span class={`size-2 shrink-0 rounded-full ${automation.enabled ? 'bg-[var(--app-success)]' : 'bg-[var(--app-text-muted)]'}`} aria-hidden="true"></span>
                  <h3 class="min-w-0 truncate text-ui-lg font-semibold">{automation.name}</h3>
                  <span class="shrink-0 rounded-md bg-[var(--app-hover)] px-1.5 py-px text-ui-xs font-medium text-[var(--app-text-soft)]">{triggerLabel(automation.triggerType)}</span>
                </div>
                <p class="mt-1 truncate pl-4 text-ui-sm text-[var(--app-text-soft)]">{describeTrigger(automation)} → {actionLabel(automation.actionType)}</p>
                <p class="mt-0.5 truncate pl-4 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{automation.lastRunAt ? new Date(automation.lastRunAt).toLocaleString() : m['automation.last_run_never']()} · {m['automation.run_count']({ count: automation.runCount })}</p>
              </div>
              <div class="relative flex shrink-0 items-center">
                <!-- Acoes secundarias sobrepostas ao conteudo ao apontar/focar; o interruptor fica sempre visivel. -->
                <div class="row-actions">
                  <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={m['automation.run_now']()} disabled={busy} onclick={() => runNow(automation)}><Play size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['automation.run_now']()}</Tooltip.Content></Tooltip.Root>
                  <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" aria-label={m['automation.edit']()} onclick={() => edit(automation)}><Pencil size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['automation.edit']()}</Tooltip.Content></Tooltip.Root>
                  <Tooltip.Root><Tooltip.Trigger>{#snippet child({ props })}<Button {...props} variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)] hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" aria-label={m['automation.delete']()} onclick={() => (pendingDelete = automation)}><Trash2 size={14} /></Button>{/snippet}</Tooltip.Trigger><Tooltip.Content>{m['automation.delete']()}</Tooltip.Content></Tooltip.Root>
                </div>
                <Switch aria-label={automation.enabled ? m['automation.disable']() : m['automation.enable']()} checked={automation.enabled} onCheckedChange={() => void toggle(automation)} />
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="recipes" class="m-0 min-h-0 overflow-y-auto p-4">
      <div class={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {#each recipes as recipe (recipe.id)}
          <article class="recipe-card flex flex-col rounded-xl bg-[var(--app-surface)] p-4 shadow-border">
            <div class="flex items-center gap-2">
              <span class="grid size-7 place-items-center rounded-lg bg-[var(--app-hover)] text-[var(--app-text-soft)]" aria-hidden="true"><Sparkles size={14} /></span>
              <span class="rounded-md bg-[var(--app-hover)] px-1.5 py-px text-ui-xs font-medium text-[var(--app-text-soft)]">{recipeCategoryLabel(recipe.category)}</span>
            </div>
            <h3 class="mt-3 text-balance text-ui-lg font-semibold">{recipeName(recipe.id)}</h3>
            <p class="mt-1 line-clamp-3 text-pretty text-ui-sm leading-[1.45] text-[var(--app-text-muted)]">{recipe.defaults.prompt ?? recipe.defaults.taskDescription ?? recipe.defaults.notificationMessage}</p>
            <div class="mt-auto pt-4"><Button variant="outline" size="sm" onclick={() => applyRecipe(recipe)}>{m['automation.recipe_apply']()}</Button></div>
          </article>
        {/each}
      </div>
    </Tabs.Content>

    <Tabs.Content value="history" class="m-0 min-h-0 overflow-y-auto p-4">
      {#if runs.length === 0}
        <div class="grid min-h-56 rounded-xl bg-[var(--app-surface)] shadow-border"><NodeEmptyState icon={History} title={m['automation.history_empty']()} /></div>
      {:else}
        <div class="overflow-hidden rounded-xl bg-[var(--app-surface)] shadow-border">
          {#each runs as run (run.id)}
            <article class="automation-row flex items-start gap-3 px-3.5 py-3">
              {#if run.status === 'succeeded'}<CheckCircle2 class="mt-0.5 shrink-0 text-[var(--app-success)]" size={15} />{:else if run.status === 'failed' || run.status === 'dead_letter'}<XCircle class="mt-0.5 shrink-0 text-[var(--app-danger)]" size={15} />{:else}<LoaderCircle class={`mt-0.5 shrink-0 text-[var(--app-text-muted)] ${run.status === 'running' ? 'animate-spin' : ''}`} size={15} />{/if}
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="text-ui-lg font-semibold">{automations.find((item) => item.id === run.routineId)?.name ?? run.routineId.slice(0, 8)}</span>
                  <span class={`rounded-md px-1.5 py-px text-ui-xs font-medium ${runTone(run.status)}`}>{statusLabel(run.status)}</span>
                </div>
                {#if run.detail ?? run.error}<p class="mt-1 break-words text-ui-sm leading-[1.45] text-[var(--app-text-soft)]">{run.detail ?? run.error}</p>{/if}
                <p class="mt-1 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{new Date(run.ranAt).toLocaleString()} · {m['automation.attempt']({ attempt: run.attempt })}/{run.maxAttempts}{run.durationMs !== null ? ` · ${m['automation.duration']({ duration: run.durationMs })}` : ''}{run.provider ? ` · ${run.provider}` : ''}{run.nextAttemptAt ? ` · ${m['automation.next_attempt']({ date: new Date(run.nextAttemptAt).toLocaleString() })}` : ''}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">{#if run.status === 'queued' || run.status === 'running' || run.status === 'waiting_approval'}<Button variant="ghost" size="sm" onclick={() => cancelRun(run)}><X size={13} />{m['automation.cancel_run']()}</Button>{:else if run.recoverable}<Button variant="outline" size="sm" onclick={() => retry(run)}><RotateCcw size={13} />{m['automation.retry']()}</Button>{/if}</div>
            </article>
          {/each}
        </div>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="integrations" class="m-0 min-h-0 overflow-hidden"><IntegrationCenterPanel {workspaceId} {compact} onChanged={refresh} /></Tabs.Content>
    <Tabs.Content value="tools" class="m-0 min-h-0 overflow-hidden"><ToolWorkshopPanel {workspaceId} {compact} /></Tabs.Content>
    <Tabs.Content value="security" class="m-0 min-h-0 overflow-hidden"><AutonomySecurityPanel {workspaceId} {compact} /></Tabs.Content>
  </Tabs.Root>
</section>

<AlertDialog.Root open={Boolean(pendingDelete)} onOpenChange={(open) => !open && (pendingDelete = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['automation.delete_confirm_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['automation.delete_confirm_description']({ name: pendingDelete?.name ?? '' })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['automation.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={() => pendingDelete && void remove(pendingDelete)}>{m['automation.delete']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  /* Abas em linha: rotulo neutro, ativa com texto forte e sublinhado de acento. */
  :global(.automation-tab) {
    flex: none;
    height: 28px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  :global(.automation-tab[data-state='active']) {
    color: var(--app-text);
  }

  :global(.automation-tab[data-state='active'] svg) {
    color: var(--app-accent);
  }

  /* Sublinhado proprio: o primitivo nao marca data-active, so data-state. */
  :global(.automation-tab::after) {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: -5px;
    height: 2px;
    border-radius: 2px;
    background: var(--app-accent);
    opacity: 0;
    transition: opacity var(--duration-fast) ease-out;
  }

  :global(.automation-tab[data-state='active']::after) {
    opacity: 1;
  }

  .automation-row {
    /* Fundo opaco equivalente ao estado da linha, para a sobreposicao das acoes. */
    --row-bg: var(--app-surface);
    transition: background-color var(--duration-quick) ease-out;
  }

  .automation-row + .automation-row {
    box-shadow: inset 0 1px 0 var(--app-border);
  }

  .automation-row:hover {
    --row-bg: color-mix(in srgb, var(--app-text) 8%, var(--app-surface));
    background: var(--app-hover);
  }

  .row-actions {
    position: absolute;
    top: 50%;
    right: 100%;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 8px 0 20px;
    background: linear-gradient(to right, transparent, var(--row-bg) 20px);
    opacity: 0;
    transform: translateY(-50%);
    transition: opacity var(--duration-quick) ease-out;
  }

  .automation-row:hover .row-actions,
  .automation-row:focus-within .row-actions {
    opacity: 1;
  }

  /* Sem ponteiro fino (toque) as acoes ficam sempre visiveis. */
  @media (hover: none) {
    .row-actions {
      opacity: 1;
    }
  }

  .recipe-card {
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .recipe-card:hover {
    box-shadow: var(--app-shadow-border-hover);
  }
</style>
