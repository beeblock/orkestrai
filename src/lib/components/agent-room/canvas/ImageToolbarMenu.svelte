<script lang="ts">
  import { ChevronDown, Image as ImageIcon, Sparkles } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils.js';
  import * as m from '$lib/paraglide/messages.js';

  let { active, onImage, onWorkflow }: { active: boolean; onImage: () => void; onWorkflow: () => void } = $props();
</script>

<DropdownMenu.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <DropdownMenu.Trigger
          {...props}
          class={cn('group relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent p-0 text-[var(--app-text-muted)] outline-none transition-[color,background-color,box-shadow] duration-150 hover:bg-[var(--app-border)] hover:text-[var(--app-text)] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 data-[state=open]:bg-[var(--app-accent-soft)] data-[state=open]:text-[var(--app-accent)]', active && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)]')}
          aria-label={m['image_workflow.menu']()}
        >
          <ImageIcon size={15} aria-hidden="true" />
          <ChevronDown size={9} class="absolute right-0.5 bottom-0.5 text-[var(--app-text-muted)] transition-transform duration-150 group-data-[state=open]:rotate-180" aria-hidden="true" />
        </DropdownMenu.Trigger>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content side="top">{m['image_workflow.menu']()}</Tooltip.Content>
  </Tooltip.Root>
  <DropdownMenu.Content side="top" align="start" sideOffset={10} class="w-[min(310px,calc(100vw-24px))] p-1.5">
    <DropdownMenu.Label>{m['image_workflow.menu']()}</DropdownMenu.Label>
    <DropdownMenu.Item class="min-h-11 gap-3" onclick={onImage}><ImageIcon size={16} class="shrink-0" /><span class="min-w-0"><strong class="block text-xs">{m['image_workflow.add_image']()}</strong><small class="mt-0.5 block text-[10px] text-muted-foreground">{m['image_workflow.add_image_hint']()}</small></span></DropdownMenu.Item>
    <DropdownMenu.Item class="min-h-11 gap-3" onclick={onWorkflow}><Sparkles size={16} class="shrink-0" /><span class="min-w-0"><strong class="block text-xs">{m['image_workflow.add_workflow']()}</strong><small class="mt-0.5 block text-[10px] text-muted-foreground">{m['image_workflow.add_workflow_hint']()}</small></span></DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
