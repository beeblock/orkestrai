<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { Film, Plus, Play, Pause, Save, Undo2, ArrowUp, ArrowDown, Trash2, Download, Square, ExternalLink, RefreshCw, X, Maximize2, Minimize2, LoaderCircle, TriangleAlert, Cpu } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Slider } from '$lib/components/ui/slider';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import NodeEmptyState from './NodeEmptyState.svelte';
  import ModelCombobox from './ModelCombobox.svelte';
  import { creativeApi, creativeError } from '../creative-media-client.js';
  import type { CreativeSequence } from '$lib/modules/creative-media/domain/sequence.js';
  import { sequenceDuration } from '$lib/modules/creative-media/domain/sequence.js';
  import { sequenceOperationSchema, type SequenceOperation } from '$lib/modules/creative-media/contracts/schemas/creative-sequence.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  type Read = { sequence: CreativeSequence; runtime: { installed: boolean; installing: boolean; supported: boolean; error: string | null }; inputs: Array<{ id: string; title: string; path: string }> };
  type Data = { title: string; workspaceId: string; payload: { revision?: number }; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, value: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let result = $state<Read | null>(null), selectedId = $state(''), inputId = $state(''), busy = $state(false), error = $state(''), dirty = $state(false), conflict = $state(false);
  let trimIn = $state(0), trimOut = $state(1), volume = $state(1), caption = $state(''), video = $state<HTMLVideoElement>(), playing = $state(false), installOpen = $state(false);
  let preview = $state<HTMLDivElement>(), fullscreen = $state(false);
  let mounted = false, refreshing = false, generation = 0, requestKey: string | null = null;
  const endpoint = $derived(`/api/agent-room/workspaces/${data.workspaceId}/creative-media/sequences`);
  const sequence = $derived(result?.sequence), clips = $derived(sequence?.document.clips ?? []), clip = $derived(clips.find(item => item.id === selectedId));
  const running = $derived(sequence?.export?.state === 'running');
  const source = $derived(clip ? `/api/agent-room/workspaces/${data.workspaceId}/fs/raw?path=${encodeURIComponent(clip.path)}` : '');
  function select(next: string) { if (dirty) return; selectedId = next; const item = clips.find(value => value.id === next); if (item) { trimIn = item.in; trimOut = item.out; volume = item.volume; caption = item.caption; } }
  async function refresh(reset = false) {
    if (refreshing || busy) return; refreshing = true; const token = generation;
    try { const value = await creativeApi<Read>(`${endpoint}?nodeId=${id}`); if (!mounted || token !== generation) return;
      if (dirty && !reset) { conflict = value.sequence.revision !== sequence?.revision; if (result) { result.sequence.export = value.sequence.export; result.runtime = value.runtime; } }
      else {
        const unchanged = sequence?.revision === value.sequence.revision;
        result = value; dirty = false; conflict = false;
        if (!unchanged || reset || !clips.some(item => item.id === selectedId)) select(clips.some(item => item.id === selectedId) ? selectedId : clips[0]?.id ?? '');
      }
    } catch (cause) { if (mounted && token === generation) error = (cause as Error).message; } finally { refreshing = false; }
  }
  onMount(() => { mounted = true; void refresh(); const onFullscreen = () => fullscreen = Boolean(preview && document.fullscreenElement === preview); document.addEventListener('fullscreenchange', onFullscreen); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3000); return () => { mounted = false; generation++; clearInterval(timer); document.removeEventListener('fullscreenchange', onFullscreen); if (preview && document.fullscreenElement === preview) void document.exitFullscreen().catch(() => undefined); video?.pause(); }; });
  $effect(() => { const revision = data.payload.revision; if (mounted && revision && revision !== sequence?.revision) untrack(() => { void refresh(); }); });
  async function command(command: string, extra: Record<string, unknown> = {}) {
    if (!sequence || busy) return; busy = true; error = ''; generation++; playing = false; video?.pause();
    try { await creativeApi(endpoint, 'POST', { command, nodeId: id, revision: sequence.revision, ...extra }); dirty = false; conflict = false; }
    catch (cause) { error = (cause as Error).message; if (error === 'creative_revision_conflict') conflict = true; }
    finally { busy = false; await refresh(); }
  }
  const apply = (operation: SequenceOperation) => command('apply', { operations: [sequenceOperationSchema.parse(operation)] });
  async function save() { if (!clip || trimOut <= trimIn) { error = 'creative_sequence_trim_invalid'; return; } await apply({ type: 'update', clipId: clip.id, patch: { in: trimIn, out: trimOut, volume, caption } }); }
  function ready() { if (!video || !clip) return; video.currentTime = trimIn; video.volume = Math.min(1, volume); if (playing) void video.play().catch(() => { playing = false; }); }
  function advance() { if (!playing || !clip) return; const next = clips[clips.findIndex(value => value.id === clip.id) + 1]; if (next) select(next.id); else { playing = false; video?.pause(); } }
  function togglePlayback() { if (!video || !clip) return; playing = !playing; if (!playing) video.pause(); else { if (video.currentTime < trimIn || video.currentTime >= trimOut) video.currentTime = trimIn; video.volume = Math.min(1, volume); void video.play().catch(() => { playing = false; error = 'creative_sequence_source_invalid'; }); } }
  function markDirty() { dirty = true; playing = false; video?.pause(); error = ''; }
  async function exportVideo() { requestKey ??= crypto.randomUUID(); await command('export', { idempotencyKey: requestKey }); if (!error) requestKey = null; }
  async function installRuntime() { installOpen = false; await command('install_runtime'); }
  async function toggleFullscreen() { try { if (fullscreen) await document.exitFullscreen(); else await preview?.requestFullscreen(); } catch { error = 'creative_request_failed'; } }
  // Arrastar-e-soltar na lista usa a mesma operacao 'move' das setas.
  let dragClip = $state(''), dropClip = $state<string | null>(null);
  const canReorder = $derived(!busy && !dirty && !running);
  function dropOn(index: number) { const clipId = dragClip; dragClip = ''; dropClip = null; if (clipId && canReorder && clips[index]?.id !== clipId) void apply({ type: 'move', clipId, index }); }
  const dragFrom = $derived(clips.findIndex(item => item.id === dragClip));
  const exportLabel = $derived(!sequence?.export ? '' : sequence.export.state === 'running' ? m['sequence.exporting']() : sequence.export.state === 'completed' ? m['creative.completed']() : sequence.export.state === 'cancelled' ? m['creative.cancelled']() : m['creative.failed']());
</script>

<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={560} minHeight={440} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Film size={14} />{/snippet}
  {#snippet title()}{data.title || m['sequence.title']()}{/snippet}
  {#snippet actions()}<HeaderIconButton class="node-action-btn" label={m['creative.refresh']()} onclick={() => refresh()}><RefreshCw size={13} /></HeaderIconButton><HeaderIconButton class="node-action-btn" label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={13} /></HeaderIconButton>{/snippet}
  <div data-testid="video-sequence" class="sq nodrag nowheel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--app-surface)] text-[var(--app-text)]">
    {#if result && sequence}
      {#if !result.runtime.installed}
        <!-- Pre-requisito como aviso calmo com a acao ao lado, nao uma linha solta. -->
        <div class="sq-callout">
          <span class="sq-callout-icon" aria-hidden="true">{#if result.runtime.installing}<LoaderCircle size={15} class="animate-spin" />{:else}<Cpu size={15} />{/if}</span>
          <span class="min-w-0 flex-1 text-ui-md leading-[1.45] text-pretty text-[var(--app-text-soft)]">{result.runtime.installing ? m['sequence.installing']() : m['sequence.runtime_required']()}</span>
          <Button size="sm" variant="outline" disabled={busy || result.runtime.installing || !result.runtime.supported} onclick={() => installOpen = true}><Download size={14} />{m['sequence.install']()}</Button>
          {#if result.runtime.error}<p role="alert" class="basis-full text-ui-md text-[var(--app-danger)]">{creativeError(result.runtime.error)}</p>{/if}
        </div>
      {/if}
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--sq-line)] px-3 py-2">
        <span class="mr-auto text-ui-md text-[var(--app-text-soft)] tabular-nums">{clips.length} {m['sequence.clips']()} <span class="text-[var(--app-text-muted)]">·</span> <span class="font-mono text-ui-sm">{sequenceDuration(sequence.document).toFixed(2)}s</span></span>
        <div class="w-44 min-w-0"><ModelCombobox value={`${sequence.document.width}x${sequence.document.height}`} options={[{ value: '1920x1080', label: '16:9 · 1920×1080' }, { value: '1080x1920', label: '9:16 · 1080×1920' }, { value: '1080x1080', label: '1:1 · 1080×1080' }]} defaultLabel={`${sequence.document.width}×${sequence.document.height}`} ariaLabel={m['creative.ratio']()} searchPlaceholder={m['creative.ratio']()} emptyLabel={m['creative.no_inputs']()} fieldProps={{ disabled: busy || dirty || running }} onValueChange={(value) => { if (!value) return; const [width, height] = value.split('x').map(Number); void apply({ type: 'settings', width, height }); }} /></div>
        <div class="w-24 min-w-0"><ModelCombobox value={String(sequence.document.fps)} options={[24,25,30].map(value => ({ value: String(value), label: `${value} fps` }))} defaultLabel="30 fps" ariaLabel={m['sequence.fps']()} searchPlaceholder={m['sequence.fps']()} emptyLabel={m['creative.no_inputs']()} fieldProps={{ disabled: busy || dirty || running }} onValueChange={(value) => { if (value) void apply({ type: 'settings', fps: Number(value) as 24 | 25 | 30 }); }} /></div>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(170px,30%)_minmax(0,1fr)] overflow-hidden">
        <div class="flex min-h-0 flex-col border-r border-[var(--sq-line)] bg-[var(--app-surface-subtle)]">
          <div class="flex flex-col gap-2 border-b border-[var(--sq-line)] p-2">
            <ModelCombobox value={inputId} options={result.inputs.map(item => ({ value: item.id, label: item.title }))} defaultLabel={m['sequence.choose_video']()} ariaLabel={m['sequence.choose_video']()} searchPlaceholder={m['sequence.choose_video']()} emptyLabel={m['sequence.no_videos']()} fieldProps={{ disabled: busy || dirty || running }} onValueChange={(value) => inputId = value} />
            <Button class="w-full" size="sm" variant="outline" disabled={!inputId || busy || dirty || running || !result.runtime.installed || clips.length >= 30} onclick={() => apply({ type: 'add', nodeId: inputId })}><Plus size={14} />{m['sequence.add']()}</Button>
          </div>
          <nav aria-label={m['sequence.clips']()} class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-2">
            {#each clips as item, index}
              <button
                type="button"
                aria-current={item.id === selectedId ? 'step' : undefined}
                disabled={dirty || busy}
                draggable={canReorder}
                class="sq-clip"
                class:dragging={dragClip === item.id}
                class:drop-before={dropClip === item.id && dragFrom > index}
                class:drop-after={dropClip === item.id && dragFrom < index}
                onclick={() => { playing = false; video?.pause(); select(item.id); }}
                ondragstart={(event) => { dragClip = item.id; event.stopPropagation(); event.dataTransfer?.setData('text/x-orkestrai-clip', item.id); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; }}
                ondragover={(event) => { if (dragClip && canReorder) { event.preventDefault(); event.stopPropagation(); dropClip = item.id; } }}
                ondragleave={() => { if (dropClip === item.id) dropClip = null; }}
                ondrop={(event) => { event.preventDefault(); event.stopPropagation(); dropOn(index); }}
                ondragend={() => { dragClip = ''; dropClip = null; }}
              ><strong class="block text-ui-md font-medium break-words text-[var(--app-text)]">{index + 1}. {item.title}</strong><span class="font-mono text-[11px] text-[var(--app-text-muted)] tabular-nums">{(item.out - item.in).toFixed(2)}s · {Math.round(item.volume * 100)}%</span>{#if item.caption}<span class="mt-0.5 block line-clamp-2 text-ui-sm text-[var(--app-text-muted)]">{item.caption}</span>{/if}</button>
            {/each}
          </nav>
          {#if clips.length > 1}<p class="shrink-0 px-3 pb-2 text-ui-xs text-[var(--app-text-muted)]">{m['sequence.drag_hint']()}</p>{/if}
        </div>
        <section aria-label={m['sequence.preview']()} class="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
          {#if clip}<div bind:this={preview} class="sq-stage relative mx-auto flex h-52 min-h-40 w-full shrink-0 items-center justify-center [&:fullscreen]:h-screen [&:fullscreen]:w-screen"><div class="relative h-full max-w-full [container-type:inline-size]" style:aspect-ratio={`${sequence.document.width}/${sequence.document.height}`}>
            {#key clip.id}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video bind:this={video} src={source} preload="metadata" playsinline class="h-full w-full object-contain" onloadedmetadata={ready} ontimeupdate={() => { if (playing && video && video.currentTime >= trimOut) advance(); }} onended={advance} onerror={() => error = 'creative_sequence_source_invalid'}></video>
            {/key}
            <!-- Legenda em branco com contorno preto e Arial: reproduz a legenda
                 queimada no MP4 exportado (SequenceEncoder), por isso nao segue o tema. -->
            {#if caption}<div class="pointer-events-none absolute inset-x-[10%] bottom-[10%] whitespace-pre-wrap break-words text-center leading-tight text-white [font-family:Arial,sans-serif] [text-shadow:0_1px_3px_black]" style:font-size={`${Math.round(Math.min(sequence.document.width, sequence.document.height) * 0.038) / sequence.document.width * 100}cqw`}>{caption}</div>{/if}
          </div><div class="sq-stage-controls absolute top-2 right-2 flex gap-0.5 rounded-lg p-0.5"><Button variant="ghost" size="icon-sm" class="text-[var(--app-text-soft)]" aria-label={m['desktop.fullscreen']()} title={m['desktop.fullscreen']()} aria-pressed={fullscreen} onclick={toggleFullscreen}>{#if fullscreen}<Minimize2 size={15} />{:else}<Maximize2 size={15} />{/if}</Button>{#if fullscreen}<Button variant="ghost" size="icon-sm" class="text-[var(--app-text-soft)]" disabled={busy || dirty} aria-label={playing ? m['sequence.pause']() : m['sequence.play']()} title={playing ? m['sequence.pause']() : m['sequence.play']()} onclick={togglePlayback}>{#if playing}<Pause size={15} />{:else}<Play size={15} />{/if}</Button>{/if}</div></div><div class="flex shrink-0 items-center justify-between gap-1 border-b border-[var(--sq-line)] px-2 py-1"><Button variant="ghost" size="icon-sm" disabled={busy || dirty} aria-label={playing ? m['sequence.pause']() : m['sequence.play']()} title={playing ? m['sequence.pause']() : m['sequence.play']()} onclick={togglePlayback}>{#if playing}<Pause size={15} />{:else}<Play size={15} />{/if}</Button><span class="font-mono text-ui-sm text-[var(--app-text-soft)] tabular-nums">{trimIn.toFixed(2)}s → {trimOut.toFixed(2)}s</span><div class="flex text-[var(--app-text-muted)]"><Button variant="ghost" size="icon-sm" title={m['sequence.up']()} aria-label={m['sequence.up']()} disabled={busy || dirty || running || clips[0]?.id === clip.id} onclick={() => apply({ type: 'move', clipId: clip.id, index: clips.findIndex(item => item.id === clip.id) - 1 })}><ArrowUp size={14} /></Button><Button variant="ghost" size="icon-sm" title={m['sequence.down']()} aria-label={m['sequence.down']()} disabled={busy || dirty || running || clips.at(-1)?.id === clip.id} onclick={() => apply({ type: 'move', clipId: clip.id, index: clips.findIndex(item => item.id === clip.id) + 1 })}><ArrowDown size={14} /></Button><Button variant="ghost" size="icon-sm" class="hover:bg-[var(--app-danger-soft)] hover:text-[var(--app-danger)]" title={m['sequence.remove']()} aria-label={m['sequence.remove']()} disabled={busy || dirty || running} onclick={() => apply({ type: 'remove', clipId: clip.id })}><Trash2 size={14} /></Button></div></div>
            <fieldset disabled={busy || running} class="flex flex-col gap-4 p-3 text-ui-md">
              <div class="flex flex-col gap-2.5"><div class="flex items-baseline justify-between gap-2"><label for={`in-${id}`} class="text-[var(--app-text-soft)]">{m['sequence.in']()}</label><span class="font-mono text-ui-sm text-[var(--app-text)] tabular-nums">{trimIn.toFixed(2)}s</span></div><Slider disabled={busy || running} id={`in-${id}`} type="single" value={trimIn} min={0} max={Math.max(0, trimOut - 0.05)} step={0.01} aria-label={m['sequence.in']()} onValueChange={(value: number) => { trimIn = value; markDirty(); if (video) video.currentTime = value; }} /></div>
              <div class="flex flex-col gap-2.5"><div class="flex items-baseline justify-between gap-2"><label for={`out-${id}`} class="text-[var(--app-text-soft)]">{m['sequence.out']()}</label><span class="font-mono text-ui-sm text-[var(--app-text)] tabular-nums">{trimOut.toFixed(2)}s</span></div><Slider disabled={busy || running} id={`out-${id}`} type="single" value={trimOut} min={trimIn + 0.05} max={clip.sourceDuration} step={0.01} aria-label={m['sequence.out']()} onValueChange={(value: number) => { trimOut = value; markDirty(); }} /></div>
              <div class="flex flex-col gap-2.5"><div class="flex items-baseline justify-between gap-2"><label for={`volume-${id}`} class="text-[var(--app-text-soft)]">{m['sequence.volume']()}</label><span class="font-mono text-ui-sm text-[var(--app-text)] tabular-nums">{Math.round(volume * 100)}%</span></div><Slider disabled={busy || running} id={`volume-${id}`} type="single" value={volume} min={0} max={1} step={0.01} aria-label={m['sequence.volume']()} onValueChange={(value: number) => { volume = value; markDirty(); }} /></div>
              <label class="flex flex-col gap-1.5"><span class="text-[var(--app-text-soft)]">{m['sequence.caption']()}</span><Textarea bind:value={caption} maxlength={500} oninput={markDirty} /></label>
              <div class="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={!dirty || busy} onclick={() => refresh(true)}><Undo2 size={14} />{m['storyboard.discard']()}</Button><Button size="sm" class="sq-primary" disabled={!dirty || busy || conflict} onclick={save}><Save size={14} />{m['creative.save']()}</Button></div>
            </fieldset>
          {:else}<NodeEmptyState icon={Film} title={m['sequence.empty']()} description={m['sequence.empty_hint']()} />{/if}
        </section>
      </div>
      <footer class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--sq-line)] px-3 py-2">
        <div class="min-w-0 flex-1 text-ui-md">
          {#if sequence.export}
            <div class="flex min-w-0 items-center gap-2" data-state={sequence.export.state}>
              <span class="sq-export-state">{#if running}<LoaderCircle size={12} class="animate-spin" />{/if}{exportLabel}</span>
              {#if running}<span class="sq-progress" aria-hidden="true"><span style:width={`${sequence.export.progress}%`}></span></span>{/if}
              <span class="font-mono text-ui-sm text-[var(--app-text-muted)] tabular-nums">{sequence.export.progress}%</span>
            </div>
            {#if sequence.export.error}<p role="alert" class="mt-1 text-[var(--app-danger)]">{creativeError(sequence.export.error)}</p>{/if}
            {#if sequence.export.revision !== sequence.revision}<p class="mt-1 text-ui-sm text-[var(--app-text-muted)]">{m['sequence.older_export']()}</p>{/if}
          {/if}
        </div>
        <div class="flex gap-2">{#if sequence.export?.outputNodeId}<Button size="sm" variant="outline" onclick={() => data.onJumpToNode?.(sequence!.export!.outputNodeId!)}><ExternalLink size={14} />{m['sequence.open_export']()}</Button>{/if}{#if running}<Button size="sm" variant="outline" disabled={busy} onclick={() => command('cancel')}><Square size={14} />{m['creative.cancel']()}</Button>{:else}<Button size="sm" class="sq-primary" disabled={busy || dirty || !clips.length || !result.runtime.installed} onclick={exportVideo}><Download size={14} />{m['sequence.export']()}</Button>{/if}</div>
      </footer>
    {:else}
      <div class="grid flex-1 place-items-center p-4"><span class="sq-loading" role="status"><LoaderCircle size={13} class="animate-spin" />{m['creative.loading']()}</span></div>
    {/if}
    {#if conflict}<p role="alert" class="sq-alert warning"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />{m['storyboard.conflict']()}</p>{/if}
    {#if error}<p role="alert" class="sq-alert"><TriangleAlert size={13} class="mt-px shrink-0" aria-hidden="true" />{creativeError(error)}</p>{/if}
  </div>
</NodeShell>
<AlertDialog.Root bind:open={installOpen}><AlertDialog.Content><AlertDialog.Header><AlertDialog.Title>{m['sequence.install']()}</AlertDialog.Title><AlertDialog.Description>{m['sequence.install_help']()}</AlertDialog.Description></AlertDialog.Header><a class="text-sm underline" href="https://ffmpeg.org/legal.html" target="_blank" rel="noreferrer">FFmpeg · GPL-3.0-or-later</a><AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={installRuntime}>{m['sequence.install']()}</AlertDialog.Action></AlertDialog.Footer></AlertDialog.Content></AlertDialog.Root>

<style>
  .sq {
    --sq-line: color-mix(in srgb, var(--app-border) 80%, transparent);
  }

  /* Primaria indisponivel fica neutra (nao um dourado desbotado). */
  .sq :global(.sq-primary:disabled) {
    background: var(--app-hover);
    color: var(--app-text-muted);
    opacity: 1;
  }

  .sq-callout {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin: 10px 12px 0;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--app-surface-subtle);
    box-shadow: var(--app-shadow-border);
  }

  .sq-callout-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text-soft);
  }

  .sq-clip {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 7px 9px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-quick) ease-out, box-shadow var(--duration-quick) ease-out, opacity var(--duration-quick) ease-out;
  }

  .sq-clip:hover:not(:disabled) {
    background: var(--app-hover);
  }

  /* Clipe atual: tom do no (secundario), nao o dourado da acao principal. */
  .sq-clip[aria-current='step'] {
    background: color-mix(in srgb, var(--app-secondary) 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-secondary) 45%, transparent);
  }

  .sq-clip:disabled {
    cursor: default;
  }

  .sq-clip:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .sq-clip.dragging {
    opacity: 0.5;
  }

  /* Linha de insercao: mostra onde o clipe vai cair antes de soltar. */
  .sq-clip.drop-before {
    box-shadow: inset 0 2px 0 var(--app-secondary);
  }

  .sq-clip.drop-after {
    box-shadow: inset 0 -2px 0 var(--app-secondary);
  }

  .sq-stage {
    background: var(--app-canvas);
  }

  /* Tela cheia e so video: fundo preto como em qualquer player. */
  .sq-stage:fullscreen {
    background: #000;
  }

  .sq-stage-controls {
    background: color-mix(in srgb, var(--app-surface-raised) 90%, transparent);
    box-shadow: var(--app-shadow-overlay);
    backdrop-filter: blur(6px);
    opacity: 0;
    transition: opacity var(--duration-quick) ease-out;
  }

  .sq-stage:hover .sq-stage-controls,
  .sq-stage:focus-within .sq-stage-controls,
  .sq-stage:fullscreen .sq-stage-controls {
    opacity: 1;
  }

  .sq-export-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 11.5px;
    font-weight: 500;
    white-space: nowrap;
  }

  [data-state='completed'] .sq-export-state {
    background: var(--app-success-soft);
    color: var(--app-success);
  }

  [data-state='failed'] .sq-export-state {
    background: var(--app-danger-soft);
    color: var(--app-danger);
  }

  [data-state='running'] .sq-export-state {
    background: var(--app-info-soft);
    color: var(--app-info);
  }

  .sq-progress {
    position: relative;
    flex: 1;
    max-width: 140px;
    height: 4px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--app-hover);
  }

  .sq-progress > span {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--app-info);
    transition: width var(--duration-slow) var(--ease-smooth-out);
  }

  .sq-loading {
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

  .sq-alert {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-top: 1px solid var(--sq-line);
    background: var(--app-danger-soft);
    color: var(--app-danger);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .sq-alert.warning {
    background: var(--app-warning-soft);
    color: var(--app-warning);
  }
</style>
