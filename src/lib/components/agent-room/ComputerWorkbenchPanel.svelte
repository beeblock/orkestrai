<script lang="ts">
  import { untrack } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { AppWindow, Camera, CheckCircle2, ChevronRight, CircleAlert, CircleOff, CornerDownLeft, Keyboard, LoaderCircle, Monitor, Play, Power, RefreshCw, Settings2, ShieldAlert, ShieldCheck } from '@lucide/svelte';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import type { ComputerCommandInput, ComputerCommandResult, ComputerDisplay, ComputerNodeConfig, ComputerSnapshot, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import { computerNodeConfigSchema, computerSnapshotSchema } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  import ComputerObservationControls from './ComputerObservationControls.svelte';
  import ComputerReplyControls from './ComputerReplyControls.svelte';
  import CompanionCapabilities from './CompanionCapabilities.svelte';
  import type { ComputerStorageStats } from '$lib/modules/agent-room/application/services/ComputerEvidenceService.js';
  import type { ObservationStatus } from '$lib/modules/agent-room/application/services/ComputerObservationService.js';

  type State = { nodeId: string | null; config: ComputerNodeConfig; snapshot: ComputerSnapshot; lastEvidence: string | null; storage?: ComputerStorageStats; observation?: ObservationStatus };
  let { workspaceId }: { workspaceId: string } = $props();
  let computerState = $state<State | null>(null);
  let loading = $state(true);
  let loadError = $state(false);
  let busy = $state<string | null>(null);
  let inputText = $state('');
  let replyOptionsVersion = $state(0);
  let applicationId = $state('');
  let inputWindowId = $state('');
  let panel: HTMLDivElement | undefined = $state();
  let screenshotTarget = $state<'all' | 'display' | 'window'>('all');
  let screenshotTargetId = $state('');
  const messages = m as unknown as Record<string, () => string>;
  let loadRequest = 0;
  let pendingLoads = 0;
  let loadAbort: AbortController | null = null;

  const applications = $derived.by(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const id of computerState?.config.allowedApplications ?? []) seen.set(id.toLowerCase(), { id, name: id });
    for (const window of computerState?.snapshot.windows ?? []) seen.set(window.appId.toLowerCase(), { id: window.appId, name: window.appName });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const evidenceId = $derived(computerState?.lastEvidence?.match(/([0-9a-f-]{36})\.png$/i)?.[1] ?? null);
  const evidenceUrl = $derived(evidenceId ? `/api/agent-room/workspaces/${workspaceId}/computers/evidence/${evidenceId}` : null);
  const inputWindow = $derived(computerState?.snapshot.windows.find((window) => window.id === inputWindowId && applicationAllowed(window.appId)) ?? null);
  const ready = $derived(Boolean(computerState?.config.enabled && computerState.snapshot.available && computerState.snapshot.permissions.accessibility === 'granted'));
  const selectedTargets = $derived<(ComputerDisplay | ComputerWindow)[]>(screenshotTarget === 'display' ? computerState?.snapshot.displays ?? [] : screenshotTarget === 'window' ? computerState?.snapshot.windows ?? [] : []);
  const captureAllowed = $derived.by(() => {
    if (!computerState?.config.enabled) return false;
    if (screenshotTarget === 'all') return computerState.snapshot.displays.length > 0 && computerState.snapshot.displays.every((display) => computerState!.config.allowedDisplays.includes(display.id));
    if (!screenshotTargetId) return false;
    if (screenshotTarget === 'display') return computerState.config.allowedDisplays.includes(screenshotTargetId);
    const window = computerState.snapshot.windows.find((candidate) => candidate.id === screenshotTargetId);
    return Boolean(window && applicationAllowed(window.appId));
  });

  // Estado de exibicao (so apresentacao): secoes raras comecam recolhidas.
  const uid = $props.id();
  let displaysOpen = $state(false);
  const headerStatus = $derived(!computerState ? null
    : !computerState.snapshot.available ? { tone: 'danger', label: m['computer.unavailable'](), icon: CircleOff }
    : !computerState.config.enabled ? { tone: 'neutral', label: m['computer.disabled'](), icon: Power }
    : !ready ? { tone: 'warning', label: m['computer.permission_denied'](), icon: ShieldAlert }
    : { tone: 'success', label: m['computer.ready'](), icon: CheckCircle2 });

  function applicationAllowed(id: string): boolean {
    return computerState?.config.allowedApplications.some((allowed) => allowed.toLowerCase() === id.toLowerCase()) ?? false;
  }

  function targetLabel(target: ComputerDisplay | ComputerWindow | undefined): string {
    if (!target) return m['computer.choose_target']();
    return 'appName' in target ? `${target.appName} · ${target.title}` : target.name;
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || m['computer.command_failed']());
    return payload.data as T;
  }

  async function load(quiet = false): Promise<void> {
    if (quiet && pendingLoads > 0) return;
    pendingLoads++;
    const request = ++loadRequest;
    const targetWorkspace = workspaceId;
    loadAbort?.abort();
    const controller = new AbortController();
    loadAbort = controller;
    if (!quiet) loading = true;
    try {
      const result = await api<State>(`/api/agent-room/workspaces/${targetWorkspace}/computers`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (request === loadRequest && targetWorkspace === workspaceId) {
        computerState = { ...result, config: computerNodeConfigSchema.parse(result.config), snapshot: computerSnapshotSchema.parse(result.snapshot) };
        loadError = false;
      }
    }
    catch { if (!controller.signal.aborted && request === loadRequest && targetWorkspace === workspaceId) loadError = true; }
    finally { pendingLoads--; if (controller === loadAbort) loading = false; }
  }

  async function saveConfig(config: ComputerNodeConfig): Promise<boolean> {
    if (!computerState?.nodeId) return false;
    const request = ++loadRequest;
    const targetWorkspace = workspaceId;
    busy = 'config';
    try {
      const saved = await api<ComputerNodeConfig>(`/api/agent-room/workspaces/${workspaceId}/computers/${computerState.nodeId}`, { method: 'PATCH', body: JSON.stringify(config) });
      if (request === loadRequest && targetWorkspace === workspaceId) computerState = { ...computerState, config: saved };
      return true;
    } catch (error) { toast.error(error instanceof Error ? error.message : m['computer.command_failed']()); return false; }
    finally { busy = null; }
  }

  function toggleAllowed(kind: 'application' | 'display', id: string, checked: boolean): void {
    if (!computerState) return;
    const key = kind === 'application' ? 'allowedApplications' : 'allowedDisplays';
    const values = computerState.config[key];
    const remaining = values.filter((value: string) => kind === 'application' ? value.toLowerCase() !== id.toLowerCase() : value !== id);
    void saveConfig({ ...computerState.config, [key]: checked ? [...remaining, id] : remaining });
  }

  async function command(input: ComputerCommandInput): Promise<ComputerCommandResult | null> {
    if (busy !== null) return null;
    const request = ++loadRequest;
    const targetWorkspace = workspaceId;
    busy = input.command;
    try {
      const result = await api<ComputerCommandResult>(`/api/agent-room/workspaces/${workspaceId}/computers`, { method: 'POST', body: JSON.stringify(input) });
      if (request !== loadRequest || targetWorkspace !== workspaceId) return null;
      if ('snapshot' in result) computerState = { ...(computerState as State), snapshot: computerSnapshotSchema.parse(result.snapshot), ...(result.kind === 'screenshot' ? { lastEvidence: result.path } : {}) };
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['computer.command_failed']());
      return null;
    } finally { busy = null; }
  }

  async function sendText(): Promise<void> {
    if (!inputText.trim() || !inputWindow || busy !== null) return;
    if (await command({ command: 'type', text: inputText, targetId: inputWindow.id })) inputText = '';
  }

  $effect(() => {
    workspaceId;
    untrack(() => { inputWindowId = ''; inputText = ''; computerState = null; loadError = false; void load(); });
    const timer = setInterval(() => {
      if (!document.hidden && panel?.getClientRects().length && busy === null && !loading) void load(true);
    }, 10_000);
    return () => { clearInterval(timer); ++loadRequest; loadAbort?.abort(); };
  });
</script>

{#if loading && !computerState}
  <div class="grid h-full min-h-56 place-items-center" data-testid="computer-loading" role="status" aria-label={m['computer.refresh']()}><LoaderCircle class="animate-spin text-[var(--app-text-muted)]" size={18} /></div>
{:else if computerState}
  <div bind:this={panel} class="cw grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--app-canvas)]" data-testid="computer-workbench">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2.5">
      <span class="grid size-9 shrink-0 place-items-center rounded-[9px] bg-[var(--app-secondary-soft)] text-[var(--app-secondary)]"><Monitor size={17} /></span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center gap-2"><h2 class="text-ui-lg font-semibold">{m['computer.title']()}</h2>{#if headerStatus}{@const StatusIcon = headerStatus.icon}<span class="cw-chip" data-tone={headerStatus.tone}><StatusIcon size={12} aria-hidden="true" />{headerStatus.label}</span>{/if}</div>
        <p class="mt-0.5 truncate text-ui-sm text-[var(--app-text-muted)]">{messages[`computer.platform_${computerState.snapshot.platform}`]()}</p>
      </div>
      <Button size="icon-sm" variant="ghost" aria-label={m['computer.refresh']()} title={m['computer.refresh']()} disabled={busy !== null || loading} onclick={() => load()}><RefreshCw size={14} class={loading ? 'animate-spin' : ''} /></Button>
      <label class="flex items-center gap-2 text-[12px] font-medium"><span>{m['computer.enable']()}</span><Switch checked={computerState.config.enabled} disabled={!computerState.snapshot.available || busy !== null} onCheckedChange={(checked: boolean) => saveConfig({ ...computerState!.config, enabled: checked })} /></label>
    </header>

    <div class="min-h-0 overflow-y-auto overscroll-contain p-3">
      <div class="cw-stack">
        {#if loadError}<div role="alert" class="cw-callout" data-tone="warning"><CircleAlert size={14} class="shrink-0" /><span>{m['computer.load_failed']()}</span></div>{/if}
        {#if !computerState.snapshot.available}
          <div class="cw-callout" data-tone="warning"><CircleAlert size={14} class="shrink-0" /><span>{computerState.snapshot.detail ?? m['computer.unavailable_help']()}</span></div>
        {/if}

        <!-- Permissoes do sistema: estado com icone + texto e a acao de correcao ao lado. -->
        <div class="cw-cols gap-2">
          {#each ['accessibility', 'screenRecording'] as permission}
            {@const status = computerState.snapshot.permissions[permission as 'accessibility' | 'screenRecording']}
            <article class="cw-permission" data-granted={status === 'granted'}>
              <span class="cw-permission-icon">{#if status === 'granted'}<CheckCircle2 size={15} />{:else}<CircleAlert size={15} />{/if}</span>
              <div class="min-w-0 flex-1"><p class="truncate text-[12px] font-medium">{permission === 'accessibility' ? m['computer.permission_accessibility']() : m['computer.permission_screen']()}</p><p class="truncate text-ui-sm text-[var(--app-text-muted)]">{messages[`computer.permission_${status}`]()}</p></div>
              {#if status !== 'granted' && status !== 'unavailable'}<Button size="xs" variant="outline" class="shrink-0" title={m['computer.open_settings']()} onclick={() => command({ command: 'open_settings', permission: permission as 'accessibility' | 'screenRecording' })}><Settings2 size={12} />{m['computer.open_settings_short']()}</Button>{/if}
            </article>
          {/each}
        </div>

        <section class="cw-card">
          <div class="cw-head">
            <h3 class="cw-title"><ShieldCheck size={14} aria-hidden="true" />{m['computer.allowed_apps']()}</h3>
            {#if computerState.config.allowedApplications.length}<span class="cw-count">{computerState.config.allowedApplications.length}</span>{/if}
          </div>
          <p class="cw-help">{m['computer.allowed_apps_help']()}</p>
          <div class="cw-list cw-cols max-h-44">
            {#each applications as app (app.id)}
              <div class="cw-app">
                <label class="flex min-w-0 flex-1 items-center gap-2.5"><Checkbox checked={applicationAllowed(app.id)} disabled={busy !== null} onCheckedChange={(checked: boolean) => toggleAllowed('application', app.id, checked)} /><span class="min-w-0 truncate" title={app.id}>{app.name}</span></label>
                <Button size="icon-xs" variant="ghost" title={m['computer.launch']()} aria-label={`${m['computer.launch']()} ${app.name}`} disabled={!computerState.config.enabled || !applicationAllowed(app.id) || busy !== null} onclick={() => command({ command: 'launch', applicationId: app.id })}><Play size={12} /></Button>
              </div>
            {/each}
            {#if applications.length === 0}<p class="cw-empty cw-span">{m['computer.no_windows']()}</p>{/if}
          </div>
          <div class="mt-3 grid gap-1.5">
            <label class="text-ui-sm font-medium text-[var(--app-text-soft)]" for={`${uid}-app-id`}>{m['computer.application_id']()}</label>
            <div class="flex gap-2">
              <Input id={`${uid}-app-id`} class="h-8 font-mono text-[12px]" bind:value={applicationId} aria-label={m['computer.application_id']()} placeholder={m['device.launch_placeholder']()} spellcheck={false} autocomplete="off" disabled={busy !== null} />
              <Button size="sm" variant="outline" class="h-8 shrink-0" disabled={busy !== null || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(applicationId.trim())} onclick={() => { toggleAllowed('application', applicationId.trim(), true); applicationId = ''; }}><ShieldCheck size={13} />{m['computer.authorize_app']()}</Button>
            </div>
          </div>
        </section>

        <section class="cw-card">
          <div class="cw-head">
            <h3 class="cw-title"><AppWindow size={14} aria-hidden="true" />{m['computer.windows']()}</h3>
            {#if computerState.snapshot.windows.length}<span class="cw-count">{computerState.snapshot.windows.length}</span>{/if}
          </div>
          <div class="grid max-h-48 gap-0.5 overflow-y-auto">
            {#each computerState.snapshot.windows as window (window.id)}
              <button type="button" aria-pressed={inputWindow?.id === window.id} class="cw-window" disabled={!computerState.config.enabled || !applicationAllowed(window.appId) || busy !== null} onclick={() => { inputWindowId = window.id; void command({ command: 'focus', windowId: window.id }); }}>
                <span class={`size-2 shrink-0 rounded-full ${window.focused ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border-strong)]'}`}></span><span class="min-w-0 flex-1 truncate text-[12px]"><strong class="font-medium">{window.appName}</strong>{window.title ? ` · ${window.title}` : ''}</span>
              </button>
            {/each}
            {#if computerState.snapshot.windows.length === 0}<p class="cw-empty">{m['computer.no_windows']()}</p>{/if}
          </div>
          <div class="mt-3 flex gap-2">
            <Input class="h-8" bind:value={inputText} disabled={!computerState.config.enabled || !inputWindow || busy !== null} aria-label={m['computer.type_placeholder']()} placeholder={inputWindow ? `${inputWindow.appName} · ${inputWindow.title}` : m['computer.type_placeholder']()} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter') void sendText(); }} />
            <Button size="sm" class="h-8 shrink-0" aria-label={m['computer.type']()} disabled={!computerState.config.enabled || !inputWindow || !inputText.trim() || busy !== null} onclick={sendText}><Keyboard size={14} />{m['computer.type']()}</Button>
            <Button size="icon" variant="outline" class="shrink-0" aria-label={m['computer.press_enter']()} title={m['computer.press_enter']()} disabled={!computerState.config.enabled || !inputWindow || busy !== null} onclick={() => inputWindow && command({ command: 'shortcut', keys: ['enter'], targetId: inputWindow.id })}><CornerDownLeft size={14} /></Button>
          </div>
        </section>

        <section class="cw-card">
          <div class="cw-head"><h3 class="cw-title"><Camera size={14} aria-hidden="true" />{m['computer.capture_title']()}</h3></div>
          <div class="flex flex-wrap items-center gap-2">
            <SegmentedControl size="sm" label={m['computer.capture_scope']()} value={screenshotTarget} onValueChange={(value) => { screenshotTarget = value; screenshotTargetId = ''; }} options={[{ value: 'all', label: m['computer.capture_all']() }, { value: 'display', label: m['computer.capture_display']() }, { value: 'window', label: m['computer.capture_window']() }]} />
            <span class="flex-1"></span>
            <Button size="sm" variant="outline" class="h-8" disabled={!captureAllowed || busy !== null} onclick={() => command({ command: 'screenshot', target: screenshotTarget, ...(screenshotTargetId ? { targetId: screenshotTargetId } : {}) })}>{#if busy === 'screenshot'}<LoaderCircle class="animate-spin" size={13} />{:else}<Camera size={13} />{/if}{m['computer.capture']()}</Button>
          </div>
          {#if screenshotTarget !== 'all'}<label class="mt-2.5 grid gap-1.5"><span class="text-ui-sm font-medium text-[var(--app-text-soft)]">{m['computer.capture_target']()}</span><Select.Root type="single" value={screenshotTargetId} onValueChange={(value: string) => (screenshotTargetId = value)}><Select.Trigger class="h-8 w-full"><span class="truncate">{targetLabel(selectedTargets.find((target: ComputerDisplay | ComputerWindow) => target.id === screenshotTargetId))}</span></Select.Trigger><Select.Content>{#each selectedTargets as target (target.id)}<Select.Item value={target.id}>{targetLabel(target)}</Select.Item>{/each}</Select.Content></Select.Root></label>{/if}
          {#if evidenceUrl}<div class="img-outline mt-3 overflow-hidden rounded-lg bg-black"><img class="max-h-80 w-full object-contain" src={evidenceUrl} alt={m['computer.evidence_alt']()} /></div>{/if}
        </section>

        <section class="cw-card">
          <div class="cw-head">
            <h3 class="cw-title"><button type="button" class="cw-toggle" aria-expanded={displaysOpen} aria-controls={`${uid}-displays`} onclick={() => (displaysOpen = !displaysOpen)}><ChevronRight size={14} class="cw-chevron" aria-hidden="true" /><Monitor size={14} aria-hidden="true" />{m['computer.allowed_displays']()}</button></h3>
            {#if computerState.snapshot.displays.length}<span class="cw-count">{m['computer.allowed_count']({ allowed: computerState.snapshot.displays.filter((display) => computerState!.config.allowedDisplays.includes(display.id)).length, total: computerState.snapshot.displays.length })}</span>{/if}
          </div>
          {#if displaysOpen}
            <div id={`${uid}-displays`} class="cw-reveal">
              <p class="cw-help">{m['computer.allowed_displays_help']()}</p>
              <div class="cw-list cw-cols">
                {#each computerState.snapshot.displays as display (display.id)}<label class="cw-app"><Checkbox checked={computerState.config.allowedDisplays.includes(display.id)} disabled={busy !== null} onCheckedChange={(checked: boolean) => toggleAllowed('display', display.id, checked)} /><span class="min-w-0 flex-1 truncate">{display.name}</span>{#if display.primary}<span class="cw-count">{m['computer.primary']()}</span>{/if}</label>{/each}
              </div>
            </div>
          {/if}
        </section>

        <ComputerObservationControls {workspaceId} optionsVersion={replyOptionsVersion} config={computerState.config} windows={computerState.snapshot.windows} storage={computerState.storage} observation={computerState.observation} busy={busy !== null} save={saveConfig} cleanup={async () => { await command({ command: 'cleanup' }); await load(true); }} />

        {#if computerState.nodeId}<div class="cw-card cw-embed"><ComputerReplyControls {workspaceId} nodeId={computerState.nodeId} windows={computerState.snapshot.windows.filter(w => applicationAllowed(w.appId))} {command} onchange={() => { replyOptionsVersion++; void load(true); }} /></div>{/if}
        <div class="cw-card cw-embed"><CompanionCapabilities {workspaceId} {command} /></div>
      </div>
    </div>
  </div>
{:else}
  <div class="flex h-full min-h-56 flex-col items-center justify-center gap-3 p-4 text-center" data-testid="computer-load-error">
    <span class="grid size-9 place-items-center rounded-[9px] bg-[var(--app-warning-soft)] text-[var(--app-warning)]"><CircleAlert size={17} /></span>
    <p role="alert" class="max-w-[38ch] text-[13px] font-medium text-pretty text-[var(--app-text)]">{m['computer.load_failed']()}</p>
    <Button size="sm" variant="outline" onclick={() => load()}><RefreshCw size={14} />{m['computer.refresh']()}</Button>
  </div>
{/if}

<style>
  .cw-stack {
    display: flex;
    flex-direction: column;
    gap: 12px;
    container-type: inline-size;
  }

  /* Duas colunas so quando o painel e largo (Workbench); no no, uma coluna. */
  .cw-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  @container (min-width: 620px) {
    .cw-cols {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .cw-span {
      grid-column: 1 / -1;
    }
  }

  /* Cartoes agrupam cada assunto; elevacao por sombra (anel de 1px do tema). */
  .cw-card {
    margin: 0;
    padding: 12px;
    border: 0;
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  /* Componentes embutidos trazem margem e divisoria propria; o cartao ja separa. */
  .cw-embed > :global(*) {
    margin-top: 0 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    border-top: 0 !important;
  }

  .cw-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 24px;
    margin-bottom: 8px;
  }

  .cw-title {
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

  .cw-title :global(svg) {
    flex-shrink: 0;
    color: var(--app-text-muted);
  }

  .cw-toggle {
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

  .cw-toggle:hover {
    background: var(--app-hover);
  }

  .cw-toggle:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .cw-toggle :global(.cw-chevron) {
    transition: transform var(--duration-fast) var(--ease-smooth-out);
  }

  .cw-toggle[aria-expanded='true'] :global(.cw-chevron) {
    transform: rotate(90deg);
  }

  .cw-reveal {
    animation: cw-reveal var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes cw-reveal {
    from {
      opacity: 0;
      transform: translateY(calc(var(--distance-micro) * -1));
    }
  }

  .cw-help {
    margin: 0 0 10px;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .cw-count {
    flex-shrink: 0;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 18px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .cw-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  .cw-chip[data-tone='success'] {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .cw-chip[data-tone='warning'] {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .cw-chip[data-tone='danger'] {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .cw-callout {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 10px;
    background: var(--app-warning-soft);
    color: var(--app-text);
    font-size: 12px;
    line-height: 1.45;
  }

  .cw-callout :global(svg) {
    margin-top: 1px;
    color: var(--app-warning);
  }

  .cw-permission {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
  }

  .cw-permission-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .cw-permission[data-granted='true'] .cw-permission-icon {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .cw-list {
    display: grid;
    gap: 2px;
    overflow-y: auto;
    padding: 3px;
    border-radius: 9px;
    background: var(--app-surface-subtle);
  }

  .cw-app {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 32px;
    padding: 0 4px 0 8px;
    border-radius: 6px;
    font-size: 12px;
    transition: background-color var(--duration-quick) ease-out;
  }

  .cw-app:hover {
    background: var(--app-hover);
  }

  .cw-empty {
    margin: 0;
    padding: 14px 8px;
    color: var(--app-text-muted);
    font-size: 12px;
    text-align: center;
  }

  .cw-window {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 32px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .cw-window:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .cw-window[aria-pressed='true'] {
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 45%, transparent);
  }

  .cw-window:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .cw-window:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }
</style>
