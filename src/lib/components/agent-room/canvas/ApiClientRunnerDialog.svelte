<script lang="ts">
  import { ArrowDown, ArrowUp, Copy, ListChecks, Play, Plus, Save, Trash2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Input } from '$lib/components/ui/input';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import { Switch } from '$lib/components/ui/switch';
  import type { ApiClientRequest, ApiClientRunner } from '$lib/modules/agent-room/domain/types.js';
  import * as m from '$lib/paraglide/messages.js';
  import ApiCodeEditor from './ApiCodeEditor.svelte';

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

    <div class="grid min-h-0 grid-cols-[220px_minmax(0,1fr)] max-[700px]:grid-cols-1 max-[700px]:grid-rows-[170px_minmax(0,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-border bg-muted/25 p-2 max-[700px]:border-b max-[700px]:border-r-0">
        <Button size="sm" variant="outline" class="mb-2 w-full justify-start" onclick={newRunner}><Plus />{m['api_client.add_runner']()}</Button>
        {#each drafts as runner (runner.id)}
          <button
            type="button"
            class="mb-1 flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
            class:border-primary={runner.id === currentId}
            class:bg-primary={runner.id === currentId}
            class:text-primary-foreground={runner.id === currentId}
            class:border-transparent={runner.id !== currentId}
            class:hover:bg-muted={runner.id !== currentId}
            aria-pressed={runner.id === currentId}
            onclick={() => selectRunner(runner)}
          >
            <ListChecks class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate text-xs font-medium">{runner.name}</span>
            <span class="text-ui-xs tabular-nums opacity-70">{runner.requestIds.length}</span>
          </button>
        {:else}
          <p class="px-3 py-8 text-center text-xs leading-5 text-muted-foreground">{m['api_client.no_runners']()}</p>
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
            <div class="max-h-72 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
              {#each runnerRequests as request (request.id)}
                {@const checked = current.requestIds.includes(request.id)}
                <div class="flex min-w-0 items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/60">
                  <Checkbox {checked} onCheckedChange={(value: boolean) => toggleRequest(request.id, value)} aria-label={request.name} />
                  <span class="w-10 shrink-0 text-ui-xs font-bold text-[var(--app-secondary)]">{request.method}</span>
                  <span class="min-w-0 flex-1 truncate text-xs">{request.name}</span>
                  {#if checked}
                    <Button size="icon-sm" variant="ghost" disabled={current.requestIds[0] === request.id} aria-label={m['api_client.move_up']()} onclick={() => moveRequest(request.id, -1)}><ArrowUp /></Button>
                    <Button size="icon-sm" variant="ghost" disabled={current.requestIds.at(-1) === request.id} aria-label={m['api_client.move_down']()} onclick={() => moveRequest(request.id, 1)}><ArrowDown /></Button>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </section>
      {:else}
        <div class="grid place-items-center p-8 text-center text-sm text-muted-foreground">{m['api_client.no_runners']()}</div>
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
