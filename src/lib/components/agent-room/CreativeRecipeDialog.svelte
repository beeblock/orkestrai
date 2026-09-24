<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Workflow, Plus, Save, ExternalLink, RefreshCw, Trash2, Square, RotateCcw, Film, Image, Search, ChevronRight, CircleAlert, LoaderCircle } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import NodeEmptyState from './canvas/NodeEmptyState.svelte';
  import { creativeApi, creativeError, creativeStatus } from './creative-media-client.js';
  import { creativeRecipeCaptureSchema, creativeRecipeBindingsSchema, type CreativeRecipeBindings } from '$lib/modules/creative-media/contracts/schemas/creative-recipe.schema.js';
  import type { CreativeRecipeLibraryItem, CreativeQueueItem } from '$lib/modules/creative-media/domain/creative-recipe.js';
  import type { CreativeStoryboard } from '$lib/modules/creative-media/domain/storyboard.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import type { CreativeRunStatus } from '$lib/modules/creative-media/domain/catalog.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, floorId = null, sourceNodeId = '', initialTab = 'library', onOpenNode }: { open?: boolean; workspaceId: string; floorId?: string | null; sourceNodeId?: string; initialTab?: string; onOpenNode?: (id: string) => void | Promise<void> } = $props();
  let tab = $state('library'), query = $state(''), selectedId = $state(''), captureNodeId = $state(''), previousId = $state('');
  let name = $state(''), description = $state(''), error = $state(''), loading = $state(false), busy = $state(false), ready = $state(false), removeId = $state<string | null>(null);
  let recipes = $state<CreativeRecipeLibraryItem[]>([]), boards = $state<CreativeStoryboard[]>([]), queue = $state<CreativeQueueItem[]>([]), characters = $state<CreativeCharacter[]>([]);
  let inputs = $state<Array<{ id: string; type: string; title: string }>>([]), executors = $state<Array<{ id: string; title: string }>>([]);
  let bindings = $state<CreativeRecipeBindings>(creativeRecipeBindingsSchema.parse({}));
  let sequence = 0, queueBusy = false;
  let libraryTab = $state<HTMLButtonElement>(null!);
  const recipe = $derived(recipes.find(item => item.id === selectedId));
  const board = $derived(boards.find(item => item.nodeId === captureNodeId));
  const filtered = $derived(recipes.filter(item => `${item.name} ${item.description} ${item.workspaceName}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const endpoint = $derived(`/api/agent-room/workspaces/${workspaceId}/creative-media/recipes`);
  const dialogContext = $derived(open ? workspaceId : '');
  const adapter = zod(creativeRecipeCaptureSchema as unknown as Parameters<typeof zod>[0]);
  const instanceId = $props.id();
  const form = superForm<{ name: string; description: string; sourceNodeId: string; revision: number; previousId?: string }>(defaults({ name: '', description: '', sourceNodeId: '', revision: 1 }, adapter) as never, { id: `creative-recipe-${instanceId}`, SPA: true, dataType: 'json', validators: adapter as never });
  const { errors } = form;
  function select(id: string) {
    selectedId = id; error = ''; bindings = creativeRecipeBindingsSchema.parse({});
    const saved = recipes.find(item => item.id === id);
    bindings.values = (saved?.definition.inputs ?? []).flatMap(slot => {
      if (!slot.identity) return [];
      const character = characters.find(item => item.familyId === slot.identity?.familyId && item.version === slot.identity.version && item.snapshot?.digest === slot.identity.digest);
      return character ? [{ key: slot.key, id: character.id }] : [];
    });
  }
  async function load() {
    const current = ++sequence, workspace = workspaceId;
    loading = true; ready = false; error = '';
    try {
      const base = `/api/agent-room/workspaces/${workspace}/creative-media`;
      const library = await creativeApi<CreativeRecipeLibraryItem[]>(`${base}/recipes?command=library`);
      const storyboards = await creativeApi<CreativeStoryboard[]>(`${base}/storyboards`);
      const nodes = await creativeApi<Array<{ id: string; title: string; type: string; payload: { provider?: string } }>>(`/api/agent-room/workspaces/${workspace}/nodes`);
      const profiles = await creativeApi<CreativeCharacter[]>(`${base}/characters`);
      const jobs = await creativeApi<CreativeQueueItem[]>(`${base}/recipes?command=queue`);
      if (!open || current !== sequence || workspace !== workspaceId) return;
      recipes = library; boards = storyboards; queue = jobs; characters = profiles.filter(item => item.state === 'locked');
      inputs = nodes.filter(node => ['image', 'video'].includes(node.type));
      executors = nodes.filter(node => node.type === 'terminal' && node.payload.provider === 'codex');
      captureNodeId = boards.some(item => item.nodeId === sourceNodeId) ? sourceNodeId : boards[0]?.nodeId ?? '';
      name = boards.find(item => item.nodeId === captureNodeId)?.document.title ?? ''; description = ''; previousId = '';
      select(recipes.some(item => item.id === selectedId) ? selectedId : recipes[0]?.id ?? ''); ready = true;
    } catch (cause) { if (current === sequence) error = (cause as Error).message; }
    finally { if (current === sequence) loading = false; }
  }
  async function refreshQueue() {
    if (queueBusy || busy || !ready) return;
    const current = sequence, url = endpoint;
    queueBusy = true;
    try { const result = await creativeApi<CreativeQueueItem[]>(`${url}?command=queue`); if (open && current === sequence) queue = result; }
    catch (cause) { if (open && current === sequence) error = (cause as Error).message; }
    finally { queueBusy = false; }
  }
  $effect(() => {
    const workspace = dialogContext;
    if (!workspace) { untrack(() => { sequence++; ready = false; }); return; }
    untrack(() => { tab = sourceNodeId ? 'capture' : initialTab; void load(); });
    const timer = setInterval(() => { if (!document.hidden && tab === 'queue') void refreshQueue(); }, 3000);
    return () => { clearInterval(timer); sequence++; };
  });
  async function command(kind: 'capture' | 'instantiate' | 'remove') {
    if (busy || !ready) return;
    const current = sequence, url = endpoint;
    busy = true; error = '';
    try {
      let payload: unknown;
      if (kind === 'capture') {
        if (!board) throw new Error('creative_recipe_board_required');
        const capture = { name, description, sourceNodeId: board.nodeId, revision: board.revision, ...(previousId ? { previousId } : {}) };
        form.form.set(capture);
        if (!(await form.validateForm({ update: true })).valid) { error = 'creative_invalid_input'; return; }
        payload = { command: kind, capture };
      } else if (kind === 'instantiate') {
        if (!recipe) return;
        payload = { command: kind, id: recipe.id, sourceWorkspaceId: recipe.workspaceId, floorId, bindings: creativeRecipeBindingsSchema.parse($state.snapshot(bindings)) };
      } else payload = { command: kind, id: selectedId };
      const result = await creativeApi<{ id?: string; nodeId?: string }>(url, 'POST', payload);
      if (!open || current !== sequence) return;
      if (result.nodeId) { open = false; await onOpenNode?.(result.nodeId); }
      else { if (result.id) selectedId = result.id; await load(); tab = 'library'; await tick(); libraryTab?.focus(); }
    } catch (cause) { if (current === sequence) error = (cause as Error).message; }
    finally { busy = false; }
  }
  async function queueAction(item: CreativeQueueItem, action: 'cancel' | 'retry_download') {
    if (busy) return;
    busy = true; error = '';
    try {
      if (item.kind === 'image') await creativeApi(`/api/agent-room/workspaces/${workspaceId}/image-workflows/${item.nodeId}`, 'DELETE');
      else await creativeApi(`/api/agent-room/workspaces/${workspaceId}/creative-media/runs`, 'POST', { command: action, runId: item.runId });
    } catch (cause) { error = (cause as Error).message; }
    finally { busy = false; await refreshQueue(); }
  }
  function stateLabel(item: CreativeQueueItem) {
    if (item.status === 'idle') return m['creative_recipe.draft']();
    if (item.status === 'running') return m['creative_recipe.running']();
    if (item.status === 'succeeded') return m['creative.completed']();
    return creativeStatus(item.status as CreativeRunStatus);
  }
  async function openNode(id: string) { open = false; await onOpenNode?.(id); }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid="creative-recipes" class="flex h-[min(800px,calc(100dvh-32px))] flex-col gap-4 overflow-hidden sm:max-w-[1000px]">
    <Dialog.Header class="shrink-0 pr-8">
      <Dialog.Title class="flex items-center gap-2"><Workflow size={16} class="shrink-0 text-[var(--app-text-muted)]" aria-hidden="true" />{m['creative_recipe.title']()}</Dialog.Title>
      <Dialog.Description>{m['creative_recipe.subtitle']()}</Dialog.Description>
    </Dialog.Header>
    <Tabs.Root bind:value={tab} activationMode="manual" class="flex min-h-0 flex-1 flex-col gap-3">
      <Tabs.List class="h-8 shrink-0 rounded-lg bg-[var(--app-hover)] p-0.5"><Tabs.Trigger bind:ref={libraryTab} value="library" class="h-7 rounded-md px-3 text-[12.5px] aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.library']()}</Tabs.Trigger><Tabs.Trigger value="capture" class="h-7 rounded-md px-3 text-[12.5px] aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.capture']()}</Tabs.Trigger><Tabs.Trigger value="queue" class="h-7 rounded-md px-3 text-[12.5px] aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.queue']()}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="library" class="grid min-h-0 flex-1 grid-cols-[minmax(180px,30%)_minmax(0,1fr)] gap-5 overflow-hidden">
        <div class="flex min-h-0 flex-col gap-2 border-r border-[var(--app-border)] pr-4">
          <div class="relative shrink-0"><Search size={14} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" aria-hidden="true" /><Input bind:value={query} class="h-8 pl-8 text-[13px]" aria-label={m['creative_recipe.search']()} placeholder={m['creative_recipe.search']()} /></div>
          <nav aria-label={m['creative_recipe.library']()} class="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto overscroll-contain">
            {#each filtered as item}<button type="button" aria-current={item.id === selectedId ? 'true' : undefined} disabled={busy} class="recipe-row" onclick={() => select(item.id)}><strong class="block text-ui-lg font-medium break-words">{item.name}</strong><span class="mt-0.5 block font-mono text-[11px] text-[var(--app-text-muted)] tabular-nums">v{item.version} · {item.definition.scenes.length} {m['storyboard.scenes']()}</span><span class="block truncate text-ui-sm text-[var(--app-text-muted)]" title={item.workspaceName}>{item.workspaceName}</span></button>{/each}
            <!-- Sem nenhum fluxo, o estado vazio do painel direito explica; aqui so a busca sem resultado. -->
            {#if !filtered.length && recipes.length}<p class="px-2 py-3 text-ui-md text-pretty text-[var(--app-text-muted)]">{m['creative_recipe.empty']()}</p>{/if}
          </nav>
        </div>
        <div class="min-h-0 overflow-y-auto overscroll-contain pr-1">
          {#if recipe}<fieldset disabled={busy || !ready} class="grid gap-5"><header><h3 class="font-display text-[15px] font-semibold break-words text-balance">{recipe.name} · v{recipe.version}</h3>{#if recipe.description}<p class="mt-1 text-ui-lg leading-relaxed whitespace-pre-wrap break-words text-[var(--app-text-soft)]">{recipe.description}</p>{/if}</header>
            <label class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative_recipe.script']()}</span><Textarea bind:value={bindings.script} maxlength={12000} class="min-h-28 resize-y" /></label>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['creative.ratio']()}</span><ModelCombobox value={bindings.aspectRatio} options={['16:9','9:16','1:1','4:3','3:4'].map(value => ({ value, label: value }))} defaultLabel="16:9" searchPlaceholder={m['creative.ratio']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.ratio']()} onValueChange={(value) => { if (value) bindings.aspectRatio = value as CreativeRecipeBindings['aspectRatio']; }} /></div>
              <div class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['storyboard.executor']()}</span><ModelCombobox value={bindings.executorNodeId ?? ''} options={executors.map(item => ({ value: item.id, label: item.title }))} defaultLabel={m['storyboard.unassigned']()} searchPlaceholder={m['storyboard.executor']()} emptyLabel={m['storyboard.unassigned']()} ariaLabel={m['storyboard.executor']()} onValueChange={(value) => bindings.executorNodeId = value || null} /></div>
              {#each recipe.definition.inputs as slot}<div class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{slot.label}{#if slot.identity}<span class="ml-2 font-mono text-[11px] text-[var(--app-text-muted)]">v{slot.identity.version}</span>{/if}</span><ModelCombobox value={bindings.values.find(item => item.key === slot.key)?.id ?? ''} options={slot.kind === 'character' ? characters.map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version}` })) : inputs.filter(item => item.type === slot.kind).map(item => ({ value: item.id, label: item.title }))} defaultLabel={m['creative_recipe.choose_input']()} searchPlaceholder={slot.label} emptyLabel={m['creative.no_inputs']()} ariaLabel={slot.label} onValueChange={(id) => bindings.values = [...bindings.values.filter(item => item.key !== slot.key), ...(id ? [{ key: slot.key, id }] : [])]} /></div>{/each}
            </div>
            <details class="group rounded-lg shadow-[var(--app-shadow-border)]"><summary class="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-ui-lg font-medium [&::-webkit-details-marker]:hidden"><ChevronRight size={14} class="shrink-0 text-[var(--app-text-muted)] transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />{m['creative_recipe.preview']()}</summary><ol class="grid gap-3 px-3 pb-3">{#each recipe.definition.scenes as scene, index}<li><h4 class="text-ui-lg font-medium"><span class="font-mono text-[11px] text-[var(--app-text-muted)] tabular-nums">{index + 1}.</span> {scene.title} <span class="font-mono text-[11px] font-normal text-[var(--app-text-muted)] tabular-nums">· {scene.duration}s</span></h4><p class="mt-0.5 text-ui-md leading-relaxed whitespace-pre-wrap break-words text-[var(--app-text-soft)]">{scene.direction}</p>{#if scene.dialogue}<p class="mt-1 text-ui-md whitespace-pre-wrap">{scene.dialogue}</p>{/if}</li>{/each}<code class="block font-mono text-[11px] break-all text-[var(--app-text-muted)]">{recipe.digest}</code></ol></details>
          </fieldset>{:else if ready}<NodeEmptyState icon={Workflow} title={m['creative_recipe.empty']()} description={m['creative_recipe.empty_hint']()}>{#snippet actions()}<Button size="sm" variant="outline" onclick={() => (tab = 'capture')}><Save size={14} aria-hidden="true" />{m['creative_recipe.capture']()}</Button>{/snippet}</NodeEmptyState>{/if}
        </div>
      </Tabs.Content>
      <Tabs.Content value="capture" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={busy || !ready} class="mx-auto grid max-w-2xl gap-4 py-1">
          <div class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative_recipe.source']()}</span><ModelCombobox value={captureNodeId} options={boards.map(item => ({ value: item.nodeId, label: `${item.document.title} · ${item.document.scenes.length} ${m['storyboard.scenes']()}` }))} defaultLabel={m['creative_recipe.choose_source']()} searchPlaceholder={m['creative_recipe.source']()} emptyLabel={m['creative_recipe.no_source']()} ariaLabel={m['creative_recipe.source']()} onValueChange={(value) => { captureNodeId = value; name = boards.find(item => item.nodeId === value)?.document.title ?? ''; }} /></div>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['creative_recipe.name']()}</span><Input bind:value={name} maxlength={120} aria-invalid={Boolean($errors.name)} /></label>
            <div class="grid content-start gap-1.5"><span class="text-ui-lg font-medium">{m['creative_recipe.version_of']()}</span><ModelCombobox value={previousId} options={[{ value: '', label: m['creative_recipe.new']() }, ...recipes.filter(item => item.workspaceId === workspaceId).map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))]} defaultLabel={m['creative_recipe.new']()} searchPlaceholder={m['creative_recipe.search']()} emptyLabel={m['creative_recipe.empty']()} ariaLabel={m['creative_recipe.version_of']()} onValueChange={(value) => previousId = value} /></div>
          </div>
          {#if $errors.name}<p role="alert" class="flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{m['creative.field_invalid']()}</p>{/if}
          <label class="grid gap-1.5"><span class="text-ui-lg font-medium">{m['creative_recipe.description']()}</span><Textarea bind:value={description} maxlength={2000} class="min-h-20 resize-y" /></label>
          {#if board}<ol class="grid gap-1.5 rounded-lg bg-[var(--app-hover)] px-3 py-2.5">{#each board.document.scenes as scene, index}<li class="flex items-baseline gap-2 text-ui-lg"><span class="font-mono text-[11px] text-[var(--app-text-muted)] tabular-nums">{index + 1}.</span><span class="min-w-0 flex-1 truncate">{scene.title}</span><span class="font-mono text-[11px] text-[var(--app-text-muted)] tabular-nums">{scene.duration}s</span></li>{/each}</ol>{/if}
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="queue" class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div class="flex shrink-0 justify-end"><Button variant="ghost" size="icon-sm" title={m['creative.refresh']()} aria-label={m['creative.refresh']()} disabled={busy} onclick={refreshQueue}><RefreshCw size={14} /></Button></div>
        <ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain">{#each queue as item}<li class="queue-row"><span class="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--app-hover)] text-[var(--app-text-soft)]" aria-hidden="true">{#if item.kind === 'video'}<Film size={15} />{:else}<Image size={15} />{/if}</span><div class="min-w-0 flex-1"><button type="button" class="text-left text-ui-lg font-medium underline-offset-4 hover:underline" onclick={() => openNode(item.nodeId)}>{item.title}</button><p class="mt-0.5 text-ui-md text-[var(--app-text-muted)]">{stateLabel(item)}{#if item.queuePosition !== null} · {m['creative_recipe.position']()} <span class="tabular-nums">{item.queuePosition}</span>{/if}{#if item.reservedCents !== null} · {m['creative_recipe.reserved']()} <span class="tabular-nums">{new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(item.reservedCents / 100)}</span>{/if}</p>{#if item.errorCode}<p class="mt-1 flex items-center gap-1.5 text-ui-md text-[var(--app-danger)]"><CircleAlert size={13} class="shrink-0" aria-hidden="true" />{creativeError(item.errorCode)}</p>{/if}{#each item.outputs as output}<button type="button" class="mt-1 flex max-w-full items-center gap-1 text-left text-ui-md text-[var(--app-text-soft)] underline underline-offset-4 hover:text-[var(--app-text)]" onclick={() => openNode(output.nodeId)}><ExternalLink size={12} aria-hidden="true" />{output.title}</button>{/each}</div><div class="flex shrink-0 gap-1"><Button variant="ghost" size="icon-sm" title={m['storyboard.open_workflow']()} aria-label={m['storyboard.open_workflow']()} onclick={() => openNode(item.nodeId)}><ExternalLink size={14} /></Button>{#if item.canCancel}<Button variant="ghost" size="icon-sm" disabled={busy} title={m['creative.cancel']()} aria-label={m['creative.cancel']()} onclick={() => queueAction(item, 'cancel')}><Square size={14} /></Button>{/if}{#if item.canRetryDownload}<Button variant="ghost" size="icon-sm" disabled={busy} title={m['creative.retry_download']()} aria-label={m['creative.retry_download']()} onclick={() => queueAction(item, 'retry_download')}><RotateCcw size={14} /></Button>{/if}</div></li>{/each}{#if !queue.length && ready}<li><NodeEmptyState icon={Film} title={m['creative_recipe.queue_empty']()} /></li>{/if}</ul>
      </Tabs.Content>
    </Tabs.Root>
    {#if loading}<p role="status" class="flex shrink-0 items-center gap-2 self-start rounded-full bg-[var(--app-hover)] px-3 py-1 text-ui-md text-[var(--app-text-soft)]"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['creative.loading']()}</p>{/if}
    {#if error}<p role="alert" class="flex shrink-0 items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span class="min-w-0 flex-1">{creativeError(error)}</span>{#if !ready && !loading}<Button size="xs" variant="outline" class="shrink-0" onclick={load}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}</p>{:else if !ready && !loading}<Button variant="outline" class="self-start" onclick={load}><RefreshCw aria-hidden="true" />{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="shrink-0 flex-wrap items-center sm:justify-between"><div>{#if tab === 'library' && recipe?.workspaceId === workspaceId}<Button variant="ghost" class="text-[var(--app-danger)] hover:text-[var(--app-danger)]" disabled={busy} onclick={() => removeId = selectedId}><Trash2 size={14} aria-hidden="true" />{m['creative.delete']()}</Button>{/if}</div><div class="flex gap-2"><Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button>{#if tab === 'library'}<Button disabled={!recipe || busy || !ready || recipe.definition.inputs.some(slot => !bindings.values.some(value => value.key === slot.key))} onclick={() => command('instantiate')}><Plus size={14} aria-hidden="true" />{m['creative_recipe.place']()}</Button>{:else if tab === 'capture'}<Button disabled={busy || !ready || !board?.document.scenes.length} onclick={() => command('capture')}><Save size={14} aria-hidden="true" />{m['creative.save']()}</Button>{/if}</div></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={removeId !== null} onOpenChange={(value) => { if (!value) removeId = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{m['creative_recipe.remove_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action variant="destructive" onclick={() => { removeId = null; void command('remove'); }}>{m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<style>
  .recipe-row {
    width: 100%;
    padding: 8px 10px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--app-text-soft);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, color var(--duration-quick) ease-out;
  }

  .recipe-row:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-text);
  }

  .recipe-row[aria-current='true'] {
    background: var(--app-accent-soft);
    box-shadow: inset 0 0 0 1px var(--app-accent);
    color: var(--app-text);
  }

  .recipe-row:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }

  .queue-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 4px;
  }

  .queue-row + .queue-row {
    border-top: 1px solid var(--app-border);
  }
</style>
