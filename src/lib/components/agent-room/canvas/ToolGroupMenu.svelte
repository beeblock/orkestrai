<script lang="ts" module>
  import type { Component } from 'svelte';

  export type ToolGroupItem = {
    id: string;
    label: string;
    hint?: string;
    icon?: Component<{ size?: number; class?: string }>;
    image?: string;
    active?: boolean;
    /** Creation tools can also be dragged from the menu onto the canvas. */
    dragTool?: string;
    onSelect: () => void;
  };
</script>

<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import { cn } from '$lib/utils.js';

  let { label, heading, items, extra }: { label: string; heading?: string; items: ToolGroupItem[]; extra?: import('svelte').Snippet } = $props();

  const active = $derived(items.some((item) => item.active));

  function startToolDrag(event: DragEvent, dragTool: string) {
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-orkestrai-tool', dragTool);
  }
</script>

<!-- A labelled group of canvas tools: one dock button instead of a row of icons. -->
<DropdownMenu.Root>
  <DropdownMenu.Trigger
    data-tool-group-trigger
    class={cn(
      'group inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border-0 bg-transparent px-2.5 text-ui-md font-medium text-[var(--app-text-soft)] outline-none transition-[color,background-color,transform] duration-150 ease-smooth-out hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 data-[state=open]:bg-[var(--app-hover)] data-[state=open]:text-[var(--app-text)]',
      active && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]',
    )}
  >
    <span>{label}</span>
    <ChevronDown size={12} class="opacity-60 transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content side="top" align="center" sideOffset={10} class="w-[min(300px,calc(100vw-24px))] p-1.5">
    <DropdownMenu.Label>{heading ?? label}</DropdownMenu.Label>
    {#each items as item (item.id)}
      <DropdownMenu.Item
        class={cn('min-h-10 gap-3', item.active && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]')}
        onclick={item.onSelect}
        draggable={item.dragTool ? 'true' : undefined}
        ondragstart={item.dragTool ? (event: DragEvent) => startToolDrag(event, item.dragTool!) : undefined}
      >
        {#if item.image}
          <img src={item.image} width="16" height="16" alt="" class="shrink-0 opacity-80" />
        {:else if item.icon}
          <item.icon size={16} class="shrink-0" />
        {/if}
        <span class="min-w-0">
          <strong class="block text-xs font-medium">{item.label}</strong>
          {#if item.hint}<small class="mt-0.5 block text-ui-xs text-muted-foreground">{item.hint}</small>{/if}
        </span>
      </DropdownMenu.Item>
    {/each}
    {#if extra}{@render extra()}{/if}
  </DropdownMenu.Content>
</DropdownMenu.Root>
