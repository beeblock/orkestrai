<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  type Props = {
    label: string;
    /** Se presente, renderiza link (navegacao); senao, botao. */
    href?: string;
    onclick?: (event: MouseEvent) => void;
    side?: 'top' | 'bottom' | 'left' | 'right';
    danger?: boolean;
    active?: boolean;
    disabled?: boolean;
    /** Classe CSS do botao (default: icon-btn da sidebar). */
    class?: string;
    type?: 'button' | 'submit';
    children: Snippet;
  };

  let {
    label,
    href,
    onclick,
    side = 'top',
    danger = false,
    active = false,
    disabled = false,
    class: klass = 'icon-btn',
    type = 'button',
    children,
  }: Props = $props();

  function handleClick(event: MouseEvent): void {
    // Node header actions used to stop propagation in IconAction. Keep that
    // contract in the shared replacement so a command cannot also interact
    // with the canvas underneath it.
    event.stopPropagation();
    onclick?.(event);
  }
</script>

<Tooltip.Root>
  <Tooltip.Trigger>
    {#snippet child({ props })}
      {#if href}
        <a {...props} aria-label={label} class={`hib ${klass}`} style="text-decoration:none" {href}>
          {@render children()}
        </a>
      {:else}
        <button {...props} aria-label={label} class={`hib ${klass}`} class:danger class:active {disabled} {type} onclick={onclick ? handleClick : undefined}>
          {@render children()}
        </button>
      {/if}
    {/snippet}
  </Tooltip.Trigger>
  <Tooltip.Content {side}>{label}</Tooltip.Content>
</Tooltip.Root>

<style>
  /* Normaliza o tamanho do icone filho — Lucide cai para 24px sem size em
     alguns contextos e quebra a linha do cabecalho. */
  .hib :global(svg),
  .hib :global(img) {
    width: 13px;
    height: 13px;
    display: block;
    flex-shrink: 0;
  }
</style>
