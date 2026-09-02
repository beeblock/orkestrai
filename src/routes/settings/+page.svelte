<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { ArrowLeft, Check, Command, Keyboard, Languages, Layers, Mic, Palette, Pencil, Play, RefreshCw, SquareTerminal, Trash2, Volume2 } from '@lucide/svelte';
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
  import {
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
  const settingsSectionClasses = 'settings-section flex scroll-mt-[84px] flex-col gap-[18px] border-0 border-t border-[var(--line)] bg-transparent px-0 py-6 first:border-t-0 max-[560px]:py-5';
  const settingsNavLinkClasses = 'flex min-h-[34px] items-center gap-[9px] border-l-2 border-transparent py-[7px] pr-[11px] pl-[10px] text-xs leading-[1.35] text-[var(--copy-muted)] no-underline transition-[color,background-color,border-color] duration-150 hover:border-l-[var(--app-accent)] hover:bg-[var(--surface-subtle)] hover:text-[var(--copy)] focus-visible:border-l-[var(--app-accent)] focus-visible:bg-[var(--surface-subtle)] focus-visible:text-[var(--copy)] [&_svg]:shrink-0 [&_svg]:text-[var(--app-text-muted)] hover:[&_svg]:text-[var(--app-accent)] focus-visible:[&_svg]:text-[var(--app-accent)] max-[900px]:mb-[-1px] max-[900px]:min-h-10 max-[900px]:whitespace-nowrap max-[900px]:border-l-0 max-[900px]:border-b-2 max-[900px]:hover:border-b-[var(--app-accent)] max-[900px]:focus-visible:border-b-[var(--app-accent)]';

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
  });

  onDestroy(() => {
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
    if (voice === 'en-US-m2') return m['settings.tts_voice_en_us']();
    if (voice === 'es-MX-f3') return m['settings.tts_voice_es_mx']();
    return m['settings.tts_voice_pt_br']();
  }

  function ttsPreviewText(voice: string): string {
    if (voice === 'en-US-m2') return m['settings.tts_preview_text_en']();
    if (voice === 'es-MX-f3') return m['settings.tts_preview_text_es']();
    return m['settings.tts_preview_text_pt']();
  }

  function languageLabel(language: string): string {
    if (language === 'pt-BR') return m['language.name_pt_br']();
    if (language === 'es') return m['language.name_es']();
    return m['language.name_en']();
  }

  function edgeRenderingLabel(value: string): string {
    if (value === 'elastic') return m['settings.canvas_edges_elastic']();
    if (value === 'static') return m['settings.canvas_edges_static']();
    return m['settings.canvas_edges_auto']();
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
  };
  const desktop =
    typeof window !== 'undefined'
      ? (window as unknown as { orkestraiDesktop?: DesktopBridge }).orkestraiDesktop
      : undefined;
  let appVersion = $state('');
  let checkingUpdate = $state(false);
  let updateMessage = $state('');

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
  <header class="settings-header min-h-[70px] w-[min(1120px,100%)] pt-2.5 pb-3 max-[560px]:grid max-[560px]:grid-cols-[auto_minmax(0,1fr)_60px] max-[560px]:pr-0">
    <Button variant="ghost" size="sm" href="/canvas">
      <ArrowLeft size={15} aria-hidden="true" />
      {m['settings.back_canvas']()}
    </Button>
    <div class="header-titles max-[560px]:col-[1/4] max-[560px]:row-start-2 max-[560px]:min-w-0">
      <h1 class="m-0 font-['Sora_Variable'] text-[21px] font-[650]">{m['settings.title']()}</h1>
      <p class="mt-[3px] mb-0 text-xs text-[var(--copy-muted)] max-[560px]:text-pretty">{m['settings.subtitle']()}</p>
    </div>
    <span class="header-spacer max-[560px]:hidden"></span>
    <Button size="sm" onclick={save} class="save-btn min-w-[132px] active:scale-[.97] max-[560px]:col-start-2 max-[560px]:row-start-1 max-[560px]:min-w-0 max-[560px]:justify-self-end">
      {#if saved}<Check size={14} aria-hidden="true" />{m['settings.saved']()}{:else}{m['settings.save']()}{/if}
    </Button>
    <span class="h-full w-[60px] shrink-0 max-[560px]:col-start-3 max-[560px]:row-start-1 max-[560px]:h-[60px]" data-dictation-dock aria-hidden="true"></span>
  </header>

  <div class="grid w-[min(1120px,100%)] grid-cols-[210px_minmax(0,1fr)] items-start gap-10 max-[900px]:grid-cols-1 max-[900px]:gap-0">
    <aside class="sticky top-[82px] max-h-[calc(100vh-102px)] overflow-y-auto max-[900px]:top-[70px] max-[900px]:z-[9] max-[900px]:max-h-none max-[900px]:overflow-x-auto max-[900px]:overflow-y-hidden max-[900px]:bg-[color-mix(in_srgb,var(--page)_94%,transparent)] max-[900px]:backdrop-blur-xl max-[900px]:[scrollbar-width:none]" aria-label={m['settings.title']()}>
      <nav class="grid gap-0.5 border-l border-[var(--line)] py-1 max-[900px]:flex max-[900px]:w-max max-[900px]:min-w-full max-[900px]:border-l-0 max-[900px]:border-b">
        <a class={settingsNavLinkClasses} href="#terminal"><SquareTerminal size={14} />{m['settings.section_terminal']()}</a>
        <a class={settingsNavLinkClasses} href="#appearance"><Palette size={14} />{m['settings.section_appearance']()}</a>
        <a class={settingsNavLinkClasses} href="#dictation"><Mic size={14} />{m['settings.section_dictation']()}</a>
        <a class={settingsNavLinkClasses} href="#voice"><Volume2 size={14} />{m['settings.section_voice']()}</a>
        <a class={settingsNavLinkClasses} href="#shortcuts"><Keyboard size={14} />{m['settings.section_shortcuts']()}</a>
        <a class={settingsNavLinkClasses} href="#presets"><Layers size={14} />{m['settings.section_presets']()}</a>
        <a class={settingsNavLinkClasses} href="#updates"><RefreshCw size={14} />{m['settings.section_updates']()}</a>
        <a class={settingsNavLinkClasses} href="#language"><Languages size={14} />{m['settings.language']()}</a>
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
  <section class={settingsSectionClasses} id="terminal">
    <header class="section-head">
      <span class="icon-chip"><SquareTerminal size={15} aria-hidden="true" /></span>
      <div class="section-titles">
        <h2>{m['settings.section_terminal']()}</h2>
        <p>{m['settings.section_terminal_desc']()}</p>
      </div>
    </header>

    <div class="grid-fields">
      <div class="field">
        <span class="field-label">{m['settings.minimap']()}</span>
        <Select.Root type="single" value={settings.showMinimap} onValueChange={(value: string) => (settings = { ...settings, showMinimap: value })}>
          <Select.Trigger data-slot="select-trigger">
            {settings.showMinimap === 'true' ? m['settings.show']() : m['settings.hide']()}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="true">{m['settings.show']()}</Select.Item>
            <Select.Item value="false">{m['settings.hide']()}</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
      <div class="field">
        <span class="field-label">{m['settings.controls']()}</span>
        <Select.Root type="single" value={settings.showControls} onValueChange={(value: string) => (settings = { ...settings, showControls: value })}>
          <Select.Trigger data-slot="select-trigger">
            {settings.showControls === 'true' ? m['settings.show']() : m['settings.hide']()}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="true">{m['settings.show']()}</Select.Item>
            <Select.Item value="false">{m['settings.hide']()}</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>
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
        <span class="field-label">{m['settings.font_size']()}</span>
        <Input type="number" min="9" max="24" bind:value={settings.terminalFontSize} />
      </div>
      <div class="field span-2">
        <span class="field-label">{m['settings.font_family']()}</span>
        <Input bind:value={settings.terminalFontFamily} placeholder="ui-monospace, Menlo, monospace" />
      </div>
      <div class="field">
        <span class="field-label">{m['settings.padding']()}</span>
        <Input type="number" min="0" max="24" bind:value={settings.terminalPadding} />
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

    <div class="grid-fields">
      <div class="field">
        <span class="field-label">{m['settings.terminal_width']()}</span>
        <Input type="number" bind:value={settings.newTerminalWidth} />
      </div>
      <div class="field">
        <span class="field-label">{m['settings.terminal_height']()}</span>
        <Input type="number" bind:value={settings.newTerminalHeight} />
      </div>
      <div class="field">
        <span class="field-label">{m['settings.note_width']()}</span>
        <Input type="number" bind:value={settings.newNoteWidth} />
      </div>
      <div class="field">
        <span class="field-label">{m['settings.note_height']()}</span>
        <Input type="number" bind:value={settings.newNoteHeight} />
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
      <Select.Root
        type="single"
        value={settings.canvasEdgeRendering ?? 'auto'}
        onValueChange={(value: string) => (settings = { ...settings, canvasEdgeRendering: value })}
      >
        <Select.Trigger class="w-full sm:w-72" aria-label={m['settings.canvas_edges']()}>
          {edgeRenderingLabel(settings.canvasEdgeRendering ?? 'auto')}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="auto">{m['settings.canvas_edges_auto']()}</Select.Item>
          <Select.Item value="elastic">{m['settings.canvas_edges_elastic']()}</Select.Item>
          <Select.Item value="static">{m['settings.canvas_edges_static']()}</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
    <div class="mb-5 grid gap-2 border-b border-[var(--app-border)] pb-5">
      <span class="field-label">{m['settings.workbench_tabs']()}</span>
      <p class="field-hint">{m['settings.workbench_tabs_desc']()}</p>
      <Select.Root
        type="single"
        value={settings.workbenchTabPlacement ?? 'vertical'}
        onValueChange={(value: string) => (settings = { ...settings, workbenchTabPlacement: value })}
      >
        <Select.Trigger class="w-full sm:w-72" aria-label={m['settings.workbench_tabs']()}>
          {(settings.workbenchTabPlacement ?? 'vertical') === 'horizontal'
            ? m['settings.workbench_tabs_horizontal']()
            : m['settings.workbench_tabs_vertical']()}
        </Select.Trigger>
        <Select.Content>
          <Select.Item value="vertical">{m['settings.workbench_tabs_vertical']()}</Select.Item>
          <Select.Item value="horizontal">{m['settings.workbench_tabs_horizontal']()}</Select.Item>
        </Select.Content>
      </Select.Root>
    </div>
    <div class="mb-5 grid gap-4 border-b border-[var(--app-border)] pb-5">
      <div>
        <span class="field-label">{m['settings.workbench_editor']()}</span>
        <p class="field-hint">{m['settings.workbench_editor_desc']()}</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        <label class="flex min-h-11 items-center justify-between gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-3">
          <span class="text-xs text-[var(--app-text-soft)]">{m['settings.editor_minimap']()}</span>
          <Switch checked={settings.editorMinimap !== 'false'} onCheckedChange={(checked: boolean) => (settings = { ...settings, editorMinimap: String(checked) })} />
        </label>
        <label class="flex min-h-11 items-center justify-between gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-3">
          <span class="text-xs text-[var(--app-text-soft)]">{m['settings.editor_word_wrap']()}</span>
          <Switch checked={settings.editorWordWrap === 'true'} onCheckedChange={(checked: boolean) => (settings = { ...settings, editorWordWrap: String(checked) })} />
        </label>
        <label class="flex min-h-11 items-center justify-between gap-3 rounded-[6px] border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-3">
          <span class="text-xs text-[var(--app-text-soft)]">{m['settings.editor_autosave']()}</span>
          <Switch checked={settings.editorAutoSave === 'true'} onCheckedChange={(checked: boolean) => (settings = { ...settings, editorAutoSave: String(checked) })} />
        </label>
      </div>
      <label class="field max-w-40">
        <span class="field-label">{m['settings.editor_font_size']()}</span>
        <Input type="number" min="9" max="24" bind:value={settings.editorFontSize} />
      </label>
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

    <div class="flex min-h-11 items-center justify-between gap-4 border-t border-[var(--line)] pt-3.5">
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
            <Select.Item value="pt-BR-f1">{m['settings.tts_voice_pt_br']()}</Select.Item>
            <Select.Item value="en-US-m2">{m['settings.tts_voice_en_us']()}</Select.Item>
            <Select.Item value="es-MX-f3">{m['settings.tts_voice_es_mx']()}</Select.Item>
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
    background: var(--page);
    color: var(--copy);
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
    background: color-mix(in srgb, var(--page) 92%, transparent);
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
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface-raised);
    color: var(--app-accent);
    flex-shrink: 0;
  }

  .section-titles h2 {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: 0;
    margin: 0;
    color: var(--copy);
  }

  .section-titles p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--copy-muted);
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
    border: 1px solid var(--line);
    background: var(--surface-subtle);
  }

  .preset-icon {
    flex-shrink: 0;
  }

  .preset-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--copy);
  }

  .preset-meta {
    flex: 1;
    font-size: 11px;
    color: var(--copy-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preset-rename {
    font-size: 12.5px;
    background: var(--surface-raised);
    border: 1px solid var(--line-strong);
    border-radius: 6px;
    color: var(--copy);
    padding: 3px 8px;
    outline: none;
  }

  .preset-action {
    display: inline-flex;
    padding: 4px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: var(--copy-muted);
    cursor: pointer;
  }

  .preset-action:hover {
    color: var(--copy);
    background: var(--surface-raised);
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
    font-size: 12px;
    font-weight: 500;
    color: var(--copy-soft);
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
    border: 1px solid var(--line);
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
    color: var(--copy);
  }

  .speed-control {
    gap: 10px;
  }

  .speed-control > span {
    width: 40px;
    flex: 0 0 40px;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--copy-muted);
  }

  .speed-control > span:last-child {
    text-align: right;
  }

  .field-hint {
    margin: 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--copy-muted);
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
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  :global(.hotkey-capture.capturing) {
    border-color: var(--violet);
    color: var(--violet);
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
    border-block: 1px solid var(--line);
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
    color: var(--copy);
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
    background: var(--surface-raised);
    border: 1px solid var(--line-strong);
    border-bottom-width: 2px;
    border-radius: 6px;
    padding: 3px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    color: var(--copy-soft);
  }

  .shortcut-desc {
    font-size: 12px;
    color: var(--copy-soft);
    text-wrap: pretty;
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-section,
    :global(.save-btn) {
      transition: none;
    }
  }
</style>
