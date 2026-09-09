<script lang="ts">
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Camera, CheckCircle2, CircleAlert, Keyboard, LoaderCircle, Monitor, MousePointer2, RefreshCw, Settings2, ShieldCheck } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Switch } from '$lib/components/ui/switch';
  import type { ComputerCommandInput, ComputerCommandResult, ComputerDisplay, ComputerNodeConfig, ComputerSnapshot, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  type State = { nodeId: string | null; config: ComputerNodeConfig; snapshot: ComputerSnapshot; lastEvidence: string | null };
  let { workspaceId }: { workspaceId: string } = $props();
  let computerState = $state<State | null>(null);
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let inputText = $state('');
  let screenshotTarget = $state<'all' | 'display' | 'window'>('all');
  let screenshotTargetId = $state('');
  const messages = m as unknown as Record<string, () => string>;

  const applications = $derived.by(() => {
    const seen = new Map<string, string>();
    for (const window of computerState?.snapshot.windows ?? []) if (!seen.has(window.appId)) seen.set(window.appId, window.appName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  });
  const evidenceId = $derived(computerState?.lastEvidence?.match(/([0-9a-f-]{36})\.png$/i)?.[1] ?? null);
  const evidenceUrl = $derived(evidenceId ? `/api/agent-room/workspaces/${workspaceId}/computers/evidence/${evidenceId}` : null);
  const focusedWindow = $derived(computerState?.snapshot.windows.find((window) => window.id === computerState?.snapshot.focusedWindowId) ?? null);
  const selectedTargets = $derived<(ComputerDisplay | ComputerWindow)[]>(screenshotTarget === 'display' ? computerState?.snapshot.displays ?? [] : screenshotTarget === 'window' ? computerState?.snapshot.windows ?? [] : []);
  const captureAllowed = $derived.by(() => {
    if (!computerState?.config.enabled) return false;
    if (screenshotTarget === 'all') return computerState.snapshot.displays.length > 0 && computerState.snapshot.displays.every((display) => computerState!.config.allowedDisplays.includes(display.id));
    if (!screenshotTargetId) return false;
    if (screenshotTarget === 'display') return computerState.config.allowedDisplays.includes(screenshotTargetId);
    const window = computerState.snapshot.windows.find((candidate) => candidate.id === screenshotTargetId);
    return Boolean(window && computerState.config.allowedApplications.includes(window.appId));
  });

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

  async function load(): Promise<void> {
    loading = true;
    try { computerState = await api<State>(`/api/agent-room/workspaces/${workspaceId}/computers`); }
    catch (error) { toast.error(error instanceof Error ? error.message : m['computer.load_failed']()); }
    finally { loading = false; }
  }

  async function saveConfig(config: ComputerNodeConfig): Promise<void> {
    if (!computerState?.nodeId) return;
    busy = 'config';
    try {
      const saved = await api<ComputerNodeConfig>(`/api/agent-room/workspaces/${workspaceId}/computers/${computerState.nodeId}`, { method: 'PATCH', body: JSON.stringify(config) });
      computerState = { ...computerState, config: saved };
    } catch (error) { toast.error(error instanceof Error ? error.message : m['computer.command_failed']()); }
    finally { busy = null; }
  }

  function toggleAllowed(kind: 'application' | 'display', id: string, checked: boolean): void {
    if (!computerState) return;
    const key = kind === 'application' ? 'allowedApplications' : 'allowedDisplays';
    const values = computerState.config[key];
    void saveConfig({ ...computerState.config, [key]: checked ? [...new Set([...values, id])] : values.filter((value: string) => value !== id) });
  }

  async function command(input: ComputerCommandInput): Promise<ComputerCommandResult | null> {
    busy = input.command;
    try {
      const result = await api<ComputerCommandResult>(`/api/agent-room/workspaces/${workspaceId}/computers`, { method: 'POST', body: JSON.stringify(input) });
      computerState = { ...(computerState as State), snapshot: result.snapshot, ...(result.kind === 'screenshot' ? { lastEvidence: result.path } : {}) };
      return result;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['computer.command_failed']());
      return null;
    } finally { busy = null; }
  }

  async function sendText(): Promise<void> {
    if (!inputText.trim()) return;
    if (await command({ command: 'type', text: inputText, ...(focusedWindow ? { targetId: focusedWindow.id } : {}) })) inputText = '';
  }

  async function clickEvidence(event: MouseEvent): Promise<void> {
    if (!computerState?.config.enabled || screenshotTarget !== 'all') return;
    const image = event.currentTarget as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    const displays = computerState.snapshot.displays;
    if (!displays.length) return;
    const minX = Math.min(...displays.map((display) => display.bounds.x));
    const minY = Math.min(...displays.map((display) => display.bounds.y));
    const maxX = Math.max(...displays.map((display) => display.bounds.x + display.bounds.width));
    const maxY = Math.max(...displays.map((display) => display.bounds.y + display.bounds.height));
    await command({ command: 'click', space: 'screen', x: minX + ((event.clientX - rect.left) / rect.width) * (maxX - minX), y: minY + ((event.clientY - rect.top) / rect.height) * (maxY - minY), button: 'left', count: 1 });
  }

  $effect(() => { workspaceId; void load(); });
</script>

{#if loading}
  <div class="grid h-full min-h-56 place-items-center"><LoaderCircle class="animate-spin text-[var(--app-accent)]" size={20} /></div>
{:else if computerState}
  <div class="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-[var(--app-canvas)]" data-testid="computer-workbench">
    <header class="flex flex-wrap items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2">
      <span class="grid size-8 place-items-center rounded-md bg-[var(--app-secondary-soft)] text-[var(--app-secondary)]"><Monitor size={16} /></span>
      <div class="min-w-0 flex-1"><div class="flex items-center gap-2"><h2 class="text-xs font-semibold">{m['computer.title']()}</h2><Badge variant={computerState.snapshot.available ? 'default' : 'outline'}>{computerState.snapshot.available ? m['computer.ready']() : m['computer.unavailable']()}</Badge></div><p class="text-ui-xs text-[var(--app-text-muted)]">{messages[`computer.platform_${computerState.snapshot.platform}`]()}</p></div>
      <Button size="icon-sm" variant="ghost" aria-label={m['computer.refresh']()} disabled={busy !== null} onclick={() => load()}><RefreshCw size={14} /></Button>
      <label class="flex items-center gap-2 text-ui-xs font-medium"><span>{m['computer.enable']()}</span><Switch checked={computerState.config.enabled} disabled={!computerState.snapshot.available || busy !== null} onCheckedChange={(checked: boolean) => saveConfig({ ...computerState!.config, enabled: checked })} /></label>
    </header>

    <div class="min-h-0 overflow-y-auto p-3">
      {#if !computerState.snapshot.available}
        <div class="flex gap-2 border-l-2 border-[var(--app-warning)] bg-[var(--app-warning-soft)] px-3 py-2 text-ui-xs text-[var(--app-warning)]"><CircleAlert size={14} class="shrink-0" /><span>{computerState.snapshot.detail ?? m['computer.unavailable_help']()}</span></div>
      {/if}

      <section class="grid gap-2 sm:grid-cols-2">
        {#each ['accessibility', 'screenRecording'] as permission}
          {@const status = computerState.snapshot.permissions[permission as 'accessibility' | 'screenRecording']}
          <article class="flex items-center gap-2 border border-[var(--app-border)] bg-[var(--app-surface)] px-3 py-2">
            {#if status === 'granted'}<CheckCircle2 size={14} class="text-[var(--app-success)]" />{:else}<CircleAlert size={14} class="text-[var(--app-warning)]" />{/if}
            <div class="min-w-0 flex-1"><p class="text-ui-xs font-medium">{permission === 'accessibility' ? m['computer.permission_accessibility']() : m['computer.permission_screen']()}</p><p class="text-ui-xs text-[var(--app-text-muted)]">{messages[`computer.permission_${status}`]()}</p></div>
            {#if status !== 'granted' && status !== 'unavailable'}<Button size="icon-sm" variant="ghost" aria-label={m['computer.open_settings']()} onclick={() => command({ command: 'open_settings', permission: permission as 'accessibility' | 'screenRecording' })}><Settings2 size={13} /></Button>{/if}
          </article>
        {/each}
      </section>

      <section class="mt-4">
        <div class="mb-2 flex items-center gap-2"><ShieldCheck size={14} class="text-[var(--app-text-muted)]" /><h3 class="text-xs font-semibold">{m['computer.allowed_apps']()}</h3></div>
        <p class="mb-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['computer.allowed_apps_help']()}</p>
        <div class="grid max-h-36 gap-1 overflow-y-auto border-y border-[var(--app-border)] py-1 sm:grid-cols-2">
          {#each applications as app (app.id)}<label class="flex items-center gap-2 px-2 py-1.5 text-ui-xs hover:bg-[var(--app-surface-hover)]"><Checkbox checked={computerState.config.allowedApplications.includes(app.id)} disabled={busy !== null} onCheckedChange={(checked: boolean) => toggleAllowed('application', app.id, checked)} /><span class="min-w-0 truncate">{app.name}</span><span class="ml-auto truncate text-[var(--app-text-muted)]">{app.id}</span></label>{/each}
          {#if applications.length === 0}<p class="px-2 py-4 text-center text-ui-xs text-[var(--app-text-muted)] sm:col-span-2">{m['computer.no_windows']()}</p>{/if}
        </div>
      </section>

      <section class="mt-4">
        <div class="mb-2 flex items-center gap-2"><Monitor size={14} class="text-[var(--app-text-muted)]" /><h3 class="text-xs font-semibold">{m['computer.allowed_displays']()}</h3></div>
        <p class="mb-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['computer.allowed_displays_help']()}</p>
        <div class="grid gap-1 border-y border-[var(--app-border)] py-1 sm:grid-cols-2">
          {#each computerState.snapshot.displays as display (display.id)}<label class="flex items-center gap-2 px-2 py-1.5 text-ui-xs hover:bg-[var(--app-surface-hover)]"><Checkbox checked={computerState.config.allowedDisplays.includes(display.id)} disabled={busy !== null} onCheckedChange={(checked: boolean) => toggleAllowed('display', display.id, checked)} /><span class="min-w-0 truncate">{display.name}</span>{#if display.primary}<Badge variant="outline" class="ml-auto">{m['computer.primary']()}</Badge>{/if}</label>{/each}
        </div>
      </section>

      <section class="mt-4">
        <div class="mb-2 flex items-center gap-2"><Monitor size={14} class="text-[var(--app-text-muted)]" /><h3 class="text-xs font-semibold">{m['computer.windows']()}</h3></div>
        <div class="grid max-h-44 gap-1 overflow-y-auto">
          {#each computerState.snapshot.windows as window (window.id)}
            <button type="button" class="flex items-center gap-2 border border-transparent px-2 py-1.5 text-left hover:border-[var(--app-border)] hover:bg-[var(--app-surface-hover)] disabled:opacity-50" disabled={!computerState.config.enabled || !computerState.config.allowedApplications.includes(window.appId) || busy !== null} onclick={() => command({ command: 'focus', windowId: window.id })}>
              <span class={`size-2 shrink-0 rounded-full ${window.focused ? 'bg-[var(--app-success)]' : 'bg-[var(--app-border-strong)]'}`}></span><span class="min-w-0 flex-1 truncate text-ui-xs"><strong>{window.appName}</strong>{window.title ? ` · ${window.title}` : ''}</span>
            </button>
          {/each}
        </div>
      </section>

      <section class="mt-4 border-t border-[var(--app-border)] pt-3">
        <div class="flex flex-wrap items-end gap-2">
          <label class="min-w-36 flex-1"><span class="mb-1 block text-ui-xs font-medium">{m['computer.capture_scope']()}</span><Select.Root type="single" value={screenshotTarget} onValueChange={(value: string) => { screenshotTarget = value as typeof screenshotTarget; screenshotTargetId = ''; }}><Select.Trigger class="w-full">{messages[`computer.capture_${screenshotTarget}`]()}</Select.Trigger><Select.Content><Select.Item value="all">{m['computer.capture_all']()}</Select.Item><Select.Item value="display">{m['computer.capture_display']()}</Select.Item><Select.Item value="window">{m['computer.capture_window']()}</Select.Item></Select.Content></Select.Root></label>
          {#if screenshotTarget !== 'all'}<label class="min-w-48 flex-[2]"><span class="mb-1 block text-ui-xs font-medium">{m['computer.capture_target']()}</span><Select.Root type="single" value={screenshotTargetId} onValueChange={(value: string) => (screenshotTargetId = value)}><Select.Trigger class="w-full">{targetLabel(selectedTargets.find((target: ComputerDisplay | ComputerWindow) => target.id === screenshotTargetId))}</Select.Trigger><Select.Content>{#each selectedTargets as target (target.id)}<Select.Item value={target.id}>{targetLabel(target)}</Select.Item>{/each}</Select.Content></Select.Root></label>{/if}
          <Button size="sm" disabled={!captureAllowed || busy !== null} onclick={() => command({ command: 'screenshot', target: screenshotTarget, ...(screenshotTargetId ? { targetId: screenshotTargetId } : {}) })}>{#if busy === 'screenshot'}<LoaderCircle class="animate-spin" size={13} />{:else}<Camera size={13} />{/if}{m['computer.capture']()}</Button>
        </div>
        {#if evidenceUrl}<button type="button" class="mt-3 block w-full cursor-crosshair overflow-hidden border border-[var(--app-border)] bg-black" aria-label={m['computer.click_preview']()} disabled={!computerState.config.enabled || screenshotTarget !== 'all' || !captureAllowed} onclick={clickEvidence}><img class="max-h-80 w-full object-contain" src={evidenceUrl} alt={m['computer.evidence_alt']()} /></button>{/if}
      </section>

      <section class="mt-3 flex gap-2 border-t border-[var(--app-border)] pt-3">
        <Input bind:value={inputText} disabled={!computerState.config.enabled || !focusedWindow || busy !== null} placeholder={m['computer.type_placeholder']()} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter') void sendText(); }} />
        <Button size="icon-sm" aria-label={m['computer.type']()} disabled={!computerState.config.enabled || !focusedWindow || !inputText.trim() || busy !== null} onclick={sendText}><Keyboard size={14} /></Button>
        <Button size="icon-sm" variant="outline" aria-label={m['computer.press_enter']()} disabled={!computerState.config.enabled || !focusedWindow || busy !== null} onclick={() => focusedWindow && command({ command: 'shortcut', keys: ['enter'], targetId: focusedWindow.id })}><MousePointer2 size={14} /></Button>
      </section>
    </div>
  </div>
{/if}
