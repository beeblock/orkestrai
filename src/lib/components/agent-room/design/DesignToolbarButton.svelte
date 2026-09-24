<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Kbd } from '$lib/components/ui/kbd';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let {
    label,
    hint,
    shortcut,
    active = false,
    disabled = false,
    pressed,
    tone = 'neutral',
    compact = false,
    side = 'bottom',
    onclick,
    children,
  }: {
    label: string;
    hint?: string;
    /** Atalho exibido como tecla no tooltip, para o usuario aprender sem abrir docs. */
    shortcut?: string;
    active?: boolean;
    disabled?: boolean;
    pressed?: boolean;
    /** 'accent' marca a ferramenta ativa do trilho; o resto da barra fica neutro. */
    tone?: 'neutral' | 'accent';
    /** 28px para caber em trilhas agrupadas (zoom) sem crescer a barra. */
    compact?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    onclick?: (event: MouseEvent) => void;
    children: Snippet;
  } = $props();

  const activeClass = $derived(active
    ? tone === 'accent'
      ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)] hover:bg-[var(--app-accent-soft)] hover:text-[var(--app-accent)]'
      : 'bg-[var(--app-active)] text-[var(--app-text)] hover:bg-[var(--app-active)]'
    : 'text-[var(--app-text-soft)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]');
</script>

<Tooltip.Root delayDuration={250}>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        class={`${compact ? 'size-7' : 'size-8'} shrink-0 rounded-md focus-visible:ring-[var(--app-accent)]/40 ${activeClass}`}
        variant="ghost"
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
  <Tooltip.Content class="z-[120] max-w-64 flex-col items-start gap-0.5" {side} sideOffset={6}>
    <span class="flex items-center gap-2">
      <span>{label}</span>
      {#if shortcut}<Kbd>{shortcut}</Kbd>{/if}
    </span>
    {#if hint}<span class="text-ui-xs font-normal opacity-75 [text-wrap:pretty]">{hint}</span>{/if}
  </Tooltip.Content>
</Tooltip.Root>
