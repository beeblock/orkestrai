<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowLeft, Blocks, Download, ExternalLink, Search, Trash2 } from '@lucide/svelte';
  import McpIcon from '$lib/components/agent-room/McpIcon.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Spinner } from '$lib/components/ui/spinner';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as m from '$lib/paraglide/messages.js';

  type Workspace = { id: string; name: string };
  type SkillResult = { id: string; skillId: string; name: string; source: string; installs: number };
  type InstalledSkill = { skillId: string; name: string; description: string };

  // -- MCPs (marketplace: curadoria + registry oficial) ------------------------
  type McpEnvVar = { key: string; label: string; help?: string; required?: boolean };
  type McpEntry = {
    key: string;
    title: string;
    description: string;
    source: 'curadoria' | 'registry';
    category: string;
    official: boolean;
    homepage?: string;
    url?: string;
    command?: string;
    args?: string[];
    envs?: McpEnvVar[];
  };
  type McpServer = { name: string; command: string; args: string[]; env: Record<string, string>; url?: string; builtin: boolean };

  function mcpDescription(entry: McpEntry): string {
    return entry.key === 'figma' ? m['skills.figma_mcp_market_description']() : entry.description;
  }

  let tab = $state<'skills' | 'mcps'>('skills');
  let mcpQuery = $state('');
  let mcpResults = $state<McpEntry[]>([]);
  let mcpSearching = $state(false);
  let mcpFeedback = $state('');
  let installedMcps = $state<McpServer[]>([]);
  let mcpInstallEntry = $state<McpEntry | null>(null);
  let mcpEnvValues = $state<Record<string, string>>({});
  let mcpInstalling = $state(false);
  let mcpInstallError = $state('');

  async function loadInstalledMcps() {
    if (!workspaceId) {
      installedMcps = [];
      return;
    }
    installedMcps = await api<McpServer[]>(`/api/agent-room/workspaces/${workspaceId}/mcps`).catch(() => []);
  }

  async function searchMcps() {
    mcpSearching = true;
    mcpFeedback = '';
    try {
      mcpResults = await api<McpEntry[]>(`/api/agent-room/workspaces/${workspaceId || 'x'}/mcp-market?q=${encodeURIComponent(mcpQuery.trim())}`);
      if (!mcpResults.length) mcpFeedback = m['skills.mcp_no_results']();
    } catch (error) {
      mcpFeedback = error instanceof Error ? error.message : m['skills.search_failed']();
      mcpResults = [];
    } finally {
      mcpSearching = false;
    }
  }

  function isMcpInstalled(entry: McpEntry) {
    return installedMcps.some((server) => server.name === entry.key);
  }

  /** Abre a instalacao: direto se nao pede env; dialog com campos se pede. */
  function openMcpInstall(entry: McpEntry) {
    if (!workspaceId) {
      mcpFeedback = m['skills.choose_workspace_first']();
      return;
    }
    mcpInstallError = '';
    mcpEnvValues = {};
    if ((entry.envs ?? []).some((env) => env.required)) {
      mcpInstallEntry = entry;
      return;
    }
    void confirmMcpInstall(entry);
  }

  async function confirmMcpInstall(entry: McpEntry) {
    mcpInstalling = true;
    mcpInstallError = '';
    mcpFeedback = '';
    try {
      installedMcps = await api<McpServer[]>(`/api/agent-room/workspaces/${workspaceId}/mcp-market`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entry, env: mcpEnvValues }),
      });
      mcpFeedback = m['skills.mcp_install_success']({ title: entry.title, workspace: activeWorkspaceName });
      mcpInstallEntry = null;
    } catch (error) {
      const message = error instanceof Error ? error.message : m['skills.install_failed']();
      if (mcpInstallEntry) mcpInstallError = message;
      else mcpFeedback = message;
    } finally {
      mcpInstalling = false;
    }
  }

  async function removeMcp(name: string) {
    installedMcps = await api<McpServer[]>(`/api/agent-room/workspaces/${workspaceId}/mcps?name=${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => installedMcps);
  }

  let workspaces = $state<Workspace[]>([]);
  let workspaceId = $state('');
  let query = $state('');
  let results = $state<SkillResult[]>([]);
  let installed = $state<InstalledSkill[]>([]);
  let searching = $state(false);
  let installingId = $state<string | null>(null);
  let feedback = $state('');

  const activeWorkspaceName = $derived(workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? '');

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) throw new Error(payload.error || m['skills.error_status']({ status: response.status }));
    return payload.data as T;
  }

  async function loadInstalled() {
    if (!workspaceId) {
      installed = [];
      return;
    }
    installed = await api<InstalledSkill[]>(`/api/agent-room/workspaces/${workspaceId}/skills`).catch(() => []);
  }

  async function search() {
    searching = true;
    feedback = '';
    try {
      results = await api<SkillResult[]>(`/api/agent-room/skills/search?q=${encodeURIComponent(query.trim())}`);
      if (!results.length) feedback = m['skills.no_results']();
    } catch (error) {
      feedback = error instanceof Error ? error.message : m['skills.search_failed']();
      results = [];
    } finally {
      searching = false;
    }
  }

  async function install(skill: SkillResult) {
    if (!workspaceId) {
      feedback = m['skills.choose_workspace_first']();
      return;
    }
    installingId = skill.id;
    feedback = '';
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/skills`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: skill.source, skillId: skill.skillId }),
      });
      await loadInstalled();
      feedback = m['skills.install_success']({ name: skill.name, workspace: activeWorkspaceName });
    } catch (error) {
      feedback = error instanceof Error ? error.message : m['skills.install_failed']();
    } finally {
      installingId = null;
    }
  }

  async function uninstall(skillId: string) {
    feedback = '';
    try {
      await api(`/api/agent-room/workspaces/${workspaceId}/skills/${skillId}`, { method: 'DELETE' });
      await loadInstalled();
    } catch (error) {
      feedback = error instanceof Error ? error.message : m['skills.remove_failed']();
    }
  }

  function isInstalled(skill: SkillResult) {
    return installed.some((item) => item.skillId === skill.skillId);
  }

  function formatInstalls(count: number) {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
    return String(count);
  }

  onMount(async () => {
    workspaces = await api<Workspace[]>('/api/agent-room/workspaces').catch(() => []);
    const fromUrl = new URLSearchParams(location.search).get('workspace');
    workspaceId = fromUrl && workspaces.some((workspace) => workspace.id === fromUrl) ? fromUrl : (workspaces[0]?.id ?? '');
    await Promise.all([loadInstalled(), loadInstalledMcps()]);
    // Skills e MCPs ja mostram opcoes no primeiro acesso.
    await Promise.all([search(), searchMcps()]);
  });
</script>
<svelte:head>
  <title>Orkestrai — {m['skills.title']()}</title>
</svelte:head>

<main class="skills-page">
  <header class="page-header">
    <Button variant="ghost" size="sm" href="/canvas">
      <ArrowLeft size={15} aria-hidden="true" />
      {m['skills.back_canvas']()}
    </Button>
    <div class="header-titles">
      <h1>{m['skills.title']()}</h1>
      <p>{m['skills.subtitle']()}</p>
    </div>
    <span class="header-spacer"></span>
    <div class="workspace-picker">
      <span class="picker-label">{m['skills.install_in']()}</span>
      <Select.Root type="single" value={workspaceId} onValueChange={async (value: string) => { workspaceId = value; await Promise.all([loadInstalled(), loadInstalledMcps()]); }}>
        <Select.Trigger class="w-56" data-slot="select-trigger">
          {activeWorkspaceName || m['skills.choose_workspace']()}
        </Select.Trigger>
        <Select.Content>
          {#each workspaces as workspace (workspace.id)}
            <Select.Item value={workspace.id}>{workspace.name}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  </header>

  <Tabs.Root
    value={tab}
    onValueChange={(value: string) => (tab = value === 'mcps' ? 'mcps' : 'skills')}
    class="flex flex-col gap-3.5"
  >
    <Tabs.List class="w-fit self-start gap-1 rounded-full border border-app-border bg-app-surface p-[3px]">
      <Tabs.Trigger
        value="skills"
        class="flex-none gap-1.5 rounded-full px-3.5 text-ui-md font-medium text-app-text-soft data-active:bg-app-accent-soft data-active:text-app-text dark:data-active:border-transparent dark:data-active:bg-app-accent-soft dark:data-active:text-app-text"
      >
        <Blocks size={14} aria-hidden="true" /> {m['skills.tab_skills']()}
      </Tabs.Trigger>
      <Tabs.Trigger
        value="mcps"
        class="flex-none gap-1.5 rounded-full px-3.5 text-ui-md font-medium text-app-text-soft data-active:bg-app-accent-soft data-active:text-app-text dark:data-active:border-transparent dark:data-active:bg-app-accent-soft dark:data-active:text-app-text"
      >
        <McpIcon size={14} aria-hidden="true" /> {m['skills.tab_mcps']()}
      </Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="skills" class="m-0 flex flex-col gap-3.5 text-[length:inherit]">
      <!-- Guarda explicita: o Tabs.Content do bits-ui mantem o painel inativo no
           DOM (so marca hidden), e os dois paineis usam as mesmas classes
           .item-row/.installed-row/.result-row. Sem isto uma contagem de linhas
           somaria as duas abas. -->
      {#if tab === 'skills'}
    <section class="page-section">
      <header class="section-head">
        <span class="icon-chip"><Blocks size={15} aria-hidden="true" /></span>
        <div class="section-titles">
          <h2>{m['skills.installed_title']()}</h2>
          <p>{installed.length ? (installed.length === 1 ? m['skills.installed_count_one']({ count: installed.length }) : m['skills.installed_count_other']({ count: installed.length })) : m['skills.installed_empty']()}</p>
        </div>
      </header>
      {#if installed.length}
        <ul class="item-list">
          {#each installed as skill (skill.skillId)}
            <li class="item-row installed-row">
              <span class="item-icon"><Blocks size={14} aria-hidden="true" /></span>
              <div class="item-info">
                <span class="item-name">{skill.name}</span>
                {#if skill.description}<span class="item-desc">{skill.description}</span>{/if}
              </div>
              <Button variant="ghost" size="sm" onclick={() => uninstall(skill.skillId)} aria-label={m['skills.remove_label']({ name: skill.name })}>
                <Trash2 size={13} />
              </Button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-hint">{m['skills.empty_hint']()}</p>
      {/if}
    </section>

    <section class="page-section">
      <header class="section-head">
        <span class="icon-chip"><Search size={15} aria-hidden="true" /></span>
        <div class="section-titles">
          <h2>{m['skills.search_title']()}</h2>
          <p>{m['skills.search_desc']()}</p>
        </div>
      </header>
      <form class="search-row" onsubmit={(event) => { event.preventDefault(); search(); }}>
        <Input bind:value={query} placeholder={m['ph.search_skills']()} class="search-input" aria-label={m['ph.search_skills']()} />
        <Button type="submit" size="sm" disabled={searching || !query.trim()}>
          {#if searching}<Spinner class="size-3.5" />{:else}<Search size={14} aria-hidden="true" />{/if}
          {m['skills.search_btn']()}
        </Button>
      </form>

      {#if feedback}<p class="feedback">{feedback}</p>{/if}

      {#if searching}
        <div class="item-list" aria-hidden="true">
          {#each [0, 1, 2, 3] as index (index)}
            <div class="item-row">
              <div class="item-info result-skeleton">
                <Skeleton class="h-4 w-40 bg-[var(--app-surface-raised)]" />
                <Skeleton class="h-3 w-56 bg-[var(--app-surface-raised)]" />
              </div>
              <Skeleton class="h-8 w-20 bg-[var(--app-surface-raised)]" />
            </div>
          {/each}
        </div>
      {:else if results.length}
        <ul class="item-list">
          {#each results as skill (skill.id)}
            <li class="item-row result-row">
              <div class="item-info">
                <div class="item-title">
                  <span class="item-name">{skill.name}</span>
                  <Badge variant="secondary">{m['skills.installs_count']({ count: formatInstalls(skill.installs) })}</Badge>
                </div>
                <span class="item-desc">{skill.id}</span>
              </div>
              {#if isInstalled(skill)}
                <Badge variant="outline">{m['skills.installed_badge']()}</Badge>
              {:else}
                <Button variant="outline" size="sm" disabled={installingId === skill.id || !workspaceId} onclick={() => install(skill)}>
                  {#if installingId === skill.id}<Spinner class="size-3.5" />{:else}<Download size={13} aria-hidden="true" />{/if}
                  {m['skills.install_btn']()}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
      {/if}
    </Tabs.Content>

    <Tabs.Content value="mcps" class="m-0 flex flex-col gap-3.5 text-[length:inherit]">
      <!-- Guarda explicita: o Tabs.Content do bits-ui mantem o painel inativo no
           DOM (so marca hidden), e os dois paineis usam as mesmas classes
           .item-row/.installed-row/.result-row. Sem isto uma contagem de linhas
           somaria as duas abas. -->
      {#if tab === 'mcps'}
    <section class="page-section">
      <header class="section-head">
        <span class="icon-chip"><McpIcon size={15} aria-hidden="true" /></span>
        <div class="section-titles">
          <h2>{m['skills.mcp_installed_title']()}</h2>
          <p>{installedMcps.length ? (installedMcps.length === 1 ? m['skills.mcp_count_one']({ count: installedMcps.length }) : m['skills.mcp_count_other']({ count: installedMcps.length })) : m['skills.mcp_installed_empty']()}</p>
        </div>
      </header>
      {#if installedMcps.length}
        <ul class="item-list">
          {#each installedMcps as server (server.name)}
            <li class="item-row installed-row">
              <span class="item-icon"><McpIcon size={14} aria-hidden="true" /></span>
              <div class="item-info">
                <span class="item-name">{server.name}{#if server.builtin} <span class="builtin-tag">{m['skills.builtin_tag']()}</span>{/if}</span>
                <span class="item-desc">{server.url ?? `${server.command} ${server.args.join(' ')}`}</span>
                {#if server.name === 'figma'}<span class="item-source">{m['skills.figma_mcp_auth_status']()}</span>{/if}
              </div>
              {#if server.name === 'figma'}<a class="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-[var(--app-text-muted)] hover:bg-[var(--app-surface-raised)] hover:text-[var(--app-text)]" href="https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/" target="_blank" rel="noreferrer" aria-label={m['skills.figma_mcp_auth_help']()} title={m['skills.figma_mcp_auth_help']()}><ExternalLink size={13} /></a>{/if}
              {#if !server.builtin}
                <Button variant="ghost" size="sm" onclick={() => removeMcp(server.name)} aria-label={m['skills.remove_label']({ name: server.name })}>
                  <Trash2 size={13} />
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="empty-hint">{m['skills.mcp_empty_hint']()}</p>
      {/if}
    </section>

    <section class="page-section">
      <header class="section-head">
        <span class="icon-chip"><Search size={15} aria-hidden="true" /></span>
        <div class="section-titles">
          <h2>{m['skills.mcp_search_title']()}</h2>
          <p>{m['skills.mcp_search_desc']()}</p>
        </div>
      </header>
      <form class="search-row" onsubmit={(event) => { event.preventDefault(); searchMcps(); }}>
        <Input bind:value={mcpQuery} placeholder={m['ph.search_mcps']()} class="search-input" aria-label={m['ph.search_mcps']()} />
        <Button type="submit" size="sm" disabled={mcpSearching}>
          {#if mcpSearching}<Spinner class="size-3.5" />{:else}<Search size={14} aria-hidden="true" />{/if}
          {m['skills.search_btn']()}
        </Button>
      </form>

      {#if mcpFeedback}<p class="feedback">{mcpFeedback}</p>{/if}

      {#if mcpSearching}
        <div class="item-list" aria-hidden="true">
          {#each [0, 1, 2, 3] as index (index)}
            <div class="item-row">
              <div class="item-info result-skeleton">
                <Skeleton class="h-4 w-40 bg-[var(--app-surface-raised)]" />
                <Skeleton class="h-3 w-56 bg-[var(--app-surface-raised)]" />
              </div>
              <Skeleton class="h-8 w-20 bg-[var(--app-surface-raised)]" />
            </div>
          {/each}
        </div>
      {:else if mcpResults.length}
        <ul class="item-list">
          {#each mcpResults as entry, index (`${entry.key}|${entry.title}|${index}`)}
            <li class="item-row result-row">
              <div class="item-info">
                <div class="item-title">
                  <span class="item-name">{entry.title}</span>
                  {#if entry.official}<Badge variant="secondary">{m['skills.badge_official']()}</Badge>{/if}
                  <Badge variant="outline">{entry.source === 'curadoria' ? m['skills.badge_curated']() : 'registry'}</Badge>
                  {#if entry.url}<Badge variant="outline">{m['skills.badge_one_click']()}</Badge>{/if}
                </div>
                <span class="item-desc">{mcpDescription(entry)}</span>
                <span class="item-source">{entry.url ?? `${entry.command ?? ''} ${(entry.args ?? []).join(' ')}`.trim()}</span>
              </div>
              {#if isMcpInstalled(entry)}
                <Badge variant="outline">{m['skills.mcp_installed_badge']()}</Badge>
              {:else}
                <Button variant="outline" size="sm" disabled={!workspaceId || mcpInstalling} onclick={() => openMcpInstall(entry)}>
                  <Download size={13} aria-hidden="true" />
                  {m['skills.install_btn']()}
                </Button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
      {/if}
    </Tabs.Content>
  </Tabs.Root>
</main>

{#if mcpInstallEntry}
  <Dialog.Root open={mcpInstallEntry !== null} onOpenChange={(open: boolean) => !open && (mcpInstallEntry = null)}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>{m['skills.mcp_install_dialog_title']({ title: mcpInstallEntry.title })}</Dialog.Title>
        <Dialog.Description>
          {m['skills.mcp_install_dialog_desc']()}
          {#if mcpInstallEntry.homepage}
            {' '}<a class="mcp-help-link" href={mcpInstallEntry.homepage} target="_blank" rel="noreferrer">{m['skills.mcp_help_link']()}</a>
          {/if}
        </Dialog.Description>
      </Dialog.Header>
      <div class="mcp-env-fields">
        {#each mcpInstallEntry.envs ?? [] as envVar (envVar.key)}
          <div class="mcp-env-field">
            <span class="field-label">{envVar.label}{envVar.required ? ' *' : ''}</span>
            <Input
              type="password"
              value={mcpEnvValues[envVar.key] ?? ''}
              oninput={(event: Event) => (mcpEnvValues = { ...mcpEnvValues, [envVar.key]: (event.target as HTMLInputElement).value })}
              placeholder={envVar.key}
            />
            {#if envVar.help}<span class="mcp-env-help">{envVar.help}</span>{/if}
          </div>
        {/each}
        {#if mcpInstallError}
          <p class="mcp-install-error">{mcpInstallError}</p>
        {/if}
      </div>
      <Dialog.Footer>
        <Button variant="outline" onclick={() => (mcpInstallEntry = null)}>{m['settings.cancel']()}</Button>
        <Button disabled={mcpInstalling} onclick={() => mcpInstallEntry && confirmMcpInstall(mcpInstallEntry)}>
          {mcpInstalling ? m['skills.installing']() : m['skills.install_btn']()}
        </Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}

<style>
  .skills-page {
    min-height: 100vh;
    background: var(--app-canvas);
    color: var(--app-text);
    padding: 24px 24px 80px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    align-items: center;
    -webkit-font-smoothing: antialiased;
  }

  .skills-page > * {
    width: min(760px, 100%);
  }

  .page-header {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 0 14px;
    background: linear-gradient(180deg, var(--app-canvas) 78%, transparent);
  }

  .header-titles h1 {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 19px;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
    text-wrap: balance;
  }

  .header-titles p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .header-spacer {
    flex: 1;
  }

  .workspace-picker {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .picker-label {
    font-size: 12px;
    color: var(--app-text-muted);
    white-space: nowrap;
  }

  /* ---- Secoes (mesmo shell das Configuracoes) ------------------------------ */
  .page-section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    border: 1px solid var(--app-border);
    border-radius: 14px;
    background: var(--app-surface);
    padding: 18px 20px 20px;
    transition: border-color 160ms ease;
  }

  .page-section:hover {
    border-color: var(--app-border-strong);
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
    border-radius: 9px;
    background: color-mix(in srgb, var(--app-secondary) 12%, transparent);
    color: var(--app-secondary);
    flex-shrink: 0;
  }

  .section-titles h2 {
    font-family: 'Sora Variable', 'Sora', 'Inter Variable', 'Inter', sans-serif;
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.005em;
    margin: 0;
    color: var(--app-text);
  }

  .section-titles p {
    margin: 1px 0 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  /* ---- Listas -------------------------------------------------------------- */
  .item-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
  }

  .item-icon {
    display: inline-flex;
    color: var(--app-accent);
    flex-shrink: 0;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .item-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .item-name {
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text);
  }

  .builtin-tag {
    font-size: 10px;
    font-weight: 500;
    color: var(--app-success);
    background: color-mix(in srgb, var(--app-success) 12%, transparent);
    border-radius: 6px;
    padding: 1px 6px;
    margin-left: 6px;
  }

  .item-desc {
    font-size: 11.5px;
    color: var(--app-text-soft);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .item-source {
    font-size: 10.5px;
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .result-skeleton {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty-hint {
    margin: 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .feedback {
    margin: 0;
    font-size: 12px;
    color: var(--app-success);
  }

  .search-row {
    display: flex;
    gap: 8px;
  }

  .search-row :global(.search-input) {
    flex: 1;
  }

  /* ---- Dialog de env do MCP ------------------------------------------------ */
  .mcp-env-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0;
  }

  .mcp-env-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--app-text-soft);
  }

  .mcp-env-help {
    font-size: 10.5px;
    color: var(--app-text-muted);
  }

  .mcp-help-link {
    color: var(--app-secondary);
  }

  .mcp-install-error {
    margin: 0;
    font-size: 12px;
    color: var(--app-danger);
  }

  @media (max-width: 640px) {
    .page-header {
      flex-wrap: wrap;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .page-section {
      transition: none;
    }
  }
</style>
