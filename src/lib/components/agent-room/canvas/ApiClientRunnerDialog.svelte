<script lang="ts">
  import { ArrowDown, ArrowUp, Copy, GripVertical, ListChecks, Play, Plus, Save, Trash2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import type { ApiClientRequest, ApiClientRunner } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import ApiCodeEditor from './ApiCodeEditor.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';

  let {
    open,
    runners,
    selectedRunnerId,
    requests,
    environmentNames,
    running,
    onSave,
    onRun,
    onClose,
  }: {
    open: boolean;
    runners: ApiClientRunner[];
    selectedRunnerId: string | null;
    requests: ApiClientRequest[];
    environmentNames: string[];
    running: boolean;
    onSave: (runners: ApiClientRunner[], selectedRunnerId: string | null) => void;
    onRun: (runner: ApiClientRunner) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  let drafts = $state<ApiClientRunner[]>([]);
  let currentId = $state<string | null>(null);
  let iterationDataDraft = $state('[]');
  let iterationDataError = $state('');
  let wasOpen = false;
  const current = $derived(drafts.find((runner) => runner.id === currentId) ?? null);
  const orderedRequests = $derived([...requests].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)));
  const runnerRequests = $derived.by(() => {
    if (!current) return [];
    const byId = new Map(orderedRequests.map((request) => [request.id, request]));
    const selected = current.requestIds.map((requestId) => byId.get(requestId)).filter((request): request is ApiClientRequest => Boolean(request));
    return [...selected, ...orderedRequests.filter((request) => !current.requestIds.includes(request.id))];
  });

  $effect(() => {
    if (open && !wasOpen) {
      drafts = $state.snapshot(runners);
      currentId = selectedRunnerId ?? drafts[0]?.id ?? null;
      loadIterationData(drafts.find((runner) => runner.id === currentId) ?? null);
    }
    wasOpen = open;
  });

  function newRunner() {
    const runner: ApiClientRunner = {
      id: crypto.randomUUID(),
      name: m['api_client.new_runner'](),
      requestIds: orderedRequests.map((request) => request.id),
      environment: null,
      iterations: 1,
      iterationData: [],
      delayMs: 0,
      stopOnFailure: false,
      sequence: drafts.length,
    };
    drafts = [...drafts, runner];
    currentId = runner.id;
    loadIterationData(runner);
  }

  function updateCurrent(changes: Partial<ApiClientRunner>) {
    if (!current) return;
    drafts = drafts.map((runner) => runner.id === current.id ? { ...runner, ...changes } : runner);
  }

  function duplicateCurrent() {
    if (!current) return;
    const runner: ApiClientRunner = {
      ...$state.snapshot(current),
      id: crypto.randomUUID(),
      name: m['api_client.copy_name']({ name: current.name }),
      sequence: drafts.length,
    };
    drafts = [...drafts, runner];
    currentId = runner.id;
    loadIterationData(runner);
  }

  function deleteCurrent() {
    if (!current) return;
    drafts = drafts.filter((runner) => runner.id !== current.id).map((runner, sequence) => ({ ...runner, sequence }));
    currentId = drafts[0]?.id ?? null;
    loadIterationData(drafts[0] ?? null);
  }

  function loadIterationData(runner: ApiClientRunner | null) {
    iterationDataDraft = JSON.stringify(runner?.iterationData ?? [], null, 2);
    iterationDataError = '';
  }

  function selectRunner(runner: ApiClientRunner) {
    currentId = runner.id;
    loadIterationData(runner);
  }

  function updateIterationData(value: string) {
    iterationDataDraft = value;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
        throw new Error(m['api_client.runner_data_array_error']());
      }
      if (parsed.length > 1_000) throw new Error(m['api_client.runner_data_limit_error']());
      iterationDataError = '';
      const previousRows = current?.iterationData.length ?? 0;
      updateCurrent({
        iterationData: parsed as Array<Record<string, unknown>>,
        ...(parsed.length > 0 && (current?.iterations === 1 || current?.iterations === previousRows) ? { iterations: parsed.length } : {}),
      });
    } catch (error) {
      iterationDataError = error instanceof Error ? error.message : m['api_client.runner_data_invalid']();
    }
  }

  function toggleRequest(requestId: string, checked: boolean) {
    if (!current) return;
    updateCurrent({ requestIds: checked ? [...current.requestIds, requestId] : current.requestIds.filter((id) => id !== requestId) });
  }

  function moveRequest(requestId: string, direction: -1 | 1) {
    if (!current) return;
    const next = [...current.requestIds];
    const index = next.indexOf(requestId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    updateCurrent({ requestIds: next });
  }

  // Arrastar reordena os requests marcados trocando com o vizinho a cada
  // linha cruzada — a mesma acao das setas (moveRequest).
  let draggedRequestId = $state<string | null>(null);

  function onRequestDragOver(event: DragEvent, requestId: string) {
    if (!draggedRequestId || !current || !current.requestIds.includes(requestId)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (requestId === draggedRequestId) return;
    const from = current.requestIds.indexOf(draggedRequestId);
    const to = current.requestIds.indexOf(requestId);
    if (from < 0 || to < 0) return;
    moveRequest(draggedRequestId, to < from ? -1 : 1);
  }

  function onGripKeydown(event: KeyboardEvent, requestId: string) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    moveRequest(requestId, event.key === 'ArrowUp' ? -1 : 1);
  }

  function saveAndClose() {
    onSave($state.snapshot(drafts), currentId);
    onClose();
  }

  async function runCurrent() {
    if (!current || !current.requestIds.length || running) return;
    onSave($state.snapshot(drafts), currentId);
    await onRun($state.snapshot(current));
  }
</script>

<Dialog.Root {open} onOpenChange={(value) => !value && onClose()}>
  <Dialog.Content class="grid h-[min(720px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-4xl" data-testid="api-client-runner-dialog">
    <Dialog.Header class="border-b border-border px-5 py-4 pr-12">
      <Dialog.Title>{m['api_client.runners']()}</Dialog.Title>
      <Dialog.Description>{m['api_client.runners_description']()}</Dialog.Description>
    </Dialog.Header>

    <div class="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:grid-rows-[170px_minmax(0,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-border bg-[var(--app-surface-subtle)] p-2 max-[700px]:border-b max-[700px]:border-r-0">
        <Button size="sm" variant="outline" class="mb-2 w-full justify-start" onclick={newRunner}><Plus />{m['api_client.add_runner']()}</Button>
        {#each drafts as runner (runner.id)}
          <button
            type="button"
            class="runner-item"
            aria-pressed={runner.id === currentId}
            onclick={() => selectRunner(runner)}
          >
            <ListChecks size={14} class="shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate">{runner.name}</span>
            <span class="runner-count">{runner.requestIds.length}</span>
          </button>
        {/each}
      </aside>

      {#if current}
        <section class="min-h-0 overflow-y-auto p-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="space-y-1.5 sm:col-span-2">
              <span class="text-xs font-medium">{m['api_client.runner_name']()}</span>
              <Input value={current.name} maxlength="80" oninput={(event: Event) => updateCurrent({ name: (event.currentTarget as HTMLInputElement).value })} />
            </label>
            <label class="space-y-1.5">
              <span class="text-xs font-medium">{m['api_client.runner_environment']()}</span>
              <NativeSelect.Root value={current.environment ?? ''} onchange={(event: Event) => updateCurrent({ environment: (event.currentTarget as HTMLSelectElement).value || null })}>
                <option value="">{m['api_client.collection_variables']()}</option>
                {#each environmentNames as name}<option value={name}>{name}</option>{/each}
              </NativeSelect.Root>
            </label>
            <label class="space-y-1.5">
              <span class="text-xs font-medium">{m['api_client.runner_iterations']()}</span>
              <Input type="number" min="1" max="1000" value={current.iterations} oninput={(event: Event) => updateCurrent({ iterations: Math.max(1, Math.min(1000, Number((event.currentTarget as HTMLInputElement).value) || 1)) })} />
            </label>
            <label class="space-y-1.5">
              <span class="text-xs font-medium">{m['api_client.runner_delay']()}</span>
              <Input type="number" min="0" max="60000" step="100" value={current.delayMs} oninput={(event: Event) => updateCurrent({ delayMs: Math.max(0, Math.min(60000, Number((event.currentTarget as HTMLInputElement).value) || 0)) })} />
            </label>
            <label class="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <span class="text-xs font-medium">{m['api_client.runner_stop_on_failure']()}</span>
              <Switch checked={current.stopOnFailure} onCheckedChange={(checked: boolean) => updateCurrent({ stopOnFailure: checked })} />
            </label>
          </div>

          <div class="mt-5 border-t border-border pt-4">
            <ApiCodeEditor
              value={iterationDataDraft}
              language="json"
              label={m['api_client.runner_iteration_data']()}
              minHeight={140}
              onchange={updateIterationData}
            />
            <p class="mt-1.5 text-ui-sm leading-4 text-muted-foreground">{m['api_client.runner_iteration_data_hint']()}</p>
            {#if iterationDataError}<p class="mt-1 text-ui-sm text-destructive" role="alert">{iterationDataError}</p>{/if}
          </div>

          <div class="mt-5 border-t border-border pt-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <h3 class="text-xs font-semibold">{m['api_client.runner_requests']()}</h3>
              <span class="text-ui-sm text-muted-foreground">{m['api_client.runner_selected']({ selected: current.requestIds.length, total: requests.length })}</span>
            </div>
            <div class="runner-requests max-h-72 overflow-y-auto p-1" role="list">
              {#each runnerRequests as request (request.id)}
                {@const checked = current.requestIds.includes(request.id)}
                {@const order = current.requestIds.indexOf(request.id)}
                <div
                  class="runner-request"
                  class:unchecked={!checked}
                  class:dragging={draggedRequestId === request.id}
                  role="listitem"
                  ondragover={(event) => onRequestDragOver(event, request.id)}
                  ondrop={(event) => { event.preventDefault(); draggedRequestId = null; }}
                >
                  {#if checked}
                    <button
                      type="button"
                      class="runner-grip"
                      draggable="true"
                      aria-label={m['api_client.reorder_request']()}
                      title={m['api_client.reorder_request']()}
                      aria-keyshortcuts="ArrowUp ArrowDown"
                      ondragstart={(event) => { draggedRequestId = request.id; if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', request.id); const row = (event.currentTarget as HTMLElement).closest('.runner-request'); if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 16, 16); } }}
                      ondragend={() => (draggedRequestId = null)}
                      onkeydown={(event) => onGripKeydown(event, request.id)}
                    ><GripVertical size={13} /></button>
                  {:else}
                    <span class="runner-grip-space" aria-hidden="true"></span>
                  {/if}
                  <Checkbox {checked} onCheckedChange={(value: boolean) => toggleRequest(request.id, value)} aria-label={request.name} />
                  <span class="runner-order" aria-hidden="true">{checked ? order + 1 : ''}</span>
                  <span class="runner-method">{request.method}</span>
                  <span class="min-w-0 flex-1 truncate text-[12.5px]" title={request.name}>{request.name}</span>
                  {#if checked}
                    <span class="runner-arrows">
                      <Button size="icon-sm" variant="ghost" class="size-7" disabled={current.requestIds[0] === request.id} aria-label={m['api_client.move_up']()} onclick={() => moveRequest(request.id, -1)}><ArrowUp /></Button>
                      <Button size="icon-sm" variant="ghost" class="size-7" disabled={current.requestIds.at(-1) === request.id} aria-label={m['api_client.move_down']()} onclick={() => moveRequest(request.id, 1)}><ArrowDown /></Button>
                    </span>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </section>
      {:else}
        <div class="grid place-items-center p-8">
          <NodeEmptyState icon={ListChecks} title={m['api_client.no_runners']()} description={m['api_client.runners_description']()} />
        </div>
      {/if}
    </div>

    <Dialog.Footer
      class="m-0! shrink-0 items-stretch justify-between gap-2 rounded-none rounded-b-lg border-t border-border bg-popover px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      data-testid="api-client-runner-footer"
    >
      <div class="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" disabled={!current} onclick={duplicateCurrent}><Copy />{m['api_client.duplicate_runner']()}</Button>
        <Button variant="ghost" size="sm" disabled={!current} onclick={deleteCurrent}><Trash2 />{m['api_client.delete_runner']()}</Button>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={Boolean(iterationDataError)} onclick={saveAndClose}><Save />{m['api_client.save_runners']()}</Button>
        <Button size="sm" disabled={!current || !current.requestIds.length || running || Boolean(iterationDataError)} onclick={() => void runCurrent()}><Play />{m['api_client.run_runner']()}</Button>
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<style>
  .runner-item {
    display: flex;
    width: 100%;
    min-height: 34px;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
    padding: 0 10px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--app-text-soft);
    font-size: 12.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .runner-item:hover {
    background: var(--app-hover);
    color: var(--app-text);
  }

  /* Selecionado: fundo ativo + barra de acento, sem pintar o item inteiro. */
  .runner-item[aria-pressed='true'] {
    background: var(--app-active);
    box-shadow: inset 2px 0 0 var(--app-accent);
    color: var(--app-text);
  }

  .runner-item:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .runner-count {
    min-width: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 18px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .runner-requests {
    border-radius: 8px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .runner-request {
    display: flex;
    min-width: 0;
    min-height: 34px;
    align-items: center;
    gap: 8px;
    padding: 0 4px 0 2px;
    border-radius: 6px;
    transition: background-color var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out;
  }

  .runner-request:hover {
    background: var(--app-hover);
  }

  .runner-request.unchecked {
    color: var(--app-text-muted);
  }

  .runner-request.dragging {
    opacity: 0.45;
  }

  .runner-grip,
  .runner-grip-space {
    width: 18px;
    height: 28px;
    flex-shrink: 0;
  }

  .runner-grip {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: grab;
    opacity: 0.5;
    transition: opacity var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .runner-request:hover .runner-grip,
  .runner-grip:focus-visible {
    opacity: 1;
  }

  .runner-grip:active {
    cursor: grabbing;
  }

  .runner-grip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -1px;
  }

  .runner-order {
    width: 16px;
    flex-shrink: 0;
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .runner-method {
    width: 48px;
    flex-shrink: 0;
    color: var(--app-secondary);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
  }

  .runner-request.unchecked .runner-method {
    opacity: 0.6;
  }

  /* Setas continuam para teclado, mas so aparecem ao apontar/focar. */
  .runner-arrows {
    display: inline-flex;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .runner-request:hover .runner-arrows,
  .runner-request:focus-within .runner-arrows {
    opacity: 1;
  }
</style>
