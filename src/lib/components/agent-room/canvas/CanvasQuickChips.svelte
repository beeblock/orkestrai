<script lang="ts" module>
  import type { Component } from 'svelte';

  export type QuickChip = {
    id: string;
    label: string;
    icon?: Component<{ size?: number; strokeWidth?: number; class?: string }>;
    hint?: string;
    disabled?: boolean;
    onSelect: () => void;
  };
</script>

<script lang="ts">
  /** One-tap team actions above the composer, each pill with its own soft tint. */
  let { chips, label }: { chips: QuickChip[]; label: string } = $props();
  const tints = ['#5fd2c2', '#e8b84a', '#b6a2ff', '#7cbff0', '#f19a76', '#a8d672', '#f29bc0'];
</script>

<div class="chips" role="toolbar" aria-label={label} data-testid="canvas-quick-chips">
  {#each chips as chip, index (chip.id)}
    {@const Icon = chip.icon}
    <button type="button" class="chip" style:--tint={tints[index % tints.length]} disabled={chip.disabled} title={chip.hint ?? chip.label} onclick={chip.onSelect} data-chip={chip.id}>
      {#if Icon}<Icon size={13} strokeWidth={1.9} />{/if}
      <span>{chip.label}</span>
    </button>
  {/each}
</div>

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    width: max-content;
    max-width: min(920px, calc(100vw - 420px));
  }

  .chip {
    height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 11px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--tint) 42%, var(--app-glass-line));
    background: color-mix(in srgb, var(--tint) 7%, var(--app-glass));
    -webkit-backdrop-filter: blur(18px) saturate(160%);
    backdrop-filter: blur(18px) saturate(160%);
    box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 6%, transparent), 0 6px 18px color-mix(in srgb, #000000 22%, transparent);
    color: var(--app-text);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
    transition: transform var(--duration-quick) var(--ease-smooth-out), border-color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .chip :global(svg) {
    color: var(--tint);
  }

  .chip:hover:not(:disabled) {
    transform: translateY(-1px);
    border-color: color-mix(in srgb, var(--tint) 70%, transparent);
    background: color-mix(in srgb, var(--tint) 14%, var(--app-glass));
  }

  .chip:active:not(:disabled) {
    transform: scale(var(--scale-press));
  }

  .chip:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .chip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  :global(:root.light) .chip :global(svg) {
    color: color-mix(in srgb, var(--tint) 60%, #000000);
  }
</style>
