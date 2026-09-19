<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { Workflow, Plus, Save, ExternalLink, RefreshCw, Trash2, Square, RotateCcw, Film, Image } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Button } from '$lib/components/ui/button';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
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
  <Dialog.Content data-testid="creative-recipes" class="flex h-[min(800px,calc(100dvh-32px))] w-[calc(100vw-32px)] flex-col overflow-hidden sm:max-w-5xl">
    <Dialog.Header><Dialog.Title class="flex items-center gap-2"><Workflow size={18} />{m['creative_recipe.title']()}</Dialog.Title><Dialog.Description>{m['creative_recipe.subtitle']()}</Dialog.Description></Dialog.Header>
    <Tabs.Root bind:value={tab} activationMode="manual" class="flex min-h-0 flex-1 flex-col">
      <Tabs.List class="shrink-0"><Tabs.Trigger bind:ref={libraryTab} value="library" class="aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.library']()}</Tabs.Trigger><Tabs.Trigger value="capture" class="aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.capture']()}</Tabs.Trigger><Tabs.Trigger value="queue" class="aria-selected:bg-[var(--app-accent-soft)] aria-selected:text-[var(--app-accent)]">{m['creative_recipe.queue']()}</Tabs.Trigger></Tabs.List>
      <Tabs.Content value="library" class="grid min-h-0 flex-1 grid-cols-[minmax(160px,32%)_minmax(0,1fr)] gap-4 overflow-hidden">
        <div class="flex min-h-0 flex-col gap-2 border-r pr-3"><Input bind:value={query} aria-label={m['creative_recipe.search']()} placeholder={m['creative_recipe.search']()} /><nav aria-label={m['creative_recipe.library']()} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">{#each filtered as item}<button type="button" aria-current={item.id === selectedId ? 'true' : undefined} disabled={busy} class="mb-1 w-full rounded border border-transparent p-2 text-left hover:bg-[var(--app-hover)] aria-current:border-[var(--app-accent)] aria-current:bg-[var(--app-accent-soft)]" onclick={() => select(item.id)}><strong class="block break-words text-sm">{item.name}</strong><span class="block text-xs text-muted-foreground">v{item.version} · {item.definition.scenes.length} {m['storyboard.scenes']()}</span><span class="block truncate text-xs text-muted-foreground" title={item.workspaceName}>{item.workspaceName}</span></button>{/each}{#if !filtered.length}<p class="py-4 text-sm text-muted-foreground">{m['creative_recipe.empty']()}</p>{/if}</nav></div>
        <div class="min-h-0 overflow-y-auto overscroll-contain pr-1">
          {#if recipe}<fieldset disabled={busy || !ready} class="space-y-4"><header><h3 class="break-words text-base font-semibold">{recipe.name} · v{recipe.version}</h3><p class="whitespace-pre-wrap break-words text-sm text-muted-foreground">{recipe.description}</p></header>
            <label class="block space-y-1 text-sm"><span>{m['creative_recipe.script']()}</span><Textarea bind:value={bindings.script} maxlength={12000} class="min-h-28" /></label>
            <div class="space-y-1 text-sm"><span>{m['creative.ratio']()}</span><ModelCombobox value={bindings.aspectRatio} options={['16:9','9:16','1:1','4:3','3:4'].map(value => ({ value, label: value }))} defaultLabel="16:9" searchPlaceholder={m['creative.ratio']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.ratio']()} onValueChange={(value) => { if (value) bindings.aspectRatio = value as CreativeRecipeBindings['aspectRatio']; }} /></div>
            <div class="space-y-1 text-sm"><span>{m['storyboard.executor']()}</span><ModelCombobox value={bindings.executorNodeId ?? ''} options={executors.map(item => ({ value: item.id, label: item.title }))} defaultLabel={m['storyboard.unassigned']()} searchPlaceholder={m['storyboard.executor']()} emptyLabel={m['storyboard.unassigned']()} ariaLabel={m['storyboard.executor']()} onValueChange={(value) => bindings.executorNodeId = value || null} /></div>
            {#each recipe.definition.inputs as slot}<div class="space-y-1 text-sm"><span>{slot.label}{#if slot.identity}<span class="ml-2 text-xs text-muted-foreground">v{slot.identity.version}</span>{/if}</span><ModelCombobox value={bindings.values.find(item => item.key === slot.key)?.id ?? ''} options={slot.kind === 'character' ? characters.map(item => ({ value: item.id, label: `${item.definition.name} · v${item.version}` })) : inputs.filter(item => item.type === slot.kind).map(item => ({ value: item.id, label: item.title }))} defaultLabel={m['creative_recipe.choose_input']()} searchPlaceholder={slot.label} emptyLabel={m['creative.no_inputs']()} ariaLabel={slot.label} onValueChange={(id) => bindings.values = [...bindings.values.filter(item => item.key !== slot.key), ...(id ? [{ key: slot.key, id }] : [])]} /></div>{/each}
            <details class="border-t pt-3"><summary class="cursor-pointer text-sm">{m['creative_recipe.preview']()}</summary><ol class="mt-3 space-y-3">{#each recipe.definition.scenes as scene, index}<li><h4 class="text-sm font-medium">{index + 1}. {scene.title} · {scene.duration}s</h4><p class="whitespace-pre-wrap break-words text-xs text-muted-foreground">{scene.direction}</p>{#if scene.dialogue}<p class="mt-1 whitespace-pre-wrap text-xs">{scene.dialogue}</p>{/if}</li>{/each}</ol><code class="mt-3 block break-all text-xs text-muted-foreground">{recipe.digest}</code></details>
          </fieldset>{/if}
        </div>
      </Tabs.Content>
      <Tabs.Content value="capture" class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <fieldset disabled={busy || !ready} class="space-y-4 py-2">
          <div class="space-y-1 text-sm"><span>{m['creative_recipe.source']()}</span><ModelCombobox value={captureNodeId} options={boards.map(item => ({ value: item.nodeId, label: `${item.document.title} · ${item.document.scenes.length} ${m['storyboard.scenes']()}` }))} defaultLabel={m['creative_recipe.choose_source']()} searchPlaceholder={m['creative_recipe.source']()} emptyLabel={m['creative_recipe.no_source']()} ariaLabel={m['creative_recipe.source']()} onValueChange={(value) => { captureNodeId = value; name = boards.find(item => item.nodeId === value)?.document.title ?? ''; }} /></div>
          <label class="block space-y-1 text-sm"><span>{m['creative_recipe.name']()}</span><Input bind:value={name} maxlength={120} aria-invalid={Boolean($errors.name)} /></label>
          <label class="block space-y-1 text-sm"><span>{m['creative_recipe.description']()}</span><Textarea bind:value={description} maxlength={2000} /></label>
          <div class="space-y-1 text-sm"><span>{m['creative_recipe.version_of']()}</span><ModelCombobox value={previousId} options={[{ value: '', label: m['creative_recipe.new']() }, ...recipes.filter(item => item.workspaceId === workspaceId).map(item => ({ value: item.id, label: `${item.name} · v${item.version}` }))]} defaultLabel={m['creative_recipe.new']()} searchPlaceholder={m['creative_recipe.search']()} emptyLabel={m['creative_recipe.empty']()} ariaLabel={m['creative_recipe.version_of']()} onValueChange={(value) => previousId = value} /></div>
          {#if $errors.name}<p role="alert" class="text-xs text-destructive">{m['creative.field_invalid']()}</p>{/if}
          {#if board}<ol class="space-y-2 border-t pt-3">{#each board.document.scenes as scene, index}<li class="text-sm">{index + 1}. {scene.title} <span class="text-muted-foreground">· {scene.duration}s</span></li>{/each}</ol>{/if}
        </fieldset>
      </Tabs.Content>
      <Tabs.Content value="queue" class="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
        <div class="flex justify-end"><Button variant="ghost" size="icon-sm" title={m['creative.refresh']()} aria-label={m['creative.refresh']()} disabled={busy} onclick={refreshQueue}><RefreshCw size={14} /></Button></div>
        <ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain divide-y">{#each queue as item}<li class="flex flex-wrap items-start gap-3 py-3">{#if item.kind === 'video'}<Film size={17} class="mt-1 shrink-0" />{:else}<Image size={17} class="mt-1 shrink-0" />{/if}<div class="min-w-0 flex-1"><button type="button" class="text-left text-sm font-medium underline-offset-4 hover:underline" onclick={() => openNode(item.nodeId)}>{item.title}</button><p class="text-xs text-muted-foreground">{stateLabel(item)}{#if item.queuePosition !== null} · {m['creative_recipe.position']()} {item.queuePosition}{/if}{#if item.reservedCents !== null} · {m['creative_recipe.reserved']()} {new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(item.reservedCents / 100)}{/if}</p>{#if item.errorCode}<p class="mt-1 text-xs text-destructive">{creativeError(item.errorCode)}</p>{/if}{#each item.outputs as output}<button type="button" class="mt-1 flex max-w-full items-center gap-1 text-left text-xs underline" onclick={() => openNode(output.nodeId)}><ExternalLink size={12} />{output.title}</button>{/each}</div><div class="flex gap-1"><Button variant="outline" size="icon-sm" title={m['storyboard.open_workflow']()} aria-label={m['storyboard.open_workflow']()} onclick={() => openNode(item.nodeId)}><ExternalLink size={14} /></Button>{#if item.canCancel}<Button variant="outline" size="icon-sm" disabled={busy} title={m['creative.cancel']()} aria-label={m['creative.cancel']()} onclick={() => queueAction(item, 'cancel')}><Square size={14} /></Button>{/if}{#if item.canRetryDownload}<Button variant="outline" size="icon-sm" disabled={busy} title={m['creative.retry_download']()} aria-label={m['creative.retry_download']()} onclick={() => queueAction(item, 'retry_download')}><RotateCcw size={14} /></Button>{/if}</div></li>{/each}{#if !queue.length}<li class="py-6 text-sm text-muted-foreground">{m['creative_recipe.queue_empty']()}</li>{/if}</ul>
      </Tabs.Content>
    </Tabs.Root>
    {#if loading}<p role="status" class="text-xs text-muted-foreground">{m['creative.loading']()}</p>{/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{creativeError(error)}</p>{/if}
    {#if !ready && !loading}<Button variant="outline" onclick={load}>{m['creative.refresh']()}</Button>{/if}
    <Dialog.Footer class="shrink-0 flex-wrap gap-2 border-t pt-3 sm:justify-between"><div>{#if tab === 'library' && recipe?.workspaceId === workspaceId}<Button variant="ghost" disabled={busy} onclick={() => removeId = selectedId}><Trash2 size={14} />{m['creative.delete']()}</Button>{/if}</div><div class="flex gap-2"><Button variant="outline" onclick={() => open = false}>{m['creative.close']()}</Button>{#if tab === 'library'}<Button disabled={!recipe || busy || !ready || recipe.definition.inputs.some(slot => !bindings.values.some(value => value.key === slot.key))} onclick={() => command('instantiate')}><Plus size={14} />{m['creative_recipe.place']()}</Button>{:else if tab === 'capture'}<Button disabled={busy || !ready || !board?.document.scenes.length} onclick={() => command('capture')}><Save size={14} />{m['creative.save']()}</Button>{/if}</div></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<AlertDialog.Root open={removeId !== null} onOpenChange={(value) => { if (!value) removeId = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{m['creative_recipe.remove_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { removeId = null; void command('remove'); }}>{m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
