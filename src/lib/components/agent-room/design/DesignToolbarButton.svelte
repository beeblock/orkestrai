<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let {
    label,
    hint,
    active = false,
    disabled = false,
    pressed,
    side = 'bottom',
    onclick,
    children,
  }: {
    label: string;
    hint?: string;
    active?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();
</script>

<Tooltip.Root delayDuration={250}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        class="shrink-0"
        variant={active ? 'secondary' : 'ghost'}
        size="icon-sm"
        {disabled}
        aria-label={label}
        aria-pressed={pressed}
        {onclick}
      >
        {@render children()}
      </Button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content class="z-[120] max-w-64 flex-col items-start" {side} sideOffset={6}>
    <span>{label}</span>
    {#if hint}<span class="text-[10px] opacity-75">{hint}</span>{/if}
  </Tooltip.Content>
</Tooltip.Root>
