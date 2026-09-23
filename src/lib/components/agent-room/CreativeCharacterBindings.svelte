<script lang="ts">
  import { untrack } from 'svelte';
  import { UsersRound, X, LockKeyhole, RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import CreativeCharacterDialog from './CreativeCharacterDialog.svelte';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import type { CreativeConfig } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
  import { modelMediaSlots, modelVoiceIdSlots, type FalModelContract } from '$lib/modules/creative-media/domain/model-contract.js';
  import { characterAlias, suggestCharacterBinding } from '$lib/modules/creative-media/domain/character-binding.js';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import { mediaSlotLabel } from './creative-media-presentation.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, config, contract, onChange, onRecords, disabled = false }: { workspaceId: string; config: CreativeConfig; contract: FalModelContract | null; onChange: (value: CreativeConfig['characterBindings']) => void; onRecords: (records: CreativeCharacter[]) => void; disabled?: boolean } = $props();
  let records = $state<CreativeCharacter[]>([]), open = $state(false), error = $state(''), loading = $state(false);
  let pending = $state<CreativeCharacter | null>(null);
  let loadSequence = 0;
  const value = $derived(config.characterBindings);
  const used = $derived([...config.mediaBindings.map(binding => binding.pointer), ...value.flatMap(binding => [...binding.imagePointers, binding.voicePointer])]);
  const slots = $derived(contract ? modelMediaSlots(contract.schema, used) : []);
  const voiceIds = $derived(contract ? modelVoiceIdSlots(contract.schema, used) : []);
  const rawUrl = (path: string) => `/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(path)}`;
  async function load() {
    const sequence = ++loadSequence, workspace = workspaceId;
    loading = true;
    try { const result = await creativeApi<CreativeCharacter[]>(`/api/agent-room/workspaces/${workspace}/creative-media/characters`); if (sequence === loadSequence && workspace === workspaceId) { records = result; onRecords(result); error = ''; } }
    catch (cause) { if (sequence === loadSequence && workspace === workspaceId) error = (cause as Error).message; }
    finally { if (sequence === loadSequence) loading = false; }
  }
  $effect(() => { const workspace = workspaceId; untrack(() => { records = []; onRecords([]); pending = null; if (workspace) void load(); }); return () => { loadSequence++; }; });
  function add(id: string) {
    if (disabled) return;
    const record = records.find(item => item.id === id);
    if (!record || record.state !== 'locked' || value.length >= 8 || value.some(item => item.id === id)) return;
    const result = suggestCharacterBinding(record, contract, config);
    if (result.binding) { onChange([...value, result.binding]); pending = null; error = ''; }
    else { pending = record; error = 'creative_character_auto_binding'; }
  }
  function manual() {
    if (disabled || !pending || value.length >= 8) return;
    onChange([...value, { id: pending.id, alias: characterAlias(pending, value), imagePointers: pending.definition.images.map(() => ''), voicePointer: '' }]);
    pending = null; error = '';
  }
  function pointer(index: number, position: number | 'voice', path: string) {
    if (disabled) return;
    onChange(value.map((binding, i) => i !== index ? binding : position === 'voice' ? { ...binding, voicePointer: path } : { ...binding, imagePointers: binding.imagePointers.map((previous, j) => j === position ? path : previous) }));
  }
  function remap(record: CreativeCharacter) {
    if (disabled) return;
    const result = suggestCharacterBinding(record, contract, config);
    if (result.binding) { onChange(value.map(binding => binding.id === record.id ? result.binding! : binding)); error = ''; }
    else error = 'creative_character_auto_binding';
  }
</script>
<section class="space-y-2 border-t border-[var(--app-border)] py-3" aria-label={m['creative.characters']()}>
  <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-xs font-semibold">{m['creative.characters']()} ({value.length})</h3><div class="flex items-center gap-1"><Button variant="ghost" size="icon-sm" disabled={loading} aria-label={m['creative.refresh']()} title={m['creative.refresh']()} onclick={load}><RefreshCw size={14} /></Button><Button variant="outline" size="sm" onclick={() => open = true}><UsersRound size={14} />{m['creative.character_library']()}</Button></div></div>
  <fieldset disabled={disabled || loading} class="min-w-0 space-y-3">
    {#if value.length < 8}<ModelCombobox value="" options={records.filter(item => item.state === 'locked' && !value.some(binding => binding.id === item.id)).map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version}` }))} defaultLabel={m['creative.character_bind']()} searchPlaceholder={m['creative.character_search']()} emptyLabel={m['creative.character_no_locked']()} ariaLabel={m['creative.character_bind']()} onValueChange={add} />{/if}
    {#each value as binding, index (binding.id)}
      {@const record = records.find(item => item.id === binding.id)}
      <div class="space-y-2 border-l-2 border-[var(--app-accent)] pl-3 text-xs" data-testid="character-binding">
        <div class="flex items-center justify-between gap-1"><strong class="min-w-0 break-words"><LockKeyhole size={12} class="mr-1 inline" />{record ? `${record.definition.name} · v${record.version}` : m['creative.character_missing']()}</strong><Button variant="ghost" size="icon-sm" title={m['creative.delete']()} aria-label={m['creative.delete']()} onclick={() => onChange(value.filter((_, i) => i !== index))}><X size={13} /></Button></div>
        {#if record}
          <div class="flex gap-2 overflow-x-auto overscroll-contain pb-1">{#each record.definition.images as path, imageIndex}<img src={rawUrl(path)} alt={m['creative.character_image_input']({ index: String(imageIndex + 1) })} width="64" height="64" loading="lazy" class="size-16 shrink-0 rounded border border-[var(--app-border)] bg-[var(--app-canvas)] object-contain" />{/each}</div>
          {#if record.definition.voice.kind !== 'unassigned'}<p class="break-words text-[var(--app-text-muted)]">{m['creative.character_voice']()} · {record.definition.voice.language}{#if record.definition.voice.style} · {record.definition.voice.style}{/if}</p>{/if}
          {#if record.definition.voice.kind === 'audio'}<audio class="h-8 w-full min-w-0" controls preload="none" aria-label={m['creative.character_voice']()} src={rawUrl(record.definition.voice.path)}></audio>{/if}
        {/if}
        <details open={binding.imagePointers.some(path => !path) || !binding.voicePointer}>
          <summary class="cursor-pointer py-1 text-[var(--app-text-muted)]">{m['creative.reference_mapping']()}</summary>
          <div class="space-y-2 py-2">
            {#if record}<Button variant="outline" size="sm" onclick={() => remap(record)}><RefreshCw size={13} />{m['creative.reference_auto']()}</Button>{/if}
            {#each binding.imagePointers as path, position}<div class="space-y-1"><span>{m['creative.character_image_input']({ index: String(position + 1) })}</span><ModelCombobox value={path} options={slots.filter(path => /image|frame/i.test(path)).map(path => ({ value: path, label: mediaSlotLabel(path) }))} defaultLabel={m['creative.media_role']()} searchPlaceholder={m['creative.media_role']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.character_image_input']({ index: String(position + 1) })} onValueChange={(path) => pointer(index, position, path)} /></div>{/each}
            <div class="space-y-1"><span>{m['creative.character_voice_input']()}</span><ModelCombobox value={binding.voicePointer} options={(record?.definition.voice.kind === 'provider' ? voiceIds : slots.filter(path => /audio|voice/i.test(path))).map(path => ({ value: path, label: mediaSlotLabel(path) }))} defaultLabel={m['creative.media_role']()} searchPlaceholder={m['creative.media_role']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.character_voice_input']()} onValueChange={(path) => pointer(index, 'voice', path)} /></div>
            <label class="block space-y-1"><span>{m['creative.reference_alias']()}</span><Input value={binding.alias ?? ''} maxlength={64} oninput={(event: Event & { currentTarget: HTMLInputElement }) => onChange(value.map((item, i) => i === index ? { ...item, alias: event.currentTarget.value || undefined } : item))} /></label>
          </div>
        </details>
      </div>
    {/each}
    {#if pending}<div class="space-y-2"><p class="text-xs">{pending.definition.name}</p><Button size="sm" variant="outline" onclick={manual}>{m['creative.reference_manual']()}</Button></div>{/if}
  </fieldset>
  {#if error}<p role="alert" class="text-xs text-destructive">{creativeError(error)}</p>{/if}
</section>
<CreativeCharacterDialog bind:open {workspaceId} onSaved={load} />
