<script lang="ts">
  import * as Tooltip from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils.js';
  import type { Snippet } from 'svelte';

  type Props = {
    /** Texto do tooltip (obrigatorio — toda ferramenta explica o que faz). */
    label: string;
    /** Segunda linha do tooltip (ex.: como usar a ferramenta). */
    hint?: string;
    /** Ferramenta de criacao: tambem pode ser arrastada ate o canvas. */
    dragTool?: string;
    active?: boolean;
    disabled?: boolean;
    onclick?: () => void;
    children: Snippet;
  };

  let { label, hint, dragTool, active = false, disabled = false, onclick, children }: Props = $props();

  // O canvas le este tipo no drop e cria o no na posicao solta, pela mesma
  // rotina do clique na ferramenta.
  function startToolDrag(event: DragEvent) {
    if (!dragTool || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('application/x-orkestrai-tool', dragTool);
  }
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
        draggable={dragTool && !disabled ? 'true' : undefined}
        ondragstart={dragTool ? startToolDrag : undefined}
      >
        {@render children()}
      </button>
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content side="top" class={hint ? 'flex-col items-start gap-0.5' : undefined}>
    <span>{label}</span>
    {#if hint}<span class="font-normal opacity-70">{hint}</span>{/if}
  </Tooltip.Content>
</Tooltip.Root>
