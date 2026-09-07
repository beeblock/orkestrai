<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Activity,
    ArrowLeft,
    BrainCircuit,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    CircleAlert,
    Copy,
    ExternalLink,
    MessageSquareText,
    MonitorCog,
    Pencil,
    Plus,
    RefreshCw,
    ShieldCheck,
    SquareTerminal,
    Trash2,
    UserRound,
  } from '@lucide/svelte';
  import { toast } from '@beeblock/svelar/ui';
  import { Button } from '$lib/components/ui/button';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { AgentProviderInfo, ProviderProfile } from '$lib/modules/agent-room/domain/types.js';
  import { providerIcons } from '$lib/modules/agent-room/domain/provider-icons.js';
  import { PROVIDER_STATUS_SOURCES } from '$lib/modules/agent-room/application/services/ProviderStatusService.js';
  import { getProviderStatus, providerStatusStore } from '$lib/components/agent-room/provider-status.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  type Filter = 'all' | 'ready' | 'setup';
  type Platform = 'darwin' | 'windows' | 'linux';

  let providers = $state<AgentProviderInfo[]>([]);
  let loading = $state(true);
  let refreshing = $state(false);
  let filter = $state<Filter>('all');
  let expandedProvider = $state<string | null>(null);
  let platform = $state<Platform>('linux');

  let profiles = $state<Record<string, ProviderProfile[]>>({});
  let profileFormOpen = $state<string | null>(null);
  let profileEditingId = $state<string | null>(null);
  let profileFormName = $state('');
  let profileFormConfigDir = $state('');
  let profileFormDataDir = $state('');
  let profileFormToken = $state('');
  let profileFormError = $state('');
  let profileFormBusy = $state(false);
  let deletingProfile = $state<{ providerId: string; profile: ProviderProfile } | null>(null);

  const readyCount = $derived(providers.filter((provider) => provider.installed).length);
  const visibleProviders = $derived(
    providers.filter((provider) =>
      filter === 'all' ? true : filter === 'ready' ? provider.installed : !provider.installed
    )
  );

  onMount(async () => {
    const userAgent = navigator.userAgent.toLowerCase();
    platform = userAgent.includes('mac')
      ? 'darwin'
      : userAgent.includes('win')
        ? 'windows'
        : 'linux';
    await Promise.all([
      loadProviders(),
      ...Object.keys(PROVIDER_STATUS_SOURCES).map((providerId) => getProviderStatus(providerId)),
    ]);
  });

  function statusLabel(indicator: string, checked: boolean): string {
    if (!checked) return m['providers.status_unavailable']();
    if (indicator === 'critical') return m['providers.status_critical']();
    if (indicator === 'major') return m['providers.status_major']();
    if (indicator === 'minor') return m['providers.status_minor']();
    return m['providers.status_operational']();
  }

  function profileErrorText(code: unknown, fallback: string): string {
    if (code === 'profile_unknown_provider') return m['providers.profile_error_unknown_provider']();
    if (code === 'profile_not_found') return m['providers.profile_error_not_found']();
    if (code === 'profile_unsupported') return m['providers.profile_error_unsupported']();
    if (code === 'profile_name_required') return m['providers.profile_error_name_required']();
    if (code === 'profile_duplicate') return m['providers.profile_error_duplicate']();
    if (code === 'profile_config_required') return m['providers.profile_error_config_required']();
    if (code === 'profile_directories_required') return m['providers.profile_error_directories_required']();
    if (code === 'profile_token_required') return m['providers.profile_error_token_required']();
    if (code === 'profile_in_use') return m['providers.profile_error_in_use']();
    return fallback;
  }

  async function loadProviders(refresh = false) {
    if (refresh) refreshing = true;
    try {
      const response = await fetch('/api/agent-room/status', { cache: 'no-store' });
      const payload = await response.json();
      providers = payload.data?.providers ?? [];
    } catch {
      providers = [];
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function platformName(): string {
    if (platform === 'darwin') return m['providers.platform_mac']();
    if (platform === 'windows') return m['providers.platform_windows']();
    return m['providers.platform_linux']();
  }

  function installCommand(provider: AgentProviderInfo): string | null {
    return provider.setup?.installCommands?.[platform] ?? null;
  }

  function versionLabel(provider: AgentProviderInfo): string | null {
    if (!provider.installed || !provider.detail) return null;
    const firstLine = provider.detail.split(/\r?\n/).find((line) => line.trim())?.trim();
    return firstLine ? firstLine.slice(0, 100) : null;
  }

  async function copyCommand(command: string) {
    await navigator.clipboard.writeText(command);
    toast.success(m['providers.copied']());
  }

  async function loadProfiles(providerId: string) {
    try {
      const response = await fetch(`/api/agent-room/provider-profiles?providerId=${encodeURIComponent(providerId)}`);
      const payload = await response.json();
      profiles = { ...profiles, [providerId]: payload.data ?? [] };
    } catch {
      profiles = { ...profiles, [providerId]: [] };
    }
  }

  function openProfileForm(providerId: string, profile: ProviderProfile | null = null) {
    profileFormOpen = providerId;
    profileEditingId = profile?.id ?? null;
    profileFormName = profile?.name ?? '';
    profileFormConfigDir = profile?.configDir ?? '';
    profileFormDataDir = profile?.dataDir ?? '';
    profileFormToken = '';
    profileFormError = '';
  }

  function closeProfileForm() {
    profileFormOpen = null;
    profileEditingId = null;
    profileFormName = '';
    profileFormConfigDir = '';
    profileFormDataDir = '';
    // Do not retain a credential in renderer memory after submit/cancel.
    profileFormToken = '';
    profileFormError = '';
  }

  async function saveProfile(provider: AgentProviderInfo) {
    if (profileFormBusy) return;
    profileFormBusy = true;
    profileFormError = '';
    try {
      const strategy = provider.profileStrategy;
      const response = await fetch(profileEditingId
        ? `/api/agent-room/provider-profiles/${profileEditingId}`
        : '/api/agent-room/provider-profiles', {
        method: profileEditingId ? 'PATCH' : 'POST',
        headers: {
          'content-type': 'application/json',
          ...(getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {}),
        },
        body: JSON.stringify({
          providerId: provider.id,
          name: profileFormName,
          ...(strategy?.kind === 'configDir' || strategy?.kind === 'configDirPair' ? { configDir: profileFormConfigDir } : {}),
          ...(strategy?.kind === 'configDirPair' ? { dataDir: profileFormDataDir } : {}),
          ...(strategy?.kind === 'token' ? { token: profileFormToken } : {}),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(profileErrorText(payload.error, m['providers.profile_save_error']()));
      closeProfileForm();
      await loadProfiles(provider.id);
      toast.success(m['providers.profile_saved']());
    } catch (error) {
      profileFormError = error instanceof Error ? error.message : m['providers.profile_save_error']();
    } finally {
      profileFormBusy = false;
    }
  }

  async function deleteProfile() {
    if (!deletingProfile) return;
    const { providerId, profile } = deletingProfile;
    try {
      const response = await fetch(`/api/agent-room/provider-profiles/${profile.id}`, {
        method: 'DELETE',
        headers: getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken()! } : {},
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(profileErrorText(payload.error, m['providers.profile_delete_error']()));
      deletingProfile = null;
      await loadProfiles(providerId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : m['providers.profile_delete_error']());
    }
  }
</script>

<svelte:head>
  <title>Orkestrai — {m['providers.title']()}</title>
</svelte:head>

<main class="providers-page">
  <header class="page-header">
    <Button variant="ghost" size="sm" href="/canvas">
      <ArrowLeft size={15} aria-hidden="true" />
      {m['providers.back_canvas']()}
    </Button>
    <div class="header-titles">
      <h1>{m['providers.title']()}</h1>
      <p>{m['providers.subtitle']()}</p>
    </div>
    <span class="header-spacer"></span>
    <Button variant="outline" size="sm" disabled={refreshing} onclick={() => loadProviders(true)}>
      <RefreshCw size={14} class={refreshing ? 'provider-refresh-spin' : ''} aria-hidden="true" />
      {refreshing ? m['providers.refreshing']() : m['providers.refresh']()}
    </Button>
    <span class="h-full w-[60px] shrink-0" data-dictation-dock aria-hidden="true"></span>
  </header>

  <section class="overview" aria-label={m['providers.summary']({ ready: readyCount, total: providers.length })}>
    <div class="overview-copy">
      <span class="overview-icon"><MonitorCog size={18} aria-hidden="true" /></span>
      <div>
        <strong>{m['providers.summary']({ ready: readyCount, total: providers.length })}</strong>
        <p>{m['providers.local_note']()}</p>
      </div>
    </div>
    <div class="filters" role="group" aria-label={m['providers.title']()}>
      <button class:active={filter === 'all'} onclick={() => (filter = 'all')}>{m['providers.filter_all']()}</button>
      <button class:active={filter === 'ready'} onclick={() => (filter = 'ready')}>{m['providers.filter_ready']()}</button>
      <button class:active={filter === 'setup'} onclick={() => (filter = 'setup')}>{m['providers.filter_setup']()}</button>
    </div>
  </section>

  {#if loading}
    <div class="provider-list" aria-hidden="true">
      {#each [0, 1, 2, 3] as item (item)}
        <Skeleton class="h-[132px] w-full rounded-lg bg-[var(--app-surface-raised)]" />
      {/each}
    </div>
  {:else if visibleProviders.length}
    <div class="provider-list">
      {#each visibleProviders as provider (provider.id)}
        {@const expanded = expandedProvider === provider.id}
        {@const command = installCommand(provider)}
        <article class="provider-row" class:available={provider.installed}>
          <div class="provider-main">
            <span class="provider-icon app-logo-plate">
              {#if providerIcons[provider.id]}
                <img src={providerIcons[provider.id]} width="20" height="20" alt="" />
              {:else}
                <SquareTerminal size={18} aria-hidden="true" />
              {/if}
            </span>
            <div class="provider-copy">
              <div class="provider-title-row">
                <h2>{provider.displayName}</h2>
                <span class:ready={provider.installed} class="status-badge">
                  {#if provider.installed}<CheckCircle2 size={12} />{:else}<CircleAlert size={12} />{/if}
                  {provider.installed ? m['providers.detected']() : m['providers.not_detected']()}
                </span>
              </div>
              <p>{provider.installed ? m['providers.ready_description']() : m['providers.setup_description']()}</p>
              {#if PROVIDER_STATUS_SOURCES[provider.id]}
                {@const status = providerStatusStore.value(provider.id)}
                <a
                  class="provider-status-line status-{status.checked ? status.indicator : 'unavailable'}"
                  href={PROVIDER_STATUS_SOURCES[provider.id].pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={status.description || statusLabel(status.indicator, status.checked)}
                >
                  <Activity size={12} aria-hidden="true" />
                  <span>{statusLabel(status.indicator, status.checked)}</span>
                  <ExternalLink size={11} aria-hidden="true" />
                </a>
              {/if}
              <div class="capabilities">
                {#if provider.supportsResume}
                  <span><MessageSquareText size={12} />{m['providers.cap_resume']()}</span>
                {/if}
                {#if provider.installed && provider.models?.length}
                  <span><SquareTerminal size={12} />{m['providers.cap_models']({ count: provider.models.length })}</span>
                {/if}
                {#if provider.efforts?.length}
                  <span><BrainCircuit size={12} />{m['providers.cap_effort']()}</span>
                {/if}
                {#if versionLabel(provider)}<span class="version">{versionLabel(provider)}</span>{/if}
              </div>
            </div>
            <div class="provider-actions">
              {#if provider.installed}
                <Button size="sm" href="/canvas">{m['providers.open_canvas']()}</Button>
              {/if}
              <Button
                variant="outline"
                size="sm"
                aria-expanded={expanded}
                onclick={() => {
                  if (expanded && profileFormOpen === provider.id) closeProfileForm();
                  expandedProvider = expanded ? null : provider.id;
                  if (!expanded && !profiles[provider.id]) loadProfiles(provider.id);
                }}
              >
                {expanded ? m['providers.setup_close']() : m['providers.setup_open']()}
                {#if expanded}<ChevronUp size={13} />{:else}<ChevronDown size={13} />{/if}
              </Button>
            </div>
          </div>

          {#if expanded}
            <div class="setup-panel">
              <div class="setup-step">
                <span class="step-icon"><SquareTerminal size={15} /></span>
                <div class="step-copy">
                  <h3>{m['providers.install_title']()}</h3>
                  <p>{m['providers.install_intro']({ platform: platformName() })}</p>
                  {#if command}
                    <div class="command-row">
                      <code>{command}</code>
                      <button aria-label={m['providers.copy_command']()} title={m['providers.copy_command']()} onclick={() => copyCommand(command)}>
                        <Copy size={14} />
                      </button>
                    </div>
                  {:else}
                    <p class="setup-note">{m['providers.no_command']()}</p>
                  {/if}
                </div>
              </div>
              <div class="setup-step">
                <span class="step-icon"><ShieldCheck size={15} /></span>
                <div class="step-copy">
                  <h3>{m['providers.login_title']()}</h3>
                  <p>{m['providers.login_body']()}</p>
                </div>
              </div>
              <div class="setup-step">
                <span class="step-icon"><RefreshCw size={15} /></span>
                <div class="step-copy">
                  <h3>{m['providers.check_title']()}</h3>
                  <p>{m['providers.check_body']()}</p>
                </div>
              </div>
              {#if provider.setup?.docsUrl}
                <a class="guide-link" href={provider.setup.docsUrl} target="_blank" rel="noreferrer">
                  {m['providers.official_guide']()}<ExternalLink size={13} />
                </a>
              {/if}

              {#if provider.profileStrategy && provider.profileStrategy.kind !== 'unsupported'}
                {@const strategy = provider.profileStrategy}
                <div class="setup-step profiles-step">
                  <span class="step-icon"><UserRound size={15} /></span>
                  <div class="step-copy">
                    <h3>{m['providers.profiles_title']()}</h3>
                    <p>{m['providers.profiles_body']()}</p>
                    <ul class="profile-list">
                      {#each profiles[provider.id] ?? [] as profile (profile.id)}
                        <li>
                          <span class="profile-name">{profile.name}</span>
                          <span class="profile-detail">
                            {#if strategy.kind === 'configDir'}{profile.configDir}
                            {:else if strategy.kind === 'configDirPair'}{profile.configDir} · {profile.dataDir}
                            {:else}{m['providers.profile_token_saved']()}{/if}
                          </span>
                          <button
                            class="profile-remove"
                            aria-label={m['providers.profile_edit']()}
                            title={m['providers.profile_edit']()}
                            onclick={() => openProfileForm(provider.id, profile)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            class="profile-remove"
                            aria-label={m['providers.profile_delete']()}
                            title={m['providers.profile_delete']()}
                            onclick={() => (deletingProfile = { providerId: provider.id, profile })}
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      {:else}
                        <li class="profile-empty">{m['providers.profiles_empty']()}</li>
                      {/each}
                    </ul>

                    {#if profileFormOpen === provider.id}
                      <form class="profile-form" onsubmit={(event) => { event.preventDefault(); saveProfile(provider); }}>
                        <input placeholder={m['providers.profile_name_placeholder']()} bind:value={profileFormName} maxlength={48} required />
                        {#if strategy.kind === 'configDir'}
                          <input placeholder={strategy.defaultDir} bind:value={profileFormConfigDir} required />
                        {:else if strategy.kind === 'configDirPair'}
                          <input placeholder={`${m['providers.profile_config_dir']()} (${strategy.defaultConfigDir})`} bind:value={profileFormConfigDir} required />
                          <input placeholder={`${m['providers.profile_data_dir']()} (${strategy.defaultDataDir})`} bind:value={profileFormDataDir} required />
                        {:else if strategy.kind === 'token'}
                          <input
                            type="password"
                            placeholder={m['providers.profile_token_placeholder']()}
                            bind:value={profileFormToken}
                            required={!profileEditingId}
                          />
                        {/if}
                        {#if profileFormError}<p class="profile-form-error">{profileFormError}</p>{/if}
                        <div class="profile-form-actions">
                          <Button type="submit" size="sm" disabled={profileFormBusy}>{m['providers.profile_save']()}</Button>
                          <Button type="button" variant="ghost" size="sm" onclick={closeProfileForm}>{m['providers.profile_cancel']()}</Button>
                        </div>
                      </form>
                    {:else}
                      <Button variant="outline" size="sm" onclick={() => openProfileForm(provider.id)}>
                        <Plus size={13} />{m['providers.profile_add']()}
                      </Button>
                    {/if}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </article>
      {/each}
    </div>
  {:else}
    <div class="empty-state"><SquareTerminal size={22} /><p>{m['providers.empty']()}</p></div>
  {/if}
</main>

<AlertDialog.Root open={deletingProfile !== null} onOpenChange={(open) => !open && (deletingProfile = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['providers.profile_delete_title']()}</AlertDialog.Title>
      <AlertDialog.Description>
        {m['providers.profile_delete_description']({ name: deletingProfile?.profile.name ?? '' })}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>{m['settings.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action variant="destructive" onclick={deleteProfile}>{m['settings.delete']()}</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<style>
  .providers-page {
    min-height: 100dvh;
    padding: 20px clamp(20px, 4vw, 64px) 64px;
    background: var(--app-page);
    color: var(--app-text);
  }

  .page-header {
    width: min(1100px, 100%);
    min-height: 70px;
    margin: 0 auto 16px;
    display: flex;
    align-items: center;
    gap: 18px;
    border-bottom: 1px solid var(--app-border);
  }

  .header-titles { min-width: 0; }
  .header-titles h1 { margin: 0; font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif; font-size: 22px; font-weight: 650; }
  .header-titles p { margin: 5px 0 0; color: var(--app-text-muted); font-size: 13px; line-height: 1.5; }
  .header-spacer { flex: 1; }

  .overview {
    width: min(1100px, 100%);
    margin: 0 auto 14px;
    padding: 16px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
    background: var(--app-surface-subtle);
  }

  .overview-copy { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .overview-icon, .provider-icon, .step-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    color: var(--app-accent);
    background: var(--app-accent-soft);
  }
  .overview-icon { width: 36px; height: 36px; border-radius: 7px; }
  .overview strong { font-size: 13px; }
  .overview p { margin: 3px 0 0; color: var(--app-text-muted); font-size: 12px; }

  .filters { display: inline-flex; padding: 3px; border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-subtle); }
  .filters button { min-height: 30px; padding: 0 11px; border: 0; border-radius: 5px; background: transparent; color: var(--app-text-muted); font: inherit; font-size: 12px; cursor: pointer; }
  .filters button:hover { color: var(--app-text); }
  .filters button.active { background: var(--app-accent-soft); color: var(--app-accent); }

  .provider-list { width: min(1100px, 100%); margin: 0 auto; display: grid; gap: 9px; }
  .provider-row { border: 1px solid var(--app-border); border-radius: 8px; background: color-mix(in srgb, var(--app-surface) 82%, transparent); overflow: hidden; transition: border-color 140ms ease, background-color 140ms ease; }
  .provider-row:hover { border-color: var(--app-border-strong); background: var(--app-surface); }
  .provider-row.available { border-color: color-mix(in srgb, var(--app-success) 36%, var(--app-border)); }
  .provider-main { min-height: 108px; padding: 14px 18px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 14px; }
  .provider-icon { width: 38px; height: 38px; border-radius: 7px; background: var(--app-logo-plate); }
  .provider-title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
  .provider-copy h2 { margin: 0; font-size: 15px; font-weight: 650; }
  .provider-copy > p { max-width: 680px; margin: 7px 0 0; color: var(--app-text-soft); font-size: 12px; line-height: 1.55; }
  .status-badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 7px; border-radius: 999px; background: color-mix(in srgb, var(--app-warning) 12%, transparent); color: var(--app-warning); font-size: 10px; font-weight: 600; }
  .status-badge.ready { background: color-mix(in srgb, var(--app-success) 12%, transparent); color: var(--app-success); }
  .provider-status-line { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; color: var(--app-success); font-size: 11px; font-weight: 600; text-decoration: none; }
  .provider-status-line:hover { text-decoration: underline; }
  .provider-status-line.status-minor { color: var(--app-warning); }
  .provider-status-line.status-major, .provider-status-line.status-critical { color: var(--app-danger); }
  .provider-status-line.status-unavailable { color: var(--app-text-muted); }
  .capabilities { min-height: 24px; margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .capabilities span { display: inline-flex; align-items: center; gap: 5px; padding: 4px 7px; border-radius: 5px; background: var(--app-surface-raised); color: var(--app-text-muted); font-size: 10px; }
  .capabilities .version { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .provider-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }

  .setup-panel { position: relative; padding: 18px 18px 18px 70px; border-top: 1px solid var(--app-border); background: var(--app-surface-subtle); display: grid; gap: 15px; }
  .setup-step { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 10px; }
  .step-icon { width: 28px; height: 28px; border-radius: 6px; }
  .step-copy h3 { margin: 1px 0 3px; font-size: 12px; font-weight: 650; }
  .step-copy p { margin: 0; color: var(--app-text-muted); font-size: 12px; line-height: 1.55; }
  .setup-note { margin-top: 7px !important; color: var(--app-accent) !important; }
  .command-row { max-width: 700px; margin-top: 8px; display: grid; grid-template-columns: minmax(0, 1fr) 34px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-page); overflow: hidden; }
  .command-row code { padding: 9px 11px; overflow-x: auto; color: var(--app-text-soft); font-size: 11px; white-space: nowrap; }
  .command-row button { border: 0; border-left: 1px solid var(--app-border); background: transparent; color: var(--app-text-muted); cursor: pointer; }
  .command-row button:hover { color: var(--app-accent); background: var(--app-accent-soft); }
  .guide-link { position: absolute; right: 18px; bottom: 18px; display: inline-flex; align-items: center; gap: 6px; color: var(--app-accent); font-size: 12px; font-weight: 600; text-decoration: none; }
  .guide-link:hover { color: var(--app-accent); }

  .profiles-step { padding-top: 3px; border-top: 1px dashed var(--app-border); }
  .profile-list { display: grid; gap: 6px; margin: 9px 0; padding: 0; list-style: none; }
  .profile-list li { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-page); }
  .profile-list .profile-empty { color: var(--app-text-muted); font-size: 12px; border-style: dashed; }
  .profile-name { font-weight: 600; font-size: 12px; }
  .profile-detail { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  .profile-remove { flex: 0 0 auto; border: 0; background: transparent; color: var(--app-text-muted); cursor: pointer; }
  .profile-remove:hover { color: var(--app-danger, #d94b4b); }
  .profile-form { display: grid; gap: 7px; max-width: 420px; margin-top: 8px; }
  .profile-form input { min-height: 32px; padding: 0 9px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface); color: var(--app-text); font: inherit; font-size: 12px; }
  .profile-form-error { margin: 0; color: var(--app-danger, #d94b4b); font-size: 12px; }
  .profile-form-actions { display: flex; gap: 8px; }

  .empty-state { width: min(1100px, 100%); min-height: 180px; margin: 0 auto; display: grid; place-items: center; align-content: center; gap: 8px; border: 1px dashed var(--app-border); border-radius: 8px; color: var(--app-text-muted); }
  .empty-state p { margin: 0; font-size: 12px; }
  :global(.provider-refresh-spin) { animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 760px) {
    .providers-page { padding: 18px 12px 40px; }
    .page-header { align-items: flex-start; flex-wrap: wrap; }
    .page-header > :global(a) { order: 0; }
    .header-titles { order: 2; width: 100%; }
    .header-spacer { display: none; }
    .page-header > :global(button) { margin-left: auto; }
    .overview { align-items: stretch; flex-direction: column; }
    .filters { align-self: stretch; }
    .filters button { flex: 1; }
    .provider-main { grid-template-columns: auto minmax(0, 1fr); }
    .provider-actions { grid-column: 1 / -1; justify-content: flex-start; padding-left: 52px; }
    .setup-panel { padding: 16px; padding-bottom: 52px; }
    .guide-link { left: 54px; right: auto; }
  }
</style>
