<script lang="ts">
  import { Server } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import type { SshMachine } from '$lib/modules/agent-room/domain/ssh-machines.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    open = $bindable(false),
    programs,
    onOpenTerminal,
  }: {
    open?: boolean;
    /** Agent CLIs the owner can start on the machine (they must be installed there). */
    programs: Array<{ id: string; label: string }>;
    onOpenTerminal: (machine: SshMachine, directory: string, program: string | null) => Promise<void>;
  } = $props();

  let machines = $state<SshMachine[] | null>(null);
  let directory = $state('');
  let program = $state('shell');
  let busy = $state<string | null>(null);

  $effect(() => {
    if (!open || machines) return;
    void fetch('/api/agent-room/machines', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { data?: SshMachine[] } | null) => (machines = body?.data ?? []))
      .catch(() => (machines = []));
  });

  const programLabel = $derived(program === 'shell' ? m['machines.shell']() : programs.find((candidate) => candidate.id === program)?.label ?? program);

  async function openOn(machine: SshMachine) {
    busy = machine.alias;
    await onOpenTerminal(machine, directory, program === 'shell' ? null : program);
    busy = null;
    open = false;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m['machines.title']()}</Dialog.Title>
      <Dialog.Description>{m['machines.description']()}</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-3">
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <Input bind:value={directory} placeholder={m['machines.directory']()} aria-label={m['machines.directory']()} />
        <Select.Root type="single" value={program} onValueChange={(value: string) => (program = value)}>
          <Select.Trigger class="w-40" aria-label={m['machines.program']()}><span class="truncate">{programLabel}</span></Select.Trigger>
          <Select.Content>
            <Select.Item value="shell">{m['machines.shell']()}</Select.Item>
            {#each programs as candidate (candidate.id)}<Select.Item value={candidate.id}>{candidate.label}</Select.Item>{/each}
          </Select.Content>
        </Select.Root>
      </div>
      {#if machines === null}
        <p class="text-ui-sm text-[var(--app-text-muted)]">{m['chat.loading']()}</p>
      {:else if machines.length}
        <ul class="grid max-h-72 gap-1 overflow-y-auto">
          {#each machines as machine (machine.alias)}
            <li class="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-[var(--app-hover)]">
              <span class="grid size-8 place-items-center rounded-lg bg-[var(--app-surface-raised)] text-[var(--app-text-soft)]"><Server size={15} /></span>
              <span class="min-w-0 flex-1">
                <b class="block truncate text-ui-sm">{machine.alias}</b>
                <small class="block truncate text-ui-xs text-[var(--app-text-muted)]">{[machine.user, machine.hostName].filter(Boolean).join('@') || machine.alias}{machine.port ? `:${machine.port}` : ''}</small>
              </span>
              <Button size="sm" variant="outline" disabled={busy !== null} onclick={() => void openOn(machine)}>{m['machines.open']()}</Button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-ui-sm text-[var(--app-text-muted)]">{m['machines.empty']()}</p>
      {/if}
      <p class="text-ui-xs text-[var(--app-text-muted)]">{m['machines.note']()}</p>
    </div>
  </Dialog.Content>
</Dialog.Root>
