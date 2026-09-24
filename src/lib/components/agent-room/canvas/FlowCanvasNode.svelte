<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { NodeProps } from '@xyflow/svelte';
  import { ArrowDown, ArrowUp, Bot, Check, CircleCheck, CircleDashed, CircleX, Clock, GripVertical, Loader2, Minus, Play, Plus, RefreshCw, Square, Trash2, UserCheck, Workflow } from '@lucide/svelte';
  import * as Select from '$lib/components/ui/select';
  import { Button } from '$lib/components/ui/button';
  import NodeShell from './NodeShell.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
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

  // -- Reordenar por arraste ---------------------------------------------------
  // O arraste troca o passo com o vizinho a cada linha cruzada, reusando
  // moveStep (a mesma acao dos botoes subir/descer). So troca de novo depois
  // que a lista otimista refletiu a troca anterior.
  let dragIndex = $state<number | null>(null);
  let stepsAtLastSwap: FlowStep[] | null = null;

  function onGripDragStart(event: DragEvent, index: number) {
    dragIndex = index;
    stepsAtLastSwap = null;
    if (!event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    const row = (event.currentTarget as HTMLElement).closest('.flow-step');
    if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 20, 18);
  }

  function onStepDragOver(event: DragEvent, index: number) {
    if (dragIndex === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (index === dragIndex || steps === stepsAtLastSwap) return;
    const delta = index < dragIndex ? -1 : 1;
    stepsAtLastSwap = steps;
    moveStep(dragIndex, delta);
    dragIndex += delta;
  }

  function endStepDrag() {
    dragIndex = null;
    stepsAtLastSwap = null;
  }

  // Teclado no puxador: setas movem o passo e o foco acompanha.
  function onGripKeydown(event: KeyboardEvent, index: number) {
    const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    const target = index + delta;
    if (target < 0 || target >= steps.length) return;
    moveStep(index, delta);
    requestAnimationFrame(() => stepsEl?.querySelector<HTMLElement>(`[data-step-grip="${target}"]`)?.focus());
  }

  let stepsEl = $state<HTMLOListElement | null>(null);

  const stepIcon = (status: FlowRunStep['status']) =>
    status === 'done' ? CircleCheck : status === 'running' ? Loader2 : status === 'waiting' ? Clock : status === 'error' ? CircleX : CircleDashed;
</script>

<!-- Acoes de montagem: no estado vazio e no rodape da lista. -->
{#snippet addButtons()}
  <Button size="sm" variant="outline" class="flow-add-btn" onclick={() => addStep('agent')} title={agents.length ? '' : m['flow.no_agents_hint']()}><Plus size={13} />{m['flow.add_agent']()}</Button>
  <Button size="sm" variant="outline" class="flow-add-btn" onclick={() => addStep('approval')}><UserCheck size={13} />{m['flow.add_approval']()}</Button>
  <Button size="sm" variant="ghost" class="flow-add-btn" title={m['flow.sync_tooltip']()} onclick={syncFromConnections}><RefreshCw size={13} />{m['flow.sync']()}</Button>
{/snippet}

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
  {#snippet icon()}<Workflow size={14} />{/snippet}
  {#snippet title()}{data.title || m['flow.title_default']()}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['flow.remove']()} class="node-action-btn" danger side="left" onclick={() => data.onDelete(id)}>
      <Trash2 size={14} /></HeaderIconButton>
  {/snippet}


  <div class="flow-body nodrag nowheel">
    {#if errorMsg}
      <div class="flow-banner error" role="alert"><CircleX size={14} /> <span>{errorMsg}</span></div>
    {:else if lastFailure}
      <div class="flow-banner error" role="alert">
        <CircleX size={14} />
        <span>{m['flow.last_run_failed']()}: {lastFailure.error ?? m['flow.history_failed']()}</span>
      </div>
    {/if}

    <!-- Entrada + Rodar no topo do corpo: a primeira acao do fluxo nunca fica
         escondida atras da doca do canvas, com ou sem passos. -->
    <div class="flow-run nodrag" class:active={run?.active}>
      {#if run?.active}
        <div class="flow-run-status" role="status">
          <Loader2 size={13} class="animate-spin" />
          <span>
            {m['flow.running_status']({ current: (run.steps.findIndex((step) => step.status === 'running' || step.status === 'waiting') + 1) || run.steps.length, total: run.steps.length })}
            {run.iterations > 1 ? m['flow.round_suffix']({ iteration: run.iteration, total: run.iterations }) : ''}
          </span>
        </div>
        <span class="flow-spacer"></span>
        {#if run.steps.some((step) => step.status === 'waiting')}
          <button class="flow-approve-btn press" onclick={approveStep}><Check size={13} /> {m['flow.approve']()}</button>
        {/if}
        <button class="flow-stop-btn press" onclick={stopRun}><Square size={12} /> {m['flow.stop']()}</button>
      {:else}
        <input
          class="flow-input"
          bind:value={flowInput}
          placeholder={m['ph.flow_initial_input']()}
          aria-label={m['flow.input_aria']()}
          onkeydown={(event) => { if (event.key === 'Enter' && !event.isComposing) startRun(); }}
        />
        <button class="flow-run-btn press" disabled={busy} onclick={startRun}>
          {#if busy}<Loader2 size={13} class="animate-spin" /> {m['flow.starting']()}{:else}<Play size={13} /> {m['flow.run']()}{/if}
        </button>
      {/if}
    </div>

    {#if steps.length}
      <div class="flow-section-head">
        <span class="section-label">{m['flow.steps_title']()}</span>
        <span class="flow-count">{steps.length}</span>
      </div>
      <!-- Lista ordenada com trilho numerado: a saida de um passo desce para o
           proximo. Puxador arrasta; setas do teclado tambem movem. -->
      <ol class="flow-steps" bind:this={stepsEl}>
        {#each steps as step, index (index)}
          {@const runStep = run?.steps?.[index]}
          {@const StepStatusIcon = runStep ? stepIcon(runStep.status) : null}
          <li
            class="flow-step"
            class:running={runStep?.status === 'running'}
            class:waiting={runStep?.status === 'waiting'}
            class:done={runStep?.status === 'done'}
            class:failed={runStep?.status === 'error'}
            class:dragging={dragIndex === index}
            ondragover={(event) => onStepDragOver(event, index)}
            ondrop={(event) => { event.preventDefault(); endStepDrag(); }}
          >
            <span class="flow-step-rail" aria-hidden="true">
              <span class="flow-step-num">
                {#if StepStatusIcon}<StepStatusIcon size={13} class={runStep?.status === 'running' ? 'animate-spin' : ''} />{:else}{index + 1}{/if}
              </span>
            </span>
            <div class="flow-step-card">
              <div class="flow-step-head">
                <button
                  type="button"
                  class="flow-step-grip"
                  draggable="true"
                  data-step-grip={index}
                  aria-label={m['flow.drag_step']()}
                  title={m['flow.drag_step']()}
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  onpointerdown={(event) => event.stopPropagation()}
                  ondragstart={(event) => onGripDragStart(event, index)}
                  ondragend={endStepDrag}
                  onkeydown={(event) => onGripKeydown(event, index)}
                ><GripVertical size={14} /></button>
                {#if step.kind === 'approval'}
                  <span class="flow-step-kind approval"><UserCheck size={14} /> {m['flow.add_approval']()}</span>
                {:else}
                  <Bot size={14} class="flow-step-bot" aria-hidden="true" />
                  <Select.Root type="single" value={step.target ?? ''} onValueChange={(value: string) => updateStep(index, { target: value })}>
                    <Select.Trigger class="flow-step-target" data-slot="select-trigger">
                      <span class="flow-step-target-label">{step.target || m['flow.agent_fallback']()}</span>
                    </Select.Trigger>
                    <Select.Content>
                      {#each agents as agent (agent.id)}
                        <Select.Item value={agent.title}>{agent.title}</Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                {/if}
                <span class="flow-step-actions">
                  <HeaderIconButton class="flow-mini-btn" label={m['flow.move_up']()} disabled={index === 0} onclick={() => moveStep(index, -1)}><ArrowUp size={13} /></HeaderIconButton>
                  <HeaderIconButton class="flow-mini-btn" label={m['flow.move_down']()} disabled={index === steps.length - 1} onclick={() => moveStep(index, 1)}><ArrowDown size={13} /></HeaderIconButton>
                  <HeaderIconButton class="flow-mini-btn danger" label={m['flow.remove_step']()} onclick={() => removeStep(index)}><Trash2 size={13} /></HeaderIconButton>
                </span>
              </div>
              {#if step.kind === 'agent'}
                <textarea
                  class="flow-step-prompt"
                  rows="2"
                  value={step.prompt ?? ''}
                  placeholder={m['ph.flow_step_prompt']()}
                  aria-label={m['ph.flow_step_prompt']()}
                  onchange={(event) => updateStep(index, { prompt: (event.target as HTMLTextAreaElement).value })}
                ></textarea>
              {/if}
              {#if runStep?.excerpt}
                <span class="flow-step-excerpt" title={runStep.excerpt}>{runStep.excerpt}</span>
              {/if}
            </div>
          </li>
        {/each}
      </ol>
      <div class="flow-add">
        {@render addButtons()}
        <span class="flow-spacer"></span>
        <span class="flow-iter" role="group" aria-label={m['flow.repeat']()}>
          <span class="flow-iter-label">{m['flow.repeat']()}</span>
          <HeaderIconButton class="flow-mini-btn" label={m['flow.repeat_less']()} disabled={iterations <= 1} onclick={() => patchPayload({ iterations: Math.min(5, Math.max(1, iterations - 1)) })}><Minus size={13} /></HeaderIconButton>
          <span class="flow-iter-value" aria-live="polite">{iterations}×</span>
          <HeaderIconButton class="flow-mini-btn" label={m['flow.repeat_more']()} disabled={iterations >= 5} onclick={() => patchPayload({ iterations: Math.min(5, Math.max(1, iterations + 1)) })}><Plus size={13} /></HeaderIconButton>
        </span>
      </div>
    {:else}
      <div class="flow-empty">
        <NodeEmptyState icon={Workflow} title={m['flow.empty_title']()} description={m['flow.empty_guide']()}>
          {#snippet actions()}{@render addButtons()}{/snippet}
        </NodeEmptyState>
      </div>
    {/if}

    {#if runs.length}
      <section class="flow-history">
        <span class="section-label">{m['flow.history_title']()}</span>
        {#each runs as pastRun (pastRun.startedAt)}
          <div class="flow-history-row" class:failed={!pastRun.ok}>
            {#if pastRun.ok}<CircleCheck size={13} />{:else}<CircleX size={13} />{/if}
            <span class="flow-history-time">{new Date(pastRun.finishedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            <span class="flow-history-detail" title={pastRun.ok ? undefined : (pastRun.error ?? undefined)}>{pastRun.ok ? m['flow.history_ok']({ count: pastRun.steps.filter((step) => step.status === 'done').length }) : (pastRun.error ?? m['flow.history_failed']())}</span>
          </div>
        {/each}
      </section>
    {/if}
  </div>

</NodeShell>

<style>
  .flow-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    color: var(--app-text-soft);
    font-size: 12px;
    overflow-y: auto;
  }

  .flow-section-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .flow-count {
    min-width: 18px;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* ---- Passos ------------------------------------------------------------ */
  .flow-steps {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .flow-step {
    position: relative;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr);
    gap: 10px;
    padding-bottom: 8px;
    transition: opacity var(--duration-quick) ease-out;
  }

  .flow-step:last-child {
    padding-bottom: 0;
  }

  .flow-step.dragging {
    opacity: 0.45;
  }

  /* Trilho: o numero do passo e a linha que o liga ao proximo. */
  .flow-step-rail {
    position: relative;
    display: flex;
    justify-content: center;
    padding-top: 8px;
  }

  .flow-step:not(:last-child) .flow-step-rail::after {
    content: '';
    position: absolute;
    top: 34px;
    bottom: -2px;
    left: 50%;
    width: 1px;
    background: var(--app-border-strong);
    transform: translateX(-50%);
  }

  .flow-step-num {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .flow-step.running .flow-step-num {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  .flow-step.waiting .flow-step-num {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }

  .flow-step.done .flow-step-num {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  .flow-step.failed .flow-step-num {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .flow-step-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 6px 8px 8px 4px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .flow-step-card:hover {
    box-shadow: var(--app-shadow-border-hover);
  }

  .flow-step.running .flow-step-card {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-info) 55%, transparent);
  }

  .flow-step.waiting .flow-step-card {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--app-warning) 60%, transparent);
  }

  .flow-step-head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 28px;
  }

  .flow-step-grip {
    display: grid;
    place-items: center;
    width: 20px;
    height: 28px;
    flex-shrink: 0;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: grab;
    opacity: 0.55;
    transition: opacity var(--duration-quick) ease-out, color var(--duration-quick) ease-out, background-color var(--duration-quick) ease-out;
  }

  .flow-step-card:hover .flow-step-grip,
  .flow-step-grip:focus-visible {
    opacity: 1;
  }

  .flow-step-grip:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .flow-step-grip:active {
    cursor: grabbing;
  }

  .flow-step-grip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .flow-step-kind.approval {
    display: inline-flex;
    flex: 1;
    align-items: center;
    gap: 6px;
    color: var(--app-warning);
    font-size: 12.5px;
    font-weight: 500;
  }

  .flow-step :global(.flow-step-bot) {
    flex-shrink: 0;
    color: var(--app-secondary);
  }

  .flow-step :global(.flow-step-target) {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 8px 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    box-shadow: none;
    color: var(--app-text);
    font-size: 12.5px;
    font-weight: 500;
  }

  .flow-step :global(.flow-step-target:hover) {
    background: var(--app-hover);
  }

  .flow-step-target-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Acoes do passo: aparecem ao apontar/focar, sem ocupar a linha. */
  .flow-step-actions {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .flow-step-card:hover .flow-step-actions,
  .flow-step-card:focus-within .flow-step-actions {
    opacity: 1;
  }

  .flow-body :global(.flow-mini-btn) {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out, transform var(--duration-quick) var(--ease-smooth-out);
  }

  .flow-body :global(.flow-mini-btn:hover:not(:disabled)) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .flow-body :global(.flow-mini-btn:active:not(:disabled)) {
    transform: scale(var(--scale-press));
  }

  .flow-body :global(.flow-mini-btn.danger:hover:not(:disabled)) {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .flow-body :global(.flow-mini-btn:disabled) {
    opacity: 0.35;
    cursor: default;
  }

  .flow-body :global(.flow-mini-btn:focus-visible) {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .flow-step-prompt {
    width: 100%;
    margin-left: 4px;
    width: calc(100% - 4px);
    resize: vertical;
    border: 1px solid var(--app-border);
    border-radius: 7px;
    background: var(--app-surface);
    color: var(--app-text);
    font-family: inherit;
    font-size: 12px;
    line-height: 1.5;
    padding: 6px 9px;
    outline: none;
    transition: border-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .flow-step-prompt::placeholder {
    color: var(--app-text-muted);
  }

  .flow-step-prompt:focus {
    border-color: var(--app-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .flow-step-excerpt {
    display: -webkit-box;
    margin-left: 4px;
    overflow: hidden;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.45;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  /* ---- Adicionar / repetir ---------------------------------------------- */
  .flow-add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-left: 34px;
  }

  .flow-spacer {
    flex: 1;
  }

  .flow-iter {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px;
    border-radius: 8px;
    background: var(--app-hover);
  }

  .flow-iter-label {
    padding: 0 6px 0 8px;
    color: var(--app-text-muted);
    font-size: 11.5px;
  }

  .flow-iter-label::first-letter {
    text-transform: uppercase;
  }

  .flow-iter-value {
    min-width: 26px;
    color: var(--app-text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .flow-empty {
    display: grid;
    flex: 1;
    min-height: 200px;
    place-items: center;
  }

  /* ---- Avisos ------------------------------------------------------------ */
  .flow-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
    animation: flow-banner-in var(--duration-fast) var(--ease-smooth-out) both;
  }

  @keyframes flow-banner-in {
    from {
      opacity: 0;
      transform: translateY(calc(var(--distance-micro) * -1));
    }
  }

  .flow-banner.error {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .flow-banner :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
  }

  /* ---- Historico ---------------------------------------------------------- */
  .flow-history {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 6px;
    padding-top: 12px;
    border-top: 1px solid var(--app-border);
  }

  .flow-history .section-label {
    margin-bottom: 4px;
  }

  .flow-history-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--app-success);
    font-size: 12px;
  }

  .flow-history-row:hover {
    background: var(--app-hover);
  }

  .flow-history-row.failed {
    color: var(--app-danger);
  }

  .flow-history-row :global(svg) {
    flex-shrink: 0;
  }

  .flow-history-time {
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .flow-history-detail {
    min-width: 0;
    overflow: hidden;
    color: var(--app-text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Barra de execucao ------------------------------------------------ */
  .flow-run {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    min-height: 44px;
    padding: 6px 6px 6px 12px;
    border-radius: 10px;
    background: var(--app-surface-raised);
    box-shadow: var(--app-shadow-border);
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out;
  }

  .flow-run:focus-within {
    box-shadow: 0 0 0 1px var(--app-accent), 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .flow-run.active {
    background: color-mix(in srgb, var(--app-info) 6%, var(--app-surface));
  }

  .flow-input {
    flex: 1;
    min-width: 0;
    height: 32px;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-text);
    font-size: 12.5px;
  }

  .flow-input::placeholder {
    color: var(--app-text-muted);
  }

  .flow-run-btn,
  .flow-approve-btn,
  .flow-stop-btn {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 500;
    white-space: nowrap;
    cursor: pointer;
  }

  .flow-run-btn {
    background: var(--app-accent);
    color: var(--app-accent-contrast);
  }

  .flow-run-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--app-accent) 88%, var(--app-text));
  }

  .flow-run-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .flow-approve-btn {
    background: var(--app-success);
    color: var(--app-accent-contrast);
  }

  .flow-approve-btn:hover {
    background: color-mix(in srgb, var(--app-success) 88%, var(--app-text));
  }

  .flow-stop-btn {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  .flow-stop-btn:hover {
    background: color-mix(in srgb, var(--app-danger) 24%, transparent);
  }

  .flow-run-btn:focus-visible,
  .flow-approve-btn:focus-visible,
  .flow-stop-btn:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .flow-run-status {
    display: inline-flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
    color: var(--app-info);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .flow-run-status :global(svg) {
    flex-shrink: 0;
  }

  .flow-run-status span::first-letter {
    text-transform: uppercase;
  }
</style>
