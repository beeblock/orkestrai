<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import type { NodeProps } from '@xyflow/svelte';
  import { Clapperboard, Plus, Copy, Trash2, ArrowUp, ArrowDown, Save, Undo2, Image, Film, ExternalLink, RefreshCw, Columns2, X } from '@lucide/svelte';
  import CreativeAssetReviewDialog from '../CreativeAssetReviewDialog.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Slider } from '$lib/components/ui/slider';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as m from '$lib/paraglide/messages.js';
  import { storyboardSceneContentSchema, type StoryboardOperation, type StoryboardScene } from '$lib/modules/creative-media/contracts/schemas/creative-storyboard.schema.js';
  import type { CreativeStoryboard, StoryboardRead } from '$lib/modules/creative-media/domain/storyboard.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import { creativeApi, creativeError } from '../creative-media-client.js';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import ModelCombobox from './ModelCombobox.svelte';

  type Data = { title: string; workspaceId: string; payload: { revision?: number }; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let read = $state<StoryboardRead | null>(null), characters = $state<CreativeCharacter[]>([]);
  let sceneId = $state(''), draft = $state(storyboardSceneContentSchema.parse({ title: 'Scene' }));
  let busy = $state(false), loading = $state(true), dirty = $state(false), conflict = $state(false), error = $state('');
  let dragging = $state(''), dropBefore = $state<string | null>(null), removeId = $state<string | null>(null);
  let reviewing = $state(false);
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
</script>

<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={540} minHeight={380} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Clapperboard size={14} />{/snippet}
  {#snippet title()}{data.title || m['storyboard.title']()}{/snippet}
  {#snippet actions()}<HeaderIconButton label={m['creative_review.title']()} onclick={() => reviewing = true}><Columns2 size={14} /></HeaderIconButton><HeaderIconButton label={m['creative.refresh']()} onclick={() => refresh()}><RefreshCw size={14} /></HeaderIconButton><HeaderIconButton label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>{/snippet}
  <div data-testid="storyboard" class="nodrag nowheel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-panel)] text-[var(--app-text)]">
    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--app-border)] px-3 py-2 text-xs"><span>{scenes.length} {m['storyboard.scenes']()} · {scenes.reduce((sum, item) => sum + item.duration, 0)} s</span><Button variant="outline" size="sm" disabled={busy || dirty || loading || scenes.length >= 100} onclick={add}><Plus size={14} />{m['storyboard.add_scene']()}</Button></div>
    {#if loading}<p role="status" class="p-3 text-xs">{m['creative.loading']()}</p>{/if}
    <div class="grid min-h-0 flex-1 grid-cols-[minmax(160px,30%)_minmax(0,1fr)] overflow-hidden">
      <nav aria-label={m['storyboard.scenes']()} class="min-h-0 overflow-y-auto overscroll-contain border-r border-[var(--app-border)] p-2">
        {#each scenes as item, index (item.id)}
          {@const image = preview(item)}
          <button type="button" draggable={!busy && !dirty} disabled={busy || (dirty && item.id !== sceneId)} aria-current={sceneId === item.id ? 'step' : undefined} aria-label={`${index + 1}. ${item.title}`} class="mb-2 block w-full overflow-hidden rounded-md border-2 text-left text-xs transition-colors disabled:opacity-60 {dropBefore === item.id ? 'border-[var(--app-accent)]' : sceneId === item.id ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]' : 'border-[var(--app-border)] hover:bg-[var(--app-surface-hover)]'}" onclick={() => select(item.id)} ondragstart={(event) => { dragging = item.id; event.stopPropagation(); event.dataTransfer?.setData('text/x-orkestrai-scene', item.id); }} ondragover={(event) => { if (dragging && !dirty && !busy) { event.preventDefault(); event.stopPropagation(); dropBefore = item.id; } }} ondrop={(event) => { event.preventDefault(); event.stopPropagation(); if (dragging && !dirty && !busy) move(dragging, item.id); }} ondragend={() => { dragging = ''; dropBefore = null; }}>
            {#if image}<img src={image} alt={item.title} loading="lazy" draggable="false" class="aspect-video w-full bg-[var(--app-canvas)] object-contain" />{:else}<div class="flex aspect-video w-full items-center justify-center bg-[var(--app-canvas)] text-[var(--app-text-muted)]"><Clapperboard size={25} /></div>{/if}
            <span class="flex items-start justify-between gap-2 p-2"><span class="min-w-0 break-words font-medium">{index + 1}. {item.title}</span><span class="shrink-0 text-[var(--app-text-muted)]">{item.duration}s</span></span>
          </button>
        {/each}
      </nav>
      <section aria-label={m['storyboard.scene']()} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {#if scene}
          <div class="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-[var(--app-border)] px-2 py-1">
            <span class="text-xs font-medium">{scenes.findIndex(item => item.id === sceneId) + 1} / {scenes.length}</span>
            <div class="flex gap-1"><Button variant="ghost" size="icon-sm" title={m['storyboard.up']()} aria-label={m['storyboard.up']()} disabled={busy || dirty || scenes[0]?.id === sceneId} onclick={() => move(sceneId, scenes[scenes.findIndex(item => item.id === sceneId) - 1].id)}><ArrowUp size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['storyboard.down']()} aria-label={m['storyboard.down']()} disabled={busy || dirty || scenes.at(-1)?.id === sceneId} onclick={() => move(sceneId, scenes[scenes.findIndex(item => item.id === sceneId) + 2]?.id ?? null)}><ArrowDown size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['storyboard.duplicate']()} aria-label={m['storyboard.duplicate']()} disabled={busy || dirty || scenes.length >= 100} onclick={duplicate}><Copy size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['creative.delete']()} aria-label={m['creative.delete']()} disabled={busy || dirty} onclick={() => removeId = sceneId}><Trash2 size={14} /></Button></div>
          </div>
          <fieldset disabled={busy} class="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-xs disabled:opacity-70" oninput={changed}>
            <label class="block space-y-1"><span>{m['storyboard.scene_title']()}</span><Input bind:value={draft.title} maxlength={120} aria-invalid={Boolean($errors.title)} /></label>
            <label class="block space-y-1"><span>{m['creative.prompt']()}</span><Textarea bind:value={draft.direction} maxlength={16000} class="min-h-24" /></label>
            <label class="block space-y-1"><span>{m['storyboard.dialogue']()}</span><Textarea bind:value={draft.dialogue} maxlength={8000} /></label>
            <label class="block space-y-1"><span>{m['creative.character_language']()}</span><Input bind:value={draft.language} maxlength={35} /></label>
            <div class="space-y-3"><span>{m['creative.duration']()} · {draft.duration} s</span><Slider type="single" value={draft.duration} min={1} max={120} step={1} aria-label={m['creative.duration']()} onValueChange={(value: number) => { draft.duration = value; changed(); }} /></div>
            <div class="space-y-1"><span>{m['storyboard.executor']()}</span><ModelCombobox value={draft.executorNodeId ?? ''} options={[{ value: '', label: m['storyboard.unassigned']() }, ...(read?.executors.map(item => ({ value: item.id, label: item.title })) ?? [])]} defaultLabel={m['storyboard.unassigned']()} searchPlaceholder={m['storyboard.executor']()} emptyLabel={m['storyboard.unassigned']()} ariaLabel={m['storyboard.executor']()} onValueChange={(value) => { draft.executorNodeId = value || null; changed(); }} /></div>
            <fieldset class="space-y-2"><legend class="mb-2 font-medium">{m['creative.characters']()}</legend>{#each characters as character}<label class="flex items-center gap-2"><Checkbox checked={draft.characterIds.includes(character.id)} onCheckedChange={(value: boolean) => toggle('characterIds', character.id, !!value)} />{#if character.definition.images[0]}<img src={`/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(character.definition.images[0])}`} alt={character.definition.name} loading="lazy" draggable="false" class="size-10 rounded border object-contain" />{/if}<span class="min-w-0 break-words">{character.definition.name} · v{character.version}</span></label>{/each}{#each missingCharacters as characterId}<label class="flex items-center gap-2 text-[var(--app-warning)]"><Checkbox checked onCheckedChange={(value: boolean) => toggle('characterIds', characterId, !!value)} /><span class="break-all">{m['storyboard.missing']()} · {characterId}</span></label>{/each}</fieldset>
            <fieldset class="space-y-2"><legend class="mb-2 font-medium">{m['storyboard.references']()}</legend>{#each inputs as input}<label class="flex items-center gap-2"><Checkbox checked={draft.referenceNodeIds.includes(input.id)} onCheckedChange={(value: boolean) => toggle('referenceNodeIds', input.id, !!value)} /><span class="min-w-0 break-words">{input.title}</span></label>{/each}{#each missing as nodeId}<label class="flex items-center gap-2 text-[var(--app-warning)]"><Checkbox checked onCheckedChange={(value: boolean) => toggle('referenceNodeIds', nodeId, !!value)} /><span class="break-all">{m['storyboard.missing']()} · {nodeId}</span></label>{/each}</fieldset>
            <div class="space-y-2 border-t border-[var(--app-border)] pt-3">
              {#each ['image', 'video'] as kind}
                {@const linked = kind === 'image' ? scene.imageWorkflowNodeId : scene.videoWorkflowNodeId}
                {@const stale = kind === 'image' ? progress?.imageStale : progress?.videoStale}
                <div class="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={dirty || busy || !!missing.length || !!missingCharacters.length} onclick={() => command({ command: 'materialize', sceneId, kind })}>{#if kind === 'image'}<Image size={14} />{:else}<Film size={14} />{/if}{kind === 'image' ? m['storyboard.prepare_image']() : m['storyboard.prepare_video']()}</Button>{#if linked}<Button variant="ghost" size="icon-sm" title={m['storyboard.open_workflow']()} aria-label={m['storyboard.open_workflow']()} onclick={() => data.onJumpToNode?.(linked)}><ExternalLink size={14} /></Button><Button variant="ghost" size="icon-sm" disabled={dirty || busy} title={m['storyboard.unlink']()} aria-label={m['storyboard.unlink']()} onclick={() => apply([{ type: 'link', id: sceneId, kind: kind as 'image' | 'video', nodeId: null }])}><X size={14} /></Button>{/if}{#if stale}<span class="text-[var(--app-warning)]">{m['storyboard.stale']()}</span>{/if}</div>
              {/each}
              {#each progress?.outputs ?? [] as output}<Button size="sm" variant="ghost" class="max-w-full whitespace-normal text-left" onclick={() => data.onJumpToNode?.(output.id)}><ExternalLink size={13} />{output.title}</Button>{/each}
            </div>
          </fieldset>
          <div class="flex shrink-0 items-center justify-end gap-2 border-t border-[var(--app-border)] p-2"><Button size="sm" variant="outline" disabled={!dirty || busy} onclick={() => refresh(true)}><Undo2 size={14} />{m['storyboard.discard']()}</Button><Button size="sm" disabled={!dirty || busy || conflict} onclick={save}><Save size={14} />{m['creative.save']()}</Button></div>
        {:else if !loading}<div class="flex flex-1 items-center justify-center p-5 text-sm text-[var(--app-text-muted)]">{m['storyboard.empty']()}</div>{/if}
      </section>
    </div>
    {#if conflict}<p role="alert" class="shrink-0 border-t border-[var(--app-border)] p-2 text-xs text-[var(--app-warning)]">{m['storyboard.conflict']()}</p>{/if}
    {#if error}<p role="alert" class="shrink-0 border-t border-[var(--app-border)] p-2 text-xs text-destructive">{creativeError(error)}</p>{/if}
  </div>
</NodeShell>
<CreativeAssetReviewDialog bind:open={reviewing} workspaceId={data.workspaceId} initialNodeId={progress?.outputs[0]?.id} onOpenNode={data.onJumpToNode} />
<AlertDialog.Root open={removeId !== null} onOpenChange={(value) => { if (!value) removeId = null; }}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['creative.delete']()}</AlertDialog.Title><AlertDialog.Description>{m['storyboard.remove_help']()}</AlertDialog.Description></AlertDialog.Header><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { const next = removeId; removeId = null; if (next) void apply([{ type: 'remove', id: next }]); }}>{m['creative.delete']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>
