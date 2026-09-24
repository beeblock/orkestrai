<script lang="ts">
  import { untrack } from 'svelte';
  import { Check, X, MessageSquare, Play, Pause, RefreshCw, ExternalLink, Film, ChevronRight, CircleAlert, LoaderCircle, Volume2, Image as ImageIcon } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Slider } from '$lib/components/ui/slider';
  import { Switch } from '$lib/components/ui/switch';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import type { CreativeAssetInspection, CreativeAssetSummary, CreativeAssetReview } from '$lib/modules/creative-media/domain/asset-review.js';
  import * as m from '$lib/paraglide/messages.js';

  let { open = $bindable(false), workspaceId, initialNodeId, onOpenNode }: { open?: boolean; workspaceId: string; initialNodeId?: string; onOpenNode?: (id: string) => void } = $props();
  let assets = $state<CreativeAssetSummary[]>([]), selections = $state(['', '']);
  let inspections = $state<Array<CreativeAssetInspection | null>>([null, null]);
  let players = $state<Array<HTMLVideoElement | undefined>>([]);
  let durations = $state([0, 0]), time = $state(0), playing = $state(false), sound = $state<'A' | 'B'>('A');
  let decoded = $state([false, false]);
  let comments = $state(['', '']), scope = $state(true), busy = $state(false), loading = $state(false), error = $state('');
  let sequence = 0, paneSequence = [0, 0], transportSequence = 0;
  const endpoint = $derived(`/api/agent-room/workspaces/${workspaceId}/creative-media/assets`);
  const origin = $derived(assets.find(item => item.nodeId === initialNodeId));
  const visible = $derived(scope && origin?.groupId ? assets.filter(item => item.groupId === origin.groupId) : assets);
  const commonDuration = $derived(durations.every(value => value > 0) ? Math.min(...durations) : 0);
  const videoPair = $derived(inspections.every(item => item?.snapshot.media.mimeType.startsWith('video/')));
  const url = (asset: CreativeAssetSummary) => asset.type === 'video' ? `/api/agent-room/workspaces/${workspaceId}/creative-media/videos/${asset.nodeId}` : `/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(asset.path)}`;
  function stop() { transportSequence++; for (const player of players) player?.pause(); playing = false; }
  function decisionLabel(decision: CreativeAssetReview['decision']) {
    return { approved: m['creative_review.approved'], rejected: m['creative_review.rejected'], changes_requested: m['creative_review.changes'], proposed: m['creative_review.proposed'] }[decision]();
  }
  function status(item: CreativeAssetInspection | null) {
    if (!item?.review) return m['creative_review.unreviewed']();
    if (!item.reviewCurrent) return m['creative_review.stale']();
    return decisionLabel(item.review.decision);
  }
  async function inspect(index: number, nodeId: string) {
    stop(); durations[index] = 0; decoded[index] = false; selections[index] = nodeId; inspections[index] = null; comments[index] = ''; error = '';
    const token = sequence, pane = ++paneSequence[index], base = endpoint;
    if (!nodeId) return;
    try {
      const item = await creativeApi<CreativeAssetInspection>(`${base}?nodeId=${nodeId}`);
      if (open && token === sequence && pane === paneSequence[index] && nodeId === selections[index] && base === endpoint) inspections[index] = item;
    } catch (cause) { if (open && token === sequence && pane === paneSequence[index] && nodeId === selections[index]) error = (cause as Error).message; }
  }
  async function load() {
    const token = ++sequence; loading = true; error = ''; stop();
    try {
      const rows = await creativeApi<CreativeAssetSummary[]>(endpoint);
      if (!open || token !== sequence) return;
      assets = rows;
      const first = rows.find(item => item.nodeId === initialNodeId) ?? rows[0];
      const second = rows.find(item => item.nodeId !== first?.nodeId && item.type === first?.type && item.groupId === first?.groupId);
      await Promise.all([inspect(0, first?.nodeId ?? ''), inspect(1, second?.nodeId ?? '')]);
    } catch (cause) { if (token === sequence) error = (cause as Error).message; }
    finally { if (token === sequence) loading = false; }
  }
  const dialogContext = $derived(open ? `${workspaceId}:${initialNodeId ?? ''}` : '');
  $effect(() => { if (dialogContext) untrack(() => { void load(); }); else untrack(() => { sequence++; stop(); }); });
  async function decide(index: number, decision: CreativeAssetReview['decision']) {
    const current = inspections[index]; if (!current || busy || !decoded[index]) return;
    const token = sequence, base = endpoint;
    busy = true; error = '';
    try {
      const next = await creativeApi<CreativeAssetInspection>(base, 'POST', { command: 'decide', nodeId: current.asset.nodeId, expectedDigest: current.digest, revision: current.review?.revision ?? 0, decision, comment: comments[index] });
      if (open && token === sequence && base === endpoint && selections[index] === current.asset.nodeId) { inspections[index] = next; comments[index] = ''; }
    } catch (cause) { if (token === sequence) error = (cause as Error).message; }
    finally { busy = false; }
  }
  function seek(value: number) { time = value; for (const player of players) if (player) player.currentTime = Math.min(value, player.duration || 0); }
  async function togglePlay() {
    if (playing) return stop();
    if (!commonDuration || !videoPair) return;
    if (time >= commonDuration - 0.05) seek(0);
    const token = ++transportSequence;
    try { await Promise.all(players.map(player => player?.play())); if (open && token === transportSequence) playing = true; else for (const player of players) player?.pause(); }
    catch { if (token === transportSequence) { stop(); error = 'creative_reference_unavailable'; } }
  }
  function tick(index: number) {
    if (index !== 0 || !videoPair || !players[0]) return;
    time = players[0].currentTime;
    if (playing && time >= commonDuration) { stop(); seek(commonDuration); }
    else if (playing && players[1] && Math.abs(players[1].currentTime - time) > 0.12) players[1].currentTime = time;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid="creative-asset-review" class="flex h-[min(880px,calc(100dvh-24px))] w-[calc(100vw-24px)] min-w-0 flex-col gap-3 overflow-hidden sm:max-w-[1000px]">
    <Dialog.Header class="shrink-0 pr-8"><Dialog.Title>{m['creative_review.title']()}</Dialog.Title><Dialog.Description>{m['creative_review.description']()}</Dialog.Description></Dialog.Header>
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <label class="flex cursor-pointer items-center gap-2 text-ui-md text-[var(--app-text-soft)]"><Switch bind:checked={scope} disabled={!origin?.groupId} />{m['creative_review.related']()}</label>
      <div class="flex items-center gap-2">
        {#if loading}<span role="status" class="flex items-center gap-1.5 text-ui-md text-[var(--app-text-muted)]"><LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{m['creative.loading']()}</span>{/if}
        <Button variant="ghost" size="icon-sm" aria-label={m['creative.refresh']()} title={m['creative.refresh']()} disabled={busy || loading} onclick={load}><RefreshCw size={15} /></Button>
      </div>
    </div>
    <div class="grid min-h-0 flex-1 auto-rows-[minmax(430px,1fr)] grid-cols-1 gap-4 overflow-y-auto overscroll-contain sm:grid-cols-2">
      {#each selections as nodeId, index (index)}
        {@const inspection = inspections[index]}
        <section class="flex min-h-0 min-w-0 flex-col gap-2" aria-label={index === 0 ? 'A' : 'B'}>
          <div class="flex items-center gap-2"><span class="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--app-hover)] font-mono text-[12px] font-semibold text-[var(--app-text-soft)]" aria-hidden="true">{index === 0 ? 'A' : 'B'}</span><div class="min-w-0 flex-1"><ModelCombobox value={nodeId} options={visible.map(asset => ({ value: asset.nodeId, label: asset.title || asset.path }))} defaultLabel={m['creative_review.choose']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={`${m['creative_review.choose']()} ${index === 0 ? 'A' : 'B'}`} onValueChange={(value) => { if (!busy) void inspect(index, value); }} /></div></div>
          <div class="relative flex min-h-40 flex-1 items-center justify-center overflow-hidden rounded-lg bg-[var(--app-canvas)] shadow-[var(--app-shadow-border)]">
            {#if inspection}
              {#if inspection.snapshot.media.mimeType.startsWith('image/')}<img src={`${url(inspection.asset)}${url(inspection.asset).includes('?') ? '&' : '?'}v=${inspection.snapshot.media.sha256}`} alt={inspection.asset.title} draggable="false" class="absolute inset-0 h-full w-full object-contain" onload={() => decoded[index] = true} onerror={() => { decoded[index] = false; error = 'creative_reference_unavailable'; }} />
              {:else if inspection.snapshot.media.mimeType.startsWith('video/')}
                <!-- Comparison uses shared accessible transport below. Generated clips have no supplied captions. -->
                <!-- svelte-ignore a11y_media_has_caption -->
                <video bind:this={players[index]} src={url(inspection.asset)} controls={!videoPair} playsinline preload="metadata" muted={index === 0 ? sound !== 'A' : sound !== 'B'} class="absolute inset-0 h-full w-full object-contain" onloadedmetadata={(event) => { const value = event.currentTarget.duration; durations[index] = Number.isFinite(value) && value > 0 ? value : 0; decoded[index] = durations[index] > 0; }} ontimeupdate={() => tick(index)} onended={stop} onerror={() => { stop(); decoded[index] = false; error = 'creative_reference_unavailable'; }} aria-label={inspection.asset.title}></video>
              {:else}<audio controls onloadedmetadata={() => decoded[index] = true} onerror={() => { decoded[index] = false; error = 'creative_reference_unavailable'; }} preload="metadata" src={url(inspection.asset)} aria-label={inspection.asset.title} class="w-full"></audio>{/if}
            {:else}<span class="flex flex-col items-center gap-2 text-ui-md text-[var(--app-text-muted)]"><ImageIcon size={18} aria-hidden="true" />{m['creative_review.choose']()}</span>{/if}
          </div>
          <div class="flex shrink-0 items-center justify-between gap-2">
            <strong class={`review-status ${inspection?.reviewCurrent && inspection.review?.decision === 'approved' ? 'approved' : inspection?.review && !inspection.reviewCurrent ? 'stale' : inspection?.reviewCurrent && inspection.review?.decision === 'rejected' ? 'rejected' : ''}`}>{status(inspection)}</strong>
            {#if inspection}<Button variant="ghost" size="icon-sm" title={m['creative_review.open']()} aria-label={m['creative_review.open']()} onclick={() => { open = false; onOpenNode?.(nodeId); }}><ExternalLink size={14} /></Button>{/if}
          </div>
          <Textarea aria-label={`${m['creative_review.comment']()} ${index === 0 ? 'A' : 'B'}`} placeholder={m['creative_review.comment']()} bind:value={comments[index]} maxlength={8000} rows={2} class="min-h-14 shrink-0 resize-y text-[13px]" disabled={!inspection || busy} />
          <div class="flex shrink-0 flex-wrap items-center gap-1.5"><Button variant="outline" size="sm" disabled={!inspection || !decoded[index] || busy} onclick={() => decide(index, 'approved')}><Check size={14} class="text-[var(--app-success)]" aria-hidden="true" />{m['creative_review.approve']()}</Button><Button variant="outline" size="sm" disabled={!inspection || !decoded[index] || busy} onclick={() => decide(index, 'changes_requested')}><MessageSquare size={14} aria-hidden="true" />{m['creative_review.request_changes']()}</Button><Button variant="ghost" size="icon-sm" class="text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" disabled={!inspection || !decoded[index] || busy} title={m['creative_review.reject']()} aria-label={m['creative_review.reject']()} onclick={() => decide(index, 'rejected')}><X size={14} /></Button></div>
          {#if inspection}<details class="group shrink-0 text-ui-md"><summary class="flex cursor-pointer list-none items-center gap-1.5 text-[var(--app-text-muted)] hover:text-[var(--app-text)] [&::-webkit-details-marker]:hidden"><ChevronRight size={13} class="shrink-0 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />{m['creative_review.history']()} <span class="font-mono text-[11px] tabular-nums">({inspection.history.length})</span></summary><div class="grid max-h-28 gap-2 overflow-y-auto py-2 pl-5"><p class="font-mono text-[10.5px] break-all text-[var(--app-text-muted)]">{inspection.snapshot.media.path}</p>{#each inspection.snapshot.characters as character}<p>{character.name} · v{character.version}</p>{/each}{#each inspection.history as review}<p class="break-words"><strong class="font-medium">{decisionLabel(review.decision)}</strong> · {new Date(review.createdAt).toLocaleString()} · {review.actorType === 'user' ? m['creative_review.owner']() : m['creative_review.agent']()}<br />{review.comment}<br /><code class="font-mono text-[10.5px] break-all text-[var(--app-text-muted)]">{review.snapshot.media.sha256}</code></p>{/each}</div></details>{/if}
        </section>
      {/each}
    </div>
    {#if videoPair}<div class="flex shrink-0 flex-wrap items-center gap-3 rounded-lg bg-[var(--app-hover)] px-3 py-2"><Button variant="outline" size="icon-sm" disabled={!commonDuration} aria-label={playing ? m['creative_review.pause']() : m['creative_review.play']()} title={playing ? m['creative_review.pause']() : m['creative_review.play']()} onclick={togglePlay}>{#if playing}<Pause size={14} />{:else}<Play size={14} />{/if}</Button><div class="min-w-28 flex-1"><Slider type="single" value={time} min={0} max={commonDuration || 1} step={0.01} aria-label={m['creative_review.seek']()} onValueChange={(value: number) => seek(value)} /></div><span class="font-mono text-[11px] text-[var(--app-text-soft)] tabular-nums">{time.toFixed(1)} / {commonDuration.toFixed(1)} s</span><Button variant="outline" size="sm" onclick={() => sound = sound === 'A' ? 'B' : 'A'}><Volume2 size={14} aria-hidden="true" />{m['creative_review.audio']()} {sound}</Button></div>{/if}
    <div class="flex h-20 shrink-0 gap-2 overflow-x-auto overscroll-contain border-t border-[var(--app-border)] pt-2" aria-label={m['creative_review.variants']()}>
      {#each visible as asset}<button type="button" disabled={busy} class="variant-thumb" aria-current={selections.includes(asset.nodeId) ? 'true' : undefined} title={asset.title} aria-label={asset.title} onclick={() => inspect(1, asset.nodeId)}>{#if asset.type === 'image'}<img src={url(asset)} alt={asset.title} loading="lazy" draggable="false" class="h-full w-full object-contain" />{:else}<Film size={18} aria-hidden="true" /><span class="absolute inset-x-0 bottom-0 truncate bg-[var(--app-surface-raised)]/90 px-1 text-ui-xs">{asset.title}</span>{/if}</button>{/each}
    </div>
    {#if error}<p role="alert" class="flex shrink-0 items-start gap-2 rounded-lg bg-[var(--app-danger-soft)] px-3 py-2 text-ui-md leading-snug text-[var(--app-danger)]"><CircleAlert size={14} class="mt-px shrink-0" aria-hidden="true" /><span>{creativeError(error)}</span></p>{/if}
  </Dialog.Content>
</Dialog.Root>

<style>
  .review-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 500;
    color: var(--app-text-muted);
  }

  .review-status::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: currentColor;
  }

  .review-status.approved {
    color: var(--app-success);
  }

  .review-status.stale {
    color: var(--app-warning);
  }

  .review-status.rejected {
    color: var(--app-danger);
  }

  /* Miniatura de variante: selecionada ganha anel de acento. */
  .variant-thumb {
    position: relative;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 64px;
    overflow: hidden;
    border: 0;
    border-radius: 8px;
    background: var(--app-canvas);
    box-shadow: var(--app-shadow-border);
    color: var(--app-text-muted);
    cursor: pointer;
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .variant-thumb:hover:not(:disabled) {
    box-shadow: var(--app-shadow-border-hover);
  }

  .variant-thumb[aria-current='true'] {
    box-shadow: 0 0 0 2px var(--app-accent);
  }

  .variant-thumb:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: 2px;
  }
</style>
