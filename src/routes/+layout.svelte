<script lang="ts">
  import '../app.css';
  import { Toaster, toast, Seo } from '@beeblock/svelar/ui';
  import { getCsrfToken, registerToast } from '@beeblock/svelar/http';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import UpdateNotifier from '$lib/components/agent-room/UpdateNotifier.svelte';
  import GlobalDictation from '$lib/components/agent-room/GlobalDictation.svelte';
  import DesktopTitlebar from '$lib/components/agent-room/DesktopTitlebar.svelte';
  import GlobalCommandPalette from '$lib/components/agent-room/GlobalCommandPalette.svelte';
  import TourGuidePanel from '$lib/components/agent-room/tours/TourGuidePanel.svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { initLocaleRuntime, localeState } from '$lib/i18n/locale.svelte.js';
  import { appSettingsStore } from '$lib/components/agent-room/app-settings.svelte.js';
  import { applyAppTheme } from '$lib/components/agent-room/app-themes.js';

  type DesktopMenuBridge = {
    platform?: string;
    setMenuLocale?: (locale: string) => Promise<string>;
    onMenuAction?: (callback: (action: string) => void) => () => void;
    setTitlebarTheme?: (theme: { background: string; foreground: string }) => Promise<boolean>;
  };

  const desktopMenu = typeof window !== 'undefined'
    ? (window as unknown as { orkestraiDesktop?: DesktopMenuBridge }).orkestraiDesktop
    : undefined;
  const windowsDesktop = desktopMenu?.platform === 'win32';

  $effect(() => {
    void desktopMenu?.setMenuLocale?.(localeState.current);
  });

  // Wire apiFetch error handling to the toast UI
  registerToast((variant: string, title: string, opts?: any) => {
    const fn = (toast as any)[variant] ?? toast;
    fn(title, opts);
  });

  let { children } = $props();
  let localeReady = $state(false);

  $effect(() => {
    const theme = applyAppTheme(appSettingsStore.values);
    void desktopMenu?.setTitlebarTheme?.({ background: theme.tokens.sidebar, foreground: theme.tokens.textSoft });
  });

  onMount(() => {
    // Nao libere interacao antes da preferencia inicial chegar: caso contrario
    // o remount de locale pode descartar um clique feito durante o startup.
    void initLocaleRuntime().finally(() => {
      applyAppTheme(appSettingsStore.values);
      localeReady = true;
    });
    const canvasActions = new Set(['new-workspace', 'presets', 'organize', 'floors', 'roles', 'usage', 'ports']);
    const unsubscribeMenu = desktopMenu?.onMenuAction?.((action) => {
      if (action === 'canvas') void goto('/canvas');
      else if (action === 'terminals') void goto('/terminal');
      else if (action === 'providers') void goto('/providers');
      else if (action === 'remote') void goto('/remote');
      else if (action === 'settings') void goto('/settings');
      else if (action === 'docs') void goto('/docs');
      else if (action === 'changelog') void goto('/docs#changelog');
      else if (action === 'command-palette') window.dispatchEvent(new CustomEvent('orkestrai:global-search'));
      else if (canvasActions.has(action)) {
        if (location.pathname !== '/canvas') {
          sessionStorage.setItem('orkestrai.menu-action', action);
          void goto('/canvas');
        } else {
          window.dispatchEvent(new CustomEvent('orkestrai:menu-action', { detail: action }));
        }
      }
    });

    const syncCsrfToken = (event: SubmitEvent) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.method || 'GET').toUpperCase() !== 'POST') return;

      const token = getCsrfToken();
      if (!token) return;

      let field = form.querySelector<HTMLInputElement>('input[name="_csrf"]');
      if (!field) {
        field = document.createElement('input');
        field.type = 'hidden';
        field.name = '_csrf';
        form.prepend(field);
      }
      field.value = token;
    };

    document.addEventListener('submit', syncCsrfToken, true);
    return () => {
      unsubscribeMenu?.();
      document.removeEventListener('submit', syncCsrfToken, true);
    };
  });
</script>

<!-- Site-wide SEO defaults — override per page with another <Seo> -->
<Seo
  title="Orkestrai Agent Room"
  description={m['app.seo_description']()}
  ogSiteName="Orkestrai Agent Room"
  ogType="website"
/>

<!-- Tooltip.Provider global: qualquer pagina pode usar Tooltip shadcn -->
<Tooltip.Provider>
  <!-- #key no locale: ao trocar de idioma, a arvore inteira remonta e todo
       m.*() reavalia — i18n reativo garantido por construcao. -->
  {#if localeReady}
    {#key localeState.current}
      {#if windowsDesktop}<DesktopTitlebar />{/if}
      <div class="app-content" class:desktop-content={windowsDesktop}>
        {@render children()}
      </div>
      <GlobalDictation />
      <GlobalCommandPalette />
      <TourGuidePanel />
    {/key}
  {/if}
</Tooltip.Provider>

<Toaster
  position="bottom-right"
  class="orkestrai-toaster"
  variants={{
    success: { iconClass: 'text-[var(--app-success)] bg-[var(--app-success-soft)] ring-transparent', borderClass: '', progressClass: 'bg-[var(--app-success)]' },
    error: { iconClass: 'text-[var(--app-danger)] bg-[var(--app-danger-soft)] ring-transparent', borderClass: '', progressClass: 'bg-[var(--app-danger)]' },
    warning: { iconClass: 'text-[var(--app-warning)] bg-[var(--app-warning-soft)] ring-transparent', borderClass: '', progressClass: 'bg-[var(--app-warning)]' },
    info: { iconClass: 'text-[var(--app-info)] bg-[var(--app-info-soft)] ring-transparent', borderClass: '', progressClass: 'bg-[var(--app-info)]' },
    default: { borderClass: '', progressClass: 'bg-[var(--app-text-muted)]' },
  }}
/>
<UpdateNotifier />

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: 'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .app-content {
    height: 100dvh;
    min-height: 0;
  }

  .app-content.desktop-content {
    height: calc(100dvh - 36px);
    border-top: 1px solid var(--app-border);
    overflow: auto;
  }
</style>
