<script lang="ts">
  import { untrack } from 'svelte';
  import { Eye, HardDrive, RefreshCw, Save } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Slider } from '$lib/components/ui/slider';
  import * as Select from '$lib/components/ui/select';
  import type { ComputerNodeConfig, ComputerWatch, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import type { ComputerStorageStats } from '$lib/modules/agent-room/application/services/ComputerEvidenceService.js';
  import type { ObservationStatus } from '$lib/modules/agent-room/application/services/ComputerObservationService.js';
  import type { Routine } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, optionsVersion = 0, config, windows, storage, observation, busy, save, cleanup }: {
    workspaceId: string; optionsVersion?: number; config: ComputerNodeConfig; windows: ComputerWindow[]; storage?: ComputerStorageStats;
    observation?: ObservationStatus; busy: boolean; save: (config: ComputerNodeConfig) => Promise<boolean>; cleanup: () => Promise<void>;
  } = $props();
  let draft = $state<ComputerWatch>(untrack(() => $state.snapshot(config.watch)));
  let dirty = $state(false);
  let routines = $state<Routine[]>([]);
  let tasks = $state<{ id: string; title: string; status: string; assigneeNodeId: string | null }[]>([]);
  let replyGrants = $state<{ id: string; enabled: boolean; agentId: string; taskId: string; applicationId: string; recipient: { name: string } }[]>([]);
  let optionsError = $state(false);
  const messages = m as unknown as Record<string, () => string>;
  const selectedRoutine = $derived(routines.find((r) => r.id === draft.routineId));
  const targetAgent = $derived(selectedRoutine?.actionConfig.targetNodeId ?? selectedRoutine?.targetNodeId);
  const eligibleTasks = $derived(tasks.filter((task) => task.status !== 'done' && task.assigneeNodeId === targetAgent));
  const eligibleWindows = $derived(windows.filter((window) => config.allowedApplications.some((app) => app.toLowerCase() === window.appId.toLowerCase())));
  const valid = $derived(Boolean(draft.windowId && draft.applicationId && selectedRoutine && eligibleTasks.some((task) => task.id === draft.taskId)));

  function edit(patch: Partial<ComputerWatch>) { dirty = true; draft = { ...draft, ...patch }; }
  function region(key: keyof ComputerWatch['region'], percent: number) {
    const next = { ...draft.region, [key]: percent / 100 };
    next.width = Math.min(next.width, 1 - next.x); next.height = Math.min(next.height, 1 - next.y);
    edit({ region: next });
  }
  async function apply(enabled = draft.enabled) {
    if (await save({ ...config, watch: { ...draft, enabled } })) { dirty = false; draft = $state.snapshot(config.watch); }
  }

  $effect(() => {
    const value = config.watch;
    if (!untrack(() => dirty)) draft = $state.snapshot(value);
  });
  $effect(() => {
    const id = workspaceId;
    optionsVersion;
    const controller = new AbortController();
    dirty = false;
    const load = async () => {
      try {
        const responses = await Promise.all(['automations', 'tasks', 'autonomy'].map(async (path) => {
          const response = await fetch(`/api/agent-room/workspaces/${id}/${path}`, { signal: controller.signal });
          if (!response.ok) throw new Error();
          return (await response.json()).data;
        }));
        if (!controller.signal.aborted) {
          routines = responses[0].filter((r: Routine) => r.enabled && r.triggerType === 'manual' && r.actionType === 'prompt_agent');
          tasks = responses[1]; optionsError = false;
          replyGrants = responses[2].policy.computerReplyGrants ?? [];
        }
      } catch { if (!controller.signal.aborted) optionsError = true; }
    };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 20000);
    return () => { controller.abort(); clearInterval(timer); };
  });
</script>

<section class="mt-4 space-y-3 border-t border-[var(--app-border)] pt-3" data-testid="computer-observation-controls">
  <div class="flex flex-wrap items-center gap-2">
    <Eye size={14} class="text-[var(--app-text-muted)]" /><h3 class="min-w-0 flex-1 text-xs font-semibold">{m['computer.watch_title']()}</h3>
    <label class="flex items-center gap-2 text-xs"><span>{m['computer.watch_enabled']()}</span><Switch checked={config.watch.enabled} disabled={busy || (!config.watch.enabled && !valid)} onCheckedChange={(enabled: boolean) => enabled ? apply(true) : save({ ...config, watch: { ...config.watch, enabled: false } })} /></label>
  </div>
  <p role="status" class="border-l-2 border-[var(--app-accent)] pl-2 text-xs text-[var(--app-text-secondary)]">{messages[`computer.watch_${observation?.state ?? 'paused'}`]()}</p>
  {#if observation?.error}<p role="alert" class="text-xs text-[var(--app-warning)]">{m['computer.watch_error']()}</p>{/if}
  {#if optionsError}<p role="alert" class="text-xs text-[var(--app-warning)]">{m['computer.watch_options_error']()}</p>{/if}
  <div class="grid min-w-0 gap-2">
    <label class="min-w-0 space-y-1 text-xs"><span>{messages['computer.watch_mode']()}</span><Select.Root type="single" value={draft.mode} onValueChange={(value: string) => edit({ mode: value as ComputerWatch['mode'] })}><Select.Trigger class="w-full" disabled={busy}>{messages[`computer.watch_mode_${draft.mode}`]()}</Select.Trigger><Select.Content><Select.Item value="auto">{messages['computer.watch_mode_auto']()}</Select.Item><Select.Item value="visual">{messages['computer.watch_mode_visual']()}</Select.Item></Select.Content></Select.Root></label>
    <label class="min-w-0 space-y-1 text-xs"><span>{m['computer.capture_target']()}</span><Select.Root type="single" value={draft.windowId} onValueChange={(value: string) => edit({ windowId: value, applicationId: eligibleWindows.find((w) => w.id === value)?.appId ?? '' })}><Select.Trigger class="w-full min-w-0" disabled={busy}><span class="truncate">{eligibleWindows.find((w) => w.id === draft.windowId)?.title || draft.windowId || m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each eligibleWindows as window (window.id)}<Select.Item value={window.id}>{window.appName} · {window.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="min-w-0 space-y-1 text-xs"><span>{m['computer.watch_routine']()}</span><Select.Root type="single" value={draft.routineId ?? ''} onValueChange={(value: string) => edit({ routineId: value, taskId: null })}><Select.Trigger class="w-full min-w-0" disabled={busy}><span class="truncate">{selectedRoutine?.name ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each routines as routine (routine.id)}<Select.Item value={routine.id}>{routine.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="min-w-0 space-y-1 text-xs"><span>{m['computer.watch_task']()}</span><Select.Root type="single" value={draft.taskId ?? ''} onValueChange={(value: string) => edit({ taskId: value })}><Select.Trigger class="w-full min-w-0" disabled={busy || !selectedRoutine}><span class="truncate">{eligibleTasks.find((task) => task.id === draft.taskId)?.title ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each eligibleTasks as task (task.id)}<Select.Item value={task.id}>{task.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
  </div>
  <label class="block min-w-0 space-y-1 text-xs"><span>{messages['computer.reply_scope']()}</span><Select.Root type="single" value={draft.replyGrantId ?? 'none'} onValueChange={(value: string) => edit({ replyGrantId: value === 'none' ? null : value, ...(value !== 'none' ? { mode: 'auto' } : {}) })}><Select.Trigger class="w-full" disabled={busy}><span class="truncate">{replyGrants.find(g => g.id === draft.replyGrantId)?.recipient.name ?? messages['computer.reply_none']()}</span></Select.Trigger><Select.Content><Select.Item value="none">{messages['computer.reply_none']()}</Select.Item>{#each replyGrants.filter(g => g.enabled && g.agentId === targetAgent && g.taskId === draft.taskId && g.applicationId === draft.applicationId) as grant}<Select.Item value={grant.id}>{grant.recipient.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
  <div class="grid grid-cols-2 gap-x-4 gap-y-3">
    <label class="space-y-2 text-xs"><span>{m['computer.watch_interval']()}: {draft.intervalSeconds}s</span><Slider type="single" min={1} max={60} step={1} value={draft.intervalSeconds} disabled={busy} aria-label={m['computer.watch_interval']()} onValueChange={(value: number) => edit({ intervalSeconds: value })} /></label>
    <label class="space-y-2 text-xs"><span>{m['computer.watch_cooldown']()}: {draft.cooldownSeconds}s</span><Slider type="single" min={1} max={120} step={1} value={draft.cooldownSeconds} disabled={busy} aria-label={m['computer.watch_cooldown']()} onValueChange={(value: number) => edit({ cooldownSeconds: value })} /></label>
  </div>
  <details class="text-xs">
    <summary class="cursor-pointer py-2 font-medium">{m['computer.watch_region']()}</summary>
    <div class="grid grid-cols-2 gap-4 py-2">
      {#each ['x', 'y', 'width', 'height'] as key}
        {@const name = key as keyof ComputerWatch['region']}
        <label class="space-y-2"><span>{messages[`computer.watch_region_${key}`]()} {Math.round(draft.region[name] * 100)}%</span><Slider type="single" min={name === 'x' || name === 'y' ? 0 : 1} max={name === 'x' || name === 'y' ? 99 : Math.floor((1 - draft.region[name === 'width' ? 'x' : 'y']) * 100)} step={1} value={Math.round(draft.region[name] * 100)} disabled={busy} aria-label={messages[`computer.watch_region_${key}`]()} onValueChange={(value: number) => region(name, value)} /></label>
      {/each}
      <label class="col-span-2 space-y-2"><span>{m['computer.watch_threshold']()}: {draft.minChangePercent}%</span><Slider type="single" min={0.1} max={10} step={0.1} value={draft.minChangePercent} disabled={busy} aria-label={m['computer.watch_threshold']()} onValueChange={(value: number) => edit({ minChangePercent: value })} /></label>
    </div>
  </details>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <label class="flex items-center gap-2 text-xs"><Switch checked={config.allowAgentWatch} disabled={busy} onCheckedChange={(checked: boolean) => save({ ...config, allowAgentWatch: checked })} />{m['computer.watch_agent_config']()}</label>
    <Button size="sm" variant="outline" disabled={busy || !dirty || (draft.enabled && !valid)} onclick={() => apply()}><Save size={13} />{m['computer.watch_save']()}</Button>
  </div>
  <div class="flex flex-wrap gap-3 text-xs tabular-nums text-[var(--app-text-muted)]"><span>{m['computer.watch_checks']()}: {observation?.checks ?? 0}</span><span>{m['computer.watch_notifications']()}: {observation?.notifications ?? 0}</span></div>
  {#if observation?.pendingMessages !== undefined}<p class="text-xs tabular-nums text-[var(--app-text-secondary)]">{messages['computer.watch_pending_messages']()}: {observation.pendingMessages}</p>{/if}
  {#if observation?.source}<div class="flex flex-wrap gap-3 text-xs tabular-nums text-[var(--app-text-muted)]"><span>{messages[`computer.watch_source_${observation.source}`]()}</span>{#if observation.checkMs !== undefined}<span>{messages['computer.watch_check_duration']()}: {observation.checkMs} ms</span>{/if}</div>{/if}
</section>

<section class="mt-4 space-y-3 border-t border-[var(--app-border)] pt-3" data-testid="computer-storage-controls">
  <div class="flex items-center gap-2"><HardDrive size={14} class="text-[var(--app-text-muted)]" /><h3 class="flex-1 text-xs font-semibold">{m['computer.storage_title']()}</h3><Button size="icon-sm" variant="ghost" disabled={busy} title={m['computer.storage_cleanup']()} aria-label={m['computer.storage_cleanup']()} onclick={cleanup}><RefreshCw size={14} /></Button></div>
  <div class="grid grid-cols-2 gap-3">
    <label class="min-w-0 space-y-1 text-xs"><span>{m['computer.storage_days']()}</span><Select.Root type="single" value={String(config.evidenceRetentionDays)} onValueChange={(value: string) => save({ ...config, evidenceRetentionDays: Number(value) })}><Select.Trigger class="w-full" disabled={busy}>{config.evidenceRetentionDays}</Select.Trigger><Select.Content>{#each [1, 7, 14, 30, 90, 365] as days}<Select.Item value={String(days)}>{days}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="min-w-0 space-y-1 text-xs"><span>{m['computer.storage_limit']()} (MiB)</span><Select.Root type="single" value={String(config.evidenceMaxMiB)} onValueChange={(value: string) => save({ ...config, evidenceMaxMiB: Number(value) })}><Select.Trigger class="w-full" disabled={busy}>{config.evidenceMaxMiB}</Select.Trigger><Select.Content>{#each [32, 128, 256, 512, 1024] as size}<Select.Item value={String(size)}>{size}</Select.Item>{/each}</Select.Content></Select.Root></label>
  </div>
  {#if storage?.checkedAt}<div class="grid gap-1 text-xs tabular-nums text-[var(--app-text-secondary)]"><span>{m['computer.storage_evidence']()}: {storage.files} · {(storage.bytes / 1048576).toFixed(1)} MiB</span><span>{m['computer.storage_temporary']()}: {storage.temporaryFiles} · {(storage.temporaryBytes / 1048576).toFixed(1)} MiB</span></div>{:else}<p class="text-xs text-[var(--app-text-muted)]">{m['computer.storage_pending']()}</p>{/if}
  {#if storage?.error}<p role="alert" class="text-xs text-[var(--app-warning)]">{m['computer.storage_error']()}</p>{/if}
  <p class="text-xs leading-5 text-[var(--app-text-muted)]">{m['computer.storage_limits']()}</p>
</section>
