<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Plus, Save, LockKeyhole, Copy, Trash2, X, Palette } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
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
  const form = superForm<CreativeBrandDefinition>(defaults({ name: '', description: '', assets: [], colors: [], rules: '', tone: '' }, adapter) as never, { id: 'creative-brand', SPA: true, dataType: 'json', validators: adapter as never });
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
  <Dialog.Content class="flex h-[min(820px,calc(100dvh-32px))] w-[calc(100vw-32px)] flex-col overflow-hidden sm:max-w-4xl" data-testid="brand-library">
    <Dialog.Header><Dialog.Title class="flex items-center gap-2"><Palette size={18} />{m['creative_brand.title']()}</Dialog.Title><Dialog.Description>{m['creative_brand.description']()}</Dialog.Description></Dialog.Header>
    <Tabs.Root bind:value={tab} class="flex min-h-0 flex-1 flex-col">
      <Tabs.List class="shrink-0"><Tabs.Trigger value="workspace" class="aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_brand.workspace']()}</Tabs.Trigger><Tabs.Trigger value="library" class="aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_brand.library']()}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="workspace" class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <fieldset disabled={busy || !ready} class="flex min-h-0 flex-1 flex-col gap-3 disabled:opacity-70">
          <div class="flex items-center gap-2"><div class="min-w-0 flex-1"><ModelCombobox value={selectedId} fieldProps={{ disabled: dirty || busy || !ready }} options={records.map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version} · ${item.state === 'locked' ? m['creative.character_locked']() : m['creative.character_draft']()}` }))} defaultLabel={m['creative_brand.new']()} searchPlaceholder={m['creative_brand.search']()} emptyLabel={m['creative_brand.empty']()} ariaLabel={m['creative_brand.title']()} onValueChange={select} /></div><Button size="icon" variant="outline" disabled={dirty} title={m['creative_brand.new']()} aria-label={m['creative_brand.new']()} onclick={() => select('')}><Plus size={16} /></Button></div>
          {#if record}<p class="text-xs font-medium">{locked ? m['creative.character_locked']() : m['creative.character_draft']()} · v{record.version}</p>{/if}
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            <fieldset disabled={locked} class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2"><label class="block space-y-1 text-sm"><span>{m['creative_brand.name']()}</span><Input bind:value={definition.name} maxlength={100} aria-invalid={Boolean($errors.name)} /></label><label class="block space-y-1 text-sm"><span>{m['creative_brand.tone']()}</span><Input bind:value={definition.tone} maxlength={4000} /></label></div>
              {#if $errors.name}<p role="alert" class="text-xs text-destructive">{m['creative.field_invalid']()}</p>{/if}
              <label class="block space-y-1 text-sm"><span>{m['creative_brand.brief']()}</span><Textarea bind:value={definition.description} maxlength={4000} /></label>
              <section class="space-y-2" aria-label={m['creative_brand.colors']()}><div class="flex items-center justify-between text-sm font-medium"><span>{m['creative_brand.colors']()}</span><Button size="icon-sm" variant="ghost" disabled={locked || definition.colors.length >= 24} aria-label={m['creative_brand.add_color']()} title={m['creative_brand.add_color']()} onclick={() => definition.colors = [...definition.colors, { name: '', value: '#2563EB' }]}><Plus size={14} /></Button></div>
                {#each definition.colors as color, index}<div class="flex items-center gap-2"><Input type="color" class="size-9 shrink-0 p-1" aria-label={`${m['creative_brand.color']()} ${index + 1}`} bind:value={color.value} /><Input aria-label={`${m['creative_brand.color_name']()} ${index + 1}`} bind:value={color.name} maxlength={60} /><Input class="w-28 shrink-0 font-mono" aria-label={`${m['creative_brand.hex']()} ${index + 1}`} bind:value={color.value} maxlength={7} /><Button size="icon-sm" variant="ghost" aria-label={`${m['creative.delete']()} ${index + 1}`} onclick={() => definition.colors = definition.colors.filter((_, i) => i !== index)}><X size={14} /></Button></div>{/each}
              </section>
              <section class="space-y-2" aria-label={m['creative_brand.assets']()}><div class="flex items-center justify-between text-sm font-medium"><span>{m['creative_brand.assets']()}</span><Button size="icon-sm" variant="ghost" disabled={locked || definition.assets.length >= 20} aria-label={m['creative.add_media']()} title={m['creative.add_media']()} onclick={() => definition.assets = [...definition.assets, { label: '', kind: 'logo', path: '' }]}><Plus size={14} /></Button></div>
                {#if !locked}<ModelCombobox value="" options={images.map(image => ({ value: image.path, label: image.title || image.path }))} defaultLabel={m['creative.character_add_image']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.character_add_image']()} onValueChange={(path) => { if (path && definition.assets.length < 20) definition.assets = [...definition.assets, { label: images.find(item => item.path === path)?.title || path, kind: 'logo', path }]; }} />{/if}
                {#each definition.assets as asset, index}<div class="flex items-start gap-2 border-b py-2">{#if asset.path}<img class="size-16 shrink-0 rounded border object-contain" loading="lazy" draggable="false" src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(asset.path)}`} alt={asset.label} />{/if}<div class="min-w-0 flex-1 space-y-2"><div class="grid gap-2 sm:grid-cols-2"><Input aria-label={`${m['creative_brand.asset_name']()} ${index + 1}`} bind:value={asset.label} maxlength={100} /><ModelCombobox value={asset.kind} options={(['logo','product','style'] as const).map(value => ({ value, label: value === 'logo' ? m['creative_brand.logo']() : value === 'product' ? m['creative_brand.product']() : m['creative_brand.style']() }))} defaultLabel={m['creative_brand.logo']()} searchPlaceholder={m['creative_brand.assets']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={`${m['creative_brand.asset_kind']()} ${index + 1}`} onValueChange={(value) => { asset.kind = value as typeof asset.kind; }} /></div><Input aria-label={`${m['creative.workspace_file']()} ${index + 1}`} bind:value={asset.path} maxlength={500} /></div><Button size="icon-sm" variant="ghost" aria-label={`${m['creative.delete']()} ${asset.label || index + 1}`} onclick={() => definition.assets = definition.assets.filter((_, i) => i !== index)}><X size={14} /></Button></div>{/each}
              </section>
              <label class="block space-y-1 text-sm"><span>{m['creative_brand.rules']()}</span><Textarea bind:value={definition.rules} maxlength={12000} class="min-h-28" /></label>
            </fieldset>
            {#if record?.snapshot}<details class="mt-3 border-t pt-3"><summary class="cursor-pointer text-sm">{m['creative.character_fingerprint']()}</summary><code class="mt-2 block break-all text-xs">{record.snapshot.digest}</code>{#each record.snapshot.assets as asset}<p class="mt-2 break-all font-mono text-xs text-muted-foreground">{asset.path}<br />{asset.sha256}</p>{/each}</details>{/if}
          </div>
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="library" class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"><Input bind:value={query} aria-label={m['creative_brand.search']()} placeholder={m['creative_brand.search']()} /><div class="min-h-0 flex-1 overflow-y-auto overscroll-contain"><ul class="grid gap-3 sm:grid-cols-2">{#each filtered as kit (kit.id)}<li class="rounded-md border p-3"><div class="mb-2 flex h-24 gap-1 overflow-hidden bg-[var(--app-canvas)]">{#if kit.definition.assets[0]}<img class="size-full object-contain" alt={kit.definition.name} loading="lazy" src={`/api/agent-room/workspaces/${kit.workspaceId}/fs/raw?path=${encodeURIComponent(kit.definition.assets[0].path)}`} />{:else}{#each kit.definition.colors as color}<span class="h-full min-w-4 flex-1" style:background-color={color.value} title={`${color.name}: ${color.value}`}></span>{/each}{/if}</div><h3 class="break-words text-sm font-semibold">{kit.definition.name} · v{kit.version}</h3><p class="mb-3 truncate text-xs text-muted-foreground" title={kit.workspaceName}>{kit.workspaceName}</p><Button variant="outline" class="w-full" disabled={busy || !ready} onclick={() => command('place', kit)}><Plus size={14} />{m['creative_brand.place']()}</Button></li>{/each}</ul>{#if !filtered.length}<p class="py-6 text-sm text-muted-foreground">{m['creative_brand.empty']()}</p>{/if}</div></Tabs.Content>
    </Tabs.Root>
    {#if loading}<p role="status" class="text-xs text-muted-foreground">{m['creative.loading']()}</p>{/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{creativeError(error)}</p>{/if}
    {#if !loading && !ready}<Button variant="outline" onclick={() => load()}>{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="shrink-0 flex-wrap gap-2 border-t pt-3 sm:justify-between"><div>{#if tab === 'workspace' && record && !locked}<Button variant="ghost" disabled={busy} onclick={() => confirmation = 'remove'}><Trash2 size={14} />{m['creative.delete']()}</Button>{/if}</div><div class="flex flex-wrap justify-end gap-2"><Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button>{#if tab === 'workspace'}{#if locked}<Button variant="outline" disabled={busy || !ready} onclick={() => command('fork')}><Copy size={14} />{m['creative.character_new_version']()}</Button><Button disabled={busy || !ready} onclick={() => command('place')}><Plus size={14} />{m['creative_brand.place']()}</Button>{:else}{#if dirty}<Button variant="ghost" disabled={busy} onclick={() => select(selectedId)}>{m['storyboard.discard']()}</Button>{/if}{#if record}<Button variant="outline" disabled={busy || !ready || dirty} onclick={() => confirmation = 'lock'}><LockKeyhole size={14} />{m['creative_brand.lock']()}</Button>{/if}<Button disabled={busy || !ready} onclick={() => command(record ? 'update' : 'create')}><Save size={14} />{m['creative.save']()}</Button>{/if}{/if}</div></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={confirmation !== null} onOpenChange={(value: boolean) => { if (!value) confirmation = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{confirmation === 'lock' ? m['creative_brand.lock']() : m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{confirmation === 'lock' ? m['creative_brand.lock_help']() : m['creative.character_delete_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { const action = confirmation; confirmation = null; if (action) void command(action); }}>{confirmation === 'lock' ? m['creative_brand.lock']() : m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
