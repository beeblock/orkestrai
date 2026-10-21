<script lang="ts">
  import * as m from '$lib/paraglide/messages.js';

  /** Pen options beside the tool rail: ink color and stroke width, applied to the next strokes. */
  let { color = $bindable('#e8b84a'), width = $bindable(3) }: { color?: string; width?: number } = $props();

  const INK_COLORS = ['#f4efe6', '#e8b84a', '#f0883e', '#e5646c', '#f29bc0', '#b6a2ff', '#7cbff0', '#5fd2c2', '#8fd18b', '#1a1714'];
  const WIDTHS = [1.5, 3, 5, 8, 12];
</script>

<div class="ink-panel" role="group" aria-label={m['canvas.ink_panel']()} data-testid="ink-panel">
  <p class="label">{m['canvas.ink_color']()}</p>
  <div class="colors" role="radiogroup" aria-label={m['canvas.ink_color']()}>
    {#each INK_COLORS as swatch (swatch)}
      <button type="button" role="radio" aria-checked={color === swatch} aria-label={swatch} class="swatch" class:on={color === swatch} style:--swatch={swatch} onclick={() => (color = swatch)}></button>
    {/each}
  </div>
  <p class="label">{m['canvas.ink_width']()}</p>
  <div class="widths" role="radiogroup" aria-label={m['canvas.ink_width']()}>
    {#each WIDTHS as value (value)}
      <button type="button" role="radio" aria-checked={width === value} aria-label={m['canvas.ink_width_value']({ value })} class="width" class:on={width === value} onclick={() => (width = value)}>
        <span style:width={`${Math.max(3, value)}px`} style:height={`${Math.max(3, value)}px`} style:background={color}></span>
      </button>
    {/each}
  </div>
</div>

<style>
  .ink-panel {
    width: 190px;
    padding: 10px 12px 12px;
    border-radius: 16px;
    background: var(--app-glass-strong);
    -webkit-backdrop-filter: blur(24px) saturate(170%);
    backdrop-filter: blur(24px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    animation: ink-in var(--duration-fast) var(--ease-smooth-out);
  }

  @keyframes ink-in {
    from { opacity: 0; transform: translateX(-6px); }
  }

  .label {
    margin: 2px 0 7px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .label + .colors + .label {
    margin-top: 10px;
  }

  .colors {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }

  .swatch {
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #000 22%, transparent);
    transition: transform var(--duration-quick) var(--ease-smooth-out);
  }

  .swatch:hover {
    transform: scale(1.08);
  }

  .swatch.on {
    box-shadow: 0 0 0 2px var(--app-surface), 0 0 0 4px var(--swatch);
  }

  .widths {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }

  .width {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: 9px;
    background: transparent;
  }

  .width:hover {
    background: var(--app-hover);
  }

  .width.on {
    border-color: color-mix(in srgb, var(--app-accent) 60%, transparent);
    background: color-mix(in srgb, var(--app-accent) 10%, transparent);
  }

  .width span {
    display: block;
    border-radius: 50%;
    max-width: 14px;
    max-height: 14px;
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
