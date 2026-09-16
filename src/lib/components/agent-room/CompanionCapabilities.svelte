<script lang="ts">
  import { untrack } from 'svelte';
  import { RefreshCw, Check, CircleAlert, Minus } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { ComputerCommandInput, ComputerCommandResult } from '$lib/modules/agent-room/contracts/schemas/computer.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, command }: { workspaceId: string; command: (input: ComputerCommandInput) => Promise<ComputerCommandResult | null> } = $props();
  let result = $state<Extract<ComputerCommandResult, { kind: 'capabilities' }> | null>(null);
  let busy = $state(false);
  let generation = 0;
  const text = m as unknown as Record<string, () => string>;
  async function load() {
    const request = ++generation, workspace = workspaceId;
    busy = true;
    try { const value = await command({ command: 'capabilities' }); if (request === generation && workspace === workspaceId && value?.kind === 'capabilities') result = value; }
    finally { if (request === generation) busy = false; }
  }
  $effect(() => { workspaceId; untrack(() => { generation++; result = null; busy = false; }); });
</script>
<details class="border-t border-[var(--app-border)] py-3" data-testid="companion-capabilities" ontoggle={event => { if (event.currentTarget.open && !result) void load(); }}>
  <summary class="cursor-pointer text-xs font-semibold">{text['companion.capabilities']()}</summary>
  <div class="mt-2 flex justify-end"><Button variant="ghost" size="icon-sm" disabled={busy} aria-label={m['computer.refresh']()} title={m['computer.refresh']()} onclick={load}><RefreshCw size={14} class={busy ? 'animate-spin' : ''} /></Button></div>
  {#if result}<ul class="divide-y divide-[var(--app-border)] text-xs">
    {#each result.capabilities as capability (capability.id)}
      <li class="flex min-w-0 flex-wrap items-center gap-2 py-2">
        {#if capability.state === 'available'}<Check size={14} class="shrink-0 text-[var(--app-success)]" />{:else if capability.state === 'unsupported'}<Minus size={14} class="shrink-0 text-[var(--app-text-muted)]" />{:else}<CircleAlert size={14} class="shrink-0 text-[var(--app-warning)]" />{/if}
        <span class="min-w-0 flex-1 break-words">{text[`companion.cap_${capability.id}`]()}</span>
        <span class="text-[var(--app-text-muted)]">{text[`companion.state_${capability.state}`]()}</span>
      </li>
    {/each}
  </ul>{/if}
</details>
