<script lang="ts">
  import SidePanel from './SidePanel.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import WorkspaceIcon from '../WorkspaceIcon.svelte';
  import { localeState } from '$lib/i18n/locale.svelte.js';
  import { ArrowRight, Download, History, Library, PackageOpen, Plus, Search, Sparkles, Upload } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';

  type PresetSummary = {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    agents: number;
    builtin: boolean;
    category: 'product' | 'frontend' | 'backend' | 'creative' | 'growth' | 'orkestrai' | 'custom';
    version: string;
    updatedAt: string;
  };
  type TeamPackRevision = { id: string; version: string; releaseNotes: string | null; checksum: string; createdAt: string };

  type Props = {
    workspaceId?: string | null;
    onCreateWorkspace: (presetId: string) => void;
    onApplied: () => void | Promise<void>;
    onClose: () => void;
    api: <T>(path: string, init?: RequestInit) => Promise<T>;
  };

  let { workspaceId, onCreateWorkspace, onApplied, onClose, api }: Props = $props();
  let presets = $state<PresetSummary[]>([]);
  let query = $state('');
  let category = $state<'all' | PresetSummary['category']>('all');
  let pendingPreset = $state<PresetSummary | null>(null);
  let applying = $state(false);
  let errorMessage = $state('');
  let importInput: HTMLInputElement;
  let detailPreset = $state<PresetSummary | null>(null);
  let revisions = $state<TeamPackRevision[]>([]);
  let releaseVersion = $state('');
  let releaseNotes = $state('');
  let packBusy = $state(false);

  const filtered = $derived(
    presets.filter((preset) => {
      const matchesCategory = category === 'all' || preset.category === category;
      const needle = query.trim().toLocaleLowerCase(localeState.current);
      const matchesQuery = !needle || `${preset.name} ${preset.description ?? ''}`.toLocaleLowerCase(localeState.current).includes(needle);
      return matchesCategory && matchesQuery;
    })
  );

  function categoryLabel(value: typeof category): string {
    if (value === 'product') return m['preset.category_product']();
    if (value === 'frontend') return m['preset.category_frontend']();
    if (value === 'backend') return m['preset.category_backend']();
    if (value === 'creative') return m['preset.category_creative']();
    if (value === 'growth') return m['preset.category_growth']();
    if (value === 'orkestrai') return m['preset.category_orkestrai']();
    if (value === 'custom') return m['preset.category_custom']();
    return m['preset.category_all']();
  }

  async function refresh() {
    errorMessage = '';
    try {
      presets = await api<PresetSummary[]>(`/api/agent-room/presets?scope=all&locale=${encodeURIComponent(localeState.current)}`);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['preset.error_load']();
    }
  }

  async function applyToCurrent() {
    if (!pendingPreset || !workspaceId || applying) return;
    applying = true;
    errorMessage = '';
    try {
      await api(`/api/agent-room/presets/${pendingPreset.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ workspaceId, locale: localeState.current }),
      });
      pendingPreset = null;
      await onApplied();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['preset.error_apply']();
    } finally {
      applying = false;
    }
  }

  async function exportPack(preset: PresetSummary): Promise<void> {
    try {
      const bundle = await api<unknown>(`/api/agent-room/presets/${preset.id}/export?locale=${encodeURIComponent(localeState.current)}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `${preset.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLocaleLowerCase()}-${preset.version}.orkestrai-team-pack.json`; anchor.click();
      URL.revokeObjectURL(url);
    } catch { errorMessage = m['team_pack.export_error'](); }
  }

  async function importPack(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const bundle = JSON.parse(await file.text());
      await api('/api/agent-room/presets/import', { method: 'POST', body: JSON.stringify(bundle) });
      await refresh();
    } catch { errorMessage = m['team_pack.import_error'](); }
    finally { importInput.value = ''; }
  }

  async function openDetails(preset: PresetSummary): Promise<void> {
    detailPreset = preset;
    releaseVersion = '';
    releaseNotes = '';
    try { revisions = await api<TeamPackRevision[]>(`/api/agent-room/presets/${preset.id}/revisions`); }
    catch { revisions = []; }
  }

  async function publishVersion(): Promise<void> {
    if (!detailPreset || detailPreset.builtin || !releaseVersion.trim()) return;
    packBusy = true;
    try {
      await api(`/api/agent-room/presets/${detailPreset.id}/revisions`, { method: 'POST', body: JSON.stringify({ version: releaseVersion, releaseNotes }) });
      await refresh();
      const updated = presets.find((preset) => preset.id === detailPreset?.id);
      if (updated) await openDetails(updated);
    } catch { errorMessage = m['team_pack.publish_error'](); }
    finally { packBusy = false; }
  }

  $effect(() => {
    localeState.current;
    void refresh();
  });
</script>

<SidePanel tour="preset-library" flush title={m['preset.title']()} icon={Sparkles} eyebrow={m['preset.eyebrow']()} description={m['preset.subtitle']()} width={380} closeLabel={m['preset.close']()} {onClose}>
  {#snippet actions()}
    <input bind:this={importInput} class="hidden" type="file" accept=".json,application/json" onchange={importPack} />
    <HeaderIconButton label={m['team_pack.import']()} class="node-action-btn" side="left" onclick={() => importInput.click()}><Upload size={14} /></HeaderIconButton>
  {/snippet}

  <div class="grid gap-2 border-b border-[var(--app-border)] p-4">
    <label class="relative">
      <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--app-text-muted)]" size={14} />
      <Input bind:value={query} aria-label={m['preset.search_aria']()} placeholder={m['preset.search_placeholder']()} class="border-[var(--app-border)] bg-[var(--app-surface-subtle)] pl-9 text-[var(--app-text)] placeholder:text-[var(--app-text-muted)]" />
    </label>
    <Select.Root type="single" value={category} onValueChange={(value: string) => (category = value as typeof category)}>
      <Select.Trigger class="w-full border-[var(--app-border)] bg-[var(--app-surface-subtle)] text-[var(--app-text-soft)]">
        {categoryLabel(category)}
      </Select.Trigger>
      <Select.Content>
        <Select.Item value="all">{m['preset.category_all']()}</Select.Item>
        <Select.Item value="product">{m['preset.category_product']()}</Select.Item>
        <Select.Item value="frontend">{m['preset.category_frontend']()}</Select.Item>
        <Select.Item value="backend">{m['preset.category_backend']()}</Select.Item>
        <Select.Item value="creative">{m['preset.category_creative']()}</Select.Item>
        <Select.Item value="growth">{m['preset.category_growth']()}</Select.Item>
        <Select.Item value="orkestrai">{m['preset.category_orkestrai']()}</Select.Item>
        <Select.Item value="custom">{m['preset.category_custom']()}</Select.Item>
      </Select.Content>
    </Select.Root>
  </div>

  <div class="flex-1 space-y-3 overflow-y-auto p-4">
    {#if errorMessage}
      <p class="rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md text-[var(--app-danger)]" role="alert">{errorMessage}</p>
    {/if}
    {#each filtered as preset (preset.id)}
      <article class="preset-card group rounded-[10px] bg-[var(--app-surface)] p-3 shadow-border transition-[box-shadow,background-color] duration-150 hover:bg-[var(--app-surface-raised)] hover:shadow-border-hover">
        <div class="flex items-start gap-3">
          <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--app-secondary-soft)] text-[var(--app-secondary)]">
            <WorkspaceIcon name={preset.icon} size={17} />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <h4 class="m-0 text-sm font-semibold text-[var(--app-text)]">{preset.name}</h4>
              <Badge variant={preset.builtin ? 'secondary' : 'outline'} class="h-5 rounded px-1.5 text-ui-xs uppercase tracking-normal">
                {preset.builtin ? m['preset.builtin']() : m['preset.custom']()}
              </Badge>
              <Badge variant="outline" class="h-5 rounded px-1.5 text-ui-xs">v{preset.version}</Badge>
            </div>
            <p class="mt-1 text-ui-md leading-[1.45] text-pretty text-[var(--app-text-muted)]">{preset.description ?? m['preset.no_description']()}</p>
            <p class="meta-mono mt-2">{m['preset.agent_count']({ count: preset.agents })} · {categoryLabel(preset.category)}</p>
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" class="min-w-0 flex-1 justify-between group-hover:bg-[var(--app-accent)] group-hover:text-[var(--app-accent-contrast)]" onclick={() => onCreateWorkspace(preset.id)}>
            {m['preset.new_workspace']()}
            <ArrowRight size={14} />
          </Button>
          {#if workspaceId}
            <Button variant="outline" size="icon-sm" aria-label={m['preset.add_current_named']({ name: preset.name })} onclick={() => (pendingPreset = preset)}>
              <Plus size={14} />
            </Button>
          {/if}
          <Button variant="outline" size="icon-sm" aria-label={m['team_pack.history_named']({ name: preset.name })} onclick={() => void openDetails(preset)}><History size={14} /></Button>
          <Button variant="outline" size="icon-sm" aria-label={m['team_pack.export_named']({ name: preset.name })} onclick={() => void exportPack(preset)}><Download size={14} /></Button>
        </div>
      </article>
    {:else}
      <div class="grid min-h-40"><NodeEmptyState icon={Library} title={m['preset.empty']()} /></div>
    {/each}
  </div>
</SidePanel>

<AlertDialog.Root open={pendingPreset !== null} onOpenChange={(open) => !open && !applying && (pendingPreset = null)}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>{m['preset.apply_title']()}</AlertDialog.Title>
      <AlertDialog.Description>{m['preset.apply_description']({ name: pendingPreset?.name ?? '' })}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={applying}>{m['settings.cancel']()}</AlertDialog.Cancel>
      <AlertDialog.Action disabled={applying} onclick={applyToCurrent}>
        {applying ? m['preset.applying']() : m['preset.apply_action']()}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root open={detailPreset !== null} onOpenChange={(open) => !open && (detailPreset = null)}>
  <Dialog.Content class="max-h-[82vh] max-w-lg overflow-y-auto">
    <Dialog.Header><Dialog.Title class="flex items-center gap-2"><PackageOpen size={16} />{detailPreset?.name}</Dialog.Title><Dialog.Description>{m['team_pack.description']()}</Dialog.Description></Dialog.Header>
    <div class="space-y-2">{#each revisions as revision (revision.id)}<article class="rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-3"><div class="flex items-center gap-2"><strong class="text-ui-sm">v{revision.version}</strong><time class="ml-auto text-ui-xs text-[var(--app-text-muted)]">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(revision.createdAt))}</time></div><p class="mt-1 text-ui-xs leading-4 text-[var(--app-text-muted)]">{revision.releaseNotes ?? m['team_pack.no_notes']()}</p><code class="mt-2 block truncate text-ui-xs text-[var(--app-text-muted)]">sha256:{revision.checksum}</code></article>{/each}</div>
    {#if detailPreset && !detailPreset.builtin}<div class="grid gap-3 border-t border-[var(--app-border)] pt-4"><h3 class="text-ui-sm font-semibold">{m['team_pack.publish_title']()}</h3><label class="grid gap-1 text-ui-xs">{m['team_pack.version']()}<Input bind:value={releaseVersion} placeholder={m['team_pack.version_placeholder']()} /></label><label class="grid gap-1 text-ui-xs">{m['team_pack.release_notes']()}<Textarea bind:value={releaseNotes} class="min-h-20 resize-y text-ui-xs" /></label><Button disabled={packBusy || !releaseVersion.trim()} onclick={() => void publishVersion()}>{packBusy ? m['team_pack.publishing']() : m['team_pack.publish']()}</Button></div>{/if}
  </Dialog.Content>
</Dialog.Root>
