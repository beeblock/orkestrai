<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import type { NodeProps } from '@xyflow/svelte';
  import { Clapperboard, Plus, Copy, Trash2, ArrowUp, ArrowDown, Save, Undo2, Image, Film, ExternalLink, RefreshCw, Columns2, X, LoaderCircle, TriangleAlert } from '@lucide/svelte';
  import CreativeAssetReviewDialog from '../CreativeAssetReviewDialog.svelte';
  import CreativeRecipeDialog from '../CreativeRecipeDialog.svelte';
  import CreativeShotControls from '../CreativeShotControls.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Slider } from '$lib/components/ui/slider';
  import { SegmentedControl } from '$lib/components/ui/segmented';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as m from '$lib/paraglide/messages.js';
  import { storyboardSceneContentSchema, type StoryboardOperation, type StoryboardScene } from '$lib/modules/creative-media/contracts/schemas/creative-storyboard.schema.js';
  import type { CreativeStoryboard, StoryboardRead } from '$lib/modules/creative-media/domain/storyboard.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import { creativeApi, creativeError } from '../creative-media-client.js';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import ModelCombobox from './ModelCombobox.svelte';

  type Data = { title: string; workspaceId: string; payload: { revision?: number }; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let read = $state<StoryboardRead | null>(null), characters = $state<CreativeCharacter[]>([]);
  let sceneId = $state(''), draft = $state(storyboardSceneContentSchema.parse({ title: 'Scene' }));
  let busy = $state(false), loading = $state(true), dirty = $state(false), conflict = $state(false), error = $state('');
  let dragging = $state(''), dropBefore = $state<string | null>(null), removeId = $state<string | null>(null);
  let reviewing = $state(false), recipeOpen = $state(false);
  let mounted = false, refreshing = false, generation = 0;
  const base = $derived(`/api/agent-room/workspaces/${data.workspaceId}/creative-media`);
  const endpoint = $derived(`${base}/storyboards`);
  const scenes = $derived(read?.storyboard.document.scenes ?? []);
  const scene = $derived(scenes.find(item => item.id === sceneId));
  const progress = $derived(read?.progress.find(item => item.id === sceneId));
  const inputs = $derived(read?.inputs.filter(item => item.type === 'image' || item.type === 'video') ?? []);
  const adapter = zod(storyboardSceneContentSchema as unknown as Parameters<typeof zod>[0]);
  const form = superForm(defaults({ title: 'Scene' }, adapter), { id: untrack(() => `storyboard-${id}`), SPA: true, dataType: 'json', validators: adapter });
  const { errors } = form;
  function select(next: string) {
    if (dirty) return;
    sceneId = next;
    const item = read?.storyboard.document.scenes.find(item => item.id === next);
    if (item) { const { id: _, imageWorkflowNodeId, videoWorkflowNodeId, imageBriefHash, videoBriefHash, ...content } = $state.snapshot(item); draft = content; }
    form.errors.set({});
  }
  async function refresh(reset = false, selectedId = sceneId) {
    if (refreshing) return;
    refreshing = true;
    const token = generation, workspace = data.workspaceId;
    try {
      const result = await creativeApi<StoryboardRead>(`${endpoint}?nodeId=${id}`);
      const available = await creativeApi<CreativeCharacter[]>(`${base}/characters`);
      if (!mounted || token !== generation || workspace !== data.workspaceId) return;
      characters = available.filter(item => item.state === 'locked');
      if (!reset && dirty) {
        conflict = result.storyboard.revision !== read?.storyboard.revision;
        if (read) read.progress = result.progress;
      } else {
        read = result; dirty = false; conflict = false;
        select(result.storyboard.document.scenes.some(item => item.id === selectedId) ? selectedId : result.storyboard.document.scenes[0]?.id ?? '');
      }
    } catch (cause) { if (token === generation) error = (cause as Error).message; }
    finally { refreshing = false; loading = false; }
  }
  onMount(() => {
    mounted = true; void refresh();
    const timer = setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 5000);
    return () => { mounted = false; generation++; clearInterval(timer); };
  });
  $effect(() => { const revision = data.payload.revision; if (revision && mounted) untrack(() => { if (!busy && revision !== read?.storyboard.revision) void refresh(); }); });
  async function command(input: Record<string, unknown>, next = sceneId) {
    if (!read || busy) return;
    busy = true; error = ''; generation++;
    try {
      const saved = await creativeApi<CreativeStoryboard>(endpoint, 'POST', { nodeId: id, revision: read.storyboard.revision, ...input });
      dirty = false; read.storyboard = saved; select(next);
      await refresh(true, next);
      return saved;
    } catch (cause) { error = (cause as Error).message; if (error === 'creative_revision_conflict') conflict = true; }
    finally { busy = false; }
  }
  const apply = (operations: StoryboardOperation[], next = sceneId) => command({ command: 'apply', operations }, next);
  async function save() {
    const value = $state.snapshot(draft);
    form.form.set(value);
    if (!(await form.validateForm({ update: true })).valid) { error = 'creative_invalid_input'; return; }
    await apply([{ type: 'update', id: sceneId, patch: value }]);
  }
  async function add() { const saved = await apply([{ type: 'add', scene: storyboardSceneContentSchema.parse({ title: `${m['storyboard.scene']()} ${scenes.length + 1}` }) }]); if (saved) select(saved.document.scenes.at(-1)!.id); }
  async function duplicate() { const index = scenes.findIndex(item => item.id === sceneId); const saved = await apply([{ type: 'duplicate', id: sceneId }]); if (saved) select(saved.document.scenes[index + 1].id); }
  function move(id: string, beforeId: string | null) { dragging = ''; dropBefore = null; void apply([{ type: 'move', id, beforeId }]); }
  function changed() { dirty = true; error = ''; }
  function toggle(field: 'characterIds' | 'referenceNodeIds', id: string, checked: boolean) { draft[field] = checked ? [...draft[field], id] : draft[field].filter(value => value !== id); changed(); }
  function preview(item: StoryboardScene) {
    const nodeId = read?.progress.find(row => row.id === item.id)?.outputs.find(row => row.type === 'image')?.id ?? item.referenceNodeIds[0];
    const input = read?.inputs.find(row => row.id === nodeId);
    return input?.type === 'image' && input.path ? `/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(input.path)}` : null;
  }
  const missing = $derived(draft.referenceNodeIds.filter(id => !inputs.some(item => item.id === id)));
  const missingCharacters = $derived(draft.characterIds.filter(id => !characters.some(item => item.id === id)));
  // Poucas proporcoes fixas: escolha direta em vez de combobox com busca.
  const ratioOptions = ['16:9', '9:16', '1:1', '4:3', '3:4'].map(value => ({ value, label: value }));
</script>

<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={540} minHeight={380} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Clapperboard size={14} />{/snippet}
  {#snippet title()}{data.title || m['storyboard.title']()}{/snippet}
  {#snippet actions()}<HeaderIconButton class="node-action-btn" label={m['creative_recipe.capture']()} onclick={() => recipeOpen = true}><Save size={13} /></HeaderIconButton><HeaderIconButton class="node-action-btn" label={m['creative_review.title']()} onclick={() => reviewing = true}><Columns2 size={13} /></HeaderIconButton><HeaderIconButton class="node-action-btn" label={m['creative.refresh']()} onclick={() => refresh()}><RefreshCw size={13} /></HeaderIconButton><HeaderIconButton class="node-action-btn" label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>{/snippet}
  <div data-testid="storyboard" class="sb nodrag nowheel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-surface)] text-[var(--app-text)]">
    {#if loading && !scenes.length}
      <div class="grid flex-1 place-items-center p-4"><span class="sb-loading" role="status"><LoaderCircle size={13} class="animate-spin" />{m['creative.loading']()}</span></div>
    {:else if !scenes.length}
      <!-- Sem cenas: a proxima acao fica no centro, junto da explicacao. -->
      <NodeEmptyState icon={Clapperboard} title={m['storyboard.empty']()} description={m['storyboard.empty_hint']()}>
        {#snippet actions()}<Button size="sm" disabled={busy || dirty || loading || scenes.length >= 100} onclick={add}><Plus size={14} />{m['storyboard.add_scene']()}</Button>{/snippet}
      </NodeEmptyState>
    {:else}
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--sb-line)] px-3 py-2">
      <span class="text-ui-md text-[var(--app-text-soft)] tabular-nums">{scenes.length} {m['storyboard.scenes']()} <span class="text-[var(--app-text-muted)]">·</span> <span class="font-mono text-ui-sm">{scenes.reduce((sum, item) => sum + item.duration, 0)}s</span></span>
      <Button variant="outline" size="sm" disabled={busy || dirty || loading || scenes.length >= 100} onclick={add}><Plus size={14} />{m['storyboard.add_scene']()}</Button>
    </div>
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(160px,30%)_minmax(0,1fr)] overflow-hidden">
      <nav aria-label={m['storyboard.scenes']()} class="flex min-h-0 flex-col gap-2 overflow-y-auto overscroll-contain border-r border-[var(--sb-line)] bg-[var(--app-surface-subtle)] p-2">
        {#each scenes as item, index (item.id)}
          {@const image = preview(item)}
          <button type="button" draggable={!busy && !dirty} disabled={busy || (dirty && item.id !== sceneId)} aria-current={sceneId === item.id ? 'step' : undefined} aria-label={`${index + 1}. ${item.title}`} class="sb-scene" class:drop-target={dropBefore === item.id} class:dragging={dragging === item.id} onclick={() => select(item.id)} ondragstart={(event) => { dragging = item.id; event.stopPropagation(); event.dataTransfer?.setData('text/x-orkestrai-scene', item.id); }} ondragover={(event) => { if (dragging && !dirty && !busy) { event.preventDefault(); event.stopPropagation(); dropBefore = item.id; } }} ondrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragging && !dirty && !busy) move(dragging, item.id); }} ondragend={() => { dragging = ''; dropBefore = null; }}>
            {#if image}<img src={image} alt={item.title} loading="lazy" draggable="false" class="sb-thumb block object-contain" />{:else}<div class="sb-thumb grid place-items-center text-[var(--app-text-muted)]"><Clapperboard size={20} /></div>{/if}
            <span class="flex items-start justify-between gap-2 px-2 py-1.5"><span class="min-w-0 font-medium break-words">{index + 1}. {item.title}</span><span class="shrink-0 font-mono text-[11px] leading-[18px] text-[var(--app-text-muted)] tabular-nums">{item.duration}s</span></span>
          </button>
        {/each}
        {#if scenes.length > 1}<p class="px-1 text-ui-xs text-[var(--app-text-muted)]">{m['storyboard.drag_hint']()}</p>{/if}
      </nav>
      <section aria-label={m['storyboard.scene']()} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {#if scene}
          <div class="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-[var(--sb-line)] py-1 pr-1.5 pl-3">
            <span class="font-mono text-ui-sm text-[var(--app-text-soft)] tabular-nums">{scenes.findIndex(item => item.id === sceneId) + 1} / {scenes.length}</span>
            <div class="flex gap-0.5 text-[var(--app-text-muted)]"><Button variant="ghost" size="icon-sm" title={m['storyboard.up']()} aria-label={m['storyboard.up']()} disabled={busy || dirty || scenes[0]?.id === sceneId} onclick={() => move(sceneId, scenes[scenes.findIndex(item => item.id === sceneId) - 1].id)}><ArrowUp size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['storyboard.down']()} aria-label={m['storyboard.down']()} disabled={busy || dirty || scenes.at(-1)?.id === sceneId} onclick={() => move(sceneId, scenes[scenes.findIndex(item => item.id === sceneId) + 2]?.id ?? null)}><ArrowDown size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['storyboard.duplicate']()} aria-label={m['storyboard.duplicate']()} disabled={busy || dirty || scenes.length >= 100} onclick={duplicate}><Copy size={14} /></Button><Button variant="ghost" size="icon-sm" class="hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" title={m['creative.delete']()} aria-label={m['creative.delete']()} disabled={busy || dirty} onclick={() => removeId = sceneId}><Trash2 size={14} /></Button></div>
          </div>
          <fieldset disabled={busy} class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 text-xs disabled:opacity-70" oninput={changed}>
            <label class="sb-field"><span class="sb-label">{m['storyboard.scene_title']()}</span><Input bind:value={draft.title} maxlength={120} aria-invalid={Boolean($errors.title)} /></label>
            <label class="sb-field"><span class="sb-label">{m['creative.prompt']()}</span><Textarea bind:value={draft.direction} maxlength={16000} class="min-h-24" /></label>
            <div class="sb-field"><span class="sb-label">{m['creative.ratio']()}</span><SegmentedControl options={ratioOptions} value={draft.aspectRatio} label={m['creative.ratio']()} size="sm" fill class="font-mono tabular-nums" onValueChange={(value) => { draft.aspectRatio = value as typeof draft.aspectRatio; changed(); }} /></div>
            <CreativeShotControls value={draft.shot} disabled={busy} onChange={(value) => { draft.shot = value; changed(); }} />
            <label class="sb-field"><span class="sb-label">{m['storyboard.dialogue']()}</span><Textarea bind:value={draft.dialogue} maxlength={8000} /></label>
            <label class="sb-field"><span class="sb-label">{m['creative.character_language']()}</span><Input bind:value={draft.language} maxlength={35} /></label>
            <div class="sb-field gap-3"><div class="flex items-baseline justify-between gap-2"><span class="sb-label">{m['creative.duration']()}</span><span class="font-mono text-ui-sm text-[var(--app-text)] tabular-nums">{draft.duration} s</span></div><Slider type="single" value={draft.duration} min={1} max={120} step={1} aria-label={m['creative.duration']()} onValueChange={(value: number) => { draft.duration = value; changed(); }} /></div>
            <div class="sb-field"><span class="sb-label">{m['storyboard.executor']()}</span><ModelCombobox value={draft.executorNodeId ?? ''} options={[{ value: '', label: m['storyboard.unassigned']() }, ...(read?.executors.map(item => ({ value: item.id, label: item.title })) ?? [])]} defaultLabel={m['storyboard.unassigned']()} searchPlaceholder={m['storyboard.executor']()} emptyLabel={m['storyboard.unassigned']()} ariaLabel={m['storyboard.executor']()} onValueChange={(value) => { draft.executorNodeId = value || null; changed(); }} /></div>
            <fieldset class="flex min-w-0 flex-col gap-0.5"><legend class="sb-label mb-1.5">{m['creative.characters']()}</legend>{#each characters as character}<label class="sb-check"><Checkbox checked={draft.characterIds.includes(character.id)} onCheckedChange={(value: boolean) => toggle('characterIds', character.id, !!value)} />{#if character.definition.images[0]}<img src={`/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(character.definition.images[0])}`} alt={character.definition.name} loading="lazy" draggable="false" class="img-outline size-9 rounded-md bg-[var(--app-canvas)] object-contain" />{/if}<span class="min-w-0 break-words">{character.definition.name} <span class="font-mono text-[11px] text-[var(--app-text-muted)]">v{character.version}</span></span></label>{/each}{#each missingCharacters as characterId}<label class="sb-check text-[var(--app-warning)]"><Checkbox checked onCheckedChange={(value: boolean) => toggle('characterIds', characterId, !!value)} /><span class="break-all">{m['storyboard.missing']()} · {characterId}</span></label>{/each}</fieldset>
            <fieldset class="flex min-w-0 flex-col gap-0.5"><legend class="sb-label mb-1.5">{m['storyboard.references']()}</legend>{#each inputs as input}<label class="sb-check"><Checkbox checked={draft.referenceNodeIds.includes(input.id)} onCheckedChange={(value: boolean) => toggle('referenceNodeIds', input.id, !!value)} /><span class="min-w-0 break-words">{input.title}</span></label>{/each}{#each missing as nodeId}<label class="sb-check text-[var(--app-warning)]"><Checkbox checked onCheckedChange={(value: boolean) => toggle('referenceNodeIds', nodeId, !!value)} /><span class="break-all">{m['storyboard.missing']()} · {nodeId}</span></label>{/each}</fieldset>
            <div class="flex flex-col gap-2 border-t border-[var(--sb-line)] pt-3">
              {#each ['image', 'video'] as kind}
                {@const linked = kind === 'image' ? scene.imageWorkflowNodeId : scene.videoWorkflowNodeId}
                {@const stale = kind === 'image' ? progress?.imageStale : progress?.videoStale}
                <div class="flex flex-wrap items-center gap-1.5"><Button size="sm" variant="outline" disabled={dirty || busy || !!missing.length || !!missingCharacters.length} onclick={() => command({ command: 'materialize', sceneId, kind })}>{#if kind === 'image'}<Image size={14} />{:else}<Film size={14} />{/if}{kind === 'image' ? m['storyboard.prepare_image']() : m['storyboard.prepare_video']()}</Button>{#if linked}<Button variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)]" title={m['storyboard.open_workflow']()} aria-label={m['storyboard.open_workflow']()} onclick={() => data.onJumpToNode?.(linked)}><ExternalLink size={14} /></Button><Button variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)]" disabled={dirty || busy} title={m['storyboard.unlink']()} aria-label={m['storyboard.unlink']()} onclick={() => apply([{ type: 'link', id: sceneId, kind: kind as 'image' | 'video', nodeId: null }])}><X size={14} /></Button>{/if}{#if stale}<span class="sb-stale">{m['storyboard.stale']()}</span>{/if}</div>
              {/each}
              {#each progress?.outputs ?? [] as output}<Button size="sm" variant="ghost" class="max-w-full justify-start text-left whitespace-normal text-[var(--app-text-soft)]" onclick={() => data.onJumpToNode?.(output.id)}><ExternalLink size={13} />{output.title}</Button>{/each}
            </div>
          </fieldset>
          <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--sb-line)] px-3 py-2"><Button size="sm" variant="ghost" disabled={!dirty || busy} onclick={() => refresh(true)}><Undo2 size={14} />{m['storyboard.discard']()}</Button><Button size="sm" class="sb-primary" disabled={!dirty || busy || conflict} onclick={save}><Save size={14} />{m['creative.save']()}</Button></div>
        {/if}
      </section>
    </div>
    {/if}
    {#if conflict}<p role="alert" class="sb-alert warning"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />{m['storyboard.conflict']()}</p>{/if}
    {#if error}<p role="alert" class="sb-alert"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />{creativeError(error)}</p>{/if}
  </div>
</NodeShell>
<CreativeRecipeDialog bind:open={recipeOpen} workspaceId={data.workspaceId} sourceNodeId={id} onOpenNode={data.onJumpToNode} />
<CreativeAssetReviewDialog bind:open={reviewing} workspaceId={data.workspaceId} initialNodeId={progress?.outputs[0]?.id} onOpenNode={data.onJumpToNode} />
<AlertDialog.Root open={removeId !== null} onOpenChange={(value) => { if (!value) removeId = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{m['storyboard.remove_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { const next = removeId; removeId = null; if (next) void apply([{ type: 'remove', id: next }]); }}>{m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<style>
  .sb {
    --sb-line: color-mix(in srgb, var(--app-border) 80%, transparent);
  }

  .sb-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .sb-label {
    color: var(--app-text);
    font-size: 12px;
    font-weight: 500;
  }

  .sb-check {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 2px 6px;
    margin-inline: -6px;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out;
  }

  .sb-check:hover {
    background: var(--app-hover);
  }

  /* Cartao de cena: mesma linguagem de selecao do NodeShell (anel 1px + halo). */
  .sb-scene {
    display: block;
    width: 100%;
    flex-shrink: 0;
    overflow: hidden;
    padding: 0;
    border: 0;
    border-radius: 8px;
    background: var(--app-surface);
    box-shadow: var(--app-shadow-border);
    color: var(--app-text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    transition: box-shadow var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out;
  }

  .sb-scene:hover:not(:disabled) {
    box-shadow: var(--app-shadow-border-hover);
  }

  .sb-scene[aria-current='step'] {
    box-shadow:
      0 0 0 1px var(--app-secondary),
      0 0 0 4px color-mix(in srgb, var(--app-secondary) 16%, transparent);
  }

  /* Alvo de soltura: faixa no topo = a cena arrastada entra antes desta. */
  .sb-scene.drop-target {
    box-shadow:
      0 -3px 0 -1px var(--app-secondary),
      var(--app-shadow-border);
  }

  .sb-scene.dragging {
    opacity: 0.5;
  }

  .sb-scene:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .sb-scene:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }

  .sb-thumb {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: var(--app-canvas);
  }

  .sb-stale {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-warning-soft);
    color: var(--app-warning);
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
  }

  .sb :global(.sb-primary:disabled) {
    background: var(--app-hover);
    color: var(--app-text-muted);
    opacity: 1;
  }

  .sb-loading {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
  }

  .sb-alert {
    display: flex;
    flex-shrink: 0;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--sb-line);
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .sb-alert.warning {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }
</style>
