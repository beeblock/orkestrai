<script lang="ts">
  import { onMount } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from '@beeblock/svelar/ui';
  import { Archive, FileText, Image as ImageIcon, LoaderCircle, RotateCcw, Sparkles, SquareTerminal, Workflow } from '@lucide/svelte';
  import { Switch } from '$lib/components/ui/switch';
  import { updateAppSettings } from '../app-settings.svelte.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  import * as m from '$lib/paraglide/messages.js';

  type ArchivedNode = { id: string; type: string; title: string; archivedAt: string };

  /** What left the board, kept and restorable; finished workflows can be tidied away at once. */
  let { workspaceId, onChanged }: { workspaceId: string; onChanged: () => void } = $props();

  let items = $state<ArchivedNode[]>([]);
  let autoTidy = $state(true);
  let loaded = $state(false);
  let busy = $state<string | null>(null);

  const base = $derived(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/nodes`);

  async function load() {
    const response = await fetch(`${base}/archived`, { cache: 'no-store' }).catch(() => null);
    const body = response?.ok ? await response.json().catch(() => null) as { data?: { nodes: ArchivedNode[]; autoTidy: boolean } } | null : null;
    items = body?.data?.nodes ?? [];
    autoTidy = body?.data?.autoTidy ?? true;
    loaded = true;
  }

  async function post(path: string, body?: unknown) {
    const csrf = getCsrfToken();
    return fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null);
  }

  async function restore(ids: string[], key: string) {
    busy = key;
    const response = await post('archived', { nodeIds: ids });
    busy = null;
    if (!response?.ok) {
      toast.error(m['archived.restore_failed']());
      return;
    }
    toast.success(m['archived.restored']({ count: ids.length }));
    onChanged();
    await load();
  }

  async function tidyNow() {
    busy = 'tidy';
    const response = await post('tidy');
    const body = response?.ok ? await response.json().catch(() => null) as { data?: { archived: number } } | null : null;
    busy = null;
    if (!body?.data) {
      toast.error(m['archived.tidy_failed']());
      return;
    }
    if (body.data.archived) toast.success(m['archived.tidied']({ count: body.data.archived }));
    else toast.info(m['archived.nothing_to_tidy']());
    onChanged();
    await load();
  }

  async function toggleAuto(next: boolean) {
    autoTidy = next;
    await updateAppSettings({ tidyFinishedWork: next ? 'true' : 'false' }).catch(() => {
      autoTidy = !next;
      toast.error(m['archived.setting_failed']());
    });
  }

  function when(iso: string): string {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  onMount(() => {
    void load();
  });
</script>

<section class="archived" aria-labelledby="archived-title" data-testid="archived-panel">
  <h2 id="archived-title"><Archive size={14} />{m['archived.title']()}{#if items.length}<span class="count">{items.length}</span>{/if}</h2>
  <p class="lead">{m['archived.lead']()}</p>
  <label class="auto">
    <Switch checked={autoTidy} onCheckedChange={(value: boolean) => void toggleAuto(value)} aria-label={m['archived.auto']()} />
    <span>{m['archived.auto']()}</span>
  </label>
  <button type="button" class="tidy" disabled={busy !== null} onclick={() => void tidyNow()}>
    {#if busy === 'tidy'}<LoaderCircle size={13} class="animate-spin" />{:else}<Sparkles size={13} />{/if}{m['archived.tidy_now']()}
  </button>
  {#if !loaded}
    <p class="empty">{m['archived.loading']()}</p>
  {:else if items.length}
    <ul>
      {#each items as item (item.id)}
        <li>
          <span class="kind" aria-hidden="true">
            {#if item.type === 'note'}<FileText size={13} />{:else if item.type === 'image'}<ImageIcon size={13} />{:else if item.type === 'imageWorkflow'}<Workflow size={13} />{:else if item.type === 'terminal'}<SquareTerminal size={13} />{:else}<Archive size={13} />{/if}
          </span>
          <span class="name" title={item.title}>{item.title || item.type}</span>
          <span class="date">{when(item.archivedAt)}</span>
          <button type="button" class="restore" disabled={busy !== null} onclick={() => void restore([item.id], item.id)} aria-label={m['archived.restore_one']({ name: item.title || item.type })} title={m['archived.restore_one']({ name: item.title || item.type })}><RotateCcw size={12} /></button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{m['archived.empty']()}</p>
  {/if}
</section>

<style>
  .archived {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
  }

  .count {
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-muted);
    font-size: 11px;
  }

  .lead,
  .empty {
    margin: 0;
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.5;
  }

  .empty {
    color: var(--app-text-muted);
  }

  .auto {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--app-text);
    font-size: 12.5px;
    line-height: 1.35;
  }

  .tidy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 32px;
    border: 0;
    border-radius: 999px;
    background: var(--app-accent);
    color: var(--app-accent-contrast);
    font-size: 12.5px;
    font-weight: 600;
  }

  .tidy:disabled {
    opacity: 0.6;
  }

  ul {
    max-height: 260px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto 26px;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 4px;
    border-radius: 8px;
  }

  li:hover {
    background: var(--app-hover);
  }

  .kind {
    display: grid;
    place-items: center;
    color: var(--app-text-muted);
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .date {
    color: var(--app-text-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .restore {
    width: 26px;
    height: 26px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--app-text-muted);
  }

  .restore:hover:not(:disabled) {
    background: var(--app-surface);
    color: var(--app-text);
  }

  button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
