<script lang="ts">
  import { ListFilter } from '@lucide/svelte';
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
    compact = false,
  }: {
    /** Versao so-icone para o cabecalho da secao de pintura. */
    compact?: boolean;
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
  {@const summary = m['design.color_occurrences']({ count: String(matches.length), color: color.toUpperCase() })}
  <Popover.Root>
    <Popover.Trigger>
      {#snippet child({ props })}
        {#if compact}
          <Button {...props} variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] hover:text-[var(--app-text)] data-[state=open]:bg-[var(--app-active)] data-[state=open]:text-[var(--app-text)]" aria-label={summary} title={summary}>
            <ListFilter size={14} />
          </Button>
        {:else}
          <Button {...props} variant="ghost" size="sm" class="h-7 w-full justify-start gap-2 px-2 text-ui-sm font-normal text-[var(--app-text-soft)] hover:bg-[var(--app-hover)] data-[state=open]:bg-[var(--app-active)]">
            <span class="size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)]" style:background={color}></span>
            <span class="min-w-0 flex-1 truncate text-left">{summary}</span>
            <ListFilter size={13} class="text-[var(--app-text-muted)]" />
          </Button>
        {/if}
      {/snippet}
    </Popover.Trigger>
    <Popover.Content align="end" sideOffset={6} class="z-[140] w-72 space-y-3 p-3">
      <div class="flex items-center gap-2.5">
        <span class="size-7 shrink-0 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)]" style:background={color}></span>
        <div class="min-w-0">
          <p class="text-ui-lg font-semibold">{role === 'fill' ? m['design.same_fill']() : m['design.same_stroke']()}</p>
          <p class="truncate text-ui-sm text-[var(--app-text-muted)]">{summary}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" class="w-full justify-start" onclick={onSelectMatches}><ListFilter size={13} />{m['design.select_same_color']()}</Button>
      <div class="max-h-36 space-y-0.5 overflow-y-auto">
        {#each matches as match (match.id)}
          <button type="button" class="flex h-7 w-full items-center truncate rounded-md px-2 text-left text-ui-sm text-[var(--app-text-soft)] transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]" onclick={() => onSelectLayer(match.id)}>{match.name}</button>
        {/each}
      </div>
      <div class="grid grid-cols-[28px_minmax(0,1fr)] gap-1.5 border-t border-[var(--app-border)] pt-3">
        <Input aria-label={m['design.replacement_color_picker']()} type="color" class="size-7 cursor-pointer rounded-md p-0.5" bind:value={nextColor} />
        <Input aria-label={m['design.replacement_color']()} class="h-7 font-mono text-ui-md uppercase md:text-ui-md" bind:value={nextColor} />
      </div>
      <div class="grid grid-cols-2 gap-1.5">
        <Button variant="outline" size="sm" disabled={!selectionCount} onclick={() => onApplySelection(nextColor)}>{m['design.apply_to_selected']({ count: String(selectionCount) })}</Button>
        <Button size="sm" onclick={() => onReplaceMatches(nextColor)}>{m['design.replace_all']({ count: String(matches.length) })}</Button>
      </div>
    </Popover.Content>
  </Popover.Root>
{/if}
