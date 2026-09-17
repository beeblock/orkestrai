<script lang="ts">
  import { untrack } from 'svelte';
  import { defaults, superForm } from 'sveltekit-superforms';
  import { zod } from 'sveltekit-superforms/adapters';
  import { WandSparkles, Eraser, Film, Focus, Undo2 } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as RadioGroup from '$lib/components/ui/radio-group';
  import { Button } from '$lib/components/ui/button';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Slider } from '$lib/components/ui/slider';
  import ModelCombobox from './canvas/ModelCombobox.svelte';
  import { creativeApi, creativeError } from './creative-media-client.js';
  import { creativeEditSchema, type CreativeEdit } from '$lib/modules/creative-media/contracts/schemas/creative-edit.schema.js';
  import type { CreativeAssetInspection } from '$lib/modules/creative-media/domain/asset-review.js';
  import * as m from '$lib/paraglide/messages.js';
  let { open = $bindable(false), workspaceId, nodeId, onOpenNode }: { open?: boolean; workspaceId: string; nodeId: string; onOpenNode?: (id: string) => void } = $props();
  const id = $props.id();
  const adapter = zod(creativeEditSchema as unknown as Parameters<typeof zod>[0]);
  const { form } = superForm<CreativeEdit>(defaults({ operation: 'variation', direction: '', count: 1, executorNodeId: null }, adapter) as never, { id: untrack(() => `creative-edit-${nodeId}`), SPA: true, validators: adapter as never, resetForm: false });
  let source = $state<CreativeAssetInspection | null>(null), busy = $state(false), loading = $state(false), error = $state('');
  let executors = $state<Array<{ value: string; label: string }>>([]), region = $state({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 });
  let dimensions = $state({ width: 0, height: 0 }), imageElement = $state<HTMLImageElement>(null!);
  let sequence = 0, drag: { x: number; y: number; pointerId: number } | null = null;
  const endpoint = $derived(`/api/agent-room/workspaces/${workspaceId}/creative-media/assets`);
  const operations = $derived([{ value: 'variation', label: m['creative_edit.variation'](), icon: WandSparkles }, { value: 'remove_background', label: m['creative_edit.remove_background'](), icon: Eraser }, { value: 'annotated_change', label: m['creative_edit.annotated_change'](), icon: Focus }, { value: 'animate', label: m['creative_edit.animate'](), icon: Film }]);
  async function load() {
    const token = ++sequence; loading = true; error = ''; source = null; dimensions = { width: 0, height: 0 };
    $form = { operation: 'variation', direction: '', count: 1, executorNodeId: null };
    try {
      const [inspection, nodes] = await Promise.all([creativeApi<CreativeAssetInspection>(`${endpoint}?nodeId=${nodeId}`), creativeApi<Array<{ id: string; type: string; title: string; payload: { provider?: string } }>>(`/api/agent-room/workspaces/${workspaceId}/nodes`)]);
      if (!open || token !== sequence) return;
      source = inspection; executors = nodes.filter(node => node.type === 'terminal' && node.payload.provider === 'codex').map(node => ({ value: node.id, label: node.title }));
    } catch (cause) { if (token === sequence) error = (cause as Error).message; }
    finally { if (token === sequence) loading = false; }
  }
  const dialogContext = $derived(open ? `${workspaceId}:${nodeId}` : '');
  $effect(() => { if (dialogContext) untrack(() => void load()); else sequence++; });
  function point(event: PointerEvent) { const rect = imageElement.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; }
  function start(event: PointerEvent) { if (busy || $form.operation !== 'annotated_change' || !dimensions.width) return; event.preventDefault(); drag = { ...point(event), pointerId: event.pointerId }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); }
  function move(event: PointerEvent) { if (!drag || event.pointerId !== drag.pointerId) return; const p = point(event); region = { x: Math.min(0.999, p.x, drag.x), y: Math.min(0.999, p.y, drag.y), width: Math.max(0.001, Math.abs(p.x - drag.x)), height: Math.max(0.001, Math.abs(p.y - drag.y)) }; }
  function setRegion(field: keyof typeof region, percent: number) {
    region = { ...region, [field]: percent / 100 };
    region.x = Math.min(region.x, 1 - region.width); region.y = Math.min(region.y, 1 - region.height);
  }
  async function prepare() {
    if (!source || busy || !dimensions.width) return;
    const token = sequence, base = endpoint;
    const parsed = creativeEditSchema.safeParse({ ...$form, ...($form.operation === 'annotated_change' ? { annotation: { ...region, sourceWidth: dimensions.width, sourceHeight: dimensions.height } } : {}) });
    if (!parsed.success) { error = 'creative_invalid_input'; return; }
    busy = true; error = '';
    try {
      const result = await creativeApi<{ nodeId: string }>(base, 'POST', { command: 'prepare', nodeId, expectedDigest: source.digest, edit: parsed.data });
      if (open && token === sequence && base === endpoint) { open = false; onOpenNode?.(result.nodeId); }
    } catch (cause) { if (token === sequence) error = (cause as Error).message; }
    finally { busy = false; }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content data-testid="creative-asset-actions" class="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] min-w-0 flex-col gap-3 overflow-hidden sm:max-w-4xl">
    <Dialog.Header class="pr-6"><Dialog.Title>{m['creative_edit.title']()}</Dialog.Title><Dialog.Description>{m['creative_edit.description']()}</Dialog.Description></Dialog.Header>
    <RadioGroup.Root value={$form.operation} onValueChange={(value) => { if (value) $form.operation = value as CreativeEdit['operation']; }} class="flex shrink-0 flex-wrap justify-start gap-2" disabled={busy} aria-label={m['creative_edit.title']()}>
      {#each operations as operation}<div class="relative"><RadioGroup.Item id={`${id}-${operation.value}`} value={operation.value} class="peer absolute inset-0 z-10 h-full w-full rounded opacity-0 after:hidden" /><label for={`${id}-${operation.value}`} class="pointer-events-none flex min-h-9 items-center justify-center gap-2 rounded border border-[var(--app-border)] px-3 py-2 text-xs text-[var(--app-text-soft)] peer-aria-checked:border-[var(--app-accent)] peer-aria-checked:bg-[var(--app-accent-soft)] peer-aria-checked:text-[var(--app-text)] peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--app-accent)] peer-disabled:opacity-50"><operation.icon size={15} />{operation.label}</label></div>{/each}
    </RadioGroup.Root>
    <div class="grid min-h-0 gap-4 overflow-y-auto overscroll-contain sm:grid-cols-[minmax(0,1fr)_260px]">
      <div class="flex min-h-40 min-w-0 items-center justify-center overflow-hidden rounded border bg-[var(--app-canvas)] p-2">
        {#if source}<div class="relative inline-block max-w-full">
          <img bind:this={imageElement} src={`/api/agent-room/workspaces/${workspaceId}/fs/raw?path=${encodeURIComponent(source.snapshot.media.path)}&v=${source.snapshot.media.sha256}`} alt={source.asset.title} draggable="false" class="block h-auto max-h-[48dvh] w-auto max-w-full" onload={(event) => dimensions = { width: (event.currentTarget as HTMLImageElement).naturalWidth, height: (event.currentTarget as HTMLImageElement).naturalHeight }} onerror={() => { dimensions = { width: 0, height: 0 }; error = 'creative_reference_unavailable'; }} />
          {#if $form.operation === 'annotated_change'}<button type="button" class="absolute inset-0 cursor-crosshair touch-none" aria-label={m['creative_edit.region']()} onpointerdown={start} onpointermove={move} onpointerup={() => drag = null} onpointercancel={() => drag = null} onlostpointercapture={() => drag = null}><span class="pointer-events-none absolute border-2 border-cyan-400 bg-cyan-500/15 shadow-[0_0_0_1px_black]" style={`left:${region.x * 100}%;top:${region.y * 100}%;width:${region.width * 100}%;height:${region.height * 100}%`}></span></button>{/if}
        </div>{:else}<span role="status" class="text-xs">{m['creative.loading']()}</span>{/if}
      </div>
      <div class="min-w-0 space-y-3">
        {#if $form.operation !== 'remove_background'}<label class="block space-y-1 text-xs"><span>{m['creative.prompt']()}</span><Textarea bind:value={$form.direction} rows={5} maxlength={16000} disabled={busy} /></label>{/if}
        {#if $form.operation !== 'animate'}
          <label class="block space-y-1 text-xs"><span>{m['storyboard.executor']()}</span><ModelCombobox value={$form.executorNodeId ?? ''} options={executors} defaultLabel={m['storyboard.unassigned']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['storyboard.executor']()} fieldProps={{ disabled: busy }} onValueChange={(value) => $form.executorNodeId = value || null} /></label>
          <div class="space-y-2 text-xs"><span>{m['creative_edit.count']()} · {$form.count}</span><Slider type="single" bind:value={$form.count} min={1} max={10} step={1} disabled={busy} aria-label={m['creative_edit.count']()} /></div>
        {/if}
        {#if $form.operation === 'annotated_change'}
          {#each ['x', 'y', 'width', 'height'] as field}{@const key = field as keyof typeof region}<div class="space-y-1 text-xs"><label for={`region-${nodeId}-${key}`}>{key === 'width' ? m['creative_edit.width']() : key === 'height' ? m['creative_edit.height']() : key.toUpperCase()} · {Math.round(region[key] * 100)}%</label><Slider id={`region-${nodeId}-${key}`} type="single" value={region[key] * 100} min={key === 'width' || key === 'height' ? 1 : 0} max={100} step={1} disabled={busy} onValueChange={(value: number) => setRegion(key, value)} /></div>{/each}
          <Button size="icon-sm" variant="ghost" aria-label={m['creative_edit.reset']()} title={m['creative_edit.reset']()} onclick={() => region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }}><Undo2 size={14} /></Button>
        {/if}
      </div>
    </div>
    {#if error}<p role="alert" class="text-xs text-destructive">{creativeError(error)}</p>{/if}
    <Dialog.Footer class="shrink-0"><Button variant="outline" disabled={busy} onclick={() => open = false}>{m['dlg.cancel']()}</Button><Button disabled={busy || loading || !dimensions.width || ($form.operation !== 'remove_background' && !$form.direction.trim())} onclick={prepare}><WandSparkles size={15} />{m['creative_edit.prepare']()}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
