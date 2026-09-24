<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import { X } from '@lucide/svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';

  /**
   * Moldura comum dos paineis laterais do Canvas (Andares, Portas, Papeis,
   * Presets...): cabecalho fixo com titulo, descricao e acoes, fechar sempre
   * no mesmo lugar e entrada deslizante de painel.
   */
  type Props = {
    title: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: Component<any>;
    eyebrow?: string;
    description?: string;
    closeLabel: string;
    onClose: () => void;
    width?: number;
    /** Atributos de teste/tour preservados no elemento raiz. */
    tour?: string;
    labelledBy?: string;
    class?: string;
    /** Corpo sem padding: para paineis que ja organizam as proprias secoes. */
    flush?: boolean;
    actions?: Snippet;
    children: Snippet;
  };

  let {
    title,
    icon: Icon,
    eyebrow,
    description,
    closeLabel,
    onClose,
    width = 340,
    tour,
    labelledBy,
    class: klass = '',
    flush = false,
    actions,
    children,
  }: Props = $props();

  const titleId = labelledBy ?? `side-panel-${Math.random().toString(36).slice(2, 9)}`;
</script>

<aside class={`side-panel-shell ${klass}`} style:--panel-width={`${width}px`} aria-labelledby={titleId} data-tour={tour}>
  <header class="side-panel-header">
    {#if Icon}<span class="side-panel-icon" aria-hidden="true"><Icon size={15} /></span>{/if}
    <div class="side-panel-heading">
      {#if eyebrow}<span class="side-panel-eyebrow">{eyebrow}</span>{/if}
      <h3 id={titleId}>{title}</h3>
      {#if description}<p>{description}</p>{/if}
    </div>
    <div class="side-panel-actions">
      {#if actions}{@render actions()}{/if}
      <HeaderIconButton label={closeLabel} class="node-action-btn" side="left" onclick={onClose}><X size={14} /></HeaderIconButton>
    </div>
  </header>
  <div class="side-panel-body" class:flush>
    {@render children()}
  </div>
</aside>

<style>
  .side-panel-shell {
    display: flex;
    flex-direction: column;
    width: var(--panel-width);
    flex-shrink: 0;
    min-height: 0;
    height: 100%;
    border-left: 1px solid var(--app-border);
    background: var(--app-sidebar);
    color: var(--app-text);
    animation: side-panel-in var(--duration-slow) var(--ease-smooth-out) both;
  }

  @keyframes side-panel-in {
    from {
      opacity: 0;
      transform: translateX(var(--distance-base));
    }
  }

  .side-panel-header {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 10px 12px 16px;
    border-bottom: 1px solid var(--app-border);
  }

  .side-panel-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border-radius: 8px;
    background: var(--app-accent-soft);
    color: var(--app-accent);
  }

  .side-panel-heading {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1;
    padding-top: 2px;
  }

  .side-panel-eyebrow {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--app-secondary);
  }

  .side-panel-heading h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 14.5px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.3;
    color: var(--app-text);
  }

  .side-panel-heading p {
    margin: 2px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-muted);
    text-wrap: pretty;
  }

  .side-panel-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
  }

  .side-panel-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1;
    min-height: 0;
    padding: 14px 16px 16px;
    overflow-y: auto;
  }

  .side-panel-body.flush {
    gap: 0;
    padding: 0;
  }

  .side-panel-shell :global(.node-action-btn) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    padding: 0;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .side-panel-shell :global(.node-action-btn:hover) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .side-panel-shell :global(.node-action-btn:active) {
    transform: scale(var(--scale-press));
  }

  .side-panel-shell :global(.node-action-btn:disabled) {
    opacity: 0.45;
    cursor: default;
  }
</style>
