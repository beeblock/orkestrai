<script lang="ts">
  import type { AgentTone } from './agent-identity.js';

  /** Teammate state as a small mono pill: a dot in the state color and the word. */
  let { tone, label, compact = false }: { tone: AgentTone; label: string; compact?: boolean } = $props();
</script>

<span class="status-pill" class:compact data-tone={tone} role="status" aria-label={label} title={label}>
  <span class="dot" aria-hidden="true"></span>
  {#if !compact}<span class="word">{label}</span>{/if}
</span>

<style>
  .status-pill {
    --tone: var(--app-text-muted);
    height: 20px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px 0 6px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--tone) 34%, transparent);
    background: color-mix(in srgb, var(--tone) 10%, transparent);
    color: color-mix(in srgb, var(--tone) 82%, var(--app-text));
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: lowercase;
    white-space: nowrap;
    flex: none;
  }

  .status-pill.compact {
    width: 20px;
    padding: 0;
    justify-content: center;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--tone);
  }

  [data-tone='working'] { --tone: var(--app-accent); }
  [data-tone='attention'] { --tone: var(--app-warning); }
  [data-tone='blocked'] { --tone: var(--app-danger); }
  [data-tone='review'] { --tone: var(--app-secondary); }
  [data-tone='done'] { --tone: var(--app-success); }

  [data-tone='working'] .dot,
  [data-tone='attention'] .dot {
    animation: status-pulse 1.8s ease-in-out infinite;
  }

  @keyframes status-pulse {
    50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--tone) 24%, transparent); }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none !important; }
  }
</style>
