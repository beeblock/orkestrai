<script lang="ts">
  import { Check, Copy, Download, Palette, Plus, Trash2, Upload } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as m from '$lib/paraglide/messages.js';
  import {
    APP_THEME_SETTING,
    APP_THEME_TOKEN_KEYS,
    CUSTOM_APP_THEMES_SETTING,
    allAppThemes,
    applyAppTheme,
    duplicateAppTheme,
    parseCustomAppThemes,
    resolveAppTheme,
    serializeCustomAppThemes,
    type AppTheme,
    type AppThemeToken,
    type CustomAppTheme,
  } from './app-themes.js';

  type Props = {
    settings: Record<string, string>;
    onChange: (settings: Record<string, string>) => void;
  };

  let { settings, onChange }: Props = $props();
  let importInput: HTMLInputElement;

  const themes = $derived(allAppThemes(settings));
  const activeTheme = $derived(resolveAppTheme(settings));
  const activeCustomTheme = $derived(activeTheme.builtin ? null : activeTheme as CustomAppTheme & { builtin: false });

  const TOKEN_LABELS: Record<AppThemeToken, () => string> = {
    page: () => m['theme.token_page'](),
    canvas: () => m['theme.token_canvas'](),
    sidebar: () => m['theme.token_sidebar'](),
    surface: () => m['theme.token_surface'](),
    surfaceRaised: () => m['theme.token_surface_raised'](),
    surfaceSubtle: () => m['theme.token_surface_subtle'](),
    text: () => m['theme.token_text'](),
    textSoft: () => m['theme.token_text_soft'](),
    textMuted: () => m['theme.token_text_muted'](),
    border: () => m['theme.token_border'](),
    borderStrong: () => m['theme.token_border_strong'](),
    accent: () => m['theme.token_accent'](),
    accentSoft: () => m['theme.token_accent_soft'](),
    accentContrast: () => m['theme.token_accent_contrast'](),
    secondary: () => m['theme.token_secondary'](),
    success: () => m['theme.token_success'](),
    warning: () => m['theme.token_warning'](),
    danger: () => m['theme.token_danger'](),
    grid: () => m['theme.token_grid'](),
    edge: () => m['theme.token_edge'](),
  };

  function updateSettings(partial: Record<string, string>) {
    const next = { ...settings, ...partial };
    onChange(next);
    applyAppTheme(next);
  }

  function selectTheme(id: string) {
    updateSettings({ [APP_THEME_SETTING]: id });
  }

  function customThemes(): CustomAppTheme[] {
    return parseCustomAppThemes(settings[CUSTOM_APP_THEMES_SETTING]);
  }

  function saveCustomTheme(theme: CustomAppTheme) {
    const next = customThemes().map((item) => item.id === theme.id ? theme : item);
    updateSettings({ [CUSTOM_APP_THEMES_SETTING]: serializeCustomAppThemes(next) });
  }

  function duplicateTheme(theme: AppTheme) {
    const copy = duplicateAppTheme(theme);
    copy.name = m['theme.copy_name']({ name: theme.name });
    const next = [...customThemes(), copy];
    updateSettings({
      [CUSTOM_APP_THEMES_SETTING]: serializeCustomAppThemes(next),
      [APP_THEME_SETTING]: copy.id,
    });
  }

  function commitThemeName(input: HTMLInputElement) {
    if (!activeCustomTheme) return;
    const name = input.value.trim().slice(0, 48);
    if (!name) {
      input.value = activeCustomTheme.name;
      return;
    }
    saveCustomTheme({ ...activeCustomTheme, name });
  }

  function updateThemeMode(dark: boolean) {
    if (!activeCustomTheme) return;
    saveCustomTheme({ ...activeCustomTheme, dark });
  }

  function updateToken(key: AppThemeToken, value: string) {
    if (!activeCustomTheme || !/^#[0-9a-f]{6}$/i.test(value)) return;
    saveCustomTheme({ ...activeCustomTheme, tokens: { ...activeCustomTheme.tokens, [key]: value } });
  }

  function commitToken(key: AppThemeToken, input: HTMLInputElement) {
    if (!activeCustomTheme) return;
    if (!/^#[0-9a-f]{6}$/i.test(input.value)) {
      input.value = activeCustomTheme.tokens[key];
      return;
    }
    updateToken(key, input.value);
  }

  function deleteTheme() {
    if (!activeCustomTheme) return;
    const next = customThemes().filter((theme) => theme.id !== activeCustomTheme.id);
    updateSettings({
      [CUSTOM_APP_THEMES_SETTING]: serializeCustomAppThemes(next),
      [APP_THEME_SETTING]: 'orkestrai-dark',
    });
  }

  function exportTheme() {
    const payload = JSON.stringify({ schemaVersion: 1, theme: { ...activeTheme, builtin: undefined } }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeTheme.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'orkestrai-theme'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importTheme(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed?.theme ?? parsed;
      const candidate = {
        ...source,
        id: `custom-${crypto.randomUUID()}`,
        name: String(source?.name ?? file.name.replace(/\.json$/i, '')).slice(0, 48),
      };
      const imported = parseCustomAppThemes([candidate])[0];
      if (!imported) throw new Error('invalid_theme');
      updateSettings({
        [CUSTOM_APP_THEMES_SETTING]: serializeCustomAppThemes([...customThemes(), imported]),
        [APP_THEME_SETTING]: imported.id,
      });
      toast.success(m['theme.imported']());
    } catch {
      toast.error(m['theme.import_failed']());
    }
  }
</script>

<section class="theme-settings">
  <header class="theme-heading">
    <div class="min-w-0">
      <h3>{m['theme.choose']()}</h3>
      <p>{m['theme.choose_desc']()}</p>
    </div>
    <div class="theme-actions">
      <Button variant="outline" size="sm" onclick={() => duplicateTheme(activeTheme)}>
        <Copy size={14} aria-hidden="true" />
        {m['theme.duplicate']()}
      </Button>
      <Button variant="outline" size="sm" onclick={() => importInput.click()}>
        <Upload size={14} aria-hidden="true" />
        {m['theme.import']()}
      </Button>
      <Button variant="outline" size="icon-sm" title={m['theme.export']()} aria-label={m['theme.export']()} onclick={exportTheme}>
        <Download size={14} aria-hidden="true" />
      </Button>
      <input bind:this={importInput} class="hidden-input" type="file" accept="application/json,.json" onchange={importTheme} />
    </div>
  </header>

  <!-- Cada tema e uma miniatura do app: escolher e ver ao mesmo tempo. -->
  <div class="theme-list">
    {#each themes as theme (theme.id)}
      <button
        type="button"
        class="theme-option"
        class:active={theme.id === activeTheme.id}
        aria-pressed={theme.id === activeTheme.id}
        onclick={() => selectTheme(theme.id)}
      >
        <span class="theme-preview" style:background={theme.tokens.canvas} aria-hidden="true">
          <span class="tp-sidebar" style:background={theme.tokens.sidebar}></span>
          <span class="tp-card" style:background={theme.tokens.surface} style:box-shadow={`0 0 0 1px ${theme.tokens.border}`}>
            <span class="tp-line" style:background={theme.tokens.text}></span>
            <span class="tp-line short" style:background={theme.tokens.textMuted}></span>
            <span class="tp-button" style:background={theme.tokens.accent}></span>
          </span>
        </span>
        <span class="theme-option-copy">
          <strong title={theme.name}>{theme.name}</strong>
          <small>{theme.dark ? m['theme.dark']() : m['theme.light']()}{theme.builtin ? '' : ` · ${m['theme.custom']()}`}</small>
        </span>
        {#if theme.id === activeTheme.id}<span class="theme-check" aria-hidden="true"><Check size={12} /></span>{/if}
      </button>
    {/each}
  </div>

  {#if activeCustomTheme}
    <div class="custom-editor">
      <header class="editor-head">
        <div class="editor-title">
          <Palette size={14} aria-hidden="true" />
          <strong>{m['theme.editor']()}</strong>
        </div>
        <Button variant="ghost" size="icon-sm" class="danger-action" title={m['theme.delete']()} aria-label={m['theme.delete']()} onclick={deleteTheme}>
          <Trash2 size={14} aria-hidden="true" />
        </Button>
      </header>

      <div class="editor-meta">
        <label>
          <span>{m['theme.name']()}</span>
          <Input name="theme-name" autocomplete="off" value={activeCustomTheme.name} maxlength={48} onchange={(event: Event) => commitThemeName(event.currentTarget as HTMLInputElement)} />
        </label>
        <label class="mode-toggle">
          <span>{m['theme.dark_mode']()}</span>
          <Switch checked={activeCustomTheme.dark} onCheckedChange={(dark: boolean) => updateThemeMode(dark)} />
        </label>
      </div>

      <div class="token-grid">
        {#each APP_THEME_TOKEN_KEYS as key (key)}
          <div class="token-field">
            <span class="token-label">{TOKEN_LABELS[key]()}</span>
            <span class="color-control">
              <!-- Amostra clicavel: abre o seletor nativo do sistema. -->
              <span class="swatch" style:background={activeCustomTheme.tokens[key]}>
                <input
                  type="color"
                  value={activeCustomTheme.tokens[key]}
                  aria-label={TOKEN_LABELS[key]()}
                  oninput={(event) => updateToken(key, event.currentTarget.value)}
                />
              </span>
              <input
                class="hex-input"
                value={activeCustomTheme.tokens[key]}
                maxlength={7}
                spellcheck="false"
                autocomplete="off"
                aria-label={`${TOKEN_LABELS[key]()} HEX`}
                onblur={(event) => commitToken(key, event.currentTarget)}
                onkeydown={(event) => {
                  if (event.key !== 'Enter') return;
                  commitToken(key, event.currentTarget);
                  event.currentTarget.blur();
                }}
              />
            </span>
          </div>
        {/each}
      </div>
      <p class="editor-hint"><Plus size={12} aria-hidden="true" /> {m['theme.editor_hint']()}</p>
    </div>
  {:else}
    <p class="builtin-hint">{m['theme.builtin_hint']()}</p>
  {/if}
</section>

<style>
  .theme-settings,
  .custom-editor {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .theme-heading,
  .editor-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .theme-heading h3 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 500;
    color: var(--app-text);
  }

  .theme-heading p,
  .builtin-hint,
  .editor-hint {
    margin: 3px 0 0;
    font-size: 11.5px;
    line-height: 1.6;
    color: var(--app-text-muted);
    text-wrap: pretty;
  }

  .theme-actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .hidden-input {
    display: none;
  }

  .theme-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 10px;
  }

  /* Cartao 12px com miniatura 6px e respiro de 6px (raio concentrico). */
  .theme-option {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 8px;
    padding: 6px 6px 8px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-soft);
    text-align: left;
    cursor: pointer;
    transition:
      box-shadow var(--duration-quick) ease-out,
      background-color var(--duration-quick) ease-out,
      color var(--duration-quick) ease-out;
  }

  .theme-option:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .theme-option.active {
    box-shadow: 0 0 0 2px var(--app-accent);
    color: var(--app-text);
  }

  .theme-option:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .theme-option:active {
    scale: 0.98;
  }

  .theme-preview {
    position: relative;
    display: flex;
    height: 64px;
    gap: 6px;
    padding: 8px;
    overflow: hidden;
    border-radius: 6px;
    outline: 1px solid oklch(0.5 0 0 / 0.18);
    outline-offset: -1px;
  }

  .tp-sidebar {
    width: 18%;
    border-radius: 3px;
  }

  .tp-card {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 5px;
    padding: 7px 8px;
    border-radius: 4px;
  }

  .tp-line {
    height: 4px;
    width: 70%;
    border-radius: 999px;
  }

  .tp-line.short {
    width: 45%;
    opacity: 0.8;
  }

  .tp-button {
    width: 28px;
    height: 8px;
    margin-top: auto;
    border-radius: 3px;
  }

  .theme-option-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 1px;
    padding: 0 4px;
  }

  .theme-option-copy strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
    font-weight: 500;
  }

  .theme-option-copy small {
    font-size: 11px;
    color: var(--app-text-muted);
  }

  .theme-check {
    position: absolute;
    top: 12px;
    right: 12px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    box-shadow: 0 1px 3px rgb(0 0 0 / 0.25);
  }

  .custom-editor {
    padding-top: 14px;
    border-top: 1px solid var(--app-border);
  }

  .editor-head {
    align-items: center;
  }

  .editor-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12.5px;
    color: var(--app-text);
  }

  .editor-title strong {
    font-weight: 500;
  }

  :global(.danger-action:hover) {
    color: var(--app-danger);
  }

  .editor-meta {
    display: flex;
    align-items: end;
    gap: 18px;
  }

  .editor-meta > label:not(.mode-toggle) {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
  }

  .editor-meta label > span,
  .token-label {
    font-size: 11.5px;
    font-weight: 500;
    color: var(--app-text-soft);
  }

  .mode-toggle {
    display: flex;
    align-items: center;
    gap: 9px;
    min-height: 32px;
    cursor: pointer;
  }

  .token-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(168px, 1fr));
    gap: 10px 14px;
  }

  .token-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 5px;
  }

  .color-control {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  /* Amostra redonda com o input nativo invisivel por cima (clique abre o seletor). */
  .swatch {
    position: relative;
    flex: 0 0 28px;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    box-shadow: inset 0 0 0 1px oklch(0.5 0 0 / 0.25);
    transition: scale var(--duration-quick) ease-out;
  }

  .swatch:hover {
    scale: 1.06;
  }

  .swatch:has(input:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .hex-input {
    width: 100%;
    min-width: 0;
    height: 28px;
    border: 0;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text);
    padding: 0 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-transform: uppercase;
    transition: background-color var(--duration-quick) ease-out;
  }

  .hex-input:hover {
    background: var(--app-active);
  }

  .hex-input:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .editor-hint {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  @media (max-width: 640px) {
    .theme-heading,
    .editor-meta {
      align-items: stretch;
      flex-direction: column;
    }

    .theme-actions {
      justify-content: flex-start;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .theme-option,
    .swatch {
      transition: none;
    }
  }
</style>
