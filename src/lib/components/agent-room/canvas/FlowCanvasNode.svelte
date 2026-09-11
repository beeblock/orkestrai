<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { NodeProps } from '@xyflow/svelte';
  import { Check, CircleCheck, CircleDashed, CircleX, Clock, Loader2, Play, Plus, RefreshCw, Square, Trash2, UserCheck, Workflow } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import NodeShell from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import * as m from '$lib/paraglide/messages.js';

  type FlowStep = { kind: 'agent' | 'approval'; target?: string; prompt?: string };
  type FlowRunStep = { index: number; label: string; status: 'pending' | 'running' | 'waiting' | 'done' | 'error'; excerpt?: string };
  type FlowRun = { active: boolean; iteration: number; iterations: number; startedAt: string; steps: FlowRunStep[] };
  type FlowFinishedRun = { ok: boolean; error?: string; startedAt: string; finishedAt: string; steps: FlowRunStep[] };

  type FlowPayload = {
    steps?: FlowStep[];
    iterations?: number;
    run?: FlowRun | null;
    runs?: FlowFinishedRun[];
  };

  export type FlowNodeData = {
    title: string;
    workspaceId: string;
    payload: FlowPayload;
    onDelete: (id: string) => void;
    onPayloadChange: (id: string, partial: Record<string, unknown>) => Promise<void> | void;
    onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
    connections?: import('./NodeShell.svelte').NodeConnection[];
    onJumpToNode?: (nodeId: string) => void;
    onRemoveConnection?: (edgeId: string) => void;
    onRename?: (id: string, title: string) => void;
  };

  let { id, data, selected } = $props<NodeProps & { data: FlowNodeData }>();

  const steps = $derived(data.payload.steps ?? []);
  const iterations = $derived(data.payload.iterations ?? 1);
  const run = $derived(data.payload.run ?? null);
  const runs = $derived(data.payload.runs ?? []);

  let agents = $state<Array<{ id: string; title: string }>>([]);
  let flowInput = $state('');
  let busy = $state(false);
  let pendingPayload: Promise<void> = Promise.resolve();
  let disposed = false;
  /** Erro visivel no topo do no — nada de falhar em silencio. */
  let errorMsg = $state('');
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  onDestroy(() => { disposed = true; if (errorTimer) clearTimeout(errorTimer); });

  function showError(message: string) {
    errorMsg = message;
    if (errorTimer) clearTimeout(errorTimer);
    errorTimer = setTimeout(() => { errorMsg = ''; }, 12_000);
  }

  /** Ultima execucao falhou: mostra o erro ate uma nova run comecar. */
  const lastFailure = $derived(!run?.active && runs.length && !runs[0].ok ? runs[0] : null);

  async function api<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      const csrf = getCsrfToken();
      const response = await fetch(path, {
        ...init,
        headers: { 'content-type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(init?.headers ?? {}) },
      });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        showError(String(payload.error ?? m['flow.error_api']()));
        return null;
      }
      return payload.data as T;
    } catch {
      showError(m['flow.error_api']());
      return null;
    }
  }

  async function loadAgents() {
    const nodeList = await api<Array<{ id: string; type: string; title: string | null }>>(`/api/agent-room/workspaces/${data.workspaceId}/nodes`);
    if (nodeList) agents = nodeList.filter((node) => node.type === 'terminal').map((node) => ({ id: node.id, title: node.title ?? 'terminal' }));
  }

  $effect(() => {
    void data.workspaceId;
    void loadAgents();
  });

  function patchPayload(partial: Record<string, unknown>) {
    pendingPayload = Promise.resolve(data.onPayloadChange(id, partial));
    void pendingPayload.catch(() => { if (!disposed) showError(m['flow.error_api']()); });
  }

  function addStep(kind: 'agent' | 'approval') {
    if (kind === 'agent' && !agents.length) {
      showError(m['flow.no_agents_hint']());
      return;
    }
    errorMsg = '';
    const step: FlowStep = kind === 'approval' ? { kind } : { kind, target: agents[0]?.title ?? '', prompt: '{{input}}' };
    patchPayload({ steps: [...steps, step] });
  }

  function updateStep(index: number, patch: Partial<FlowStep>) {
    patchPayload({ steps: steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  }

  function removeStep(index: number) {
    patchPayload({ steps: steps.filter((_, i) => i !== index) });
  }

  function moveStep(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    patchPayload({ steps: next });
  }

  /** Sincroniza os passos com as conexoes do no: cada agente ligado ao fluxo
      vira um passo Agente (na ordem das arestas), sem duplicar os existentes. */
  async function syncFromConnections() {
    const edgeList = await api<Array<{ sourceNodeId: string; targetNodeId: string }>>(`/api/agent-room/workspaces/${data.workspaceId}/edges`);
    const nodeList = await api<Array<{ id: string; type: string; title: string | null }>>(`/api/agent-room/workspaces/${data.workspaceId}/nodes`);
    if (!edgeList || !nodeList) return;
    const connectedIds = edgeList
      .filter((edge) => edge.sourceNodeId === id || edge.targetNodeId === id)
      .map((edge) => (edge.sourceNodeId === id ? edge.targetNodeId : edge.sourceNodeId));
    const connectedAgents = nodeList
      .filter((node) => connectedIds.includes(node.id) && node.type === 'terminal')
      .map((node) => node.title ?? '');
    if (!connectedAgents.length) {
      showError(m['flow.sync_none_connected']());
      return;
    }
    const existing = new Set(steps.map((step) => step.target));
    const missing = connectedAgents.filter((title) => title && !existing.has(title));
    if (!missing.length) {
      showError(m['flow.sync_nothing_new']());
      return;
    }
    errorMsg = '';
    patchPayload({ steps: [...steps, ...missing.map((title) => ({ kind: 'agent' as const, target: title, prompt: '{{input}}' }))] });
  }

  async function startRun() {
    if (busy) return;
    if (!steps.length) {
      showError(m['flow.no_steps_hint']());
      return;
    }
    busy = true;
    errorMsg = '';
    const workspaceId = data.workspaceId;
    try {
      // Steps render optimistically; execution must wait for their persisted version.
      let saved: Promise<void>;
      do { saved = pendingPayload; await saved; } while (saved !== pendingPayload);
      if (disposed || workspaceId !== data.workspaceId) return;
      const started = await api(`/api/agent-room/workspaces/${workspaceId}/flows/run`, {
        method: 'POST',
        body: JSON.stringify({ nodeId: id, input: flowInput }),
      });
      if (started) flowInput = '';
    } catch { if (!disposed) showError(m['flow.error_api']()); }
    finally { busy = false; }
  }

  async function approveStep() {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/flows/approve`, { method: 'POST', body: JSON.stringify({ nodeId: id }) });
  }

  async function stopRun() {
    await api(`/api/agent-room/workspaces/${data.workspaceId}/flows/stop`, { method: 'POST', body: JSON.stringify({ nodeId: id }) });
  }

  const stepIcon = (status: FlowRunStep['status']) =>
    status === 'done' ? CircleCheck : status === 'running' ? Loader2 : status === 'waiting' ? Clock : status === 'error' ? CircleX : CircleDashed;
</script>

<NodeShell
  {id}
  {selected}
  class="canvas-flow"
  accent="var(--app-accent)"
  minWidth={420}
  minHeight={300}
  onResize={data.onResize}
  titleText={data.title}
  onRename={data.onRename}
  connections={data.connections ?? []}
  onJumpToNode={data.onJumpToNode}
  onRemoveConnection={data.onRemoveConnection}
>
  {#snippet icon()}<Workflow size={13} />{/snippet}
  {#snippet title()}{data.title || m['flow.title_default']()}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['flow.remove']()} class="node-action-btn" danger side="left" onclick={() => data.onDelete(id)}>
      <Trash2 size={13} /></HeaderIconButton>
  {/snippet}

  <div class="flow-body nodrag nowheel">
    {#if errorMsg}
      <div class="flow-banner error" role="alert"><CircleX size={12} /> <span>{errorMsg}</span></div>
    {:else if lastFailure}
      <div class="flow-banner error" role="alert">
        <CircleX size={12} />
        <span>{m['flow.last_run_failed']()}: {lastFailure.error ?? m['flow.history_failed']()}</span>
      </div>
    {/if}

    <div class="flow-steps">
      {#each steps as step, index (index)}
        {@const runStep = run?.steps?.[index]}
        {@const StepStatusIcon = runStep ? stepIcon(runStep.status) : null}
        <div class="flow-step" class:running={runStep?.status === 'running'} class:waiting={runStep?.status === 'waiting'}>
          <span class="flow-step-num">
            {#if StepStatusIcon}<StepStatusIcon size={12} class={runStep?.status === 'running' ? 'flow-spin' : ''} />{:else}{index + 1}{/if}
          </span>
          {#if step.kind === 'approval'}
            <span class="flow-step-kind approval"><UserCheck size={11} /> {m['flow.kind_approval']()}</span>
          {:else}
            <Select.Root type="single" value={step.target ?? ''} onValueChange={(value: string) => updateStep(index, { target: value })}>
              <Select.Trigger class="flow-step-target" data-slot="select-trigger">
                {step.target || m['flow.agent_fallback']()}
              </Select.Trigger>
              <Select.Content>
                {#each agents as agent (agent.id)}
                  <Select.Item value={agent.title}>{agent.title}</Select.Item>
                {/each}
              </Select.Content>
            </Select.Root>
          {/if}
          <span class="flow-step-actions">
            <button class="flow-mini-btn" aria-label={m['flow.move_up']()} onclick={() => moveStep(index, -1)}>↑</button>
            <button class="flow-mini-btn" aria-label={m['flow.move_down']()} onclick={() => moveStep(index, 1)}>↓</button>
            <button class="flow-mini-btn danger" aria-label={m['flow.remove_step']()} onclick={() => removeStep(index)}>×</button>
          </span>
          {#if step.kind === 'agent'}
            <textarea
              class="flow-step-prompt"
              rows="2"
              value={step.prompt ?? ''}
              placeholder={m['ph.flow_step_prompt']()}
              onchange={(event) => updateStep(index, { prompt: (event.target as HTMLTextAreaElement).value })}
            ></textarea>
          {/if}
          {#if runStep?.excerpt}
            <span class="flow-step-excerpt">{runStep.excerpt}</span>
          {/if}
        </div>
      {:else}
        <div class="flow-empty">
          <Workflow size={18} />
          <strong>{m['flow.empty']()}</strong>
          <span>{m['flow.empty_guide']()}</span>
        </div>
      {/each}
    </div>

    <div class="flow-add">
      <button class="flow-add-btn" onclick={() => addStep('agent')} title={agents.length ? '' : m['flow.no_agents_hint']()}><Plus size={12} /> {m['flow.add_agent']()}</button>
      <button class="flow-add-btn" onclick={() => addStep('approval')}><UserCheck size={12} /> {m['flow.add_approval']()}</button>
      <button class="flow-add-btn" title={m['flow.sync_tooltip']()} onclick={syncFromConnections}><RefreshCw size={12} /> {m['flow.sync']()}</button>
      <label class="flow-iter">
        {m['flow.repeat']()}
        <input
          type="number"
          min="1"
          max="5"
          value={iterations}
          onchange={(event) => patchPayload({ iterations: Math.min(5, Math.max(1, Number((event.target as HTMLInputElement).value) || 1)) })}
        />
        x
      </label>
    </div>

    <div class="flow-run">
      {#if run?.active}
        <div class="flow-run-status">
          <Loader2 size={12} class="flow-spin" />
          {m['flow.running_status']({ current: (run.steps.findIndex((step) => step.status === 'running' || step.status === 'waiting') + 1) || run.steps.length, total: run.steps.length })}
          {run.iterations > 1 ? m['flow.round_suffix']({ iteration: run.iteration, total: run.iterations }) : ''}
        </div>
        {#if run.steps.some((step) => step.status === 'waiting')}
          <button class="flow-approve-btn" onclick={approveStep}><Check size={12} /> {m['flow.approve']()}</button>
        {/if}
        <button class="flow-stop-btn" onclick={stopRun}><Square size={11} /> {m['flow.stop']()}</button>
      {:else}
        <input
          class="flow-input"
          bind:value={flowInput}
          placeholder={m['ph.flow_initial_input']()}
          aria-label={m['flow.input_aria']()}
        />
        <button class="flow-run-btn" disabled={busy} onclick={startRun}>
          {#if busy}<Loader2 size={12} class="flow-spin" /> {m['flow.starting']()}{:else}<Play size={12} /> {m['flow.run']()}{/if}
        </button>
      {/if}
    </div>

    {#if runs.length}
      <div class="flow-history">
        {#each runs as pastRun (pastRun.startedAt)}
          <div class="flow-history-row" class:failed={!pastRun.ok}>
            {#if pastRun.ok}<CircleCheck size={11} />{:else}<CircleX size={11} />{/if}
            <span>{new Date(pastRun.finishedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            <span class="flow-history-detail">{pastRun.ok ? m['flow.history_ok']({ count: pastRun.steps.filter((step) => step.status === 'done').length }) : (pastRun.error ?? m['flow.history_failed']())}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</NodeShell>

<style>
  .flow-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 8px 10px;
    font-size: 11.5px;
    color: var(--app-text-soft);
    overflow-y: auto;
  }

  .flow-steps {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .flow-step {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--app-border);
    background: color-mix(in srgb, var(--app-surface-raised) 55%, transparent);
  }

  .flow-step.running {
    border-color: color-mix(in srgb, var(--app-secondary) 55%, var(--app-border));
  }

  .flow-step.waiting {
    border-color: color-mix(in srgb, var(--app-warning) 58%, var(--app-border));
  }

  .flow-step-num {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--app-secondary) 16%, transparent);
    color: var(--app-secondary);
    font-size: 9.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .flow-step-kind.approval {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--app-warning);
    font-size: 10.5px;
  }

  .flow-step :global(.flow-step-target) {
    width: 100%;
    height: 24px;
    font-size: 11px;
    background: transparent;
    border: none;
    box-shadow: none;
    padding: 0 4px;
  }

  .flow-step-actions {
    display: inline-flex;
    gap: 2px;
  }

  .flow-mini-btn {
    border: none;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 11px;
  }

  .flow-mini-btn:hover {
    background: var(--app-border);
    color: var(--app-text);
  }

  .flow-mini-btn.danger:hover {
    color: var(--app-danger);
  }

  .flow-step-prompt {
    grid-column: 1 / -1;
    width: 100%;
    resize: vertical;
    background: var(--app-surface-subtle);
    border: 1px solid var(--app-border);
    border-radius: 6px;
    color: var(--app-text-soft);
    font-size: 10.5px;
    font-family: inherit;
    padding: 5px 7px;
    outline: none;
  }

  .flow-step-excerpt {
    grid-column: 1 / -1;
    font-size: 10px;
    color: var(--app-text-muted);
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .flow-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 16px 12px;
    text-align: center;
    color: var(--app-text-muted);
    border: 1.5px dashed color-mix(in srgb, var(--app-accent) 42%, transparent);
    border-radius: 10px;
    background: color-mix(in srgb, var(--app-accent) 7%, transparent);
  }

  .flow-empty strong {
    font-size: 11.5px;
    color: var(--app-text-soft);
    font-weight: 600;
  }

  .flow-empty span {
    font-size: 10.5px;
    line-height: 1.45;
    max-width: 34ch;
  }

  .flow-banner {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 7px 9px;
    border-radius: 8px;
    font-size: 10.5px;
    line-height: 1.4;
  }

  .flow-banner.error {
    background: color-mix(in srgb, var(--app-danger) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--app-danger) 42%, var(--app-border));
    color: var(--app-danger);
  }

  .flow-banner :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .flow-add {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .flow-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 7px;
    border: 1px solid var(--app-border);
    background: transparent;
    color: var(--app-text-soft);
    font-size: 10.5px;
    cursor: pointer;
  }

  .flow-add-btn:hover:not(:disabled) {
    background: var(--app-border);
  }

  .flow-add-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .flow-iter {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: var(--app-text-muted);
  }

  .flow-iter input {
    width: 40px;
    background: var(--app-surface-subtle);
    border: 1px solid var(--app-border);
    border-radius: 6px;
    color: var(--app-text);
    font-size: 11px;
    padding: 2px 5px;
    text-align: center;
  }

  .flow-run {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .flow-input {
    flex: 1;
    min-width: 0;
    background: var(--app-surface-subtle);
    border: 1px solid var(--app-border);
    border-radius: 7px;
    color: var(--app-text);
    font-size: 11px;
    padding: 5px 9px;
    outline: none;
  }

  .flow-run-btn,
  .flow-approve-btn,
  .flow-stop-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    border-radius: 7px;
    border: none;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .flow-run-btn {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .flow-run-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .flow-approve-btn {
    background: color-mix(in srgb, var(--app-success) 18%, transparent);
    color: var(--app-success);
    border: 1px solid color-mix(in srgb, var(--app-success) 45%, var(--app-border));
  }

  .flow-stop-btn {
    background: color-mix(in srgb, var(--app-danger) 14%, transparent);
    color: var(--app-danger);
    border: 1px solid color-mix(in srgb, var(--app-danger) 42%, var(--app-border));
  }

  .flow-run-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--app-secondary);
  }

  .flow-history {
    display: flex;
    flex-direction: column;
    gap: 3px;
    border-top: 1px solid var(--app-border);
    padding-top: 6px;
  }

  .flow-history-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: var(--app-success);
  }

  .flow-history-row.failed {
    color: var(--app-danger);
  }

  .flow-history-detail {
    color: var(--app-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .flow-history-row :global(svg),
  .flow-run-status :global(.flow-spin) {
    animation: none;
  }

  .flow-run-status :global(.flow-spin) {
    animation: flow-spin 1s linear infinite;
  }

  @keyframes flow-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flow-run-status :global(.flow-spin) {
      animation: none;
    }
  }
</style>
