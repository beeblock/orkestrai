<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Music4, Plus, Trash2 } from '@lucide/svelte';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';

  type Score = { id: string; name: string; agents: number; scope?: 'selection' };

  /** Scores: parts of a canvas saved to place again in any workspace. */
  let { workspaceId, onInserted }: { workspaceId: string; onInserted: () => void } = $props();

  let scores = $state<Score[]>([]);
  let busy = $state<string | null>(null);

  async function load() {
    const response = await fetch(`/api/agent-room/presets?locale=${getLocale()}`, { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) : null;
    scores = ((body?.data ?? []) as Score[]).filter((preset) => preset.scope === 'selection');
  }

  async function insert(score: Score) {
    busy = score.id;
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/presets/${encodeURIComponent(score.id)}/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: JSON.stringify({ workspaceId, locale: getLocale() }),
    }).catch(() => null);
    busy = null;
    if (response?.ok) {
      toast.success(m['scores.inserted']({ name: score.name }));
      onInserted();
    } else {
      toast.error(m['scores.insert_failed']());
    }
  }

  async function remove(score: Score) {
    busy = score.id;
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/presets/${encodeURIComponent(score.id)}`, {
      method: 'DELETE',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    }).catch(() => null);
    busy = null;
    if (response?.ok) scores = scores.filter((candidate) => candidate.id !== score.id);
  }

  onMount(() => {
    void load();
    const reload = () => void load();
    window.addEventListener('orkestrai:scores-changed', reload);
    return () => window.removeEventListener('orkestrai:scores-changed', reload);
  });
</script>

{#if scores.length}
  <section class="scores" aria-labelledby="scores-title">
    <h2 id="scores-title">{m['scores.title']()}<span class="count">{scores.length}</span></h2>
    <ul>
      {#each scores as score (score.id)}
        <li>
          <span class="mark" aria-hidden="true"><Music4 size={13} /></span>
          <span class="name" title={score.name}>{score.name}</span>
          <button type="button" class="act" disabled={busy === score.id} onclick={() => void insert(score)} aria-label={m['scores.insert']({ name: score.name })} title={m['scores.insert']({ name: score.name })}><Plus size={13} /></button>
          <button type="button" class="act danger" disabled={busy === score.id} onclick={() => void remove(score)} aria-label={m['scores.remove']({ name: score.name })} title={m['scores.remove']({ name: score.name })}><Trash2 size={12} /></button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .scores {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px 6px;
    border-top: 1px solid var(--app-border);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 2px 4px;
    color: var(--app-text-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .count {
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-hover);
    font-size: 11px;
    letter-spacing: 0;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 4px;
    border-radius: 7px;
  }

  li:hover {
    background: var(--app-hover);
  }

  .mark {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--app-secondary-soft);
    color: var(--app-secondary);
  }

  .name {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    color: var(--app-text-soft);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .act {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    opacity: 0;
  }

  li:hover .act,
  .act:focus-visible {
    opacity: 1;
  }

  .act:hover {
    background: var(--app-active);
    color: var(--app-text);
  }

  .act.danger:hover {
    color: var(--app-danger);
  }

  .act:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }
</style>
