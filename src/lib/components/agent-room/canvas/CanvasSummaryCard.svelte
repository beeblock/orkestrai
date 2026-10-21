<script lang="ts">
  import { X } from '@lucide/svelte';
  import { attentionFeed } from '../attention-feed.svelte.js';
  import { agentStatus } from '../agent-status.svelte.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  type DoneTask = { id: string; title: string; status: string; updatedAt: string };

  // `compact` turns the briefing into a small chip once the owner starts working on the Canvas.
  let { workspaceId, compact = false, onOpenAttention }: { workspaceId: string; compact?: boolean; onOpenAttention: () => void } = $props();
  let reopened = $state(false);
  $effect(() => {
    if (compact) reopened = false;
  });
  const collapsed = $derived(compact && !reopened);

  const VISIT_KEY = 'orkestrai.canvas.lastVisit.';
  const DISMISS_KEY = 'orkestrai.canvas.summaryDismissed.';
  const DAY = 24 * 60 * 60 * 1000;

  let since = $state<number>(Date.now() - DAY);
  let done = $state<DoneTask[]>([]);
  let dismissed = $state(false);

  // "Since your last visit": the previous visit is read once per workspace and
  // replaced with now when the owner leaves it (per-viewer convenience only).
  $effect(() => {
    const id = workspaceId;
    let previous = Date.now() - DAY;
    try {
      const stored = Number(localStorage.getItem(VISIT_KEY + id));
      if (Number.isFinite(stored) && stored > 0) previous = stored;
      dismissed = sessionStorage.getItem(DISMISS_KEY + id) === '1';
    } catch {
      dismissed = false;
    }
    since = previous;
    done = [];
    const controller = new AbortController();
    void fetch(`/api/agent-room/workspaces/${encodeURIComponent(id)}/tasks/history`, { signal: controller.signal, cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { data?: DoneTask[] } | null) => {
        if (!payload?.data) return;
        done = payload.data.filter((task) => task.status === 'done' && Date.parse(task.updatedAt) > previous);
      })
      .catch(() => {});
    const remember = () => {
      try { localStorage.setItem(VISIT_KEY + id, String(Date.now())); } catch { /* storage unavailable */ }
    };
    window.addEventListener('pagehide', remember);
    return () => {
      controller.abort();
      window.removeEventListener('pagehide', remember);
      remember();
    };
  });

  const needsYou = $derived(attentionFeed.items.length);
  const working = $derived(Object.values(agentStatus.agents).filter((agent) => agent.sessionAlive && (agent.state === 'working' || agent.state === 'starting')).length);
  const blocked = $derived(Object.values(agentStatus.agents).filter((agent) => agent.sessionAlive && (agent.state === 'blocked' || agent.state === 'error')));
  const sinceLabel = $derived.by(() => {
    const date = new Date(since);
    const sameDay = new Date().toDateString() === date.toDateString();
    const locale = getLocale();
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return sameDay ? m['canvas_summary.since_today']({ time }) : m['canvas_summary.since_day']({ day: date.toLocaleDateString(locale, { day: 'numeric', month: 'short' }), time });
  });
  const story = $derived.by(() => {
    const parts: string[] = [];
    if (done.length) parts.push(m['canvas_summary.story_done']({ titles: done.slice(0, 2).map((task) => task.title).join(', ') }));
    if (blocked.length) parts.push(m['canvas_summary.story_blocked']({ names: blocked.slice(0, 2).map((agent) => agent.title).join(', ') }));
    if (!parts.length) parts.push(needsYou ? m['canvas_summary.story_waiting']() : m['canvas_summary.story_quiet']());
    return parts.join(' ');
  });

  function dismiss() {
    dismissed = true;
    try { sessionStorage.setItem(DISMISS_KEY + workspaceId, '1'); } catch { /* storage unavailable */ }
  }
</script>

{#if !dismissed && collapsed}
  <button type="button" class="canvas-summary-chip" class:hot={needsYou > 0} onclick={() => (reopened = true)} aria-label={m['canvas_summary.label']()}>
    {#if needsYou > 0}<span class="dot" aria-hidden="true"></span>{/if}
    <span class="tabular-nums">{m['canvas_summary.chip']({ needs: needsYou, working })}</span>
  </button>
{:else if !dismissed}
  <section class="canvas-summary" aria-label={m['canvas_summary.label']()}>
    <header>
      <span>{sinceLabel}</span>
      <button type="button" class="close" onclick={dismiss} aria-label={m['canvas_summary.dismiss']()}><X size={13} /></button>
    </header>
    <div class="figures">
      <div class:hot={needsYou > 0}><b class="headline tabular-nums">{needsYou}</b><span>{m['canvas_summary.needs_you']()}</span></div>
      <div><b class="headline tabular-nums">{done.length}</b><span>{m['canvas_summary.done']()}</span></div>
      <div><b class="headline tabular-nums">{working}</b><span>{m['canvas_summary.working']()}</span></div>
    </div>
    <p>{story}</p>
    {#if needsYou > 0}
      <button type="button" class="open" onclick={onOpenAttention}>{m['canvas_summary.open_attention']()}</button>
    {/if}
  </section>
{/if}

<style>
  .canvas-summary {
    width: 300px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-radius: 18px;
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    color: var(--app-text);
    animation: summary-in var(--duration-slow) var(--ease-smooth-out);
  }

  @keyframes summary-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.98); }
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text-muted);
    font-size: 12px;
  }

  header span {
    flex: 1;
  }

  .close {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .figures {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .figures div {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .figures b {
    font-size: 38px;
  }

  .figures .hot b {
    color: var(--app-warning);
  }

  .figures span {
    color: var(--app-text-muted);
    font-size: 12px;
  }

  p {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .open {
    align-self: flex-start;
    height: 28px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 6px 18px color-mix(in srgb, var(--app-accent) 28%, transparent);
  }

  .open:hover {
    filter: brightness(1.06);
  }

  .open:focus-visible,
  .close:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .canvas-summary-chip {
    height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--app-glass);
    -webkit-backdrop-filter: blur(22px) saturate(170%);
    backdrop-filter: blur(22px) saturate(170%);
    border: 1px solid var(--app-glass-line);
    box-shadow: var(--app-glass-shadow);
    color: var(--app-text-soft);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }

  .canvas-summary-chip:hover {
    color: var(--app-text);
  }

  .canvas-summary-chip.hot {
    color: var(--app-text);
  }

  .canvas-summary-chip .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--app-warning);
  }

  .canvas-summary-chip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  @media (max-width: 1100px) {
    .canvas-summary,
    .canvas-summary-chip {
      display: none;
    }
  }
</style>
