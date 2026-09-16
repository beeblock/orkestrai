<script lang="ts">
  import { untrack } from 'svelte';
  import { Search, Trash2, Pencil, Save, X } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import * as Select from '$lib/components/ui/select';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import type { ComputerReplyGrant } from '$lib/modules/agent-room/contracts/schemas/computer-reply.schema.js';
  import type { ComputerCommandInput, ComputerCommandResult } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import type { ConversationMemoryResult, ConversationMemoryFact } from '$lib/modules/agent-room/contracts/schemas/conversation-memory.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  import { getLocale } from '$lib/paraglide/runtime.js';
  let { grant, disabled, update, command }: { grant: ComputerReplyGrant; disabled: boolean; update: (fields: Partial<ComputerReplyGrant>) => Promise<void>; command: (input: ComputerCommandInput) => Promise<ComputerCommandResult | null> } = $props();
  const text = m as unknown as Record<string, () => string>;
  let result = $state<ConversationMemoryResult | null>(null);
  let query = $state('');
  let busy = $state(false);
  let editing = $state<ConversationMemoryFact | null>(null);
  let deletion = $state<ConversationMemoryFact | 'all' | null>(null);
  let confirmOpen = $state(false);
  let request = 0;
  async function search() {
    const id = ++request, grantId = grant.id;
    busy = true;
    try { const next = await command({ command: 'memory_search', grantId, query, limit: 20 }); if (id === request && grantId === grant.id && next?.kind === 'conversation_memory') result = next; }
    finally { if (id === request) busy = false; }
  }
  async function save() {
    if (!editing) return;
    const generation = request, grantId = grant.id;
    busy = true;
    try {
      const next = await command({ command: 'memory_save', grantId: grant.id, id: editing.id, revision: editing.revision, title: editing.title, content: editing.content, sourceDigests: editing.sources.map(s => s.digest) });
      if (next && generation === request && grantId === grant.id) { editing = null; await search(); }
    } finally { if (grantId === grant.id) busy = false; }
  }
  async function erase() {
    if (!deletion) return;
    const generation = request, grantId = grant.id;
    busy = true;
    try {
      const next = await command({ command: 'memory_forget', grantId: grant.id, ...(deletion === 'all' ? { all: true } : { all: false, id: deletion.id, revision: deletion.revision }) });
      if (next?.kind === 'conversation_memory' && generation === request && grantId === grant.id) { result = next; editing = null; deletion = null; confirmOpen = false; }
    } finally { if (grantId === grant.id) busy = false; }
  }
  $effect(() => { grant.id; untrack(() => { result = null; editing = null; deletion = null; confirmOpen = false; busy = false; query = ''; request++; }); });
</script>
<div class="min-w-0 space-y-3 pb-3" data-testid="conversation-memory">
  <label class="flex items-center justify-between gap-3 text-xs"><span>{text['companion.memory']()}</span><Switch checked={grant.memoryEnabled} disabled={disabled || busy} onCheckedChange={(memoryEnabled: boolean) => update({ memoryEnabled })} /></label>
  {#if grant.memoryEnabled}<label class="flex flex-wrap items-center gap-2 text-xs"><span class="flex-1">{text['companion.retention']()}</span><Select.Root type="single" value={String(grant.memoryRetentionDays)} onValueChange={days => update({ memoryRetentionDays: Number(days) })}><Select.Trigger class="w-24" disabled={disabled || busy}>{grant.memoryRetentionDays}</Select.Trigger><Select.Content>{#each [...new Set([30,90,365,730,3650,grant.memoryRetentionDays])].sort((a,b)=>a-b) as days}<Select.Item value={String(days)}>{days}</Select.Item>{/each}</Select.Content></Select.Root></label>{/if}
  <details ontoggle={event => { if (event.currentTarget.open && !result) void search(); }}>
    <summary class="cursor-pointer py-1 text-xs font-medium">{text['companion.history']()}</summary>
    <p class="py-2 text-xs leading-5 text-[var(--app-text-muted)]">{text['companion.memory_scope']()}</p>
    <div class="flex min-w-0 gap-1"><Input class="min-w-0 flex-1" bind:value={query} aria-label={text['companion.search']()} placeholder={text['companion.search']()} onkeydown={(event: KeyboardEvent) => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} /><Button size="icon-sm" variant="outline" disabled={busy || disabled} aria-label={text['companion.search']()} title={text['companion.search']()} onclick={search}><Search size={14} /></Button></div>
    {#if result}
      <div class="max-h-80 space-y-3 overflow-y-auto overscroll-contain py-3 text-xs" aria-live="polite">
        <h4 class="font-medium">{text['companion.facts']()} ({result.totalFacts})</h4>
        {#each result.facts as fact (fact.id)}
          <div class="border-b border-[var(--app-border)] pb-2">
            {#if editing?.id === fact.id}
              <Input bind:value={editing.title} aria-label={text['companion.edit']()} maxlength={160} /><Textarea class="mt-2 min-h-20" bind:value={editing.content} aria-label={text['companion.facts']()} maxlength={4000} />
              <div class="mt-1 flex justify-end gap-1"><Button size="icon-sm" variant="ghost" aria-label={text['companion.cancel']()} onclick={() => editing = null}><X size={13} /></Button><Button size="icon-sm" disabled={busy || !editing.title.trim() || !editing.content.trim()} aria-label={text['companion.save']()} onclick={save}><Save size={13} /></Button></div>
            {:else}
              <div class="flex items-start gap-2"><strong class="min-w-0 flex-1 break-words">{fact.title}</strong><Button size="icon-sm" variant="ghost" disabled={busy} aria-label={text['companion.edit']()} title={text['companion.edit']()} onclick={() => editing = structuredClone($state.snapshot(fact))}><Pencil size={13} /></Button><Button size="icon-sm" variant="ghost" disabled={busy} aria-label={text['companion.forget']()} title={text['companion.forget']()} onclick={() => { deletion = fact; confirmOpen = true; }}><Trash2 size={13} /></Button></div>
              <p class="whitespace-pre-wrap break-words leading-5">{fact.content}</p>
            {/if}
          </div>
        {/each}
        <h4 class="font-medium">{text['companion.messages']()} ({result.totalMessages})</h4>
        {#each result.messages as message (message.id)}<div class="border-b border-[var(--app-border)] pb-2"><p class="mb-1 text-[var(--app-text-muted)]">{text[`companion.${message.direction}`]()} · {new Date(message.observedAt).toLocaleString(getLocale())}</p><p class="whitespace-pre-wrap break-words leading-5">{message.content}</p></div>{/each}
        {#if !result.facts.length && !result.messages.length}<p class="text-[var(--app-text-muted)]">{text['companion.no_results']()}</p>{/if}
      </div>
      <Button size="sm" variant="outline" disabled={busy || disabled || !result.totalFacts && !result.totalMessages} onclick={() => { deletion = 'all'; confirmOpen = true; }}><Trash2 size={13} />{text['companion.forget_all']()}</Button>
    {/if}
  </details>
</div>
<AlertDialog.Root bind:open={confirmOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{deletion === 'all' ? text['companion.forget_all']() : text['companion.forget']()}</AlertDialog.Title><AlertDialog.Description>{text['companion.forget_confirm']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel disabled={busy}>{text['companion.cancel']()}</AlertDialog.Cancel><Button variant="destructive" disabled={busy} onclick={erase}>{text['companion.forget']()}</Button></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
