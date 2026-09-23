<script lang="ts">
  import { onMount } from 'svelte';
  import { Check, X, Archive, RefreshCw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Select from '$lib/components/ui/select';
  import type { AgentLesson } from '$lib/modules/agent-room/domain/agent-learning.js';
  import { knowledgeApi } from './knowledge-client.js';
  import { knowledgeLabel } from './knowledge-labels.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId }: { workspaceId: string } = $props();
  let agents = $state<Array<{ id: string; title: string; mode: string }>>([]);
  let entries = $state<AgentLesson[]>([]);
  let nodeId = $state('');
  let busy = $state(false), error = $state('');
  let showHistory = $state(false);
  const agent = $derived(agents.find(item => item.id === nodeId));
  const visible = $derived(entries.filter(item => item.nodeId === nodeId && (showHistory || !['archived', 'rejected'].includes(item.status))));
  async function load() {
    busy = true; error = '';
    try {
      const result = await knowledgeApi<{ agents: typeof agents; entries: AgentLesson[] }>(workspaceId, 'learning');
      agents = result.agents; entries = result.entries;
      if (!agents.some(item => item.id === nodeId)) nodeId = agents[0]?.id ?? '';
    } catch { error = m['learning.error'](); } finally { busy = false; }
  }
  async function command(body: Record<string, unknown>) {
    busy = true; error = '';
    try { await knowledgeApi(workspaceId, 'learning', { nodeId, ...body }); await load(); }
    catch (cause) { error = cause instanceof Error && cause.message === 'learning_revision_conflict' ? m['learning.conflict']() : m['learning.error'](); }
    finally { busy = false; }
  }
  onMount(() => { void load(); });
</script>

<section class="flex h-full min-h-0 flex-col text-[var(--app-text)]" data-testid="agent-learning">
  <div class="flex flex-wrap items-end gap-3 border-b border-[var(--app-border)] p-3">
    <label class="min-w-48 flex-1"><span class="mb-1 block text-xs">{m['learning.agent']()}</span>
      <Select.Root type="single" bind:value={nodeId}><Select.Trigger class="w-full">{agent?.title ?? m['learning.agent']()}</Select.Trigger><Select.Content>{#each agents as item}<Select.Item value={item.id}>{item.title}</Select.Item>{/each}</Select.Content></Select.Root>
    </label>
    {#if agent}<label class="min-w-40"><span class="mb-1 block text-xs">{m['learning.mode']()}</span>
      <Select.Root type="single" value={agent.mode} onValueChange={(mode) => void command({ command: 'configure', mode })} disabled={busy}><Select.Trigger class="w-full">{knowledgeLabel(agent.mode)}</Select.Trigger><Select.Content>{#each ['automatic', 'review', 'off'] as mode}<Select.Item value={mode}>{knowledgeLabel(mode)}</Select.Item>{/each}</Select.Content></Select.Root>
    </label>{/if}
    <Button variant="outline" size="icon" title={m['knowledge.refresh']()} aria-label={m['knowledge.refresh']()} disabled={busy} onclick={() => void load()}><RefreshCw size={16} class={busy ? 'animate-spin' : ''} /></Button>
    <Button variant={showHistory ? 'secondary' : 'outline'} aria-pressed={showHistory} onclick={() => showHistory = !showHistory}>{m['learning.history']()}</Button>
  </div>
  {#if error}<p role="alert" class="p-3 text-sm text-[var(--app-danger)]">{error}</p>{/if}
  <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-3">
    {#each visible as entry (entry.id)}
      <article class="mb-3 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-3">
        <div class="flex flex-wrap items-start justify-between gap-2"><h3 class="text-sm font-semibold">{entry.title}</h3><span class="text-xs text-[var(--app-text-muted)]">{knowledgeLabel(entry.status)} · v{entry.revision}</span></div>
        <p class="mt-1 text-xs text-[var(--app-text-muted)]">{knowledgeLabel(entry.evidenceLevel)} · {entry.sourceTitle}</p>
        {#if entry.trigger}<h4 class="mt-3 text-xs font-semibold">{m['learning.trigger']()}</h4><p class="whitespace-pre-wrap break-words text-sm">{entry.trigger}</p>{/if}
        {#if entry.mistake}<h4 class="mt-3 text-xs font-semibold">{m['learning.mistake']()}</h4><p class="whitespace-pre-wrap break-words text-sm">{entry.mistake}</p>{/if}
        {#if entry.correction}<h4 class="mt-3 text-xs font-semibold">{m['learning.correction']()}</h4><p class="whitespace-pre-wrap break-words text-sm">{entry.correction}</p>{/if}
        {#if entry.evidence}<details class="mt-3 text-sm"><summary>{m['learning.evidence']()}</summary><p class="mt-2 whitespace-pre-wrap break-words">{entry.evidence}</p><code class="block break-all text-xs">{entry.taskId}</code></details>{/if}
        <details class="mt-2 text-xs text-[var(--app-text-muted)]"><summary>{m['learning.history']()}</summary>{#each entry.history as revision}<p>v{revision.revision} · {knowledgeLabel(revision.status)} · {new Date(revision.at).toLocaleString()}</p>{/each}</details>
        <div class="mt-3 flex flex-wrap gap-2">
          {#if entry.correction && entry.evidence && entry.status !== 'active'}<Button size="sm" disabled={busy} onclick={() => void command({ command: 'decide', id: entry.id, revision: entry.revision, status: 'active' })}><Check size={14} />{m['learning.approve']()}</Button>{/if}
          {#if entry.status !== 'rejected'}<Button variant="outline" size="sm" disabled={busy} onclick={() => void command({ command: 'decide', id: entry.id, revision: entry.revision, status: 'rejected' })}><X size={14} />{m['learning.reject']()}</Button>{/if}
          {#if entry.status !== 'archived'}<Button variant="outline" size="sm" disabled={busy} onclick={() => void command({ command: 'decide', id: entry.id, revision: entry.revision, status: 'archived' })}><Archive size={14} />{m['learning.archive']()}</Button>{/if}
        </div>
      </article>
    {:else}<p class="p-4 text-sm text-[var(--app-text-muted)]">{m['learning.empty']()}</p>{/each}
  </div>
</section>
