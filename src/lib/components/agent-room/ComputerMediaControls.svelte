<script lang="ts">
  import { RefreshCw, Save } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Switch } from '$lib/components/ui/switch';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Slider } from '$lib/components/ui/slider';
  import { Textarea } from '$lib/components/ui/textarea';
  import * as Select from '$lib/components/ui/select';
  import { computerMediaContentTypes, type ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
  import type { ComputerAccessibility, ComputerCommandInput, ComputerCommandResult, ComputerWindow } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  import ConversationRecovery from './ConversationRecovery.svelte';

  let { grant, windows, command, update, disabled = false }: { grant: ComputerReplyGrant; windows: ComputerWindow[]; command: (input: ComputerCommandInput) => Promise<ComputerCommandResult | null>; update: (fields: Partial<ComputerReplyGrant>) => Promise<void>; disabled?: boolean } = $props();
  type Media = NonNullable<ComputerReplyGrant['media']>;
  let tree = $state<ComputerAccessibility | null>(null);
  let controls = $state<Partial<Pick<Media, 'open' | 'menu' | 'send'>>>({});
  let photo = $state<Media['photo']>(undefined);
  let photoControls = $state<Partial<Pick<Media, 'open' | 'menu' | 'send'>>>({});
  let editingPhoto = $state(false);
  let maxMiB = $state(20);
  let contentTypes = $state<Media['contentTypes']>(['image/png', 'image/jpeg', 'application/pdf', 'audio/wav']);
  let receive = $state<Media['receive']>(undefined);
  let markers = $state('');
  let busy = $state(false);
  let enabled = $state(false);
  const text = m as unknown as Record<string, () => string>;
  const types: Media['contentTypes'] = [...computerMediaContentTypes];
  const target = $derived(windows.find(w => w.appId === grant.applicationId && w.focused));
  const valid = $derived(controls.open && controls.send && (!editingPhoto || photoControls.open && photoControls.send) && contentTypes.length > 0 && markers.split('\n').filter(Boolean).length <= 8 && markers.split('\n').every(marker => marker.length <= 500));
  $effect(() => { const media = grant.media; enabled = media?.enabled ?? false; controls = media ? { open: media.open, menu: media.menu, send: media.send } : {}; maxMiB = media?.maxMiB ?? 20; contentTypes = media?.contentTypes ?? ['image/png', 'image/jpeg', 'application/pdf', 'audio/wav']; receive = media?.receive; markers = media?.receive?.incomingMarkers.join('\n') ?? ''; });
  $effect(() => { photo = grant.media?.photo; photoControls = grant.media?.photo ? { ...grant.media.photo } : {}; });

  async function read() {
    if (!target) return;
    busy = true;
    try { const result = await command({ command: 'read', targetId: target.id }); if (result?.kind === 'accessibility') tree = result.tree; }
    finally { busy = false; }
  }
  async function save() {
    if (!controls.open || !controls.send || !valid) return;
    const nextPhoto = photoControls.open && photoControls.send ? { open: photoControls.open, send: photoControls.send, ...(photoControls.menu ? { menu: photoControls.menu } : {}) } : photo;
    await update({ media: { enabled, open: controls.open, send: controls.send, ...(controls.menu ? { menu: controls.menu } : {}), ...(nextPhoto ? { photo: nextPhoto } : {}), maxMiB, contentTypes, ...(receive ? { receive: { ...receive, incomingMarkers: markers.split('\n').filter(Boolean) } } : {}) } });
  }
</script>

<details class="min-w-0 text-xs" data-testid="computer-media-controls">
  <summary class="cursor-pointer py-2 font-medium">{text['companion.media_title']()}</summary>
  <div class="space-y-3 pb-3">
    <label class="flex items-center justify-between gap-3"><span>{text['companion.media_enabled']()}</span><Switch checked={enabled} disabled={disabled} onCheckedChange={(value: boolean) => { enabled = value; if (!value && grant.media) void update({ media: { ...grant.media, enabled: false } }); }} /></label>
    <Button size="sm" variant="outline" disabled={disabled || busy || !target} onclick={read}><RefreshCw size={13} />{text['computer.reply_read']()}</Button>
    <label class="grid gap-1"><span>{m['companion.media_route']()}</span><Select.Root type="single" value={editingPhoto ? 'photo' : 'document'} onValueChange={(value: string) => { editingPhoto = value === 'photo'; }}><Select.Trigger class="w-full" {disabled}>{editingPhoto ? m['companion.media_photo']() : m['companion.media_document']()}</Select.Trigger><Select.Content><Select.Item value="photo">{m['companion.media_photo']()}</Select.Item><Select.Item value="document">{m['companion.media_document']()}</Select.Item></Select.Content></Select.Root></label>
    {#each ['open', 'menu', 'send'] as kind}
      {@const key = kind as 'open' | 'menu' | 'send'}
      {@const selected = (editingPhoto ? photoControls : controls)[key]}
      {@const options = tree?.available && !tree.truncated ? tree.elements.filter(e => e.name && !e.protected && e.enabled && e.actions.includes('press')) : []}
      <label class="block min-w-0 space-y-1"><span>{text[`companion.media_${key}`]()}</span>
        <Select.Root type="single" value={selected?.id ?? ''} onValueChange={(id: string) => { const item = options.find(e => e.id === id); const selected = item ? { id: item.id, role: item.role, name: item.name } : undefined; if (editingPhoto) photoControls = { ...photoControls, [key]: selected }; else controls = { ...controls, [key]: selected }; }}>
          <Select.Trigger class="w-full" disabled={disabled || busy}><span class="truncate">{selected?.name ?? m['computer.choose_target']()}</span></Select.Trigger>
          <Select.Content>{#if key === 'menu'}<Select.Item value="none">{text['companion.media_no_menu']()}</Select.Item>{/if}{#each options as item}<Select.Item value={item.id}>{item.name.slice(0, 100)} · {item.role}</Select.Item>{/each}</Select.Content>
        </Select.Root>
      </label>
    {/each}
    <label class="flex items-center justify-between gap-3"><span>{text['companion.media_receive']()}</span><Switch checked={receive?.enabled ?? false} disabled={disabled || !receive} onCheckedChange={(enabled: boolean) => { if (receive) receive = { ...receive, enabled }; }} /></label>
    <label class="block space-y-1"><span>{text['companion.media_download']()}</span>
      <Select.Root type="single" value={receive?.download.id ?? ''} onValueChange={(id: string) => { const item = tree?.elements.find(e => e.id === id); if (item) receive = { enabled: receive?.enabled ?? false, incomingMarkers: [], ...receive, download: { id: item.id, role: item.role, name: item.name } }; }}>
        <Select.Trigger class="w-full" disabled={disabled || busy}><span class="truncate">{receive?.download.name ?? m['computer.choose_target']()}</span></Select.Trigger><Select.Content>{#each tree?.elements.filter(e => !e.protected && e.enabled && e.actions.includes('press') && e.name) ?? [] as item}<Select.Item value={item.id}>{item.name.slice(0, 100)} · {item.role}</Select.Item>{/each}</Select.Content>
      </Select.Root>
    </label>
    <label class="block min-w-0 space-y-1"><span>{text['companion.media_receive_menu']()}</span>
      <Select.Root type="single" value={receive?.menu?.id ?? 'none'} onValueChange={(id: string) => { if (!receive) return; const item = tree?.elements.find(e => e.id === id); receive = { ...receive, menu: item ? { id: item.id, role: item.role, name: item.name } : undefined }; }}>
        <Select.Trigger class="w-full" disabled={disabled || busy || !receive}><span class="truncate">{receive?.menu?.name ?? text['companion.media_no_menu']()}</span></Select.Trigger>
        <Select.Content><Select.Item value="none">{text['companion.media_no_menu']()}</Select.Item>{#each tree?.elements.filter(e => !e.protected && e.enabled && e.actions.includes('press') && e.name) ?? [] as item}<Select.Item value={item.id}>{item.name.slice(0, 100)} · {item.role}</Select.Item>{/each}</Select.Content>
      </Select.Root>
    </label>
    <label class="block space-y-1"><span>{text['companion.media_markers']()}</span><Textarea bind:value={markers} disabled={disabled || !receive} rows={2} maxlength={4007} /></label>
    <fieldset class="grid grid-cols-2 gap-2"><legend class="mb-2">{text['companion.media_types']()}</legend>{#each types as type}<label class="flex min-w-0 items-center gap-2"><Checkbox checked={contentTypes.includes(type)} disabled={disabled} onCheckedChange={(checked: boolean) => { contentTypes = checked ? [...contentTypes.filter(t => t !== type), type] : contentTypes.filter(t => t !== type); }} /><span class="break-all">{type}</span></label>{/each}</fieldset>
    <label class="block space-y-2"><span>{text['companion.media_limit']()}: {maxMiB} MiB</span><Slider type="single" min={1} max={50} step={1} bind:value={maxMiB} disabled={disabled} aria-label={text['companion.media_limit']()} /></label>
    <Button size="sm" disabled={disabled || busy || !valid || !grant.enabled} onclick={save}><Save size={13} />{text['companion.media_save']()}</Button>
    {#if grant.media?.enabled}<ConversationRecovery {grant} {windows} {command} disabled={disabled || busy} media />{/if}
  </div>
</details>
