<script lang="ts">
  import { Film, Music2, Image, Plus, X, ExternalLink } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import { mediaSlotLabel, matchingMediaInputs, mediaInputThumbnail, mediaBindingInput, type CreativeMediaInput } from './creative-media-presentation.js';
  import CreativeMediaPreview from './CreativeMediaPreview.svelte';
  import CreativeWorkspaceMediaPicker from './CreativeWorkspaceMediaPicker.svelte';
  import type { CreativeConfig } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  let { workspaceId, bindings, slots, inputs, onChange, onOpenNode }: {
    workspaceId: string; bindings: CreativeConfig['mediaBindings']; slots: string[]; inputs: CreativeMediaInput[];
    onChange: (bindings: CreativeConfig['mediaBindings']) => void; onOpenNode?: (id: string) => void;
  } = $props();
  const inputIndex = $derived(new Map([...inputs, ...bindings.flatMap(binding => {
    const input = mediaBindingInput(binding, inputs);
    return input ? [input] : [];
  })].map(input => [input.id, input])));
  const available = $derived(slots.filter(slot => !bindings.some(binding => binding.pointer === slot)));
  function update(index: number, value: CreativeConfig['mediaBindings'][number]) {
    onChange(bindings.map((binding, i) => i === index ? value : binding));
  }
</script>

{#snippet thumbnail(option: { value: string; label: string })}
  {@const input = inputIndex.get(option.value)}
  {@const url = input && mediaInputThumbnail(workspaceId, input)}
  <span class="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-[var(--app-canvas)]" aria-hidden="true">
    {#if url}<img src={url} alt="" loading="lazy" decoding="async" class="size-full object-contain" />
    {:else if input?.mimeType?.startsWith('audio/')}<Music2 size={15} />
    {:else if input?.type === 'video'}<Film size={15} />{:else}<Image size={15} />{/if}
  </span>
{/snippet}

<section class="space-y-3 border-t border-[var(--app-border)] pt-3" aria-label={m['creative.media_bindings']()} data-testid="creative-media-inputs">
  <div class="flex items-center justify-between gap-2 text-xs font-medium"><span>{m['creative.media_bindings']()}</span><Button size="icon-sm" variant="ghost" disabled={bindings.length >= 50 || !available.length} title={m['creative.add_media']()} aria-label={m['creative.add_media']()} onclick={() => onChange([...bindings, { pointer: available[0], path: '' }])}><Plus size={14} /></Button></div>
  <p class="text-xs leading-5 text-[var(--app-text-muted)]">{m['creative.upload_disclosure']()}</p>
  {#each bindings as binding, index}
    {@const source = mediaBindingInput(binding, inputs)}
    {@const choices = [...new Set([binding.pointer, ...available])].filter(Boolean)}
    {@const media = matchingMediaInputs(inputs, binding.pointer)}
    {@const sources = source && !binding.nodeId ? [source, ...media] : media}
    <div class="min-w-0 space-y-2 border-l-2 border-[var(--app-border)] pl-3" data-media-binding={binding.pointer}>
      <div class="flex min-w-0 items-center gap-1">
        <div class="min-w-0 flex-1"><ModelCombobox value={binding.pointer} options={choices.map(pointer => ({ value: pointer, label: mediaSlotLabel(pointer) }))} defaultLabel={m['creative.media_role']()} searchPlaceholder={m['creative.media_role']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.media_role']()} onValueChange={(pointer) => { if (pointer) update(index, { ...binding, pointer }); }} /></div>
        <Button size="icon-sm" variant="ghost" title={m['creative.delete']()} aria-label={m['creative.delete']()} onclick={() => onChange(bindings.filter((_, i) => i !== index))}><X size={13} /></Button>
      </div>
      {#if source}<CreativeMediaPreview {workspaceId} {source} />{:else if binding.nodeId}<p role="alert" class="text-xs text-destructive">{m['creative.media_missing']()}</p>{/if}
      <ModelCombobox value={source?.id ?? ''} options={sources.map(item => ({ value: item.id, label: item.title || item.path?.split('/').at(-1) || item.id }))} details={Object.fromEntries(sources.map(item => [item.id, item.path ?? '']))} optionIcon={thumbnail} defaultLabel={m['creative.media_choose']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.media_source']()} onValueChange={(nodeId) => { if (source && !binding.nodeId && nodeId === source.id) return; update(index, { pointer: binding.pointer, ...(nodeId ? { nodeId } : { path: '' }) }); }} />
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <CreativeWorkspaceMediaPicker {workspaceId} pointer={binding.pointer} onSelect={(path) => update(index, { pointer: binding.pointer, path })} />
        {#if source && binding.nodeId && onOpenNode}<Button size="icon-sm" variant="ghost" aria-label={m['creative_review.open']()} title={m['creative_review.open']()} onclick={() => onOpenNode?.(source.id)}><ExternalLink size={14} /></Button>{/if}
      </div>
      <details class="text-xs text-[var(--app-text-muted)]"><summary class="cursor-pointer">{m['creative.media_technical']()}</summary><code class="block break-all py-2">{binding.pointer}</code>
        {#if !binding.nodeId}<label class="block space-y-1"><span>{m['creative.workspace_file']()}</span><Input aria-label={m['creative.workspace_file']()} placeholder={m['creative.workspace_file']()} value={binding.path ?? ''} oninput={(event) => update(index, { pointer: binding.pointer, path: event.currentTarget.value })} /></label>
        {:else if source?.path}<code class="block break-all pb-1">{source.path}</code>{/if}
      </details>
    </div>
  {/each}
</section>
