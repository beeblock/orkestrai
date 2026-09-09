<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { AgentRuntimeData } from '$lib/modules/agent-room/contracts/schemas/agent-runtime.schema.js';
  import * as m from '$lib/paraglide/messages.js';

  let {
    open,
    workspaceId,
    nodeId,
    onChanged,
    onClose,
  }: {
    open: boolean;
    workspaceId: string;
    nodeId: string;
    onChanged: (runtime: AgentRuntimeData) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  let runtime = $state<AgentRuntimeData | null>(null);
  let mode = $state<'interactive' | 'on_demand' | 'persistent'>('interactive');
  let idleMinutes = $state(30);
  let concurrency = $state(1);
  let usageLimit = $state(95);
  let busy = $state(false);
  let errorMessage = $state('');
  let loadedFor = '';

  $effect(() => {
    if (!open || loadedFor === `${workspaceId}:${nodeId}`) return;
    loadedFor = `${workspaceId}:${nodeId}`;
    void load();
  });

  async function request<T>(method: string, body?: Record<string, unknown>): Promise<T> {
    const csrf = getCsrfToken();
    const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/nodes/${nodeId}/runtime`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || m['agent_runtime.error']());
    return payload.data as T;
  }

  function apply(value: AgentRuntimeData) {
    runtime = value;
    mode = value.mode;
    idleMinutes = value.idleMinutes;
    concurrency = value.concurrency;
    usageLimit = value.usageLimit;
    void onChanged(value);
  }

  async function load() {
    errorMessage = '';
    try {
      apply(await request<AgentRuntimeData>('GET'));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['agent_runtime.error']();
    }
  }

  async function save() {
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      apply(await request<AgentRuntimeData>('PATCH', { mode, idleMinutes, concurrency, usageLimit }));
      onClose();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['agent_runtime.error']();
    } finally {
      busy = false;
    }
  }

  async function act(action: 'wake' | 'sleep') {
    if (busy) return;
    busy = true;
    errorMessage = '';
    try {
      apply(await request<AgentRuntimeData>('POST', { action }));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : m['agent_runtime.error']();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root {open} onOpenChange={(value) => !value && onClose()}>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{m['agent_runtime.title']()}</Dialog.Title>
      <Dialog.Description>{m['agent_runtime.description']()}</Dialog.Description>
    </Dialog.Header>

    <div class="space-y-4">
      <div class="flex items-center justify-between rounded-md border border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-3 py-2">
        <div>
          <p class="text-sm font-medium">{m['agent_runtime.state']()}</p>
          <p class="text-xs text-[var(--app-text-muted)]">{runtime?.activeRuns ?? 0} {m['agent_runtime.active_runs']()}</p>
        </div>
        <span class={`rounded-full px-2 py-1 text-xs font-medium ${runtime?.state === 'awake' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--app-border)]'}`}>
          {runtime?.state === 'awake' ? m['agent_runtime.awake']() : m['agent_runtime.sleeping']()}
        </span>
      </div>

      <div class="space-y-2">
        <Label for="agent-runtime-mode">{m['agent_runtime.mode']()}</Label>
        <Select.Root type="single" value={mode} onValueChange={(value: string) => (mode = value as typeof mode)}>
          <Select.Trigger id="agent-runtime-mode" class="w-full">
            {mode === 'persistent' ? m['agent_runtime.mode_persistent']() : mode === 'on_demand' ? m['agent_runtime.mode_on_demand']() : m['agent_runtime.mode_interactive']()}
          </Select.Trigger>
          <Select.Content>
            <Select.Item value="interactive">{m['agent_runtime.mode_interactive']()}</Select.Item>
            <Select.Item value="on_demand">{m['agent_runtime.mode_on_demand']()}</Select.Item>
            <Select.Item value="persistent">{m['agent_runtime.mode_persistent']()}</Select.Item>
          </Select.Content>
        </Select.Root>
        <p class="text-xs text-[var(--app-text-muted)]">
          {mode === 'persistent' ? m['agent_runtime.mode_persistent_hint']() : mode === 'on_demand' ? m['agent_runtime.mode_on_demand_hint']() : m['agent_runtime.mode_interactive_hint']()}
        </p>
      </div>

      <div class="grid grid-cols-3 gap-3">
        <Label class="space-y-1 text-xs" for="agent-runtime-idle">
          <span>{m['agent_runtime.idle_minutes']()}</span>
          <Input id="agent-runtime-idle" type="number" min="5" max="720" bind:value={idleMinutes} />
        </Label>
        <Label class="space-y-1 text-xs" for="agent-runtime-concurrency">
          <span>{m['agent_runtime.concurrency']()}</span>
          <Input id="agent-runtime-concurrency" type="number" min="1" max="8" bind:value={concurrency} />
        </Label>
        <Label class="space-y-1 text-xs" for="agent-runtime-usage">
          <span>{m['agent_runtime.usage_limit']()}</span>
          <Input id="agent-runtime-usage" type="number" min="50" max="100" bind:value={usageLimit} />
        </Label>
      </div>

      <div class="flex gap-2">
        {#if runtime?.state === 'awake'}
          <Button type="button" variant="outline" disabled={busy || Boolean(runtime.activeRuns)} onclick={() => act('sleep')}>{m['agent_runtime.sleep']()}</Button>
        {:else}
          <Button type="button" variant="outline" disabled={busy} onclick={() => act('wake')}>{m['agent_runtime.wake']()}</Button>
        {/if}
      </div>

      {#if errorMessage}<p class="text-sm text-destructive" role="alert">{errorMessage}</p>{/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
      <Button type="button" disabled={busy} onclick={save}>{busy ? m['term.runtime_saving']() : m['dlg.save']()}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
