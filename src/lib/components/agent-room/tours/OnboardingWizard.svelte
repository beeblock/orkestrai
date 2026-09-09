<script lang="ts">
  import { untrack } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as m from '$lib/paraglide/messages.js';
  import {
    Activity, ArrowLeft, BookMarked, Cable, FileCode2, FolderPlus, GitBranch, GitPullRequestArrow, GlobeLock, Languages, Layers, LayoutGrid, LayoutTemplate, ListRestart, MessageCircleMore, Mic, MonitorCog, Palette, PanelLeftOpen, Paperclip, Pin, RadioTower, Repeat, Rocket, Scale, ScanSearch, Search, Smartphone, Sparkles, Users, Workflow,
  } from '@lucide/svelte';
  import { toursCatalog, startTour } from './engine.svelte.js';
  import type { Tour } from './types.js';
  import { getAppSettings, invalidateAppSettings } from '$lib/components/agent-room/app-settings.svelte.js';
  import { localeState } from '$lib/i18n/locale.svelte.js';

  type Workspace = { id: string; name: string };

  type Props = {
    open: boolean;
    onClose: () => void;
    /** Cria o workspace e devolve o criado (pagina seleciona ele). */
    onCreateWorkspace: (input: { name: string; workingDir: string }) => Promise<Workspace | null>;
    /** Workspace ativo para iniciar o tour (se ja existir um). */
    activeWorkspaceId: string | null;
    /** Abre o catalogo com um tour especifico ja selecionado (link da documentacao). */
    requestedTourId?: string | null;
  };

  let { open, onClose, onCreateWorkspace, activeWorkspaceId, requestedTourId = null }: Props = $props();

  const ICONS: Record<string, typeof Users> = { Users, Repeat, GitBranch, GitPullRequestArrow, GlobeLock, Workflow, Search, FolderPlus, Cable, Rocket, Layers, LayoutGrid, LayoutTemplate, ListRestart, Palette, PanelLeftOpen, FileCode2, Paperclip, Pin, RadioTower, Mic, MessageCircleMore, Languages, Activity, Scale, ScanSearch, Smartphone, MonitorCog, BookMarked };

  type WizardStep = 'language' | 'welcome' | 'workspace' | 'usecase';
  type UiLanguage = 'pt-BR' | 'en' | 'es';

  let step = $state<WizardStep>('language');
  let name = $state('');
  let workingDir = $state('');
  let creating = $state(false);
  let createError = $state('');
  let workspaceId = $state<string | null>(null);
  let pickedTour = $state<Tour | null>(null);
  let languageSaving = $state<UiLanguage | null>(null);
  let tourQuery = $state('');
  let wasOpen = false;

  const desktop =
    typeof window !== 'undefined'
      ? (window as unknown as { orkestraiDesktop?: { pickDirectory: () => Promise<string | null> } }).orkestraiDesktop
      : undefined;

  $effect(() => {
    if (open && !wasOpen) {
      // A troca de idioma remonta toda a arvore. A etapa persistida impede que
      // o wizard volte ao seletor logo depois de salvar a preferencia.
      let savedStep: WizardStep = 'language';
      try {
        if (sessionStorage.getItem('orkestrai.onboarding-step') === 'welcome') savedStep = 'welcome';
      } catch {
        // storage indisponivel: recomeca pela escolha de idioma
      }
      step = savedStep;
      workspaceId = untrack(() => activeWorkspaceId);
      createError = '';
      pickedTour = requestedTourId ? toursCatalog().find((tour) => tour.id === requestedTourId) ?? null : null;
      tourQuery = '';
      languageSaving = null;
    }
    wasOpen = open;
  });

  async function chooseLanguage(language: UiLanguage) {
    if (languageSaving) return;
    const changesLocale = localeState.current !== language;
    languageSaving = language;
    try {
      // Grave o proximo passo antes do PUT: getAppSettings troca o locale e
      // remonta este componente assim que a resposta chega.
      sessionStorage.setItem('orkestrai.onboarding-step', 'welcome');
      const csrf = getCsrfToken();
      const response = await fetch('/api/agent-room/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
        },
        body: JSON.stringify({ uiLanguage: language }),
      });
      if (!response.ok) throw new Error('language_save_failed');
      invalidateAppSettings();
      // O portal do Dialog e desmontado com a arvore de locale. Um reload
      // reabre o wizard a partir das flags gravadas acima, sem perder o workspace.
      if (changesLocale) {
        location.reload();
        return;
      }
      await getAppSettings(true);
      step = 'welcome';
    } catch {
      try { sessionStorage.removeItem('orkestrai.onboarding-step'); } catch {}
      toast.error(m['onboarding.language_error']());
      languageSaving = null;
    }
  }

  async function pickDirectory() {
    if (!desktop) return;
    const dir = await desktop.pickDirectory();
    if (dir) workingDir = dir;
  }

  async function createWorkspace() {
    if (!name.trim() || !workingDir.trim()) return;
    creating = true;
    createError = '';
    const created = await onCreateWorkspace({ name: name.trim(), workingDir: workingDir.trim() });
    creating = false;
    if (!created) {
      createError = m['onboarding.create_error']();
      return;
    }
    workspaceId = created.id;
    step = 'usecase';
  }

  async function begin(tour: Tour) {
    if (!workspaceId) return;
    await startTour(tour.id, workspaceId);
    onClose();
  }

  const tours = $derived(toursCatalog());
  const filteredTours = $derived.by(() => {
    const term = tourQuery.trim().toLocaleLowerCase();
    if (!term) return tours;
    return tours.filter((tour) => `${tour.title} ${tour.tagline}`.toLocaleLowerCase().includes(term));
  });
</script>

<Dialog.Root {open} onOpenChange={(isOpen) => !isOpen && !languageSaving && onClose()}>
  <Dialog.Content class="{step === 'usecase' ? 'sm:max-w-3xl' : 'sm:max-w-2xl'} wizard-content">
    {#if step === 'language'}
      <div class="wizard-center">
        <span class="wizard-icon"><Languages size={26} /></span>
        <h2 class="wizard-title">{m['onboarding.language_title']()}</h2>
        <p class="wizard-sub">{m['onboarding.language_body']()}</p>
        <div class="language-grid" aria-busy={languageSaving !== null}>
          <button class="language-option" disabled={languageSaving !== null} onclick={() => chooseLanguage('en')}>
            <span class="language-code">EN</span>
            <span>{m['language.name_en']()}</span>
          </button>
          <button class="language-option" disabled={languageSaving !== null} onclick={() => chooseLanguage('pt-BR')}>
            <span class="language-code">PT</span>
            <span>{m['language.name_pt_br']()}</span>
          </button>
          <button class="language-option" disabled={languageSaving !== null} onclick={() => chooseLanguage('es')}>
            <span class="language-code">ES</span>
            <span>{m['language.name_es']()}</span>
          </button>
        </div>
        {#if languageSaving}<p class="language-saving">{m['onboarding.language_saving']()}</p>{/if}
      </div>
    {:else if step === 'welcome'}
      <div class="wizard-center">
        <span class="wizard-icon"><Sparkles size={26} /></span>
        <h2 class="wizard-title">{m['onboarding.welcome_title']()}</h2>
        <p class="wizard-sub">{m['onboarding.welcome_body']()}</p>
        <div class="wizard-actions">
          <Button onclick={() => (step = 'workspace')}>{m['onboarding.ws_create']()}</Button>
          {#if activeWorkspaceId}
            <Button variant="ghost" onclick={() => (step = 'usecase')}>{m['onboarding.ws_skip']()}</Button>
          {/if}
        </div>
      </div>
    {:else if step === 'workspace'}
      <Dialog.Header>
        <Dialog.Title>{m['onboarding.ws_title']()}</Dialog.Title>
        <Dialog.Description>{m['onboarding.ws_body']()}</Dialog.Description>
      </Dialog.Header>
      <div class="wizard-form">
        <div class="field">
          <span class="field-label">{m['onboarding.ws_name']()}</span>
          <Input bind:value={name} placeholder={m['ph.onboarding_name']()} />
        </div>
        <div class="field">
          <span class="field-label">{m['onboarding.ws_dir']()}</span>
          <div class="dir-row">
            <Input bind:value={workingDir} placeholder={m['ph.onboarding_dir']()} class="flex-1" />
            {#if desktop}
              <Button variant="outline" size="sm" onclick={pickDirectory}>
                <FolderPlus size={14} aria-hidden="true" />
              </Button>
            {/if}
          </div>
        </div>
        {#if createError}<p class="wizard-error">{createError}</p>{/if}
      </div>
      <Dialog.Footer>
        <Button variant="ghost" onclick={() => (step = 'welcome')}>{m['onboarding.back']()}</Button>
        {#if activeWorkspaceId}
          <Button variant="ghost" onclick={() => { workspaceId = activeWorkspaceId; step = 'usecase'; }}>
            {m['onboarding.use_current_ws']()}
          </Button>
        {/if}
        <Button disabled={creating || !name.trim() || !workingDir.trim()} onclick={createWorkspace}>
          {creating ? '...' : m['onboarding.ws_create']()}
        </Button>
      </Dialog.Footer>
    {:else}
      <Dialog.Header>
        <Dialog.Title>{m['onboarding.pick_title']()}</Dialog.Title>
        <Dialog.Description>{m['onboarding.pick_body']()}</Dialog.Description>
      </Dialog.Header>
      <label class="tour-search">
        <Search size={14} aria-hidden="true" />
        <Input bind:value={tourQuery} name="tour-search" autocomplete="off" placeholder={m['onboarding.search_tours']()} aria-label={m['onboarding.search_tours']()} />
      </label>
      <div class="tour-grid">
        {#each filteredTours as tour (tour.id)}
          {@const Icon = ICONS[tour.icon] ?? Sparkles}
          <button
            class="tour-card"
            class:picked={pickedTour?.id === tour.id}
            onclick={() => (pickedTour = tour)}
            ondblclick={() => begin(tour)}
          >
            <span class="tour-card-icon"><Icon size={15} aria-hidden="true" /></span>
            <span class="tour-card-text">
              <span class="tour-card-title">{tour.title}</span>
              <span class="tour-card-tagline">{tour.tagline}</span>
            </span>
          </button>
        {:else}
          <p class="tour-empty">{m['onboarding.no_tours']({ query: tourQuery.trim() })}</p>
        {/each}
      </div>
      <Dialog.Footer>
        <Button variant="ghost" onclick={onClose}>{m['onboarding.later']()}</Button>
        <Button disabled={!pickedTour || !workspaceId} onclick={() => pickedTour && begin(pickedTour)}>
          {m['onboarding.start']()}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .wizard-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 20px 8px;
    text-align: center;
  }

  .wizard-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 14px;
    background: color-mix(in srgb, var(--app-secondary) 14%, transparent);
    color: var(--app-secondary);
  }

  .wizard-title {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 19px;
    font-weight: 600;
    margin: 0;
  }

  .wizard-sub {
    margin: 0;
    font-size: 13px;
    line-height: 1.65;
    color: var(--app-text-soft);
    max-width: 420px;
    text-wrap: pretty;
  }

  .wizard-actions {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }

  .language-grid {
    width: min(100%, 460px);
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin-top: 6px;
  }

  .language-option {
    min-height: 92px;
    padding: 12px 8px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 9px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-subtle);
    color: var(--app-text);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
  }

  .language-option:hover:not(:disabled) {
    border-color: var(--app-accent);
    background: var(--app-accent-soft);
    transform: translateY(-1px);
  }

  .language-option:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .language-option:disabled { opacity: 0.55; cursor: wait; }
  .language-code { color: var(--app-accent); font-size: 17px; font-weight: 700; }
  .language-saving { min-height: 18px; margin: 0; color: var(--app-text-muted); font-size: 11px; }

  .wizard-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--app-text-soft);
  }

  .dir-row {
    display: flex;
    gap: 8px;
  }

  .wizard-error {
    margin: 0;
    font-size: 12px;
    color: var(--app-danger);
  }

  .tour-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
    max-height: 46vh;
    overflow-y: auto;
    /* Espaco para o anel de foco/selecao respirar — com 2px ele era cortado
       pelo overflow nas bordas do grid. */
    padding: 6px;
    /* Fade sutil no rodape para o corte do scroll nao parecer erro. */
    mask-image: linear-gradient(to bottom, black calc(100% - 28px), transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black calc(100% - 28px), transparent 100%);
  }

  .tour-search {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text-muted);
  }

  .tour-search :global(input) {
    flex: 1;
  }

  .tour-empty {
    grid-column: 1 / -1;
    margin: 0;
    padding: 28px 16px;
    text-align: center;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .tour-card {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
  }

  .tour-card:hover {
    background: var(--app-surface-raised);
    transform: translateY(-1px);
  }

  /* Anel de foco customizado: fica dentro do respiro do grid, nunca corta. */
  .tour-card:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .tour-card.picked {
    border-color: var(--app-accent);
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 30%, transparent);
  }

  .tour-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--app-secondary) 14%, transparent);
    color: var(--app-secondary);
    flex-shrink: 0;
    margin-top: 1px;
  }

  .tour-card-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tour-card-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--app-text);
    text-wrap: balance;
  }

  .tour-card-tagline {
    font-size: 11px;
    color: var(--app-text-muted);
    line-height: 1.45;
    text-wrap: pretty;
  }

  @media (max-width: 560px) {
    .language-grid { grid-template-columns: 1fr; }
    .language-option { min-height: 58px; flex-direction: row; }
  }
</style>
