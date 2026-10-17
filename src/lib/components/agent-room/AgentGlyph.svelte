<script lang="ts">
  import type { AgentTone } from './agent-identity.js';

  let { tone, label, size = 14 }: { tone: AgentTone; label: string; size?: number } = $props();
</script>

<span class="agent-glyph" data-tone={tone} role="img" aria-label={label} title={label} style={`--glyph-size:${size}px`}>
  {#if tone === 'done'}
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7" /></svg>
  {:else}
    <span class="mark" aria-hidden="true"></span>
  {/if}
</span>

<style>
  .agent-glyph {
    width: var(--glyph-size);
    height: var(--glyph-size);
    flex: none;
    display: inline-grid;
    place-items: center;
    color: var(--app-success);
  }
  .mark {
    display: block;
    width: 55%;
    height: 55%;
    border-radius: 50%;
    background: var(--app-text-muted);
  }
  [data-tone='working'] .mark {
    width: 78%;
    height: 78%;
    background: transparent;
    border: 1.6px solid color-mix(in srgb, var(--app-info) 25%, transparent);
    border-top-color: var(--app-info);
    animation: agent-glyph-spin 0.9s linear infinite;
  }
  [data-tone='attention'] .mark {
    width: 62%;
    height: 62%;
    background: var(--app-warning);
    box-shadow: 0 0 0 3px var(--app-warning-soft);
  }
  [data-tone='blocked'] .mark {
    border-radius: 2px;
    background: var(--app-danger);
  }
  [data-tone='review'] .mark {
    width: 62%;
    height: 62%;
    background: transparent;
    border: 1.8px solid var(--app-accent);
  }
  [data-tone='offline'] .mark {
    background: transparent;
    border: 1.4px solid var(--app-text-muted);
  }
  @keyframes agent-glyph-spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    [data-tone='working'] .mark { animation: none; border-color: var(--app-info); }
  }
</style>
