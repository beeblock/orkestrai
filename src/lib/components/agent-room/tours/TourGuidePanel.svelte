<script lang="ts">
  import { page } from '$app/state';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';
  import { Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Loader2, Play, X } from '@lucide/svelte';
  import { tourState, tourNext, tourBack, tourCompleteCurrent, tourRunAction, stopTour } from './engine.svelte.js';

  const step = $derived(tourState.tour?.steps[tourState.stepIndex] ?? null);
  const total = $derived(tourState.tour?.steps.length ?? 0);
  const completed = (id: string) => tourState.autoCompleted.has(id);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }
</script>

{#if tourState.tour && step}
  <aside
    class="tour-panel nodrag nowheel"
    class:workbench={page.url.pathname === '/terminal'}
    use:portal
    aria-label={m['tour.panel_aria']()}
  >
    {#if tourState.done}
      <div class="tour-done" role="status">
        <span class="tour-done-icon" aria-hidden="true"><CircleCheck size={17} /></span>
        <h3>{m['tour.completed_title']()}</h3>
        <p>{m['tour.completed_body']()}</p>
        <div class="tour-actions">
          <span class="tour-spacer"></span>
          <Button size="sm" onclick={stopTour}>{m['tour.finish']()}</Button>
        </div>
      </div>
    {:else}
      <header class="tour-head">
        <span class="tour-kicker" title={tourState.tour.title}>{tourState.tour.title}</span>
        <span class="tour-step-of">{m['tour.step_of']({ current: String(tourState.stepIndex + 1), total: String(total) })}</span>
        <button type="button" class="tour-close" aria-label={m['tour.quit']()} title={m['tour.quit']()} onclick={stopTour}>
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <div class="tour-progress" aria-hidden="true">
        {#each tourState.tour.steps as s, index (s.id)}
          <span
            class="tour-dot"
            class:done={completed(s.id) || index < tourState.stepIndex}
            class:current={index === tourState.stepIndex}
          ></span>
        {/each}
      </div>
      <!-- Regiao estavel: leitores de tela anunciam cada novo passo. -->
      <div class="tour-step" aria-live="polite" aria-atomic="true">
        {#key step.id}
          <div class="tour-step-content">
            <h3 class="tour-title">{step.title}</h3>
            <p class="tour-body">{step.body}</p>
          </div>
        {/key}
      </div>
      {#if tourState.error}
        <p class="tour-error" role="alert"><CircleAlert size={13} class="tour-error-icon" aria-hidden="true" /><span>{tourState.error}</span></p>
      {/if}
      <div class="tour-actions">
        {#if tourState.stepIndex > 0}
          <Button size="sm" variant="ghost" onclick={tourBack}><ChevronLeft aria-hidden="true" />{m['tour.back']()}</Button>
        {/if}
        <span class="tour-spacer"></span>
        {#if step.action}
          <Button size="sm" disabled={tourState.busy || tourState.actionDoneFor === step.id} onclick={() => step.action && tourRunAction(step.action)}>
            {#if tourState.busy}<Loader2 size={13} class="tour-spin" aria-hidden="true" />{m['tour.doing']()}{:else}<Play size={13} aria-hidden="true" />{m['tour.do_for_me']()}{/if}
          </Button>
        {:else if step.check}
          <Button size="sm" variant="outline" onclick={tourCompleteCurrent}>
            <Check size={13} aria-hidden="true" />{m['tour.done_step']()}
          </Button>
        {:else}
          <Button size="sm" onclick={tourNext}>{m['tour.next']()}<ChevronRight aria-hidden="true" /></Button>
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  /* Acima dos dialogos de proposito (z 60): o tour guia acoes feitas dentro deles. */
  .tour-panel {
    position: fixed;
    pointer-events: auto;
    left: 16px;
    bottom: 16px;
    z-index: 60;
    width: 344px;
    max-width: calc(100vw - 40px);
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px 12px;
    border-radius: 14px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-panel);
    animation: tour-in var(--duration-slow) var(--ease-smooth-out) both;
  }

  @keyframes tour-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-base));
    }
  }

  .tour-panel.workbench {
    right: 16px;
    bottom: 40px;
    left: auto;
  }

  .tour-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
  }

  .tour-kicker {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text-muted);
  }

  .tour-step-of {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
  }

  .tour-close {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 28px;
    height: 28px;
    margin-right: -6px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .tour-close:hover {
    color: var(--app-text);
    background: var(--app-hover);
  }

  .tour-close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .tour-progress {
    display: flex;
    gap: 4px;
  }

  .tour-dot {
    flex: 1;
    max-width: 28px;
    height: 3px;
    border-radius: 999px;
    background: var(--app-hover);
    transition: background-color var(--duration-fast) ease-out;
  }

  .tour-dot.done {
    background: color-mix(in srgb, var(--app-accent) 45%, transparent);
  }

  .tour-dot.current {
    background: var(--app-accent);
  }

  .tour-step-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: tour-step-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes tour-step-in {
    from {
      opacity: 0;
      transform: translateY(var(--distance-micro));
    }
  }

  .tour-title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--app-text);
    text-wrap: balance;
  }

  .tour-body {
    margin: 0;
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--app-text-soft);
    text-wrap: pretty;
  }

  .tour-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 10px;
    border-radius: 8px;
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12px;
    line-height: 1.45;
  }

  .tour-error :global(.tour-error-icon) {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .tour-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }

  .tour-spacer {
    flex: 1;
  }

  .tour-done {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .tour-done-icon {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    margin-bottom: 2px;
    border-radius: 9px;
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .tour-done h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 600;
    color: var(--app-text);
  }

  .tour-done p {
    margin: 0;
    font-size: 12.5px;
    color: var(--app-text-soft);
    line-height: 1.55;
    text-wrap: pretty;
  }

  .tour-done .tour-actions {
    align-self: stretch;
  }

  :global(.tour-spin) {
    animation: tour-spin 1s linear infinite;
  }

  @keyframes tour-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 600px) {
    .tour-panel {
      right: 12px;
      bottom: 12px;
      left: 12px;
      width: auto;
      max-width: none;
    }

    .tour-panel.workbench {
      right: 12px;
      bottom: 40px;
      left: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .tour-panel,
    .tour-step-content,
    :global(.tour-spin) {
      animation: none;
    }
  }
</style>
