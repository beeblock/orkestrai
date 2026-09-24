<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import { CircleAlert, LoaderCircle, Minus, Moon, Plus, Sun } from '@lucide/svelte';
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
  <Dialog.Content class="sm:max-w-[520px]">
    <Dialog.Header>
      <Dialog.Title>{m['agent_runtime.title']()}</Dialog.Title>
      <Dialog.Description>{m['agent_runtime.description']()}</Dialog.Description>
    </Dialog.Header>

    <div class="grid gap-5">
      <!-- Estado atual e a acao que o altera ficam juntos. -->
      <div class="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 shadow-[var(--app-shadow-border)]">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="state-dot" class:awake={runtime?.state === 'awake'} aria-hidden="true"></span>
          <div class="min-w-0">
            <p class="text-ui-lg font-medium">
              {m['agent_runtime.state']()} · <span class={runtime?.state === 'awake' ? 'text-[var(--app-success)]' : 'text-[var(--app-text-soft)]'}>{runtime?.state === 'awake' ? m['agent_runtime.awake']() : m['agent_runtime.sleeping']()}</span>
            </p>
            <p class="text-ui-md text-muted-foreground"><span class="tabular-nums">{runtime?.activeRuns ?? 0}</span> {m['agent_runtime.active_runs']()}</p>
          </div>
        </div>
        {#if runtime?.state === 'awake'}
          <Button type="button" size="sm" variant="outline" class="shrink-0" disabled={busy || Boolean(runtime.activeRuns)} onclick={() => act('sleep')}><Moon aria-hidden="true" />{m['agent_runtime.sleep']()}</Button>
        {:else}
          <Button type="button" size="sm" variant="outline" class="shrink-0" disabled={busy} onclick={() => act('wake')}><Sun aria-hidden="true" />{m['agent_runtime.wake']()}</Button>
        {/if}
      </div>

      <div class="grid gap-1.5">
        <span class="text-ui-lg font-medium" id="agent-runtime-mode-label">{m['agent_runtime.mode']()}</span>
        <SegmentedControl
          fill
          label={m['agent_runtime.mode']()}
          value={mode}
          onValueChange={(value) => (mode = value)}
          options={[
            { value: 'interactive', label: m['agent_runtime.mode_interactive']() },
            { value: 'on_demand', label: m['agent_runtime.mode_on_demand']() },
            { value: 'persistent', label: m['agent_runtime.mode_persistent']() },
          ]}
        />
        <p class="text-ui-md leading-snug text-pretty text-muted-foreground" aria-live="polite">
          {mode === 'persistent' ? m['agent_runtime.mode_persistent_hint']() : mode === 'on_demand' ? m['agent_runtime.mode_on_demand_hint']() : m['agent_runtime.mode_interactive_hint']()}
        </p>
      </div>

      <!-- Limites: cada numero no controle que combina com sua faixa. -->
      <div class="grid border-t border-[var(--app-border)] pt-3">
        <span class="section-label mb-1">{m['agent_runtime.limits']()}</span>
        <div class="limit-row">
          <label class="text-ui-lg" for="agent-runtime-idle">{m['agent_runtime.idle_label']()}</label>
          <span class="unit-input">
            <Input id="agent-runtime-idle" type="number" min="5" max="720" step="5" bind:value={idleMinutes} aria-label={m['agent_runtime.idle_minutes']()} class="h-8 w-28 text-[13px]" />
            <span aria-hidden="true">min</span>
          </span>
        </div>
        <div class="limit-row">
          <span class="text-ui-lg" id="agent-runtime-concurrency-label">{m['agent_runtime.concurrency']()}</span>
          <div class="stepper" role="group" aria-labelledby="agent-runtime-concurrency-label">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${m['agent_runtime.concurrency']()} −`} disabled={concurrency <= 1} onclick={() => (concurrency = Math.max(1, concurrency - 1))}><Minus aria-hidden="true" /></Button>
            <output class="stepper-value" aria-live="polite">{concurrency}</output>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`${m['agent_runtime.concurrency']()} +`} disabled={concurrency >= 8} onclick={() => (concurrency = Math.min(8, concurrency + 1))}><Plus aria-hidden="true" /></Button>
          </div>
        </div>
        <div class="limit-row">
          <span class="text-ui-lg">{m['agent_runtime.usage_label']()}</span>
          <div class="flex w-44 items-center gap-3">
            <Slider type="single" class="flex-1 [&_[data-slot=slider-track]]:bg-[var(--app-border-strong)]" value={usageLimit} min={50} max={100} step={1} aria-label={m['agent_runtime.usage_limit']()} onValueChange={(value: number) => (usageLimit = value)} />
            <output class="slider-value w-9 text-right">{usageLimit}%</output>
          </div>
        </div>
      </div>

      {#if errorMessage}<p class="flex items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]" role="alert"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{errorMessage}</span></p>{/if}
    </div>

    <Dialog.Footer>
      <Button type="button" variant="outline" onclick={onClose}>{m['dlg.cancel']()}</Button>
      <Button type="button" disabled={busy} onclick={save}>
        {#if busy}<LoaderCircle class="animate-spin" aria-hidden="true" />{/if}
        {busy ? m['term.runtime_saving']() : m['dlg.save']()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .state-dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 999px;
    background: var(--app-text-muted);
  }

  .state-dot.awake {
    background: var(--app-success);
    box-shadow: 0 0 0 3px var(--app-success-soft);
  }

  /* Linha de limite: rotulo a esquerda, controle a direita (como em Configuracoes). */
  .limit-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 44px;
  }

  .limit-row + .limit-row {
    border-top: 1px solid var(--app-border);
  }

  .unit-input {
    position: relative;
    display: block;
  }

  .unit-input :global(input) {
    padding-right: 36px;
    font-variant-numeric: tabular-nums;
  }

  .unit-input > span {
    position: absolute;
    top: 50%;
    right: 10px;
    transform: translateY(-50%);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--app-text-muted);
    pointer-events: none;
  }

  .stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .stepper-value {
    min-width: 28px;
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: center;
    color: var(--app-text);
  }

  .slider-value {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--app-text-muted);
  }
</style>
