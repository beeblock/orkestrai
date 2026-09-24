<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils.js';
  import type { Snippet } from 'svelte';

  type Props = {
    /** Texto do tooltip (obrigatorio — toda ferramenta explica o que faz). */
    label: string;
    active?: boolean;
    disabled?: boolean;
    onclick?: () => void;
    children: Snippet;
  };

  let { label, active = false, disabled = false, onclick, children }: Props = $props();
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        type="button"
        class={cn(
          'group inline-flex size-8 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-0 bg-transparent p-0 text-[0px] text-[var(--app-text-soft)] outline-none transition-[color,background-color,box-shadow,transform] duration-150 ease-smooth-out hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-[var(--app-accent)]/45 disabled:pointer-events-none disabled:opacity-40 [&_.tool-icon-svg]:text-[var(--app-text-muted)] hover:[&_.tool-icon-svg]:text-current [&_.tool-icon]:opacity-60 [&_.tool-icon]:transition-opacity [&_.tool-icon]:duration-150 hover:[&_.tool-icon]:opacity-100',
          active && 'bg-[var(--app-accent-soft)] text-[var(--app-accent)] [&_.tool-icon-svg]:text-current [&_.tool-icon]:opacity-100',
        )}
        aria-label={label}
        {disabled}
        {onclick}
      >
        {@render children()}
      </button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="top">{label}</Tooltip.Content>
</Tooltip.Root>
