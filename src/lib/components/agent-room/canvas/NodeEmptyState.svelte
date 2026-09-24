<script lang="ts">
  import type { Component, Snippet } from 'svelte';

  /**
   * Estado vazio dos nos: diz o que falta e oferece a proxima acao no mesmo
   * lugar, em vez de uma frase cinza solta no canto do no.
   */
  type Props = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    icon?: Component<any>;
    title: string;
    description?: string;
    /** Versao compacta para nos pequenos ou colunas estreitas. */
    compact?: boolean;
    tone?: 'neutral' | 'warning' | 'danger';
    actions?: Snippet;
    class?: string;
  };

  let { icon: Icon, title, description, compact = false, tone = 'neutral', actions, class: klass = '' }: Props = $props();
</script>

<div class={`node-empty ${klass}`} class:compact data-tone={tone}>
  {#if Icon}
    <span class="node-empty-icon" aria-hidden="true"><Icon size={compact ? 15 : 17} /></span>
  {/if}
  <p class="node-empty-title">{title}</p>
  {#if description}<p class="node-empty-description">{description}</p>{/if}
  {#if actions}<div class="node-empty-actions">{@render actions()}</div>{/if}
</div>

<style>
  .node-empty {
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 6px;
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: 20px 18px;
    text-align: center;
  }

  .node-empty.compact {
    gap: 4px;
    padding: 12px;
  }

  .node-empty-icon {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    margin-bottom: 4px;
    border-radius: 9px;
    background: var(--app-hover);
    color: var(--app-text-soft);
  }

  .compact .node-empty-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
  }

  [data-tone='warning'] .node-empty-icon {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  [data-tone='danger'] .node-empty-icon {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .node-empty-title {
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
    line-height: 1.35;
    text-wrap: balance;
  }

  .compact .node-empty-title {
    font-size: 12px;
  }

  .node-empty-description {
    max-width: 38ch;
    margin: 0;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
    text-wrap: pretty;
  }

  .compact .node-empty-description {
    font-size: 11.5px;
  }

  .node-empty-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    margin-top: 8px;
  }
</style>
