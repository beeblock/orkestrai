<script lang="ts">
  import { untrack } from 'svelte';
  import { ChevronRight, Eraser, Eye, HardDrive, Save, TriangleAlert } from '@lucide/svelte';
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

  // Apresentacao: tom do ponto de estado e secao de armazenamento recolhida.
  const uid = $props.id();
  let storageOpen = $state(false);
  const stateTone = $derived.by(() => {
    const state = observation?.state ?? 'paused';
    if (state === 'paused') return 'muted';
    if (state === 'unchanged') return 'success';
    if (state === 'changed') return 'accent';
    if (state === 'blocked' || state === 'error') return 'warning';
    return 'info';
  });
  const mib = (bytes: number) => (bytes / 1048576).toFixed(1);

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

<section class="oc-card" data-testid="computer-observation-controls">
  <div class="oc-head">
    <h3 class="oc-title"><Eye size={14} aria-hidden="true" />{m['computer.watch_title']()}</h3>
    <label class="flex items-center gap-2 text-[12px] font-medium"><span>{m['computer.watch_enabled']()}</span><Switch checked={config.watch.enabled} disabled={busy || (!config.watch.enabled && !valid)} onCheckedChange={(enabled: boolean) => enabled ? apply(true) : save({ ...config, watch: { ...config.watch, enabled: false } })} /></label>
  </div>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
    <p role="status" class="oc-status" data-tone={stateTone}><span class="oc-dot" aria-hidden="true"></span>{messages[`computer.watch_${observation?.state ?? 'paused'}`]()}</p>
    <span class="oc-meta"><span class="oc-num">{observation?.checks ?? 0}</span> {m['computer.watch_checks']()}</span>
    <span class="oc-meta"><span class="oc-num">{observation?.notifications ?? 0}</span> {m['computer.watch_notifications']()}</span>
  </div>
  {#if observation?.error}<p role="alert" class="oc-callout"><TriangleAlert size={13} aria-hidden="true" /><span>{m['computer.watch_error']()}</span></p>{/if}
  {#if optionsError}<p role="alert" class="oc-callout"><TriangleAlert size={13} aria-hidden="true" /><span>{m['computer.watch_options_error']()}</span></p>{/if}
  <div class="oc-grid">
    <label class="oc-field"><span class="oc-label">{messages['computer.watch_mode']()}</span><Select.Root type="single" value={draft.mode} onValueChange={(value: string) => edit({ mode: value as ComputerWatch['mode'] })}><Select.Trigger class="h-8 w-full min-w-0" disabled={busy}><span class="truncate">{messages[`computer.watch_mode_${draft.mode}`]()}</span></Select.Trigger><Select.Content><Select.Item value="auto">{messages['computer.watch_mode_auto']()}</Select.Item><Select.Item value="visual">{messages['computer.watch_mode_visual']()}</Select.Item></Select.Content></Select.Root></label>
    <label class="oc-field"><span class="oc-label">{m['computer.capture_target']()}</span><Select.Root type="single" value={draft.windowId} onValueChange={(value: string) => edit({ windowId: value, applicationId: eligibleWindows.find((w) => w.id === value)?.appId ?? '' })}><Select.Trigger class="h-8 w-full min-w-0" disabled={busy}><span class="truncate">{eligibleWindows.find((w) => w.id === draft.windowId)?.title || draft.windowId || m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each eligibleWindows as window (window.id)}<Select.Item value={window.id}>{window.appName} · {window.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="oc-field"><span class="oc-label">{m['computer.watch_routine']()}</span><Select.Root type="single" value={draft.routineId ?? ''} onValueChange={(value: string) => edit({ routineId: value, taskId: null })}><Select.Trigger class="h-8 w-full min-w-0" disabled={busy}><span class="truncate">{selectedRoutine?.name ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each routines as routine (routine.id)}<Select.Item value={routine.id}>{routine.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="oc-field"><span class="oc-label">{m['computer.watch_task']()}</span><Select.Root type="single" value={draft.taskId ?? ''} onValueChange={(value: string) => edit({ taskId: value })}><Select.Trigger class="h-8 w-full min-w-0" disabled={busy || !selectedRoutine}><span class="truncate">{eligibleTasks.find((task) => task.id === draft.taskId)?.title ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each eligibleTasks as task (task.id)}<Select.Item value={task.id}>{task.title}</Select.Item>{/each}</Select.Content></Select.Root></label>
    <label class="oc-field oc-span"><span class="oc-label">{messages['computer.reply_scope']()}</span><Select.Root type="single" value={draft.replyGrantId ?? 'none'} onValueChange={(value: string) => edit({ replyGrantId: value === 'none' ? null : value, ...(value !== 'none' ? { mode: 'auto' } : {}) })}><Select.Trigger class="h-8 w-full min-w-0" disabled={busy}><span class="truncate">{replyGrants.find(g => g.id === draft.replyGrantId)?.recipient.name ?? messages['computer.reply_none']()}</span></Select.Trigger><Select.Content><Select.Item value="none">{messages['computer.reply_none']()}</Select.Item>{#each replyGrants.filter(g => g.enabled && g.agentId === targetAgent && g.taskId === draft.taskId && g.applicationId === draft.applicationId) as grant}<Select.Item value={grant.id}>{grant.recipient.name}</Select.Item>{/each}</Select.Content></Select.Root></label>
  </div>
  <div class="oc-grid oc-sliders">
    <label class="oc-field"><span class="oc-label"><span>{m['computer.watch_interval']()}</span><span class="oc-value">{draft.intervalSeconds} s</span></span><Slider type="single" min={1} max={60} step={1} value={draft.intervalSeconds} disabled={busy} aria-label={m['computer.watch_interval']()} onValueChange={(value: number) => edit({ intervalSeconds: value })} /></label>
    <label class="oc-field"><span class="oc-label"><span>{m['computer.watch_cooldown']()}</span><span class="oc-value">{draft.cooldownSeconds} s</span></span><Slider type="single" min={1} max={120} step={1} value={draft.cooldownSeconds} disabled={busy} aria-label={m['computer.watch_cooldown']()} onValueChange={(value: number) => edit({ cooldownSeconds: value })} /></label>
  </div>
  <details class="oc-details">
    <summary class="oc-summary"><ChevronRight size={14} class="oc-chevron" aria-hidden="true" />{m['computer.watch_region']()}<span class="oc-value ml-auto">{Math.round(draft.region.width * 100)}% × {Math.round(draft.region.height * 100)}%</span></summary>
    <div class="oc-grid oc-sliders pt-2 pb-1">
      {#each ['x', 'y', 'width', 'height'] as key}
        {@const name = key as keyof ComputerWatch['region']}
        <label class="oc-field"><span class="oc-label"><span>{messages[`computer.watch_region_${key}`]()}</span><span class="oc-value">{Math.round(draft.region[name] * 100)}%</span></span><Slider type="single" min={name === 'x' || name === 'y' ? 0 : 1} max={name === 'x' || name === 'y' ? 99 : Math.floor((1 - draft.region[name === 'width' ? 'x' : 'y']) * 100)} step={1} value={Math.round(draft.region[name] * 100)} disabled={busy} aria-label={messages[`computer.watch_region_${key}`]()} onValueChange={(value: number) => region(name, value)} /></label>
      {/each}
      <label class="oc-field oc-span"><span class="oc-label"><span>{m['computer.watch_threshold']()}</span><span class="oc-value">{draft.minChangePercent}%</span></span><Slider type="single" min={0.1} max={10} step={0.1} value={draft.minChangePercent} disabled={busy} aria-label={m['computer.watch_threshold']()} onValueChange={(value: number) => edit({ minChangePercent: value })} /></label>
    </div>
  </details>
  <div class="oc-footer">
    <label class="flex items-center gap-2 text-[12px]"><Switch checked={config.allowAgentWatch} disabled={busy} onCheckedChange={(checked: boolean) => save({ ...config, allowAgentWatch: checked })} />{m['computer.watch_agent_config']()}</label>
    <Button size="sm" variant={dirty ? 'default' : 'outline'} disabled={busy || !dirty || (draft.enabled && !valid)} onclick={() => apply()}><Save size={13} />{m['computer.watch_save']()}</Button>
  </div>
  {#if observation?.pendingMessages !== undefined || observation?.source}
    <div class="flex flex-wrap gap-x-3 gap-y-1">
      {#if observation?.pendingMessages !== undefined}<span class="oc-meta">{messages['computer.watch_pending_messages']()}: <span class="oc-num">{observation.pendingMessages}</span></span>{/if}
      {#if observation?.source}<span class="oc-meta">{messages[`computer.watch_source_${observation.source}`]()}</span>{#if observation.checkMs !== undefined}<span class="oc-meta">{messages['computer.watch_check_duration']()}: <span class="oc-num">{observation.checkMs} ms</span></span>{/if}{/if}
    </div>
  {/if}
</section>

<section class="oc-card" data-testid="computer-storage-controls">
  <div class="oc-head">
    <h3 class="oc-title"><button type="button" class="oc-toggle" aria-expanded={storageOpen} aria-controls={`${uid}-storage`} onclick={() => (storageOpen = !storageOpen)}><ChevronRight size={14} class="oc-chevron" aria-hidden="true" /><HardDrive size={14} aria-hidden="true" />{m['computer.storage_title']()}</button></h3>
    {#if storage?.checkedAt}<span class="oc-count">{storage.files} · {mib(storage.bytes)} MiB</span>{/if}
    <Button size="icon-sm" variant="ghost" disabled={busy} title={m['computer.storage_cleanup']()} aria-label={m['computer.storage_cleanup']()} onclick={cleanup}><Eraser size={14} /></Button>
  </div>
  {#if storage?.error}<p role="alert" class="oc-callout"><TriangleAlert size={13} aria-hidden="true" /><span>{m['computer.storage_error']()}</span></p>{/if}
  {#if storageOpen}
    <div id={`${uid}-storage`} class="oc-reveal space-y-3 pt-1">
      <div class="oc-grid">
        <label class="oc-field"><span class="oc-label">{m['computer.storage_days']()}</span><Select.Root type="single" value={String(config.evidenceRetentionDays)} onValueChange={(value: string) => save({ ...config, evidenceRetentionDays: Number(value) })}><Select.Trigger class="h-8 w-full tabular-nums" disabled={busy}>{config.evidenceRetentionDays}</Select.Trigger><Select.Content>{#each [1, 7, 14, 30, 90, 365] as days}<Select.Item value={String(days)}>{days}</Select.Item>{/each}</Select.Content></Select.Root></label>
        <label class="oc-field"><span class="oc-label">{m['computer.storage_limit']()} (MiB)</span><Select.Root type="single" value={String(config.evidenceMaxMiB)} onValueChange={(value: string) => save({ ...config, evidenceMaxMiB: Number(value) })}><Select.Trigger class="h-8 w-full tabular-nums" disabled={busy}>{config.evidenceMaxMiB}</Select.Trigger><Select.Content>{#each [32, 128, 256, 512, 1024] as size}<Select.Item value={String(size)}>{size}</Select.Item>{/each}</Select.Content></Select.Root></label>
      </div>
      {#if storage?.checkedAt}<div class="flex flex-wrap gap-x-3 gap-y-1"><span class="oc-meta">{m['computer.storage_evidence']()}: <span class="oc-num">{storage.files} · {mib(storage.bytes)} MiB</span></span><span class="oc-meta">{m['computer.storage_temporary']()}: <span class="oc-num">{storage.temporaryFiles} · {mib(storage.temporaryBytes)} MiB</span></span></div>{:else}<p class="oc-meta">{m['computer.storage_pending']()}</p>{/if}
      <p class="oc-help">{m['computer.storage_limits']()}</p>
    </div>
  {/if}
</section>

<style>
  /* Cartoes do painel do Computador: elevacao por sombra, cabecalho claro. */
  .oc-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
    container-type: inline-size;
  }

  .oc-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
  }

  .oc-title {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  .oc-title :global(svg) {
    flex-shrink: 0;
    color: var(--app-text-muted);
  }

  .oc-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 1;
    min-width: 0;
    height: 28px;
    margin: -2px -6px;
    padding: 0 6px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .oc-toggle:hover {
    background: var(--app-hover);
  }

  .oc-toggle:focus-visible,
  .oc-summary:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .oc-card :global(.oc-chevron) {
    transition: transform var(--duration-fast) var(--ease-smooth-out);
  }

  .oc-toggle[aria-expanded='true'] :global(.oc-chevron),
  .oc-details[open] :global(.oc-chevron) {
    transform: rotate(90deg);
  }

  .oc-reveal {
    animation: oc-reveal var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes oc-reveal {
    from {
      opacity: 0;
      transform: translateY(calc(var(--distance-micro) * -1));
    }
  }

  .oc-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    margin: 0;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text);
    font-size: 11.5px;
    font-weight: 500;
  }

  .oc-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--app-text-muted);
  }

  .oc-status[data-tone='success'] .oc-dot {
    background: var(--app-success);
  }

  .oc-status[data-tone='accent'] .oc-dot {
    background: var(--app-accent);
  }

  .oc-status[data-tone='info'] .oc-dot {
    background: var(--app-info);
  }

  .oc-status[data-tone='warning'] {
    background: var(--app-warning-soft);
  }

  .oc-status[data-tone='warning'] .oc-dot {
    background: var(--app-warning);
  }

  .oc-meta {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .oc-num,
  .oc-value,
  .oc-count {
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .oc-num {
    color: var(--app-text-soft);
  }

  .oc-value {
    color: var(--app-text-soft);
    font-weight: 500;
  }

  .oc-count {
    flex-shrink: 0;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    line-height: 18px;
    white-space: nowrap;
  }

  .oc-callout {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--app-warning-soft);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .oc-callout :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--app-warning);
  }

  .oc-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 10px 16px;
  }

  @container (min-width: 440px) {
    .oc-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .oc-span {
      grid-column: 1 / -1;
    }
  }

  .oc-sliders {
    row-gap: 14px;
  }

  .oc-field {
    display: grid;
    gap: 6px;
    min-width: 0;
  }

  .oc-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
  }

  .oc-details {
    border-radius: 8px;
  }

  .oc-summary {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    margin: 0 -6px;
    padding: 0 6px;
    border-radius: 7px;
    color: var(--app-text-soft);
    font-size: 12px;
    font-weight: 500;
    list-style: none;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .oc-summary::-webkit-details-marker {
    display: none;
  }

  .oc-summary:hover {
    background: var(--app-hover);
  }

  .oc-summary :global(svg) {
    color: var(--app-text-muted);
  }

  .oc-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid color-mix(in srgb, var(--app-border) 70%, transparent);
  }

  .oc-help {
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }
</style>
