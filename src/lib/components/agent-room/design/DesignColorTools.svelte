<script lang="ts">
  import { ListFilter, Palette } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Popover from '$lib/components/ui/popover';
  import * as m from '$lib/paraglide/messages.js';

  let {
    role,
    color,
    matches,
    selectionCount,
    onSelectMatches,
    onSelectLayer,
    onApplySelection,
    onReplaceMatches,
  }: {
    role: 'fill' | 'stroke';
    color: string | null;
    matches: Array<{ id: string; name: string }>;
    selectionCount: number;
    onSelectMatches: () => void;
    onSelectLayer: (id: string) => void;
    onApplySelection: (color: string) => void;
    onReplaceMatches: (color: string) => void;
  } = $props();

  let nextColor = $state('#7c5cff');

  $effect(() => {
    if (color) nextColor = color.slice(0, 7);
  });
</script>

{#if color}
  <Popover.Root>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="ghost" size="sm" class="h-7 w-full justify-start gap-2 px-2 text-ui-xs text-[var(--app-text-muted)]">
          <span class="size-3 shrink-0 border border-black/15" style:background={color}></span>
          <span class="min-w-0 flex-1 truncate">{m['design.color_occurrences']({ count: String(matches.length), color: color.toUpperCase() })}</span>
          <ListFilter size={12} />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="end" class="z-[140] w-72 space-y-3 p-3">
      <div class="flex items-center gap-2">
        <Palette size={14} class="text-[var(--app-accent)]" />
        <div class="min-w-0">
          <p class="text-xs font-semibold">{role === 'fill' ? m['design.same_fill']() : m['design.same_stroke']()}</p>
          <p class="text-ui-xs text-[var(--app-text-muted)]">{m['design.color_occurrences']({ count: String(matches.length), color: color.toUpperCase() })}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" class="w-full justify-start" onclick={onSelectMatches}><ListFilter size={13} />{m['design.select_same_color']()}</Button>
      <div class="max-h-36 space-y-0.5 overflow-y-auto border-y border-[var(--app-border)] py-1">
        {#each matches as match (match.id)}
          <button class="block h-7 w-full truncate px-2 text-left text-ui-xs text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)]" onclick={() => onSelectLayer(match.id)}>{match.name}</button>
        {/each}
      </div>
      <div class="grid grid-cols-[44px_1fr] gap-2">
        <Input aria-label={m['design.replacement_color_picker']()} type="color" class="h-8 w-full p-1" bind:value={nextColor} />
        <Input aria-label={m['design.replacement_color']()} class="h-8 font-mono text-ui-xs uppercase" bind:value={nextColor} />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" disabled={!selectionCount} onclick={() => onApplySelection(nextColor)}>{m['design.apply_to_selected']({ count: String(selectionCount) })}</Button>
        <Button size="sm" onclick={() => onReplaceMatches(nextColor)}>{m['design.replace_all']({ count: String(matches.length) })}</Button>
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}
