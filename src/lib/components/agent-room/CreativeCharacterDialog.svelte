<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Plus, Save, LockKeyhole, Copy, Trash2, X } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import { creativeCharacterDefinitionSchema, type CreativeCharacterDefinition, type CreativeCharacterCommand } from '$lib/modules/creative-media/contracts/schemas/creative-character.schema.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import type { CreativeProfile } from '$lib/modules/creative-media/domain/types.js';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, onSaved }: { open?: boolean; workspaceId: string; onSaved: () => void | Promise<void> } = $props();
  let records = $state<CreativeCharacter[]>([]), selectedId = $state('');
  let definition = $state<CreativeCharacterDefinition>({ name: '', appearance: '', images: [], voice: { kind: 'unassigned' } });
  let images = $state<Array<{ id: string; title: string; path: string }>>([]), profiles = $state<CreativeProfile[]>([]);
  let loading = $state(true), busy = $state(false), ready = $state(false), error = $state('');
  let confirmation = $state<'lock' | 'remove' | null>(null), loadSequence = 0;
  const record = $derived(records.find(item => item.id === selectedId));
  const locked = $derived(record?.state === 'locked');
  const adapter = zod(creativeCharacterDefinitionSchema as unknown as Parameters<typeof zod>[0]);
  const form = superForm<CreativeCharacterDefinition>(defaults({ name: '', appearance: '', images: [], voice: { kind: 'unassigned' } }, adapter) as never, { id: 'creative-character', SPA: true, dataType: 'json', validators: adapter as never });
  const { errors } = form;
  function select(id: string) {
    selectedId = records.some(item => item.id === id) ? id : ''; error = ''; form.errors.set({});
    definition = structuredClone($state.snapshot(records.find(item => item.id === id)?.definition) ?? { name: '', appearance: '', images: [], voice: { kind: 'unassigned' as const } });
  }
  async function load(id = selectedId) {
    const sequence = ++loadSequence, workspace = workspaceId;
    ready = false; loading = true; error = '';
    try {
      const base = `/api/agent-room/workspaces/${workspace}/creative-media`;
      const [characters, options] = await Promise.all([creativeApi<CreativeCharacter[]>(`${base}/characters`), creativeApi<{ profiles: CreativeProfile[]; inputs: Array<{ id: string; title: string; type: string; path?: string }> }>(base)]);
      if (!open || sequence !== loadSequence || workspace !== workspaceId) return;
      records = characters; profiles = options.profiles;
      images = options.inputs.filter(item => item.type === 'image' && item.path).map(item => ({ id: item.id, title: item.title, path: item.path! }));
      select(id); ready = true;
    } catch (cause) { if (sequence === loadSequence) error = (cause as Error).message; }
    finally { if (sequence === loadSequence) loading = false; }
  }
  $effect(() => { const workspace = workspaceId; if (open && workspace) untrack(() => { void load(); }); else untrack(() => { loadSequence++; ready = false; }); });
  async function command(command: CreativeCharacterCommand['command']) {
    if (busy || !ready) return;
    const workspace = workspaceId, sequence = loadSequence, current = record;
    const draft = $state.snapshot(definition);
    const isCurrent = () => open && workspace === workspaceId && sequence === loadSequence;
    busy = true; error = '';
    try {
      if (command === 'create' || command === 'update') {
        form.form.set(draft);
        if (!(await form.validateForm({ update: true })).valid) { if (isCurrent()) error = 'creative_invalid_input'; return; }
      }
      if (!isCurrent()) return;
      const payload = { command, ...(current ? { id: current.id, revision: current.revision } : {}), ...(['create','update'].includes(command) ? { definition: draft } : {}) };
      const saved = await creativeApi<CreativeCharacter | { removed: true }>(`/api/agent-room/workspaces/${workspace}/creative-media/characters`, 'POST', payload);
      if (!isCurrent()) return;
      await load('id' in saved ? saved.id : '');
      await onSaved();
    } catch (cause) { if (isCurrent()) error = (cause as Error).message; }
    finally { busy = false; }
  }
  function voiceKind(kind: string) {
    definition.voice = kind === 'audio' ? { kind: 'audio', path: '', language: 'en-US', style: '' } : kind === 'provider' ? { kind: 'provider', voiceId: '', profileId: '', modelIds: [], language: 'en-US', style: '' } : { kind: 'unassigned' };
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex h-[min(800px,calc(100dvh-32px))] w-[calc(100vw-32px)] flex-col overflow-hidden sm:max-w-3xl [&_[data-slot=native-select-wrapper]]:w-full">
    <Dialog.Header><Dialog.Title>{m['creative.characters']()}</Dialog.Title><Dialog.Description>{m['creative.character_library_help']()}</Dialog.Description></Dialog.Header>
    {#if loading}<p role="status" class="text-xs text-muted-foreground">{m['creative.loading']()}</p>{/if}
    <fieldset disabled={busy || !ready} class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 disabled:opacity-70">
      <div class="flex min-w-0 items-center gap-2"><div class="min-w-0 flex-1"><ModelCombobox value={selectedId} options={records.map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version} · ${item.state === 'locked' ? m['creative.character_locked']() : m['creative.character_draft']()}` }))} defaultLabel={m['creative.character_new']()} searchPlaceholder={m['creative.character_search']()} emptyLabel={m['creative.character_empty']()} ariaLabel={m['creative.characters']()} onValueChange={select} /></div><Button size="icon" variant="outline" aria-label={m['creative.character_new']()} title={m['creative.character_new']()} onclick={() => select('')}><Plus size={16} /></Button></div>
      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
        {#if record}<div class="flex flex-wrap items-center gap-2 text-xs"><span class="inline-flex items-center gap-1 font-semibold">{#if locked}<LockKeyhole size={13} />{/if}{locked ? m['creative.character_locked']() : m['creative.character_draft']()} · v{record.version}</span><code class="break-all text-muted-foreground">{record.id}</code></div>{/if}
        <fieldset disabled={locked} class="space-y-4">
          <label class="block space-y-1 text-sm"><span>{m['creative.character_name']()}</span><Input bind:value={definition.name} maxlength={80} aria-invalid={Boolean($errors.name)} /></label>
          {#if $errors.name}<p role="alert" class="text-xs text-destructive">{m['creative.field_invalid']()}</p>{/if}
          <label class="block space-y-1 text-sm"><span>{m['creative.character_appearance']()}</span><Textarea bind:value={definition.appearance} maxlength={8000} class="min-h-28" /></label>
          <section class="space-y-2" aria-label={m['creative.character_images']()}>
            <div class="flex items-center justify-between gap-2 text-sm font-medium"><span>{m['creative.character_images']()}</span><Button size="icon-sm" variant="ghost" disabled={definition.images.length >= 12 || locked} title={m['creative.add_media']()} aria-label={m['creative.add_media']()} onclick={() => definition.images = [...definition.images, '']}><Plus size={14} /></Button></div>
            {#if !locked && images.length}<ModelCombobox value="" options={images.filter(image => !definition.images.includes(image.path)).map(image => ({ value: image.path, label: image.title || image.path }))} defaultLabel={m['creative.character_add_image']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.character_add_image']()} onValueChange={(path) => { if (path && definition.images.length < 12) definition.images = [...definition.images, path]; }} />{/if}
            {#each definition.images as path, index}<div class="flex min-w-0 items-center gap-1">{#if path}<img loading="lazy" draggable="false" class="size-12 shrink-0 rounded border object-contain" src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(path)}`} alt={`${definition.name} ${index + 1}`} />{/if}<Input aria-label={`${m['creative.character_images']()} ${index + 1}`} placeholder={m['creative.workspace_file']()} bind:value={definition.images[index]} /><Button variant="ghost" size="icon-sm" disabled={locked} aria-label={m['creative.delete']()} onclick={() => definition.images = definition.images.filter((_, i) => i !== index)}><X size={14} /></Button></div>{/each}
          </section>
          <label class="block space-y-1 text-sm"><span>{m['creative.character_voice']()}</span><NativeSelect.Root value={definition.voice.kind} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => voiceKind(event.currentTarget.value)}><option value="unassigned">{m['creative.character_voice_unassigned']()}</option><option value="audio">{m['creative.character_voice_audio']()}</option><option value="provider">{m['creative.character_voice_provider']()}</option></NativeSelect.Root></label>
          {#if definition.voice.kind === 'audio'}<label class="block space-y-1 text-sm"><span>{m['creative.character_voice_file']()}</span><Input bind:value={definition.voice.path} placeholder={m['creative.workspace_file']()} /></label>{#if definition.voice.path}<audio controls preload="none" class="w-full" aria-label={m['creative.character_voice_file']()} src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(definition.voice.path)}`}></audio>{/if}{/if}
          {#if definition.voice.kind === 'provider'}
            <label class="block space-y-1 text-sm"><span>{m['creative.character_voice_id']()}</span><Input bind:value={definition.voice.voiceId} maxlength={200} /></label>
            <label class="block space-y-1 text-sm"><span>{m['creative.account']()}</span><NativeSelect.Root bind:value={definition.voice.profileId}><option value="">{m['creative.choose_account']()}</option>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</NativeSelect.Root></label>
            <label class="block space-y-1 text-sm"><span>{m['creative.character_voice_models']()}</span><Textarea value={definition.voice.modelIds.join('\n')} oninput={(event: Event & { currentTarget: HTMLTextAreaElement }) => { if (definition.voice.kind === 'provider') definition.voice.modelIds = event.currentTarget.value.split('\n').map(value => value.trim()).filter(Boolean); }} /></label>
          {/if}
          {#if definition.voice.kind !== 'unassigned'}<label class="block space-y-1 text-sm"><span>{m['creative.character_language']()}</span><Input bind:value={definition.voice.language} maxlength={40} /></label><label class="block space-y-1 text-sm"><span>{m['creative.character_delivery']()}</span><Textarea bind:value={definition.voice.style} maxlength={2000} /></label>{/if}
        </fieldset>
        {#if record?.snapshot}<details class="border-t pt-3"><summary class="cursor-pointer text-sm">{m['creative.character_fingerprint']()}</summary><code class="mt-2 block break-all text-xs">{record.snapshot.digest}</code>{#each [...record.snapshot.images, ...(record.snapshot.voice ? [record.snapshot.voice] : [])] as media}<p class="mt-2 break-all font-mono text-xs text-muted-foreground">{media.path}<br />{media.sha256}</p>{/each}</details>{/if}
      </div>
    </fieldset>
    {#if error}<p role="alert" class="shrink-0 text-sm text-destructive">{creativeError(error)}</p>{/if}
    {#if !loading && !ready}<Button variant="outline" onclick={() => load()}>{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="shrink-0 flex-wrap gap-2 border-t pt-3 sm:justify-between">
      <div>{#if record && !locked}<Button variant="ghost" disabled={busy} onclick={() => confirmation = 'remove'}><Trash2 size={14} />{m['creative.delete']()}</Button>{/if}</div>
      <div class="flex flex-wrap justify-end gap-2"><Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button>{#if locked}<Button disabled={busy || !ready} onclick={() => command('fork')}><Copy size={14} />{m['creative.character_new_version']()}</Button>{:else}{#if record}<Button variant="outline" disabled={busy || !ready || JSON.stringify(definition) !== JSON.stringify(record.definition)} onclick={() => confirmation = 'lock'}><LockKeyhole size={14} />{m['creative.character_lock']()}</Button>{/if}<Button disabled={busy || !ready} onclick={() => command(record ? 'update' : 'create')}><Save size={14} />{m['creative.save']()}</Button>{/if}</div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={confirmation !== null} onOpenChange={(value: boolean) => { if (!value) confirmation = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{confirmation === 'lock' ? m['creative.character_lock']() : m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{confirmation === 'lock' ? m['creative.character_lock_help']() : m['creative.character_delete_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { const action = confirmation; confirmation = null; if (action) void command(action); }}>{confirmation === 'lock' ? m['creative.character_lock']() : m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
