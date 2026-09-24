<script lang="ts">
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { onDestroy, onMount } from 'svelte';
  import { Activity, ArrowLeft, Check, Command, Keyboard, Languages, Layers, Mic, Palette, Pencil, Play, Power, RefreshCw, RotateCw, SquareTerminal, Trash2, Volume2 } from '@lucide/svelte';
  import { isMacPlatform } from '$lib/components/agent-room/platform.js';
  import WorkspaceIcon from '$lib/components/agent-room/WorkspaceIcon.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { terminalThemeLabel } from '$lib/components/agent-room/terminal-theme-label.js';
  import { normalizeTerminalTheme, TERMINAL_THEMES, TERMINAL_THEME_ORDER } from '$lib/components/agent-room/terminal-themes.js';
  import { DEFAULT_DICTATION_HOTKEY, comboFromEvent, comboLabel } from '$lib/components/agent-room/dictation-hotkey.js';
  import { appSettingsStore, getAppSettings, invalidateAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import VoiceConfirmDialog from '$lib/components/agent-room/VoiceConfirmDialog.svelte';
  import { localVoiceLabel } from '$lib/components/agent-room/voice-label.js';
  import {
    EMBEDDED_TTS_VOICES,
    DEFAULT_EMBEDDED_TTS_SPEED,
    MAX_EMBEDDED_TTS_SPEED,
    MIN_EMBEDDED_TTS_SPEED,
    normalizeEmbeddedTtsSpeed,
    normalizeEmbeddedTtsVoice,
  } from '$lib/modules/agent-room/domain/voice.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import AppThemeSettings from '$lib/components/agent-room/AppThemeSettings.svelte';
  import AudioDeviceSettings from '$lib/components/agent-room/AudioDeviceSettings.svelte';
  import { playAudioBlob } from '$lib/components/agent-room/audio-devices.js';
  import { applyAppTheme } from '$lib/components/agent-room/app-themes.js';

  let settings = $state<Record<string, string>>({});
  let loaded = $state(false);
  let saved = $state(false);
  let capturingHotkey = $state(false);

  // ssr = false nesta rota — navigator sempre existe aqui.
  const isMac = isMacPlatform();

  /** "Cmd/Ctrl" vira o icone ⌘ no macOS ou o texto "Ctrl" nos demais. */
  function shortcutSegments(keys: string): string[] {
    return keys.split('+').map((segment) => (segment === 'Cmd/Ctrl' ? (isMac ? '⌘' : 'Ctrl') : segment));
  }

  function themeSwatchColors(name: string): string[] {
    const theme = TERMINAL_THEMES[normalizeTerminalTheme(name)].theme;
    return [theme.background, theme.red, theme.green, theme.yellow, theme.blue].filter((color): color is string => Boolean(color));
  }

  const previewTheme = $derived(TERMINAL_THEMES[normalizeTerminalTheme(settings.terminalTheme)].theme);

  const hotkeyLabel = $derived(comboLabel(settings.dictationHotkey || DEFAULT_DICTATION_HOTKEY));
  const ttsSpeed = $derived(normalizeEmbeddedTtsSpeed(settings.voiceTtsSpeed));
  const settingsSectionClasses = 'settings-section flex scroll-mt-[84px] flex-col gap-[18px] border-0 border-t border-[var(--app-border)] bg-transparent px-0 py-6 first:border-t-0 max-[560px]:py-5';
  // Navegacao acompanha a secao visivel (scroll-spy) para a pessoa saber
  // onde esta numa pagina longa.
  const SETTINGS_NAV = [
    { id: 'autonomy', icon: Power, label: m['settings.section_autonomy'] },
    { id: 'terminal', icon: SquareTerminal, label: m['settings.section_terminal'] },
    { id: 'appearance', icon: Palette, label: m['settings.section_appearance'] },
    { id: 'dictation', icon: Mic, label: m['settings.section_dictation'] },
    { id: 'voice', icon: Volume2, label: m['settings.section_voice'] },
    { id: 'shortcuts', icon: Keyboard, label: m['settings.section_shortcuts'] },
    { id: 'presets', icon: Layers, label: m['settings.section_presets'] },
    { id: 'updates', icon: RefreshCw, label: m['settings.section_updates'] },
    { id: 'language', icon: Languages, label: m['settings.language'] },
  ];
  let activeSection = $state('autonomy');

  $effect(() => {
    if (!loaded || typeof IntersectionObserver === 'undefined') return;
    const sections = SETTINGS_NAV.map((item) => document.getElementById(item.id)).filter((node): node is HTMLElement => Boolean(node));
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      const first = SETTINGS_NAV.find((item) => visible.has(item.id));
      if (first) activeSection = first.id;
    }, { rootMargin: '-96px 0px -55% 0px' });
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  });

  const settingsNavLinkClasses = 'aria-[current=location]:border-l-[var(--app-accent)] aria-[current=location]:bg-[var(--app-hover)] aria-[current=location]:text-[var(--app-text)] aria-[current=location]:[&_svg]:text-[var(--app-accent)] rounded-r-md flex min-h-[34px] items-center gap-[9px] border-l-2 border-transparent py-[7px] pr-[11px] pl-[10px] text-xs leading-[1.35] text-[var(--app-text-muted)] no-underline transition-[color,background-color,border-color] duration-150 hover:border-l-[var(--app-accent)] hover:bg-[var(--app-surface-subtle)] hover:text-[var(--app-text)] focus-visible:border-l-[var(--app-accent)] focus-visible:bg-[var(--app-surface-subtle)] focus-visible:text-[var(--app-text)] [&_svg]:shrink-0 [&_svg]:text-[var(--app-text-muted)] hover:[&_svg]:text-[var(--app-accent)] focus-visible:[&_svg]:text-[var(--app-accent)] max-[900px]:mb-[-1px] max-[900px]:min-h-10 max-[900px]:whitespace-nowrap max-[900px]:border-l-0 max-[900px]:border-b-2 max-[900px]:hover:border-b-[var(--app-accent)] max-[900px]:focus-visible:border-b-[var(--app-accent)]';

  function captureHotkey(event: KeyboardEvent) {
    if (!capturingHotkey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      capturingHotkey = false;
      return;
    }
    const combo = comboFromEvent(event);
    if (!combo) return; // modificador puro — espera a tecla principal
    settings = { ...settings, dictationHotkey: combo };
    capturingHotkey = false;
  }

  onMount(async () => {
    const response = await fetch('/api/agent-room/settings');
    const payload = await response.json();
    settings = payload.data ?? {};
    settings = { ...settings, voiceTtsVoice: normalizeEmbeddedTtsVoice(settings.voiceTtsVoice) };
    loaded = true;
    await refreshModelStatus();
    await loadPresets();
    if (desktop?.appVersion) appVersion = await desktop.appVersion().catch(() => '');
    await refreshCoreStatus();
    if (desktop?.coreStatus) coreStatusTimer = window.setInterval(() => void refreshCoreStatus(), 10_000);
  });

  onDestroy(() => {
    if (coreStatusTimer) window.clearInterval(coreStatusTimer);
    applyAppTheme(appSettingsStore.values);
  });

  async function save() {
    await fetch('/api/agent-room/settings', {
      method: 'PUT',
      headers: csrfHeaders({ 'content-type': 'application/json' }),
      body: JSON.stringify(settings),
    });
    // Invalida a store reativa: terminais aplicam o novo atalho na hora.
    invalidateAppSettings();
    await getAppSettings(true);
    if (desktop?.configureCore) {
      coreStatus = await desktop.configureCore({
        runInBackground: settings.coreRunInBackground === 'true',
        launchAtLogin: settings.coreLaunchAtLogin === 'true',
      }).catch(() => coreStatus);
    }
    saved = true;
    setTimeout(() => (saved = false), 2000);
  }

  type VoiceHealth = { ok: boolean; url: string; detail?: string };
  let voiceHealth = $state<VoiceHealth | null>(null);
  let checkingVoice = $state(false);
  let modelBytes = $state<number | null>(null);
  let confirmDeleteModels = $state(false);
  let deletingModels = $state(false);
  let previewingVoice = $state(false);
  let confirmVoiceDownload = $state(false);

  function ttsVoiceLabel(voice: string): string {
    return localVoiceLabel(voice);
  }

  function ttsPreviewText(voice: string): string {
    if (voice.startsWith('en-US-')) return m['settings.tts_preview_text_en']();
    if (voice.startsWith('es-MX-')) return m['settings.tts_preview_text_es']();
    return m['settings.tts_preview_text_pt']();
  }

  function languageLabel(language: string): string {
    if (language === 'pt-BR') return m['language.name_pt_br']();
    if (language === 'es') return m['language.name_es']();
    return m['language.name_en']();
  }

  function setTtsSpeed(value: number) {
    settings = { ...settings, voiceTtsSpeed: normalizeEmbeddedTtsSpeed(value).toFixed(2) };
  }

  function ttsSpeedLabel(value: number): string {
    const locale = settings.uiLanguage === 'en' ? 'en-US' : settings.uiLanguage === 'es' ? 'es' : 'pt-BR';
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}×`;
  }

  async function playVoicePreview() {
    previewingVoice = true;
    const embedded = (settings.voiceBackend ?? 'embedded') === 'embedded';
    const voice = embedded
      ? normalizeEmbeddedTtsVoice(settings.voiceTtsVoice)
      : (settings.voiceSidecarTtsVoice || 'pf_dora');
    try {
      const response = await fetch('/api/agent-room/voice/speak', {
        method: 'POST',
        headers: csrfHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({
          text: embedded ? ttsPreviewText(voice) : m['settings.tts_preview_text_sidecar'](),
          voice,
          speed: embedded ? ttsSpeed : undefined,
        }),
      });
      if (!response.ok) throw new Error('preview_failed');
      const playback = await playAudioBlob(await response.blob(), settings.audioOutputDeviceId);
      if (playback.fallback) {
        settings = { ...settings, audioOutputDeviceId: 'default' };
        toast.warning(m['settings.audio_device_removed']());
      } else if (playback.unsupported) toast.warning(m['settings.audio_output_unsupported']());
    } catch {
      toast.error(m['settings.tts_preview_failed']());
    } finally {
      previewingVoice = false;
    }
  }

  async function previewVoice() {
    if ((settings.voiceBackend ?? 'embedded') === 'embedded' && !(modelBytes && modelBytes > 0)) {
      confirmVoiceDownload = true;
      return;
    }
    await playVoicePreview();
  }

  function csrfHeaders(extra: Record<string, string> = {}): HeadersInit {
    const token = getCsrfToken();
    return token ? { ...extra, 'X-CSRF-Token': token } : extra;
  }

  // -- Presets de equipe -------------------------------------------------------
  type Preset = { id: string; name: string; icon: string | null; description: string | null; agents: number };
  let presets = $state<Preset[]>([]);
  let editingPresetId = $state<string | null>(null);
  let presetDraft = $state('');
  let deletingPreset = $state<Preset | null>(null);

  async function loadPresets() {
    try {
      const response = await fetch('/api/agent-room/presets');
      presets = (await response.json()).data ?? [];
    } catch {
      presets = [];
    }
  }

  function startPresetRename(preset: Preset) {
    editingPresetId = preset.id;
    presetDraft = preset.name;
  }

  async function renamePreset(preset: Preset) {
    const name = presetDraft.trim();
    editingPresetId = null;
    if (!name || name === preset.name) return;
    await fetch(`/api/agent-room/presets/${preset.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await loadPresets();
  }

  async function deletePreset() {
    if (!deletingPreset) return;
    await fetch(`/api/agent-room/presets/${deletingPreset.id}`, { method: 'DELETE' });
    deletingPreset = null;
    await loadPresets();
  }
  type DesktopBridge = {
    appVersion?: () => Promise<string>;
    checkForUpdates?: () => Promise<{ status: string; message?: string; version?: string }>;
    coreStatus?: () => Promise<CoreStatus | null>;
    configureCore?: (preferences: { runInBackground: boolean; launchAtLogin: boolean }) => Promise<CoreStatus | null>;
    restartCore?: () => Promise<CoreStatus | null>;
  };
  type CoreStatus = {
    running: boolean;
    pid: number | null;
    uptimeSeconds: number;
    version: string;
    restartCount: number;
    runInBackground: boolean;
    launchAtLogin: boolean;
    launchAtLoginSupported: boolean;
  };
  const desktop =
    typeof window !== 'undefined'
      ? (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop
      : undefined;
  let appVersion = $state('');
  let checkingUpdate = $state(false);
  let updateMessage = $state('');
  let coreStatus = $state<CoreStatus | null>(null);
  let restartingCore = $state(false);
  let coreStatusTimer: number | null = null;

  async function refreshCoreStatus() {
    if (!desktop?.coreStatus) return;
    coreStatus = await desktop.coreStatus().catch(() => null);
  }

  async function restartCoreRuntime() {
    if (!desktop?.restartCore || restartingCore) return;
    restartingCore = true;
    try {
      coreStatus = await desktop.restartCore();
      toast.success(m['settings.core_restarted']());
    } catch {
      toast.error(m['settings.core_restart_failed']());
    } finally {
      restartingCore = false;
    }
  }

  function setCoreBackground(enabled: boolean) {
    settings = {
      ...settings,
      coreRunInBackground: String(enabled),
      ...(!enabled ? { coreLaunchAtLogin: 'false' } : {}),
    };
  }

  function formatCoreUptime(seconds: number): string {
    if (seconds < 60) return m['settings.core_uptime_seconds']({ count: seconds });
    if (seconds < 3_600) return m['settings.core_uptime_minutes']({ count: Math.floor(seconds / 60) });
    return m['settings.core_uptime_hours']({ count: Math.floor(seconds / 3_600) });
  }

  async function checkUpdates() {
    if (!desktop?.checkForUpdates) return;
    checkingUpdate = true;
    updateMessage = m['settings.update_checking']();
    try {
      const result = await desktop.checkForUpdates();
      if (result.status === 'unsupported') updateMessage = m['settings.update_unsupported']();
      else if (result.status === 'error' || result.status === 'check-error') updateMessage = m['settings.update_error']();
      else if (result.status === 'manual') updateMessage = m['settings.update_manual_available']({ version: result.version ?? '' });
      else if (result.status === 'available') updateMessage = m['settings.update_available']({ version: result.version ?? '' });
      else if (result.status === 'none') updateMessage = m['settings.update_latest']();
    } finally {
      checkingUpdate = false;
    }
  }

  /** Troca de idioma: salva e aplica na hora (a store reativa invalida a UI). */
  async function changeLanguage(value: string) {
    settings = { ...settings, uiLanguage: value };
    await save();
  }

  async function refreshModelStatus() {
    try {
      const response = await fetch('/api/agent-room/voice/models');
      const status = (await response.json()).data;
      modelBytes = status.ready ? (status.bytes ?? 0) : 0;
    } catch {
      modelBytes = null;
    }
  }

  async function deleteModels() {
    deletingModels = true;
    try {
      const response = await fetch('/api/agent-room/voice/models', {
        method: 'DELETE',
        headers: csrfHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error || payload.data?.deleted !== true) throw new Error('delete_models_failed');
      invalidateAppSettings();
      settings = { ...settings, ...(await getAppSettings(true)) };
      await refreshModelStatus();
      voiceHealth = null;
      toast.success(m['settings.model_deleted']());
    } catch {
      toast.error(m['settings.delete_model_failed']());
    } finally {
      deletingModels = false;
      confirmDeleteModels = false;
    }
  }

  function formatMb(bytes: number) {
    return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`;
  }

  async function checkVoiceStack() {
    checkingVoice = true;
    try {
      // Salva antes de testar (a URL testada e a das settings salvas).
      await save();
      const response = await fetch('/api/agent-room/voice/health');
      voiceHealth = (await response.json()).data ?? null;
    } catch {
      voiceHealth = { ok: false, url: settings.voiceStackUrl ?? '', detail: m['settings.voice_health_failed']() };
    } finally {
      checkingVoice = false;
    }
  }

  const SHORTCUTS = $derived<Array<[string, string]>>([
    ['Cmd/Ctrl+P', m['settings.shortcut_palette']()],
    ['Cmd/Ctrl+K', m['settings.shortcut_search_docs']()],
    ['Cmd/Ctrl+Shift+A', m['settings.shortcut_next_attention']()],
    ['Cmd/Ctrl+Shift+T', m['settings.shortcut_arrange']()],
    ['Cmd/Ctrl+G', m['settings.shortcut_group']()],
    ['Cmd/Ctrl+Shift+G', m['settings.shortcut_ungroup']()],
    ['Cmd/Ctrl+Shift+!', m['settings.shortcut_zoom']()],
    ['N', m['settings.shortcut_new_note']()],
    ['L', m['settings.shortcut_connect']()],
    ['Alt+1..9', m['settings.shortcut_focus_terminal']()],
    [hotkeyLabel, m['settings.shortcut_dictation']()],
    ['Cmd/Ctrl+S', m['settings.shortcut_save']()],
    ['Backspace/Delete', m['settings.shortcut_delete']()],
  ]);
</script>

<svelte:head>
  <title>Orkestrai — {m['settings.title']()}</title>
</svelte:head>

<svelte:window onkeydown={captureHotkey} />

<main class="settings-page gap-1">
  <header class="settings-header">
    <Button variant="ghost" size="sm" href="/canvas">
      <ArrowLeft size={15} aria-hidden="true" />
      {m['settings.back_canvas']()}
    </Button>
    <div class="header-titles max-[560px]:col-[1/4] max-[560px]:row-start-2 max-[560px]:min-w-0">
      <h1 class="m-0 font-display text-[20px] font-semibold tracking-[-0.015em]">{m['settings.title']()}</h1>
      <p class="mt-[3px] mb-0 text-xs text-[var(--app-text-muted)] max-[560px]:text-pretty">{m['settings.subtitle']()}</p>
    </div>
    <span class="header-spacer max-[560px]:hidden"></span>
    <Button size="sm" onclick={save} class="save-btn min-w-[132px] active:scale-[.97] max-[560px]:col-start-2 max-[560px]:row-start-1 max-[560px]:min-w-0 max-[560px]:justify-self-end">
      {#if saved}<Check size={14} aria-hidden="true" />{m['settings.saved']()}{:else}{m['settings.save']()}{/if}
    </Button>
    <span class="h-full w-[60px] shrink-0 max-[560px]:col-start-3 max-[560px]:row-start-1 max-[560px]:h-[60px]" data-dictation-dock aria-hidden="true"></span>
  </header>

  <div class="grid w-[min(1120px,100%)] grid-cols-[210px_minmax(0,1fr)] items-start gap-10 max-[900px]:grid-cols-1 max-[900px]:gap-0">
    <aside class="sticky top-[82px] max-h-[calc(100vh-102px)] overflow-y-auto max-[900px]:top-[70px] max-[900px]:z-[9] max-[900px]:max-h-none max-[900px]:overflow-x-auto max-[900px]:overflow-y-hidden max-[900px]:bg-[color-mix(in_srgb,var(--app-page)_94%,transparent)] max-[900px]:backdrop-blur-xl max-[900px]:[scrollbar-width:none]" aria-label={m['settings.title']()}>
      <nav class="grid gap-0.5 border-l border-[var(--app-border)] py-1 max-[900px]:flex max-[900px]:w-max max-[900px]:min-w-full max-[900px]:border-l-0 max-[900px]:border-b">
        {#each SETTINGS_NAV as item (item.id)}
          <a class={settingsNavLinkClasses} href={`#${item.id}`} aria-current={activeSection === item.id ? 'location' : undefined}><item.icon size={14} />{item.label()}</a>
        {/each}
      </nav>
    </aside>
    <div class="grid min-w-0">
  {#if !loaded}
    {#each [0, 1, 2] as index (index)}
      <section class={settingsSectionClasses} aria-hidden="true">
        <div class="section-skeleton-head">
          <Skeleton class="h-[30px] w-[30px] rounded-[9px] bg-[var(--app-surface-raised)]" />
          <div class="section-skeleton-titles">
            <Skeleton class="h-4 w-32 bg-[var(--app-surface-raised)]" />
            <Skeleton class="h-3 w-52 bg-[var(--app-surface-raised)]" />
          </div>
        </div>
        <div class="grid-fields">
          <Skeleton class="h-9 w-full bg-[var(--app-surface-raised)]" />
          <Skeleton class="h-9 w-full bg-[var(--app-surface-raised)]" />
          <Skeleton class="h-9 w-full bg-[var(--app-surface-raised)]" />
        </div>
      </section>
    {/each}
  {:else}
  <section class={settingsSectionClasses} id="autonomy">
    <header class="section-head">
      <span class="icon-chip"><Power size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_autonomy']()}</h2>
        <p>{m['settings.section_autonomy_desc']()}</p>
      </div>
    </header>

    <div class="grid">
      <div class="flex min-h-14 items-center justify-between gap-4 border-t border-[var(--app-border)] py-3 first:border-t-0 first:pt-0">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="field-label">{m['settings.core_background']()}</span>
          <p class="field-hint">{m['settings.core_background_desc']()}</p>
        </div>
        <Switch
          checked={settings.coreRunInBackground === 'true'}
          aria-label={m['settings.core_background']()}
          onCheckedChange={setCoreBackground}
        />
      </div>
      <div class="flex min-h-14 items-center justify-between gap-4 border-t border-[var(--app-border)] py-3">
        <div class="flex min-w-0 flex-col gap-1">
          <span class="field-label">{m['settings.core_launch_login']()}</span>
          <p class="field-hint">{m['settings.core_launch_login_desc']()}</p>
        </div>
        <Switch
          checked={settings.coreLaunchAtLogin === 'true'}
          disabled={settings.coreRunInBackground !== 'true' || coreStatus?.launchAtLoginSupported === false}
          aria-label={m['settings.core_launch_login']()}
          onCheckedChange={(checked: boolean) => (settings = { ...settings, coreLaunchAtLogin: String(checked) })}
        />
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--app-border)] pt-4">
      <span class={`inline-flex items-center gap-2 text-xs font-medium ${coreStatus?.running ? 'text-[var(--app-success)]' : 'text-[var(--app-danger)]'}`}>
        <Activity size={14} aria-hidden="true" />
        {coreStatus?.running ? m['settings.core_running']() : m['settings.core_unavailable']()}
      </span>
      {#if coreStatus?.running}
        <span class="text-xs text-[var(--app-text-muted)]">
          {formatCoreUptime(coreStatus.uptimeSeconds)} · PID {coreStatus.pid ?? '—'}
          {#if coreStatus.restartCount > 0} · {m['settings.core_recoveries']({ count: coreStatus.restartCount })}{/if}
        </span>
      {/if}
      {#if desktop?.restartCore}
        <Button variant="outline" size="sm" class="ml-auto" disabled={restartingCore} onclick={restartCoreRuntime}>
          <RotateCw size={14} class={restartingCore ? 'animate-spin' : ''} aria-hidden="true" />
          {restartingCore ? m['settings.core_restarting']() : m['settings.core_restart']()}
        </Button>
      {/if}
    </div>
  </section>

  <section class={settingsSectionClasses} id="terminal">
    <header class="section-head">
      <span class="icon-chip"><SquareTerminal size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_terminal']()}</h2>
        <p>{m['settings.section_terminal_desc']()}</p>
      </div>
    </header>

    <div class="grid">
      <div class="setting-row">
        <div class="setting-copy">
          <span class="field-label">{m['settings.minimap']()}</span>
          <p class="field-hint">{m['settings.minimap_desc']()}</p>
        </div>
        <Switch
          checked={settings.showMinimap !== 'false'}
          aria-label={m['settings.minimap']()}
          onCheckedChange={(checked: boolean) => (settings = { ...settings, showMinimap: String(checked) })}
        />
      </div>
      <div class="setting-row">
        <div class="setting-copy">
          <span class="field-label">{m['settings.controls']()}</span>
          <p class="field-hint">{m['settings.controls_desc']()}</p>
        </div>
        <Switch
          checked={settings.showControls !== 'false'}
          aria-label={m['settings.controls']()}
          onCheckedChange={(checked: boolean) => (settings = { ...settings, showControls: String(checked) })}
        />
      </div>
    </div>

    <div class="grid-fields">
      <div class="field">
        <span class="field-label">{m['settings.theme']()}</span>
        <Select.Root type="single" value={settings.terminalTheme} onValueChange={(value: string) => (settings = { ...settings, terminalTheme: value })}>
          <Select.Trigger data-slot="select-trigger">
            <span class="theme-select-swatch" aria-hidden="true">
              {#each themeSwatchColors(settings.terminalTheme) as color, i (i)}<span style={`background:${color}`}></span>{/each}
            </span>
            {terminalThemeLabel(settings.terminalTheme)}
          </Select.Trigger>
          <Select.Content>
            {#each TERMINAL_THEME_ORDER as theme}
              <Select.Item value={theme}>
                <span class="theme-select-swatch" aria-hidden="true">
                  {#each themeSwatchColors(theme) as color, i (i)}<span style={`background:${color}`}></span>{/each}
                </span>
                {terminalThemeLabel(theme)}
              </Select.Item>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>

    <div class="grid-fields">
      <div class="field">
        <span class="field-label field-label-row">{m['settings.font_size']()}<output class="slider-value">{Number(settings.terminalFontSize) || 13}px</output></span>
        <Slider
          type="single"
          value={Number(settings.terminalFontSize) || 13}
          min={9}
          max={24}
          step={1}
          aria-label={m['settings.font_size']()}
          onValueChange={(value: number) => (settings = { ...settings, terminalFontSize: String(value) })}
        />
      </div>
      <div class="field">
        <span class="field-label field-label-row">{m['settings.padding']()}<output class="slider-value">{Number(settings.terminalPadding ?? 8)}px</output></span>
        <Slider
          type="single"
          value={Number(settings.terminalPadding ?? 8)}
          min={0}
          max={24}
          step={1}
          aria-label={m['settings.padding']()}
          onValueChange={(value: number) => (settings = { ...settings, terminalPadding: String(value) })}
        />
      </div>
      <div class="field span-2">
        <span class="field-label">{m['settings.font_family']()}</span>
        <Input bind:value={settings.terminalFontFamily} placeholder="ui-monospace, Menlo, monospace" />
      </div>
    </div>

    <div
      class="terminal-preview"
      style:background={previewTheme.background}
      style:color={previewTheme.foreground}
      style:font-family={settings.terminalFontFamily || 'ui-monospace, Menlo, monospace'}
      style:font-size={`${settings.terminalFontSize || 13}px`}
      style:padding={`${settings.terminalPadding ?? 8}px`}
    >
      <div><span style={`color:${previewTheme.green}`}>➜</span> <span style={`color:${previewTheme.blue}`}>~/orkestrai</span> npm run dev</div>
      <div><span style={`color:${previewTheme.yellow}`}>warn</span> {m['settings.preview_sample_warn']()}</div>
      <div><span style={`color:${previewTheme.red}`}>✗</span> {m['settings.preview_sample_error']()}</div>
    </div>

    <div class="grid gap-3">
      <div class="setting-copy">
        <span class="field-label">{m['settings.new_node_sizes']()}</span>
        <p class="field-hint">{m['settings.new_node_sizes_desc']()}</p>
      </div>
      <div class="grid-fields">
        <label class="field">
          <span class="field-label">{m['settings.terminal_width']()}</span>
          <span class="unit-input"><Input type="number" bind:value={settings.newTerminalWidth} /><span aria-hidden="true">px</span></span>
        </label>
        <label class="field">
          <span class="field-label">{m['settings.terminal_height']()}</span>
          <span class="unit-input"><Input type="number" bind:value={settings.newTerminalHeight} /><span aria-hidden="true">px</span></span>
        </label>
        <label class="field">
          <span class="field-label">{m['settings.note_width']()}</span>
          <span class="unit-input"><Input type="number" bind:value={settings.newNoteWidth} /><span aria-hidden="true">px</span></span>
        </label>
        <label class="field">
          <span class="field-label">{m['settings.note_height']()}</span>
          <span class="unit-input"><Input type="number" bind:value={settings.newNoteHeight} /><span aria-hidden="true">px</span></span>
        </label>
      </div>
    </div>
  </section>

  <section class={settingsSectionClasses} id="appearance">
    <header class="section-head">
      <span class="icon-chip"><Palette size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_appearance']()}</h2>
        <p>{m['settings.section_appearance_desc']()}</p>
      </div>
    </header>
    <div class="mb-5 grid gap-2 border-b border-[var(--app-border)] pb-5">
      <span class="field-label">{m['settings.canvas_edges']()}</span>
      <p class="field-hint">{m['settings.canvas_edges_desc']()}</p>
      <SegmentedControl
        class="w-fit max-w-full"
        label={m['settings.canvas_edges']()}
        value={settings.canvasEdgeRendering ?? 'auto'}
        onValueChange={(value: string) => (settings = { ...settings, canvasEdgeRendering: value })}
        options={[
          { value: 'auto', label: m['settings.canvas_edges_auto']() },
          { value: 'elastic', label: m['settings.canvas_edges_elastic']() },
          { value: 'static', label: m['settings.canvas_edges_static']() },
        ]}
      />
    </div>
    <div class="mb-5 grid gap-2 border-b border-[var(--app-border)] pb-5">
      <span class="field-label">{m['settings.workbench_tabs']()}</span>
      <p class="field-hint">{m['settings.workbench_tabs_desc']()}</p>
      <SegmentedControl
        class="w-fit max-w-full"
        label={m['settings.workbench_tabs']()}
        value={settings.workbenchTabPlacement ?? 'vertical'}
        onValueChange={(value: string) => (settings = { ...settings, workbenchTabPlacement: value })}
        options={[
          { value: 'vertical', label: m['settings.workbench_tabs_vertical']() },
          { value: 'horizontal', label: m['settings.workbench_tabs_horizontal']() },
        ]}
      />
    </div>
    <div class="mb-5 grid gap-4 border-b border-[var(--app-border)] pb-5">
      <div>
        <span class="field-label">{m['settings.workbench_editor']()}</span>
        <p class="field-hint">{m['settings.workbench_editor_desc']()}</p>
      </div>
      <div class="grid">
        <div class="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--app-border)] pt-3 first:border-t-0 first:pt-0">
          <span class="field-label">{m['settings.editor_minimap']()}</span>
          <Switch
            checked={settings.editorMinimap !== 'false'}
            aria-label={m['settings.editor_minimap']()}
            onCheckedChange={(checked: boolean) => (settings = { ...settings, editorMinimap: String(checked) })}
          />
        </div>
        <div class="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--app-border)] pt-3 first:border-t-0 first:pt-0">
          <span class="field-label">{m['settings.editor_word_wrap']()}</span>
          <Switch
            checked={settings.editorWordWrap === 'true'}
            aria-label={m['settings.editor_word_wrap']()}
            onCheckedChange={(checked: boolean) => (settings = { ...settings, editorWordWrap: String(checked) })}
          />
        </div>
        <div class="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--app-border)] pt-3 first:border-t-0 first:pt-0">
          <span class="field-label">{m['settings.editor_autosave']()}</span>
          <Switch
            checked={settings.editorAutoSave === 'true'}
            aria-label={m['settings.editor_autosave']()}
            onCheckedChange={(checked: boolean) => (settings = { ...settings, editorAutoSave: String(checked) })}
          />
        </div>
      </div>
      <div class="field max-w-72">
        <span class="field-label field-label-row">{m['settings.editor_font_size']()}<output class="slider-value">{Number(settings.editorFontSize) || 13}px</output></span>
        <Slider
          type="single"
          value={Number(settings.editorFontSize) || 13}
          min={9}
          max={24}
          step={1}
          aria-label={m['settings.editor_font_size']()}
          onValueChange={(value: number) => (settings = { ...settings, editorFontSize: String(value) })}
        />
      </div>
    </div>
    <AppThemeSettings {settings} onChange={(next) => (settings = next)} />
  </section>

  <section class={settingsSectionClasses} id="dictation">
    <header class="section-head">
      <span class="icon-chip"><Mic size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_dictation']()}</h2>
        <p>{m['settings.section_dictation_desc']()}</p>
      </div>
    </header>

    <div class="field">
      <span class="field-label">{m['settings.hotkey']()}</span>
      <div class="hotkey-row">
        <Button
          variant="outline"
          size="sm"
          class={capturingHotkey ? 'hotkey-capture capturing' : 'hotkey-capture'}
          onclick={() => (capturingHotkey = true)}
        >
          {capturingHotkey ? m['settings.hotkey_capturing']() : hotkeyLabel}
        </Button>
        {#if settings.dictationHotkey && settings.dictationHotkey !== DEFAULT_DICTATION_HOTKEY}
          <Button variant="ghost" size="sm" onclick={() => (settings = { ...settings, dictationHotkey: DEFAULT_DICTATION_HOTKEY })}>
            {m['settings.restore_default']()}
          </Button>
        {/if}
      </div>
      <p class="field-hint">
        {m['settings.dictation_hint']()}
      </p>
    </div>

    <div class="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--app-border)] pt-3.5">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="field-label">{m['settings.dictation_auto_submit']()}</span>
        <p class="field-hint">{m['settings.dictation_auto_submit_desc']()}</p>
      </div>
      <Switch
        checked={settings.dictationAutoSubmit === 'true'}
        aria-label={m['settings.dictation_auto_submit']()}
        onCheckedChange={(checked: boolean) => (settings = { ...settings, dictationAutoSubmit: String(checked) })}
      />
    </div>
  </section>

  <section class={settingsSectionClasses} id="voice">
    <header class="section-head">
      <span class="icon-chip"><Volume2 size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_voice']()}</h2>
        <p>{m['settings.section_voice_desc']()}</p>
      </div>
    </header>

    <AudioDeviceSettings {settings} onChange={(next) => (settings = next)} />

    <div class="grid-fields">
      <div class="field">
        <span class="field-label">{m['settings.voice_engine']()}</span>
        <Select.Root type="single" value={settings.voiceBackend ?? 'embedded'} onValueChange={(value: string) => (settings = { ...settings, voiceBackend: value })}>
          <Select.Trigger data-slot="select-trigger">
            {(settings.voiceBackend ?? 'embedded') === 'embedded' ? m['settings.voice_engine_local']() : m['settings.voice_engine_sidecar']()}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="embedded">{m['settings.voice_engine_local']()}</Select.Item>
            <Select.Item value="sidecar">{m['settings.voice_engine_sidecar']()}</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      {#if (settings.voiceBackend ?? 'embedded') === 'embedded'}
      <div class="field">
        <span class="field-label">{m['settings.tts_voice']()}</span>
        <Select.Root type="single" value={normalizeEmbeddedTtsVoice(settings.voiceTtsVoice)} onValueChange={(value: string) => (settings = { ...settings, voiceTtsVoice: value })}>
          <Select.Trigger data-slot="select-trigger">
            {ttsVoiceLabel(normalizeEmbeddedTtsVoice(settings.voiceTtsVoice))}
          </Select.Trigger>
          <Select.Content>
            {#each EMBEDDED_TTS_VOICES as voice}<Select.Item value={voice.id}>{localVoiceLabel(voice.id)}</Select.Item>{/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div class="field span-all">
        <div class="speed-head">
          <span class="field-label">{m['settings.tts_speed']()}</span>
          <div class="speed-value-row">
            <output class="speed-value" aria-live="polite">{ttsSpeedLabel(ttsSpeed)}</output>
            <Button
              variant="ghost"
              size="icon-xs"
              title={m['settings.tts_speed_reset']()}
              aria-label={m['settings.tts_speed_reset']()}
              disabled={ttsSpeed === DEFAULT_EMBEDDED_TTS_SPEED}
              onclick={() => setTtsSpeed(DEFAULT_EMBEDDED_TTS_SPEED)}
            >
              <RefreshCw size={12} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div class="speed-control">
          <span>{ttsSpeedLabel(MIN_EMBEDDED_TTS_SPEED)}</span>
          <Slider
            type="single"
            value={ttsSpeed}
            min={MIN_EMBEDDED_TTS_SPEED}
            max={MAX_EMBEDDED_TTS_SPEED}
            step={0.05}
            aria-label={m['settings.tts_speed']()}
            onValueChange={setTtsSpeed}
          />
          <span>{ttsSpeedLabel(MAX_EMBEDDED_TTS_SPEED)}</span>
        </div>
      </div>
      {/if}
    </div>

    {#if (settings.voiceBackend ?? 'embedded') === 'sidecar'}
      <div class="grid-fields">
        <div class="field">
          <span class="field-label">{m['settings.sidecar_url']()}</span>
          <Input bind:value={settings.voiceStackUrl} placeholder="http://localhost:8000" />
        </div>
        <div class="field">
          <span class="field-label">{m['settings.sidecar_model']()}</span>
          <Input bind:value={settings.voiceSttModel} placeholder="whisper-large-v3-turbo" />
        </div>
        <div class="field">
          <span class="field-label">{m['settings.sidecar_tts_voice']()}</span>
          <Input bind:value={settings.voiceSidecarTtsVoice} placeholder="pf_dora" />
        </div>
      </div>
    {/if}

    <div class="hotkey-row">
      <Button variant="outline" size="sm" disabled={checkingVoice} onclick={checkVoiceStack}>
        {checkingVoice ? m['settings.testing']() : m['settings.test_connection']()}
      </Button>
      <Button variant="outline" size="sm" disabled={previewingVoice} onclick={previewVoice}>
        <Play size={14} aria-hidden="true" />
        {previewingVoice ? m['settings.tts_previewing']() : m['settings.tts_preview']()}
      </Button>
      {#if voiceHealth}
        <span class="status-pill" class:ok={voiceHealth.ok}>
          <span class="status-dot"></span>
          {voiceHealth.ok ? `${voiceHealth.url === 'embedded' ? m['settings.voice_local_active']() : m['settings.voice_sidecar_up']({ url: voiceHealth.url })}${voiceHealth.detail ? ` — ${voiceHealth.detail}` : ''}` : `${m['settings.voice_down']({ url: voiceHealth.url })}${voiceHealth.detail ? ` — ${voiceHealth.detail}` : ''}`}
        </span>
      {/if}
    </div>

    {#if modelBytes !== null && modelBytes > 0}
      <div class="model-card">
        <div class="model-info">
          <span class="field-label">{m['settings.model_downloaded']()}</span>
          <strong class="model-size">{formatMb(modelBytes)}</strong>
        </div>
        <Button variant="outline" size="sm" onclick={() => (confirmDeleteModels = true)}>
          {m['settings.delete_model']()}
        </Button>
      </div>
    {/if}

    <p class="field-hint">
      {m['settings.voice_hint']()}
    </p>
  </section>

  <AlertDialog.Root bind:open={confirmDeleteModels}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>{m['settings.delete_model_title']()}</AlertDialog.Title>
        <AlertDialog.Description>
          {m['settings.delete_model_desc']({ size: modelBytes ? formatMb(modelBytes) : '—' })}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel onclick={() => (confirmDeleteModels = false)}>{m['settings.cancel']()}</AlertDialog.Cancel>
        <AlertDialog.Action disabled={deletingModels} onclick={deleteModels}>
          {deletingModels ? m['settings.deleting']() : m['settings.delete']()}
        </AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  <VoiceConfirmDialog
    bind:open={confirmVoiceDownload}
    onConfirm={() => {
      void refreshModelStatus();
      void playVoicePreview();
    }}
    onCancel={() => (confirmVoiceDownload = false)}
  />

  <section class={settingsSectionClasses} id="shortcuts">
    <header class="section-head">
      <span class="icon-chip"><Keyboard size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_shortcuts']()}</h2>
        <p>{m['settings.section_shortcuts_desc']()}</p>
      </div>
    </header>
    <div class="shortcuts-grid">
      {#each SHORTCUTS as [keys, description]}
        <div class="shortcut-row">
          <kbd>
            {#each shortcutSegments(keys) as segment, i (i)}
              {#if i > 0}<span aria-hidden="true">+</span>{/if}
              {#if segment === '⌘'}<Command size={10} class="inline-block align-[-1px]" aria-label={m['settings.shortcut_command_key']()} />{:else}{segment}{/if}
            {/each}
          </kbd>
          <span class="shortcut-desc">{description}</span>
        </div>
      {/each}
    </div>
  </section>

  <section class={settingsSectionClasses} id="presets">
    <header class="section-head">
      <span class="icon-chip"><Layers size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_presets']()}</h2>
        <p>{m['settings.section_presets_desc']()}</p>
      </div>
    </header>
    {#if presets.length === 0}
      <p class="field-hint">{m['settings.presets_empty']()}</p>
    {:else}
      <ul class="preset-list">
        {#each presets as preset (preset.id)}
          <li class="preset-row">
            <span class="preset-icon"><WorkspaceIcon name={preset.icon} size={14} /></span>
            {#if editingPresetId === preset.id}
              <input
                class="preset-rename"
                bind:value={presetDraft}
                aria-label={m['settings.preset_rename_aria']()}
                onkeydown={(event) => {
                  if (event.key === 'Enter') renamePreset(preset);
                  if (event.key === 'Escape') editingPresetId = null;
                }}
                onblur={() => renamePreset(preset)}
              />
            {:else}
              <span class="preset-name">{preset.name}</span>
            {/if}
            <span class="preset-meta">{m['settings.preset_agents']({ count: preset.agents })}{preset.description ? ` · ${preset.description}` : ''}</span>
            <button class="preset-action" aria-label={m['settings.preset_rename_named']({ name: preset.name })} onclick={() => startPresetRename(preset)}>
              <Pencil size={12} />
            </button>
            <button class="preset-action danger" aria-label={m['settings.preset_delete_named']({ name: preset.name })} onclick={() => (deletingPreset = preset)}>
              <Trash2 size={12} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <AlertDialog.Root open={deletingPreset !== null} onOpenChange={(isOpen) => !isOpen && (deletingPreset = null)}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>{m['settings.delete_preset_title']()}</AlertDialog.Title>
        <AlertDialog.Description>
          {m['settings.delete_preset_desc']({ name: deletingPreset?.name ?? '' })}
        </AlertDialog.Description>
      </AlertDialog.Header>
      <AlertDialog.Footer>
        <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
        <AlertDialog.Action onclick={deletePreset}>{m['settings.delete']()}</AlertDialog.Action>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  <section class={settingsSectionClasses} id="updates">
    <header class="section-head">
      <span class="icon-chip"><RefreshCw size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_updates']()}</h2>
        <p>{m['settings.section_updates_desc']()}</p>
      </div>
    </header>
    <div class="hotkey-row">
      <span class="field-label">{m['settings.version']()}: <strong class="model-size">{appVersion || '—'}</strong></span>
      {#if desktop?.checkForUpdates}
        <Button variant="outline" size="sm" disabled={checkingUpdate} onclick={checkUpdates}>
          {checkingUpdate ? m['settings.checking']() : m['settings.check_updates']()}
        </Button>
      {/if}
    </div>
    {#if updateMessage}
      <p class="field-hint">{updateMessage}</p>
    {/if}
  </section>

  <section class={settingsSectionClasses} id="language">
    <header class="section-head">
      <span class="icon-chip"><Languages size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.language']()}</h2>
        <p>{m['settings.language_desc']()}</p>
      </div>
    </header>
    <div class="field" style="max-width: 240px">
      <Select.Root type="single" value={settings.uiLanguage ?? 'en'} onValueChange={changeLanguage}>
        <Select.Trigger data-slot="select-trigger">
          {languageLabel(settings.uiLanguage ?? 'en')}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="pt-BR">{m['language.name_pt_br']()}</Select.Item>
          <Select.Item value="en">{m['language.name_en']()}</Select.Item>
          <Select.Item value="es">{m['language.name_es']()}</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
  </section>
  {/if}
    </div>
  </div>
</main>

<style>
  .settings-page {
    min-height: 100vh;
    background: var(--app-page);
    color: var(--app-text);
    padding: 24px 24px 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    -webkit-font-smoothing: antialiased;
  }

  /* ---- Cabecalho fixo com o Salvar sempre a mao ------------------------ */
  .settings-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 70px;
    width: min(1120px, 100%);
    padding: 10px 0 12px;
    background: color-mix(in srgb, var(--app-page) 92%, transparent);
    backdrop-filter: blur(12px);
  }

  .header-spacer {
    flex: 1;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .icon-chip {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-raised);
    color: var(--app-accent);
    flex-shrink: 0;
  }

  .section-titles h2 {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0;
    margin: 0;
    color: var(--app-text);
  }

  .section-titles p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .section-skeleton-head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .section-skeleton-titles {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* ---- Presets ------------------------------------------------------------ */
  .preset-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preset-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 7px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
  }

  .preset-icon {
    flex-shrink: 0;
  }

  .preset-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--app-text);
  }

  .preset-meta {
    flex: 1;
    font-size: 11px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-rename {
    font-size: 12.5px;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border-strong);
    border-radius: 6px;
    color: var(--app-text);
    padding: 3px 8px;
    outline: none;
  }

  .preset-action {
    display: inline-flex;
    padding: 4px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .preset-action:hover {
    color: var(--app-text);
    background: var(--app-surface-raised);
  }

  .preset-action.danger:hover {
    color: var(--app-danger);
  }

  /* ---- Campos em grade responsiva --------------------------------------- */
  .grid-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 14px 16px;
  }

  .span-2 {
    grid-column: span 2;
  }

  .span-all {
    grid-column: 1 / -1;
  }

  @media (max-width: 560px) {
    .settings-page {
      padding: 12px 12px 64px;
      overflow-x: hidden;
    }

    .settings-header {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) 60px;
    }

    .span-2 {
      grid-column: span 1;
    }
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .field-label {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--app-text);
  }

  /* Rotulo com o valor atual do slider alinhado a direita. */
  .field-label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .slider-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
  }

  .field :global([data-slot='slider']) {
    margin: 8px 0 6px;
  }

  /* Linha de configuracao: rotulo e descricao a esquerda, controle a direita. */
  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 56px;
    padding: 12px 0;
    border-top: 1px solid var(--app-border);
  }

  .setting-row:first-child {
    border-top: 0;
    padding-top: 0;
  }

  .setting-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  /* Numero com unidade: o sufixo fica dentro do campo. */
  .unit-input {
    position: relative;
    display: block;
  }

  .unit-input :global(input) {
    padding-right: 34px;
    font-variant-numeric: tabular-nums;
  }

  .unit-input > span {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--app-text-muted);
    pointer-events: none;
  }

  .theme-select-swatch {
    display: inline-flex;
    flex-shrink: 0;
    gap: 2px;
    margin-right: 4px;
  }

  .theme-select-swatch span {
    display: block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    border: 1px solid rgb(0 0 0 / 15%);
  }

  .terminal-preview {
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    overflow: hidden;
    white-space: pre;
  }

  .speed-head,
  .speed-value-row,
  .speed-control {
    display: flex;
    align-items: center;
  }

  .speed-head {
    justify-content: space-between;
    min-height: 24px;
  }

  .speed-value-row {
    gap: 4px;
  }

  .speed-value {
    min-width: 42px;
    text-align: right;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--app-text);
  }

  .speed-control {
    gap: 10px;
  }

  .speed-control > span {
    width: 40px;
    flex: 0 0 40px;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
  }

  .speed-control > span:last-child {
    text-align: right;
  }

  .field-hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--app-text-muted);
    text-wrap: pretty;
  }

  .hotkey-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  :global(.hotkey-capture) {
    min-width: 150px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  :global(.hotkey-capture.capturing) {
    border-color: var(--app-accent);
    color: var(--app-accent);
  }

  /* ---- Status da voz em pildula ---------------------------------------- */
  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 11.5px;
    color: var(--app-danger);
    background: color-mix(in srgb, var(--app-danger) 10%, transparent);
  }

  .status-pill.ok {
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 10%, transparent);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex-shrink: 0;
  }

  /* ---- Cartao interno do modelo (raio concentrico: 14 - 6 = 8+) -------- */
  .model-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 0;
    border: 0;
    border-block: 1px solid var(--app-border);
    background: transparent;
  }

  .model-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .model-size {
    font-size: 14px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: var(--app-text);
  }

  /* ---- Atalhos em grade ------------------------------------------------- */
  .shortcuts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 9px 24px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    flex-shrink: 0;
    min-width: 44px;
    text-align: center;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border-strong);
    border-bottom-width: 2px;
    border-radius: 6px;
    padding: 3px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--app-text-soft);
  }

  .shortcut-desc {
    font-size: 12px;
    color: var(--app-text-soft);
    text-wrap: pretty;
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-section,
    :global(.save-btn) {
      transition: none;
    }
  }
</style>
