<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import {
    Activity, CheckCircle2, GitPullRequestArrow, History, LoaderCircle,
    Pencil, Play, Plus, RefreshCw, RotateCcw, Sparkles, Trash2,
    Workflow, X, XCircle,
  } from '@lucide/svelte';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as Select from '$lib/components/ui/select';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import { automationFormSchema, type AutomationFormInput } from '$lib/modules/agent-room/contracts/schemas/automation.schema.js';
  import type { AutomationRecipe } from '$lib/modules/agent-room/application/catalogs/AutomationRecipeCatalog.js';
  import type { AutomationIntegration, AutomationRun, Routine } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  type DesktopBridge = {
    automationSecretStatus?: (key: string) => Promise<{ available: boolean; stored: boolean }>;
    saveAutomationSecret?: (key: string, value: string) => Promise<{ stored: boolean }>;
    deleteAutomationSecret?: (key: string) => Promise<{ deleted: boolean }>;
  };

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
  };
  const schema = automationFormSchema as unknown as Parameters<typeof zod>[0];
  const form = superForm(defaults(emptyForm, zod(schema)), {
    SPA: true,
    validators: zod(schema),
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
  let loading = $state(true);
  let busy = $state(false);
  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let githubOwner = $state('');
  let githubRepo = $state('');
  let githubToken = $state('');
  let githubSecretStored = $state(false);
  let pendingDelete = $state<Routine | null>(null);
  let disconnectPending = $state(false);

  const githubIntegration = $derived(integrations.find((item) => item.type === 'github') ?? null);
  const desktop = typeof window === 'undefined'
    ? undefined
    : (window as typeof window & { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop;

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
      [automations, runs, recipes, integrations] = await Promise.all([
        api<Routine[]>(`/api/agent-room/workspaces/${workspaceId}/automations`),
        api<AutomationRun[]>(`/api/agent-room/workspaces/${workspaceId}/automations/history`),
        api<AutomationRecipe[]>(`/api/agent-room/workspaces/${workspaceId}/automations/recipes`),
        api<AutomationIntegration[]>(`/api/agent-room/workspaces/${workspaceId}/automations/integrations`),
      ]);
      const github = integrations.find((item) => item.type === 'github');
      if (github) {
        githubOwner = github.config.owner;
        githubRepo = github.config.repo;
      }
      const status = await desktop?.automationSecretStatus?.(`automation:github:${workspaceId}`).catch(() => null);
      githubSecretStored = Boolean(status?.stored);
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

  async function connectGitHub(): Promise<void> {
    busy = true;
    const secretKey = `automation:github:${workspaceId}`;
    try {
      if (!desktop?.saveAutomationSecret) throw new Error(m['automation.desktop_required']());
      if (githubToken.trim()) {
        await desktop.saveAutomationSecret(secretKey, githubToken);
        githubSecretStored = true;
      }
      if (!githubSecretStored && !githubToken.trim()) throw new Error(m['automation.github_token']());
      await api(`/api/agent-room/workspaces/${workspaceId}/automations/integrations/github`, {
        method: 'POST', body: JSON.stringify({ owner: githubOwner, repo: githubRepo }),
      });
      githubToken = '';
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['automation.github_error']());
    } finally {
      busy = false;
    }
  }

  async function checkGitHub(): Promise<void> {
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/integrations/github`, { method: 'PATCH' });
    await refresh();
  }

  async function disconnectGitHub(): Promise<void> {
    if (!githubIntegration) return;
    await desktop?.deleteAutomationSecret?.(`automation:github:${workspaceId}`);
    await api(`/api/agent-room/workspaces/${workspaceId}/automations/integrations/${githubIntegration.id}`, { method: 'DELETE' });
    githubSecretStored = false;
    integrations = [];
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
    return ({ prompt_agent: m['automation.action_prompt'], create_task: m['automation.action_task'], notify: m['automation.action_notify'] }[type])();
  }

  function statusLabel(status: AutomationRun['status']): string {
    return ({ queued: m['automation.status_queued'], running: m['automation.status_running'], succeeded: m['automation.status_succeeded'], failed: m['automation.status_failed'] }[status])();
  }

  function describeTrigger(automation: Routine): string {
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
  <header class="flex min-h-14 shrink-0 items-start gap-3 border-b border-[var(--app-border)] px-4 py-3">
    <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-[var(--app-accent-soft)] text-[var(--app-accent)]"><Workflow size={16} /></span>
    <div class="min-w-0 flex-1"><h1 class="text-sm font-semibold">{m['automation.title']()}</h1><p class="mt-0.5 line-clamp-2 text-[10px] leading-4 text-[var(--app-text-muted)]">{m['automation.description']()}</p></div>
    {#if onClose}<Button variant="ghost" size="icon-sm" aria-label={m['routine.close']()} onclick={onClose}><X size={15} /></Button>{/if}
  </header>

  <Tabs.Root bind:value={activeTab} class="grid min-h-0 flex-1 grid-rows-[38px_minmax(0,1fr)]">
    <Tabs.List class="h-[38px] w-full justify-start overflow-x-auto rounded-none border-b border-[var(--app-border)] bg-transparent px-2">
      <Tabs.Trigger value="overview" class="h-7 text-[10px]"><Activity size={12} />{m['automation.overview']()}</Tabs.Trigger>
      <Tabs.Trigger value="recipes" class="h-7 text-[10px]"><Sparkles size={12} />{m['automation.recipes']()}</Tabs.Trigger>
      <Tabs.Trigger value="history" class="h-7 text-[10px]"><History size={12} />{m['automation.history']()}</Tabs.Trigger>
      <Tabs.Trigger value="integrations" class="h-7 text-[10px]"><GitPullRequestArrow size={12} />{m['automation.integrations']()}</Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="overview" class="m-0 min-h-0 overflow-y-auto p-4">
      <div class="mb-3 flex items-center justify-between gap-3"><div><h2 class="text-xs font-semibold">{m['automation.overview']()}</h2><p class="text-[9px] text-[var(--app-text-muted)]">{m['automation.run_count']({ count: runs.length })}</p></div><Button size="sm" onclick={openNew}><Plus size={14} />{m['automation.new']()}</Button></div>
      {#if loading}<div class="grid min-h-40 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={20} /><span class="sr-only">{m['automation.loading']()}</span></div>
      {:else if automations.length === 0 && !editorOpen}<div class="grid min-h-52 place-items-center border border-dashed border-[var(--app-border)] p-8 text-center"><div><Workflow class="mx-auto text-[var(--app-text-muted)]" size={24} /><h3 class="mt-3 text-xs font-semibold">{m['automation.empty']()}</h3><p class="mt-1 text-[10px] text-[var(--app-text-muted)]">{m['automation.empty_hint']()}</p></div></div>
      {/if}

      {#if editorOpen}
        <form method="POST" use:enhance class="mb-4 border-l-2 border-[var(--app-accent)] bg-[var(--app-surface)] p-4">
          <div class="mb-4 flex items-center justify-between"><h3 class="text-xs font-semibold">{editingId ? m['automation.edit']() : m['automation.new']()}</h3><Button type="button" variant="ghost" size="icon-sm" aria-label={m['automation.cancel']()} onclick={resetEditor}><X size={14} /></Button></div>
          <div class={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <label class="block"><span class="mb-1 block text-[10px] font-medium">{m['automation.name']()}</span><Input name="automation-name" bind:value={$formData.name} autocomplete="off" /></label>
            <label class="block"><span class="mb-1 block text-[10px] font-medium">{m['automation.trigger']()}</span><Select.Root type="single" value={$formData.triggerType} onValueChange={(value) => { $formData.triggerType = value as AutomationFormInput['triggerType']; if (value === 'webhook' && !$formData.webhookSecret) $formData.webhookSecret = crypto.randomUUID(); }}><Select.Trigger class="w-full">{triggerLabel($formData.triggerType)}</Select.Trigger><Select.Content>{#each ['manual','schedule','task','message','git_commit','github_pull_request','webhook','file_change','usage_threshold'] as type}<Select.Item value={type}>{triggerLabel(type as Routine['triggerType'])}</Select.Item>{/each}</Select.Content></Select.Root></label>
            {#if $formData.triggerType === 'schedule'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.interval']()}</span><Input type="number" min="1" bind:value={$formData.intervalMinutes} /></label>{/if}
            {#if $formData.triggerType === 'task'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.task_event']()}</span><Select.Root type="single" value={$formData.taskEvent ?? undefined} onValueChange={(value) => ($formData.taskEvent = value as AutomationFormInput['taskEvent'])}><Select.Trigger class="w-full">{$formData.taskEvent ? ({created:m['automation.event_created'],updated:m['automation.event_updated'],status_changed:m['automation.event_status_changed'],completed:m['automation.event_completed']}[$formData.taskEvent])() : m['automation.task_event']()}</Select.Trigger><Select.Content><Select.Item value="created">{m['automation.event_created']()}</Select.Item><Select.Item value="updated">{m['automation.event_updated']()}</Select.Item><Select.Item value="status_changed">{m['automation.event_status_changed']()}</Select.Item><Select.Item value="completed">{m['automation.event_completed']()}</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1 block text-[10px] font-medium">{m['automation.task_status']()}</span><Input bind:value={$formData.taskStatus} /></label>{/if}
            {#if $formData.triggerType === 'message'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.message_contains']()}</span><Input bind:value={$formData.messageContains} /></label>{/if}
            {#if $formData.triggerType === 'git_commit'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.git_branch']()}</span><Input bind:value={$formData.gitBranch} /></label>{/if}
            {#if $formData.triggerType === 'github_pull_request'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.pr_event']()}</span><Select.Root type="single" value={$formData.githubEvent ?? undefined} onValueChange={(value) => ($formData.githubEvent = value as AutomationFormInput['githubEvent'])}><Select.Trigger class="w-full">{$formData.githubEvent ?? m['automation.pr_event']()}</Select.Trigger><Select.Content><Select.Item value="opened">{m['automation.pr_opened']()}</Select.Item><Select.Item value="updated">{m['automation.pr_updated']()}</Select.Item><Select.Item value="merged">{m['automation.pr_merged']()}</Select.Item><Select.Item value="closed">{m['automation.pr_closed']()}</Select.Item></Select.Content></Select.Root></label>{/if}
            {#if $formData.triggerType === 'webhook'}<label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-[10px] font-medium">{m['automation.webhook_secret']()}</span><Input bind:value={$formData.webhookSecret} autocomplete="off" /><span class="mt-1 block text-[9px] text-[var(--app-text-muted)]">{m['automation.webhook_hint']()}</span>{#if editingId}<code class="mt-2 block overflow-x-auto border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 text-[9px]">/api/agent-room/workspaces/{workspaceId}/automations/webhook/{editingId}</code>{/if}</label>{/if}
            {#if $formData.triggerType === 'file_change'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.file_path']()}</span><Input bind:value={$formData.filePath} placeholder="src" /></label>{/if}
            {#if $formData.triggerType === 'usage_threshold'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.provider']()}</span><Select.Root type="single" value={$formData.usageProvider ?? undefined} onValueChange={(value) => ($formData.usageProvider = value as AutomationFormInput['usageProvider'])}><Select.Trigger class="w-full">{$formData.usageProvider ?? m['automation.provider']()}</Select.Trigger><Select.Content><Select.Item value="claude">Claude</Select.Item><Select.Item value="codex">Codex</Select.Item><Select.Item value="kimi">Kimi</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1 block text-[10px] font-medium">{m['automation.usage_window']()}</span><Select.Root type="single" value={$formData.usageWindow ?? undefined} onValueChange={(value) => ($formData.usageWindow = value as AutomationFormInput['usageWindow'])}><Select.Trigger class="w-full">{$formData.usageWindow ?? m['automation.usage_window']()}</Select.Trigger><Select.Content><Select.Item value="5h">5h</Select.Item><Select.Item value="weekly">Weekly</Select.Item><Select.Item value="monthly">Monthly</Select.Item></Select.Content></Select.Root></label><label><span class="mb-1 block text-[10px] font-medium">{m['automation.threshold']()}</span><Input type="number" min="1" max="100" bind:value={$formData.usagePercent} /></label>{/if}
            <label><span class="mb-1 block text-[10px] font-medium">{m['automation.action']()}</span><Select.Root type="single" value={$formData.actionType} onValueChange={(value) => ($formData.actionType = value as AutomationFormInput['actionType'])}><Select.Trigger class="w-full">{actionLabel($formData.actionType)}</Select.Trigger><Select.Content><Select.Item value="prompt_agent">{m['automation.action_prompt']()}</Select.Item><Select.Item value="create_task">{m['automation.action_task']()}</Select.Item><Select.Item value="notify">{m['automation.action_notify']()}</Select.Item></Select.Content></Select.Root></label>
            {#if $formData.actionType === 'prompt_agent'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.target']()}</span><Select.Root type="single" value={$formData.targetNodeId ?? undefined} onValueChange={(value) => ($formData.targetNodeId = value)}><Select.Trigger class="w-full">{terminals.find((item) => item.id === $formData.targetNodeId)?.title ?? m['automation.target']()}</Select.Trigger><Select.Content>{#each terminals as terminal}<Select.Item value={terminal.id}>{terminal.title}</Select.Item>{/each}</Select.Content></Select.Root></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-[10px] font-medium">{m['automation.prompt']()}</span><Textarea class="min-h-24 resize-y" bind:value={$formData.prompt} /></label>{/if}
            {#if $formData.actionType === 'create_task'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.task_title']()}</span><Input bind:value={$formData.taskTitle} /></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-[10px] font-medium">{m['automation.task_description']()}</span><Textarea class="min-h-20 resize-y" bind:value={$formData.taskDescription} /></label>{/if}
            {#if $formData.actionType === 'notify'}<label><span class="mb-1 block text-[10px] font-medium">{m['automation.notification_title']()}</span><Input bind:value={$formData.notificationTitle} /></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-[10px] font-medium">{m['automation.notification_message']()}</span><Textarea class="min-h-20 resize-y" bind:value={$formData.notificationMessage} /></label>{/if}
          </div>
          <div class="mt-4 flex items-center justify-between gap-3"><label class="flex items-center gap-2 text-[10px]"><Switch checked={$formData.enabled} onCheckedChange={(checked) => ($formData.enabled = checked)} />{m['automation.enable']()}</label><div class="flex gap-2"><Button type="button" variant="ghost" size="sm" onclick={resetEditor}>{m['automation.cancel']()}</Button><Button type="submit" size="sm" disabled={busy}>{#if busy}<LoaderCircle class="animate-spin" />{/if}{m['automation.save']()}</Button></div></div>
        </form>
      {/if}

      <div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">
        {#each automations as automation (automation.id)}
          <article class={`grid gap-3 bg-[var(--app-surface)] px-3 py-3 ${compact ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]'}`}>
            <div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><span class={`size-2 rounded-full ${automation.enabled ? 'bg-[var(--app-success)]' : 'bg-[var(--app-text-muted)]'}`}></span><h3 class="truncate text-xs font-semibold">{automation.name}</h3><Badge variant="outline">{triggerLabel(automation.triggerType)}</Badge></div><p class="mt-1 truncate text-[10px] text-[var(--app-text-soft)]">{describeTrigger(automation)} → {actionLabel(automation.actionType)}</p><p class="mt-1 text-[9px] text-[var(--app-text-muted)]">{automation.lastRunAt ? new Date(automation.lastRunAt).toLocaleString() : m['automation.last_run_never']()} · {m['automation.run_count']({ count: automation.runCount })}</p></div>
            <div class="flex items-center gap-1"><Switch aria-label={automation.enabled ? m['automation.disable']() : m['automation.enable']()} checked={automation.enabled} onCheckedChange={() => void toggle(automation)} /><Button variant="ghost" size="icon-sm" aria-label={m['automation.run_now']()} disabled={busy} onclick={() => runNow(automation)}><Play size={13} /></Button><Button variant="ghost" size="icon-sm" aria-label={m['automation.edit']()} onclick={() => edit(automation)}><Pencil size={13} /></Button><Button variant="ghost" size="icon-sm" class="text-[var(--app-danger)]" aria-label={m['automation.delete']()} onclick={() => (pendingDelete = automation)}><Trash2 size={13} /></Button></div>
          </article>
        {/each}
      </div>
    </Tabs.Content>

    <Tabs.Content value="recipes" class="m-0 min-h-0 overflow-y-auto p-4"><div class={`grid gap-px bg-[var(--app-border)] ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>{#each recipes as recipe (recipe.id)}<article class="bg-[var(--app-surface)] p-4"><div class="flex items-center gap-2"><Sparkles size={14} class="text-[var(--app-accent)]" /><Badge variant="outline">{recipe.category}</Badge></div><h3 class="mt-3 text-xs font-semibold">{recipeName(recipe.id)}</h3><p class="mt-1 line-clamp-3 text-[10px] leading-4 text-[var(--app-text-muted)]">{recipe.defaults.prompt ?? recipe.defaults.taskDescription ?? recipe.defaults.notificationMessage}</p><Button class="mt-4" variant="outline" size="sm" onclick={() => applyRecipe(recipe)}>{m['automation.recipe_apply']()}</Button></article>{/each}</div></Tabs.Content>

    <Tabs.Content value="history" class="m-0 min-h-0 overflow-y-auto p-4">{#if runs.length === 0}<div class="grid min-h-52 place-items-center text-center"><div><History class="mx-auto text-[var(--app-text-muted)]" size={24} /><p class="mt-2 text-xs">{m['automation.history_empty']()}</p></div></div>{:else}<div class="divide-y divide-[var(--app-border)] border-y border-[var(--app-border)]">{#each runs as run (run.id)}<article class="flex items-start gap-3 bg-[var(--app-surface)] px-3 py-3">{#if run.status === 'succeeded'}<CheckCircle2 class="mt-0.5 shrink-0 text-[var(--app-success)]" size={15} />{:else if run.status === 'failed'}<XCircle class="mt-0.5 shrink-0 text-[var(--app-danger)]" size={15} />{:else}<LoaderCircle class={`mt-0.5 shrink-0 text-[var(--app-accent)] ${run.status === 'running' ? 'animate-spin' : ''}`} size={15} />{/if}<div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><span class="text-xs font-medium">{automations.find((item) => item.id === run.routineId)?.name ?? run.routineId.slice(0, 8)}</span><Badge variant="outline">{statusLabel(run.status)}</Badge></div><p class="mt-1 break-words text-[10px] leading-4 text-[var(--app-text-soft)]">{run.detail ?? run.error}</p><p class="mt-1 text-[9px] text-[var(--app-text-muted)]">{new Date(run.ranAt).toLocaleString()} · {m['automation.attempt']({ attempt: run.attempt })}{run.durationMs !== null ? ` · ${m['automation.duration']({ duration: run.durationMs })}` : ''}{run.provider ? ` · ${run.provider}` : ''}</p></div>{#if run.recoverable && run.attempt < 3}<Button variant="ghost" size="sm" onclick={() => retry(run)}><RotateCcw size={13} />{m['automation.retry']()}</Button>{/if}</article>{/each}</div>{/if}</Tabs.Content>

    <Tabs.Content value="integrations" class="m-0 min-h-0 overflow-y-auto p-4"><section class="border-l-2 border-[var(--app-text)] bg-[var(--app-surface)] p-4"><div class="flex items-start gap-3"><GitPullRequestArrow size={20} /><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h2 class="text-sm font-semibold">{m['automation.github_title']()}</h2><Badge variant={githubIntegration?.status === 'connected' ? 'default' : 'outline'}>{githubIntegration?.status === 'connected' ? m['automation.github_connected']() : githubIntegration?.status === 'error' ? m['automation.github_error']() : m['automation.github_disconnected']()}</Badge></div><p class="mt-1 max-w-xl text-[10px] leading-4 text-[var(--app-text-muted)]">{m['automation.github_description']()}</p></div></div><div class={`mt-5 grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}><label><span class="mb-1 block text-[10px] font-medium">{m['automation.github_owner']()}</span><Input bind:value={githubOwner} autocomplete="off" /></label><label><span class="mb-1 block text-[10px] font-medium">{m['automation.github_repo']()}</span><Input bind:value={githubRepo} autocomplete="off" /></label><label class={compact ? '' : 'col-span-2'}><span class="mb-1 block text-[10px] font-medium">{m['automation.github_token']()}</span><Input type="password" bind:value={githubToken} autocomplete="new-password" placeholder={githubSecretStored ? '••••••••••••' : ''} /><span class="mt-1 block text-[9px] text-[var(--app-text-muted)]">{m['automation.github_token_hint']()}</span></label></div>{#if githubIntegration?.error}<p class="mt-3 text-[10px] text-[var(--app-danger)]">{githubIntegration.error}</p>{/if}<div class="mt-4 flex flex-wrap gap-2"><Button size="sm" disabled={busy || !githubOwner.trim() || !githubRepo.trim()} onclick={connectGitHub}>{#if busy}<LoaderCircle class="animate-spin" />{:else}<GitPullRequestArrow />{/if}{m['automation.github_connect']()}</Button>{#if githubIntegration}<Button variant="outline" size="sm" onclick={checkGitHub}><RefreshCw />{m['automation.github_check']()}</Button><Button variant="ghost" size="sm" class="text-[var(--app-danger)]" onclick={() => (disconnectPending = true)}><Trash2 />{m['automation.github_disconnect']()}</Button>{/if}</div></section></Tabs.Content>
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
      <AlertDialog.Action class="bg-[var(--app-danger)] text-white hover:opacity-90" onclick={() => pendingDelete && void remove(pendingDelete)}>{m['automation.delete']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={disconnectPending}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['automation.github_disconnect_confirm_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['automation.github_disconnect_confirm_description']()}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['automation.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-[var(--app-danger)] text-white hover:opacity-90" onclick={() => void disconnectGitHub()}>{m['automation.github_disconnect']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
