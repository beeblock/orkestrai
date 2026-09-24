<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Plus, Save, LockKeyhole, Copy, Trash2, X, Palette, Search, ChevronRight, CircleAlert, LoaderCircle, RefreshCw, Image as ImageIcon } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import { creativeBrandDefinitionSchema, type CreativeBrandDefinition, type CreativeBrandCommand } from '$lib/modules/creative-media/contracts/schemas/creative-brand.schema.js';
  import type { CreativeBrandKit, CreativeBrandLibraryItem } from '$lib/modules/creative-media/domain/brand-kit.js';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, floorId = null, onPlaced }: { open?: boolean; workspaceId: string; floorId?: string | null; onPlaced?: (nodeId: string) => void | Promise<void> } = $props();
  let records = $state<CreativeBrandKit[]>([]), library = $state<CreativeBrandLibraryItem[]>([]), selectedId = $state('');
  let definition = $state<CreativeBrandDefinition>({ name: '', description: '', assets: [], colors: [], rules: '', tone: '' });
  let images = $state<Array<{ title: string; path: string }>>([]);
  let loading = $state(true), busy = $state(false), ready = $state(false), error = $state(''), query = $state(''), tab = $state('workspace');
  let confirmation = $state<'lock' | 'remove' | null>(null), loadSequence = 0;
  const record = $derived(records.find(item => item.id === selectedId));
  const locked = $derived(record?.state === 'locked');
  const dirty = $derived(record ? JSON.stringify(definition) !== JSON.stringify(record.definition) : !!definition.name || !!definition.description || !!definition.tone || !!definition.rules || definition.assets.length > 0 || definition.colors.length > 0);
  const filtered = $derived(library.filter(item => `${item.definition.name} ${item.workspaceName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const adapter = zod(creativeBrandDefinitionSchema as unknown as Parameters<typeof zod>[0]);
  const instanceId = $props.id();
  const form = superForm<CreativeBrandDefinition>(defaults({ name: '', description: '', assets: [], colors: [], rules: '', tone: '' }, adapter) as never, { id: `creative-brand-${instanceId}`, SPA: true, dataType: 'json', validators: adapter as never });
  const { errors } = form;
  function select(id: string) {
    selectedId = records.some(item => item.id === id) ? id : ''; error = ''; form.errors.set({});
    definition = structuredClone($state.snapshot(records.find(item => item.id === id)?.definition) ?? { name: '', description: '', assets: [], colors: [], rules: '', tone: '' });
  }
  async function load(id = selectedId) {
    const sequence = ++loadSequence, workspace = workspaceId;
    ready = false; loading = true; error = '';
    try {
      const base = `/api/agent-room/workspaces/${workspace}/creative-media`;
      const kits = await creativeApi<CreativeBrandKit[]>(`${base}/brands`);
      const shared = await creativeApi<CreativeBrandLibraryItem[]>(`${base}/brands?command=library`);
      const options = await creativeApi<{ inputs: Array<{ title: string; type: string; path?: string }> }>(base);
      if (!open || sequence !== loadSequence || workspace !== workspaceId) return;
      records = kits; library = shared; images = options.inputs.filter(item => item.type === 'image' && item.path).map(item => ({ title: item.title, path: item.path! }));
      select(id); ready = true;
    } catch (cause) { if (sequence === loadSequence) error = (cause as Error).message; }
    finally { if (sequence === loadSequence) loading = false; }
  }
  const dialogContext = $derived(open ? workspaceId : '');
  $effect(() => { if (dialogContext) untrack(() => { tab = 'workspace'; void load(); }); else untrack(() => { loadSequence++; ready = false; }); });
  async function command(command: CreativeBrandCommand['command'], source = record) {
    if (busy || !ready) return;
    const workspace = workspaceId, sequence = loadSequence, draft = $state.snapshot(definition);
    const current = () => open && workspace === workspaceId && sequence === loadSequence;
    busy = true; error = '';
    try {
      if (command === 'create' || command === 'update') {
        form.form.set(draft);
        if (!(await form.validateForm({ update: true })).valid) { if (current()) error = 'creative_invalid_input'; return; }
      }
      if (!current()) return;
      const payload = { command, ...(source ? { id: source.id, revision: source.revision } : {}), ...(['create','update'].includes(command) ? { definition: draft } : {}), ...(command === 'place' ? { sourceWorkspaceId: source?.workspaceId, floorId } : {}) };
      const saved = await creativeApi<CreativeBrandKit | { removed: true } | { nodes: Array<{ id: string; type: string }> }>(`/api/agent-room/workspaces/${workspace}/creative-media/brands`, 'POST', payload);
      if (!current()) return;
      if ('nodes' in saved) { const note = saved.nodes.find(node => node.type === 'note'); if (note) await onPlaced?.(note.id); open = false; }
      else await load('id' in saved ? saved.id : '');
    } catch (cause) { if (current()) error = (cause as Error).message; }
    finally { busy = false; }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[min(820px,calc(100dvh-32px))] flex-col gap-4 overflow-hidden sm:max-w-[800px]" data-testid="brand-library">
    <Dialog.Header class="shrink-0 pr-8"><Dialog.Title class="flex items-center gap-2"><Palette size={16} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />{m['creative_brand.title']()}</Dialog.Title><Dialog.Description>{m['creative_brand.description']()}</Dialog.Description></Dialog.Header>
    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs.List class="h-8 shrink-0 rounded-lg bg-[var(--app-hover)] p-0.5"><Tabs.Trigger value="workspace" class="h-7 rounded-md px-3 text-[12.5px] aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_brand.workspace']()}</Tabs.Trigger><Tabs.Trigger value="library" class="h-7 rounded-md px-3 text-[12.5px] aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_brand.library']()}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="workspace" class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <fieldset disabled={busy || !ready} class="flex min-h-0 flex-1 flex-col gap-4 disabled:opacity-70">
          <div class="flex shrink-0 items-center gap-2"><div class="min-w-0 flex-1"><ModelCombobox value={selectedId} fieldProps={{ disabled: dirty || busy || !ready }} options={records.map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version} · ${item.state === 'locked' ? m['creative.character_locked']() : m['creative.character_draft']()}` }))} defaultLabel={m['creative_brand.new']()} searchPlaceholder={m['creative_brand.search']()} emptyLabel={m['creative_brand.empty']()} ariaLabel={m['creative_brand.title']()} onValueChange={select} /></div>{#if record}<span class="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--app-hover)] px-2.5 py-1 text-ui-sm text-[var(--app-text-soft)]">{#if locked}<LockKeyhole size={12} aria-hidden="true" />{/if}{locked ? m['creative.character_locked']() : m['creative.character_draft']()} · <span class="font-mono tabular-nums">v{record.version}</span></span>{/if}<Button size="icon" variant="outline" disabled={dirty} title={m['creative_brand.new']()} aria-label={m['creative_brand.new']()} onclick={() => select('')}><Plus size={16} /></Button></div>
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <fieldset disabled={locked} class="grid gap-6">
              <div class="grid gap-4">
                <div class="grid gap-4 sm:grid-cols-2"><label class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['creative_brand.name']()}</span><Input bind:value={definition.name} maxlength={100} aria-invalid={Boolean($errors.name)} /></label><label class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['creative_brand.tone']()}</span><Input bind:value={definition.tone} maxlength={4000} /></label></div>
                {#if $errors.name}<p role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.field_invalid']()}</p>{/if}
                <label class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative_brand.brief']()}</span><Textarea bind:value={definition.description} maxlength={4000} class="min-h-20 resize-y" /></label>
              </div>
              <section class="grid gap-2 border-t border-[var(--app-border)] pt-5" aria-label={m['creative_brand.colors']()}>
                <div class="flex items-center justify-between gap-3"><h3 class="text-ui-lg font-medium">{m['creative_brand.colors']()} <span class="font-mono text-[11px] font-normal text-[var(--app-text-muted)] tabular-nums">{definition.colors.length}/24</span></h3><Button size="sm" variant="outline" disabled={locked || definition.colors.length >= 24} aria-label={m['creative_brand.add_color']()} title={m['creative_brand.add_color']()} onclick={() => definition.colors = [...definition.colors, { name: '', value: '#2563EB' }]}><Plus size={14} aria-hidden="true" />{m['creative_brand.add_color']()}</Button></div>
                {#each definition.colors as color, index}<div class="flex items-center gap-2"><Input type="color" class="color-swatch size-8 shrink-0 cursor-pointer rounded-lg p-0.5" aria-label={`${m['creative_brand.color']()} ${index + 1}`} bind:value={color.value} /><Input class="h-8 min-w-0 flex-1 text-[13px]" aria-label={`${m['creative_brand.color_name']()} ${index + 1}`} bind:value={color.name} maxlength={60} /><Input class="h-8 w-28 shrink-0 font-mono text-[12px] uppercase" aria-label={`${m['creative_brand.hex']()} ${index + 1}`} bind:value={color.value} maxlength={7} /><Button size="icon-sm" variant="ghost" class="text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={`${m['creative.delete']()} ${index + 1}`} onclick={() => definition.colors = definition.colors.filter((_, i) => i !== index)}><X size={14} /></Button></div>{/each}
              </section>
              <section class="grid gap-2 border-t border-[var(--app-border)] pt-5" aria-label={m['creative_brand.assets']()}>
                <div class="flex items-center justify-between gap-3"><h3 class="text-ui-lg font-medium">{m['creative_brand.assets']()} <span class="font-mono text-[11px] font-normal text-[var(--app-text-muted)] tabular-nums">{definition.assets.length}/20</span></h3><Button size="sm" variant="outline" disabled={locked || definition.assets.length >= 20} aria-label={m['creative.add_media']()} title={m['creative.add_media']()} onclick={() => definition.assets = [...definition.assets, { label: '', kind: 'logo', path: '' }]}><Plus size={14} aria-hidden="true" />{m['creative.add_media']()}</Button></div>
                {#if !locked}<ModelCombobox value="" options={images.map(image => ({ value: image.path, label: image.title || image.path }))} defaultLabel={m['creative.character_add_image']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.character_add_image']()} onValueChange={(path) => { if (path && definition.assets.length < 20) definition.assets = [...definition.assets, { label: images.find(item => item.path === path)?.title || path, kind: 'logo', path }]; }} />{/if}
                {#each definition.assets as asset, index}<div class="asset-row">{#if asset.path}<img class="img-outline size-16 shrink-0 rounded-lg bg-[var(--app-canvas)] object-contain" loading="lazy" draggable="false" src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(asset.path)}`} alt={asset.label} />{:else}<span class="grid size-16 shrink-0 place-items-center rounded-lg bg-[var(--app-hover)] text-[var(--app-text-soft)]" aria-hidden="true"><ImageIcon size={18} /></span>{/if}<div class="grid min-w-0 flex-1 gap-2"><div class="grid gap-2 sm:grid-cols-2"><Input class="h-8 text-[13px]" aria-label={`${m['creative_brand.asset_name']()} ${index + 1}`} bind:value={asset.label} maxlength={100} /><ModelCombobox value={asset.kind} options={(['logo','product','style'] as const).map(value => ({ value, label: value === 'logo' ? m['creative_brand.logo']() : value === 'product' ? m['creative_brand.product']() : m['creative_brand.style']() }))} defaultLabel={m['creative_brand.logo']()} searchPlaceholder={m['creative_brand.assets']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={`${m['creative_brand.asset_kind']()} ${index + 1}`} onValueChange={(value) => { asset.kind = value as typeof asset.kind; }} /></div><Input class="h-8 font-mono text-[12px]" aria-label={`${m['creative.workspace_file']()} ${index + 1}`} bind:value={asset.path} maxlength={500} /></div><Button size="icon-sm" variant="ghost" class="text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={`${m['creative.delete']()} ${asset.label || index + 1}`} onclick={() => definition.assets = definition.assets.filter((_, i) => i !== index)}><X size={14} /></Button></div>{/each}
              </section>
              <label class="grid gap-1.5 border-t border-[var(--app-border)] pt-5"><span class="text-ui-lg font-medium">{m['creative_brand.rules']()}</span><Textarea bind:value={definition.rules} maxlength={12000} class="min-h-28 resize-y" /></label>
            </fieldset>
            {#if record?.snapshot}<details class="group mt-5 rounded-lg shadow-[var(--app-shadow-border)]"><summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-ui-lg font-medium [&::-webkit-details-marker]:hidden"><ChevronRight size={14} class="shrink-0 text-[var(--app-text-muted)] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />{m['creative.character_fingerprint']()}</summary><div class="grid gap-2 px-3 pb-3"><code class="block font-mono text-[11px] break-all">{record.snapshot.digest}</code>{#each record.snapshot.assets as asset}<p class="font-mono text-[11px] break-all text-[var(--app-text-muted)]">{asset.path}<br />{asset.sha256}</p>{/each}</div></details>{/if}
          </div>
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="library" class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"><div class="relative shrink-0"><Search size={14} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" aria-hidden="true" /><Input bind:value={query} class="h-8 pl-8 text-[13px]" aria-label={m['creative_brand.search']()} placeholder={m['creative_brand.search']()} /></div><div class="min-h-0 flex-1 overflow-y-auto overscroll-contain"><ul class="grid gap-3 sm:grid-cols-2">{#each filtered as kit (kit.id)}<li class="grid gap-2 rounded-xl p-3 shadow-[var(--app-shadow-border)]"><div class="flex h-24 gap-1 overflow-hidden rounded-lg bg-[var(--app-canvas)]">{#if kit.definition.assets[0]}<img class="size-full object-contain" alt={kit.definition.name} loading="lazy" src={`/api/agent-room/workspaces/${kit.workspaceId}/fs/raw?path=${encodeURIComponent(kit.definition.assets[0].path)}`} />{:else}{#each kit.definition.colors as color}<span class="h-full min-w-4 flex-1" style:background-color={color.value} title={`${color.name}: ${color.value}`}></span>{/each}{/if}</div><div class="min-w-0"><h3 class="text-ui-lg font-medium break-words">{kit.definition.name} <span class="font-mono text-[11px] font-normal text-[var(--app-text-muted)]">v{kit.version}</span></h3><p class="truncate text-ui-md text-[var(--app-text-muted)]" title={kit.workspaceName}>{kit.workspaceName}</p></div><Button variant="outline" class="w-full" disabled={busy || !ready} onclick={() => command('place', kit)}><Plus size={14} aria-hidden="true" />{m['creative_brand.place']()}</Button></li>{/each}</ul>{#if !filtered.length && ready}<NodeEmptyState icon={Palette} title={m['creative_brand.empty']()} />{/if}</div></Tabs.Content>
    </Tabs.Root>
    {#if loading}<p role="status" class="flex shrink-0 items-center gap-2 self-start rounded-full bg-[var(--app-hover)] px-3 py-1 text-ui-md text-[var(--app-text-soft)]"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['creative.loading']()}</p>{/if}
    {#if error}<p role="alert" class="flex shrink-0 items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1">{creativeError(error)}</span>{#if !loading && !ready}<Button size="xs" variant="outline" class="shrink-0" onclick={() => load()}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}</p>{:else if !loading && !ready}<Button variant="outline" class="self-start" onclick={() => load()}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="shrink-0 flex-wrap items-center sm:justify-between"><div>{#if tab === 'workspace' && record && !locked}<Button variant="ghost" class="text-[var(--app-danger)] hover:text-[var(--app-danger)]" disabled={busy} onclick={() => confirmation = 'remove'}><Trash2 size={14} aria-hidden="true" />{m['creative.delete']()}</Button>{/if}</div><div class="flex flex-wrap justify-end gap-2"><Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button>{#if tab === 'workspace'}{#if locked}<Button variant="outline" disabled={busy || !ready} onclick={() => command('fork')}><Copy size={14} aria-hidden="true" />{m['creative.character_new_version']()}</Button><Button disabled={busy || !ready} onclick={() => command('place')}><Plus size={14} aria-hidden="true" />{m['creative_brand.place']()}</Button>{:else}{#if dirty}<Button variant="ghost" disabled={busy} onclick={() => select(selectedId)}>{m['storyboard.discard']()}</Button>{/if}{#if record}<Button variant="outline" disabled={busy || !ready || dirty} onclick={() => confirmation = 'lock'}><LockKeyhole size={14} aria-hidden="true" />{m['creative_brand.lock']()}</Button>{/if}<Button disabled={busy || !ready} onclick={() => command(record ? 'update' : 'create')}><Save size={14} aria-hidden="true" />{m['creative.save']()}</Button>{/if}{/if}</div></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={confirmation !== null} onOpenChange={(value: boolean) => { if (!value) confirmation = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{confirmation === 'lock' ? m['creative_brand.lock']() : m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{confirmation === 'lock' ? m['creative_brand.lock_help']() : m['creative.character_delete_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action variant={confirmation === 'remove' ? 'destructive' : 'default'} onclick={() => { const action = confirmation; confirmation = null; if (action) void command(action); }}>{confirmation === 'lock' ? m['creative_brand.lock']() : m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<style>
  .asset-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 10px 0;
  }

  .asset-row + .asset-row {
    border-top: 1px solid var(--app-border);
  }

  /* Seletor de cor nativo com cara de amostra. */
  :global(.color-swatch::-webkit-color-swatch-wrapper) {
    padding: 0;
  }

  :global(.color-swatch::-webkit-color-swatch) {
    border: 0;
    border-radius: 6px;
  }
</style>
