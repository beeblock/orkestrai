<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import { Film, Settings2, Save, Play, RefreshCw, Square, RotateCcw, X, Download, Plus } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Switch } from '$lib/components/ui/switch';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import * as m from '$lib/paraglide/messages.js';
  import { CREATIVE_MODELS, ACTIVE_CREATIVE_STATUSES, type CreativeModelId } from '$lib/modules/creative-media/domain/catalog.js';
  import { creativeConfigSchema, type CreativeConfig } from '$lib/modules/creative-media/contracts/schemas/creative-media.schema.js';
  import type { CreativeProfile, CreativeWorkflow, CreativeRun, CreativePreview } from '$lib/modules/creative-media/domain/types.js';
  import { creativeApi, creativeStatus, creativeError } from '../creative-media-client.js';
  import CreativeProviderDialog from '../CreativeProviderDialog.svelte';
  import CreativeCharacterBindings from '../CreativeCharacterBindings.svelte';
  import CreativePrompt from '../CreativePrompt.svelte';
  import CreativeShotControls from '../CreativeShotControls.svelte';
  import { switchCreativeModel, expandLegacyCreativeModel } from '$lib/modules/creative-media/domain/creative-model-switch.js';
  import type { CreativeCharacter } from '$lib/modules/creative-media/domain/character.js';
  import NodeShell, { type NodeConnection } from './NodeShell.svelte';
  import HeaderIconButton from './HeaderIconButton.svelte';
  import ModelCombobox from './ModelCombobox.svelte';
  import CreativeModelFields from './CreativeModelFields.svelte';
  import CreativeModelPicker from './CreativeModelPicker.svelte';
  import { modelDefaults, modelMediaSlots, modelPromptField, concreteSchema, type FalModelSummary, type FalModelContract } from '$lib/modules/creative-media/domain/model-contract.js';

  type Data = { title: string; workspaceId: string; payload: { revision?: number; draftConfig?: CreativeConfig }; connections?: NodeConnection[]; onDelete: (id: string) => void; onResize?: (id: string, params: { x: number; y: number; width: number; height: number }) => void; onRename?: (id: string, title: string) => void; onJumpToNode?: (id: string) => void; onRemoveConnection?: (id: string) => void; };
  let { id, data, selected } = $props<NodeProps & { data: Data }>();
  let config = $state<CreativeConfig>(creativeConfigSchema.parse({}));
  let characters = $state<CreativeCharacter[]>([]);
  const promptReferences = $derived(config.characterBindings.flatMap(binding => {
    const character = characters.find(item => item.id === binding.id);
    return binding.alias && character ? [{ alias: binding.alias, name: character.definition.name, version: character.version }] : [];
  }));
  let revision = $state<number | undefined>(), runs = $state<CreativeRun[]>([]), profiles = $state<CreativeProfile[]>([]);
  let inputs = $state<Array<{ id: string; type: string; title: string }>>([]);
  let busy = $state(false), loading = $state(true), dirty = $state(false), error = $state(''), configure = $state(false), preview = $state<CreativePreview | null>(null);
  let mounted = false, refreshing = false;
  let closeRun = $state<string | null>(null);
  let catalog = $state<FalModelSummary[]>([]), contract = $state<FalModelContract | null>(null), catalogLoading = $state(false), contractLoading = $state(false), parametersValid = $state(true), catalogError = $state('');
  let contractSequence = 0;
  let requestedContractModel = '';
  let catalogDate = $state('');
  let billing = $state<{ unit: string; unitPrice: number } | null>(null);
  const base = $derived(`/api/agent-room/workspaces/${data.workspaceId}/creative-media`);
  const endpoint = $derived(`${base}/workflows/${id}`);
  const model = $derived(CREATIVE_MODELS[config.modelId as CreativeModelId]);
  const promptField = $derived(contract ? modelPromptField(contract.schema) : undefined);
  const modelOptions = $derived([...Object.values(CREATIVE_MODELS).map(item => ({ value: item.id, label: `${item.name} (${item.mode})` })), ...catalog.filter(item => item.status === 'active').map(item => ({ value: item.id, label: `${item.name} · ${item.id}` }))]);
  const active = $derived(runs.find(run => ACTIVE_CREATIVE_STATUSES.includes(run.status)));
  const images = $derived(inputs.filter(input => input.type === 'image'));
  const notes = $derived(inputs.filter(input => input.type === 'note'));
  const characterPointers = $derived(config.characterBindings.flatMap(binding => [...binding.imagePointers, binding.voicePointer]));
  const mediaSlots = $derived(contract ? modelMediaSlots(contract.schema, [...config.mediaBindings.map(binding => binding.pointer), ...characterPointers]).filter(path => !characterPointers.includes(path)) : []);
  const usd = (cents: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100);

  async function options() {
    const result = await creativeApi<{ profiles: CreativeProfile[]; inputs: typeof inputs }>(base);
    profiles = result.profiles; inputs = result.inputs;
  }
  async function loadCatalog(refresh = false) {
    catalogLoading = true; catalogError = '';
    try { const result = await creativeApi<{ models: FalModelSummary[]; fetchedAt?: string }>(`${base}/models?limit=5000${refresh ? '&refresh=true' : ''}`); catalog = result.models; catalogDate = result.fetchedAt ?? ''; }
    catch (cause) { catalogError = (cause as Error).message; }
    finally { catalogLoading = false; }
  }
  async function loadContract(modelId: string, defaults = false) {
    requestedContractModel = modelId;
    const sequence = ++contractSequence;
    contract = null; parametersValid = true;
    if (CREATIVE_MODELS[modelId as CreativeModelId]) { contractLoading = false; return; }
    contractLoading = true;
    try {
      const next = await creativeApi<FalModelContract>(`${base}/models?endpoint=${encodeURIComponent(modelId)}`);
      if (sequence !== contractSequence || config.modelId !== modelId) return;
      contract = next;
      if (defaults) config.parameters = { ...modelDefaults(next.schema), ...config.parameters };
    } catch (cause) { if (sequence === contractSequence) error = (cause as Error).message; }
    finally { if (sequence === contractSequence) contractLoading = false; }
  }
  async function refresh(reset = false) {
    if (refreshing) return;
    refreshing = true;
    if (reset) { loading = true; error = ''; preview = null; }
    try {
      const result = await creativeApi<{ workflow: CreativeWorkflow | null; runs: CreativeRun[] }>(endpoint);
      runs = result.runs;
      if (reset || !dirty) {
        const next = creativeConfigSchema.parse(result.workflow?.config ?? data.payload.draftConfig ?? {});
        const changedModel = next.modelId !== config.modelId;
        config = next;
        if (changedModel || (!model && (reset || requestedContractModel !== next.modelId))) await loadContract(next.modelId);
        revision = result.workflow?.revision; dirty = false;
      }
      if (reset) await options();
    } finally { refreshing = false; loading = false; }
  }
  onMount(() => {
    mounted = true;
    void refresh(true).catch(cause => error = (cause as Error).message);
    void loadCatalog();
    const timer = setInterval(() => { if (!document.hidden && !busy) void refresh().catch(cause => error = (cause as Error).message); }, 5000);
    return () => { mounted = false; clearInterval(timer); };
  });
  $effect(() => { const next = data.payload.revision; if (next && mounted) untrack(() => { if (!dirty && !busy && next !== revision) void refresh(true).catch(cause => error = cause.message); }); });
  function changed() { dirty = true; preview = null; error = ''; }
  async function chooseModel(value: string) {
    if (!value || value === config.modelId) return;
    try {
      config = switchCreativeModel($state.snapshot(config), value);
    } catch (cause) { error = cause instanceof Error && cause.message === 'creative_model_mapping_required' ? cause.message : 'creative_unsupported_input'; return; }
    billing = null;
    changed(); await loadContract(value, true);
  }
  async function persist() {
    const result = await creativeApi<CreativeWorkflow>(endpoint, 'PUT', { title: data.title || m['creative.title'](), config, ...(revision ? { revision } : {}) });
    revision = result.revision; config = result.config; dirty = false;
  }
  async function expandContract() {
    try { config = expandLegacyCreativeModel($state.snapshot(config)); changed(); await loadContract(config.modelId); }
    catch (cause) { error = (cause as Error).message; }
  }
  async function execute(action: 'save' | 'estimate' | 'run') {
    busy = true; error = '';
    try {
      if (action !== 'run') { await persist(); if (action === 'estimate') preview = await creativeApi<CreativePreview>(`${endpoint}/preview`, 'POST', {}); }
      else if (preview && revision) {
        await creativeApi(`${endpoint}/runs`, 'POST', { revision, previewId: preview.id, idempotencyKey: preview.id });
        preview = null;
      }
      await refresh();
    } catch (cause) {
      error = (cause as Error).message;
      billing = (cause as Error & { billing?: typeof billing }).billing ?? null;
      if (['creative_preview_expired', 'creative_reference_changed', 'creative_revision_conflict'].includes(error)) preview = null;
    } finally { busy = false; }
  }
  async function command(runId: string, command: 'cancel' | 'retry_download' | 'close_unconfirmed') {
    busy = true; error = '';
    try { await creativeApi(`${base}/runs`, 'POST', { runId, command }); await refresh(); }
    catch (cause) { error = (cause as Error).message; } finally { busy = false; }
  }
  function noteChecked(noteId: string, checked: boolean) { config.contextNodeIds = checked ? [...config.contextNodeIds, noteId] : config.contextNodeIds.filter(value => value !== noteId); changed(); }
</script>

<NodeShell {id} {selected} accent="var(--app-secondary)" minWidth={390} minHeight={420} onResize={data.onResize} connections={data.connections ?? []} titleText={data.title} onRename={data.onRename} onJumpToNode={data.onJumpToNode} onRemoveConnection={data.onRemoveConnection}>
  {#snippet icon()}<Film size={14} />{/snippet}
  {#snippet title()}{data.title || m['creative.title']()}{/snippet}
  {#snippet actions()}
    <HeaderIconButton label={m['creative.configure']()} onclick={() => configure = true}><Settings2 size={14} /></HeaderIconButton>
    <HeaderIconButton label={m['creative.refresh']()} onclick={() => void refresh(true).catch(cause => error = cause.message)}><RefreshCw size={14} /></HeaderIconButton>
    <HeaderIconButton label={m['creative.delete']()} danger onclick={() => data.onDelete(id)}><X size={14} /></HeaderIconButton>
  {/snippet}
  <div data-testid="video-workflow" class="nodrag nowheel flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-3 text-[var(--app-text)] [&_[data-slot=native-select-wrapper]]:w-full">
    {#if loading}<p role="status" class="text-xs text-[var(--app-text-muted)]">{m['creative.loading']()}</p>{/if}
    {#if config.requiredCharacterIds.some(id => !config.characterBindings.some(binding => binding.id === id)) || config.requiredReferenceNodeIds.some(id => ![config.startImageNodeId, config.endImageNodeId, ...config.mediaBindings.map(binding => binding.nodeId)].includes(id))}<p role="status" class="mb-3 border-l-2 border-[var(--app-warning)] pl-2 text-xs text-[var(--app-text)]">{m['storyboard.bind_required']()}</p>{/if}
    <fieldset disabled={loading || busy || Boolean(active) || contractLoading} class="min-w-0 space-y-3 disabled:opacity-70" oninput={changed} onchange={changed}>
      <div class="grid grid-cols-2 gap-3">
        <CreativeModelPicker {base} profileId={config.profileId} value={config.modelId} options={modelOptions} onValueChange={chooseModel} />
        <label class="min-w-0 space-y-1 text-xs"><span>{m['creative.account']()}</span><NativeSelect.Root value={config.profileId ?? ''} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => { config.profileId = event.currentTarget.value || null; changed(); }}><option value="">{m['creative.choose_account']()}</option>{#each profiles as profile}<option value={profile.id}>{profile.name}</option>{/each}</NativeSelect.Root></label>
      </div>
      {#if catalogLoading || contractLoading}<p role="status" class="text-xs text-[var(--app-text-muted)]">{m['creative.catalog_loading']()}</p>{/if}
      <div class="flex items-center justify-between gap-2 text-xs text-[var(--app-text-muted)]"><span>{m['creative.catalog_count']({ count: String(catalog.length) })}{#if catalogDate} · {new Date(catalogDate).toLocaleDateString()}{/if}</span><Button size="icon-sm" variant="ghost" disabled={catalogLoading} aria-label={m['creative.refresh_catalog']()} title={m['creative.refresh_catalog']()} onclick={() => loadCatalog(true)}><RefreshCw size={13} /></Button></div>
      {#if catalogError}<p role="alert" class="text-xs text-destructive">{creativeError(catalogError)}</p>{/if}
      {#if model}<Button size="sm" variant="outline" title={m['creative.full_contract_help']()} onclick={expandContract}>{m['creative.full_contract']()}</Button>{/if}
      {#if contract}<a class="block break-all text-xs text-[var(--app-accent)] underline" href={contract.documentationUrl} target="_blank" rel="noreferrer">{contract.id}</a>{/if}
      <CreativeCharacterBindings workspaceId={data.workspaceId} {config} {contract} disabled={busy || Boolean(active) || loading || contractLoading} onRecords={(value) => characters = value} onChange={(value) => { config.characterBindings = value; changed(); }} />
      {#if model || promptField}<CreativePrompt value={config.prompt} references={promptReferences} maxlength={model?.promptLimit ?? concreteSchema(contract?.schema.properties?.[promptField ?? 'prompt'] ?? {}).maxLength ?? 50000} onChange={(value) => { config.prompt = value; changed(); }} />{/if}
      <CreativeShotControls value={config.shot} disabled={busy || Boolean(active) || loading} onChange={(value) => { config.shot = value; changed(); }} />
      {#if contract}
        {#key contract.id}<CreativeModelFields schema={contract.schema} value={config.parameters} managedPointers={[...config.mediaBindings.map(binding => binding.pointer), ...config.characterBindings.flatMap(binding => [...binding.imagePointers, binding.voicePointer])]} onChange={(value) => { config.parameters = value; changed(); }} onValidityChange={(valid) => parametersValid = valid} />{/key}
        <section class="space-y-2 border-t border-[var(--app-border)] pt-2" aria-label={m['creative.media_bindings']()}>
          <div class="flex items-center justify-between gap-2 text-xs font-medium"><span>{m['creative.media_bindings']()}</span><Button size="icon-sm" variant="ghost" disabled={config.mediaBindings.length >= 50} title={m['creative.add_media']()} aria-label={m['creative.add_media']()} onclick={() => { config.mediaBindings = [...config.mediaBindings, { pointer: mediaSlots.find(path => !config.mediaBindings.some(binding => binding.pointer === path)) ?? '', path: '' }]; changed(); }}><Plus size={14} /></Button></div>
          <p class="text-xs leading-5 text-[var(--app-text-muted)]">{m['creative.upload_disclosure']()}</p>
          {#each config.mediaBindings as binding, index}
            <div class="space-y-2 border-l-2 border-[var(--app-border)] pl-2">
              <div class="flex min-w-0 items-center gap-1"><div class="min-w-0 flex-1">{#if mediaSlots.length}<ModelCombobox value={binding.pointer} options={mediaSlots.map(path => ({ value: path, label: path }))} defaultLabel={m['creative.media_pointer']()} searchPlaceholder={m['creative.media_pointer']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.media_pointer']()} onValueChange={(path) => { binding.pointer = path; changed(); }} />{:else}<Input aria-label={m['creative.media_pointer']()} placeholder={m['creative.media_pointer']()} bind:value={binding.pointer} />{/if}</div><Button size="icon-sm" variant="ghost" title={m['creative.delete']()} aria-label={m['creative.delete']()} onclick={() => { config.mediaBindings = config.mediaBindings.filter((_, i) => index !== i); changed(); }}><X size={13} /></Button></div>
              <ModelCombobox value={binding.nodeId ?? ''} options={inputs.filter(item => ['image','video'].includes(item.type)).map(item => ({ value: item.id, label: item.title || item.id }))} defaultLabel={m['creative.workspace_file']()} searchPlaceholder={m['creative.search_media']()} emptyLabel={m['creative.no_inputs']()} ariaLabel={m['creative.media_source']()} onValueChange={(nodeId) => { config.mediaBindings[index] = { pointer: binding.pointer, ...(nodeId ? { nodeId } : { path: '' }) }; changed(); }} />
              {#if !binding.nodeId}<Input aria-label={m['creative.workspace_file']()} placeholder={m['creative.workspace_file']()} bind:value={binding.path} />{/if}
            </div>
          {/each}
        </section>
      {/if}
      {#if model?.startImage}
        <div class="grid grid-cols-2 gap-3">
          <label class="min-w-0 space-y-1 text-xs"><span>{m['creative.start_image']()}</span><NativeSelect.Root value={config.startImageNodeId ?? ''} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => { config.startImageNodeId = event.currentTarget.value || null; changed(); }}><option value="">{m['creative.none']()}</option>{#each images as image}<option value={image.id}>{image.title || image.id.slice(0,8)}</option>{/each}</NativeSelect.Root></label>
          <label class="min-w-0 space-y-1 text-xs"><span>{m['creative.end_image']()}</span><NativeSelect.Root value={config.endImageNodeId ?? ''} onchange={(event: Event & { currentTarget: HTMLSelectElement }) => { config.endImageNodeId = event.currentTarget.value || null; changed(); }}><option value="">{m['creative.none']()}</option>{#each images as image}<option value={image.id}>{image.title || image.id.slice(0,8)}</option>{/each}</NativeSelect.Root></label>
        </div>
      {/if}
      {#if model}<div class="grid grid-cols-3 gap-2">
        <label class="min-w-0 space-y-1 text-xs"><span>{m['creative.duration']()}</span><Input type="number" min={model.minDuration} max={model.maxDuration} step={1} bind:value={config.duration} /></label>
        {#if model.aspectRatios.length}<label class="min-w-0 space-y-1 text-xs"><span>{m['creative.ratio']()}</span><NativeSelect.Root bind:value={config.aspectRatio}>{#each model.aspectRatios as ratio}<option value={ratio}>{ratio}</option>{/each}</NativeSelect.Root></label>{/if}
        {#if model.resolutions.length}<label class="min-w-0 space-y-1 text-xs"><span>{m['creative.resolution']()}</span><NativeSelect.Root bind:value={config.resolution}>{#each model.resolutions as resolution}<option value={resolution}>{resolution}</option>{/each}</NativeSelect.Root></label>{/if}
      </div>
      {#if model.audioToggle}<label class="flex items-center justify-between gap-3 text-xs"><span>{m['creative.audio']()}</span><Switch checked={config.generateAudio} onCheckedChange={(value: boolean) => { config.generateAudio = value; changed(); }} /></label><p class="text-xs leading-4 text-[var(--app-text-muted)]">{m['creative.audio_help']()}</p>{:else}<p class="text-xs text-[var(--app-text-muted)]">{m['creative.wan_audio']()}</p>{/if}{/if}
      <details class="border-t border-[var(--app-border)] pt-2"><summary class="cursor-pointer py-1 text-xs font-medium">{m['creative.notes']()} ({config.contextNodeIds.length})</summary><div class="max-h-36 space-y-2 overflow-y-auto py-2">{#each notes as note}<label class="flex items-center gap-2 text-xs"><Checkbox checked={config.contextNodeIds.includes(note.id)} disabled={config.contextNodeIds.length >= 8 && !config.contextNodeIds.includes(note.id)} onCheckedChange={(checked: boolean | 'indeterminate') => noteChecked(note.id, checked === true)} /><span class="break-words">{note.title || note.id.slice(0,8)}</span></label>{/each}{#if !notes.length}<p class="text-xs text-[var(--app-text-muted)]">{m['creative.no_inputs']()}</p>{/if}</div></details>
      <details class="border-t border-[var(--app-border)] pt-2"><summary class="cursor-pointer py-1 text-xs font-medium">{m['creative.advanced']()}</summary><div class="space-y-3 py-2">
        {#if model}<label class="block space-y-1 text-xs"><span>{m['creative.negative_prompt']()}</span><Textarea bind:value={config.negativePrompt} maxlength={model.negativePromptLimit} class="min-h-16" /></label>{/if}
        {#if model?.seed}<label class="block space-y-1 text-xs"><span>{m['creative.seed']()}</span><Input type="number" min={0} max={2147483647} step={1} value={config.seed ?? ''} oninput={(event: Event & { currentTarget: HTMLInputElement }) => config.seed = event.currentTarget.value === '' ? null : Number(event.currentTarget.value)} /></label>{/if}
        <label class="block space-y-1 text-xs"><span>{m['creative.billing_units']()}</span><Input type="number" min={0.000001} max={1000000000} step="any" value={config.billingUnits ?? ''} oninput={(event: Event & { currentTarget: HTMLInputElement }) => config.billingUnits = event.currentTarget.value ? Number(event.currentTarget.value) : null} /></label><p class="text-xs leading-5 text-[var(--app-text-muted)]">{m['creative.billing_units_help']()}</p>
        <label class="block space-y-1 text-xs"><span>{m['creative.output_directory']()}</span><Input bind:value={config.outputDirectory} maxlength={500} /></label>
        <label class="block space-y-1 text-xs"><span>{m['creative.file_prefix']()}</span><Input bind:value={config.filePrefix} maxlength={80} /></label>
      </div></details>
    </fieldset>
    {#if error}<div role="alert" class="my-3 break-words text-xs leading-5 text-[var(--app-danger)]">{creativeError(error)}<span class="block break-all font-mono">{error.startsWith('creative_') ? error : ''}</span></div>{/if}
    {#if billing}<div class="space-y-2 border-y border-[var(--app-border)] py-3 text-xs"><p>{m['creative.billing_rate']({ price: String(billing.unitPrice), unit: billing.unit })}</p><label class="block space-y-1"><span>{m['creative.billing_units']()}</span><Input type="number" min={0.000001} max={1000000000} step="any" value={config.billingUnits ?? ''} oninput={(event: Event & { currentTarget: HTMLInputElement }) => { config.billingUnits = event.currentTarget.value ? Number(event.currentTarget.value) : null; changed(); }} /></label></div>{/if}
    {#if preview}<div class="my-3 border-y border-[var(--app-border)] py-3 text-xs leading-5"><strong>{m['creative.estimate_value']({ estimate: usd(preview.estimatedCents), reservation: usd(preview.reservedCents) })}</strong><p class="mt-1 text-[var(--app-text-muted)]">{m['creative.budget_help']()}</p>
      <details class="mt-2"><summary class="cursor-pointer font-medium">{m['creative.outgoing_data']()}</summary><p class="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">{preview.snapshot.prompt}</p>{#each [preview.snapshot.startImage, preview.snapshot.endImage].filter(Boolean) as reference}<p class="mt-2 break-all font-mono">{reference?.path} ({reference?.width} × {reference?.height})</p>{/each}{#if preview.snapshot.modelContract}<pre class="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.snapshot.config.parameters, null, 2)}</pre>{#each preview.snapshot.media ?? [] as item}<p class="break-all font-mono">{item.pointer}: {item.reference.path}</p>{/each}{/if}</details>
    </div>{/if}
    <div class="my-3 flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={loading || busy || Boolean(active) || contractLoading || !parametersValid} onclick={() => execute('save')}><Save size={14} />{m['creative.save']()}</Button>
      {#if preview}<Button size="sm" disabled={loading || busy || Boolean(active) || !parametersValid || contractLoading} onclick={() => execute('run')}><Play size={14} />{m['creative.generate']()}</Button>{:else}<Button size="sm" disabled={loading || busy || Boolean(active) || !config.profileId || !parametersValid || contractLoading || (!model && !contract)} onclick={() => execute('estimate')}><Film size={14} />{m['creative.estimate']()}</Button>{/if}
      <Button size="icon" variant="ghost" title={m['creative.configure']()} aria-label={m['creative.configure']()} onclick={() => configure = true}><Settings2 size={15} /></Button>
      {#if dirty}<span class="text-xs text-[var(--app-text-muted)]">{m['creative.dirty']()}</span>{/if}
    </div>
    <section class="border-t border-[var(--app-border)] pt-3" aria-label={m['creative.history']()}>
      <h3 class="mb-2 text-xs font-semibold">{m['creative.history']()}</h3>
      {#if !runs.length}<p class="text-xs text-[var(--app-text-muted)]">{m['creative.no_runs']()}</p>{/if}
      {#each runs as run (run.id)}
        <div class="space-y-1 border-b border-[var(--app-border)] py-3 text-xs">
          <div class="flex items-start justify-between gap-2"><strong class="min-w-0 break-words">{creativeStatus(run.status)}</strong><time class="shrink-0 text-[var(--app-text-muted)]">{new Date(run.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
          <div class="break-words text-[var(--app-text-muted)]">{run.snapshot.modelContract?.name ?? CREATIVE_MODELS[run.snapshot.config.modelId as CreativeModelId]?.name ?? run.snapshot.config.modelId} · {usd(run.reservedCents)}</div>
          {#if run.snapshot.characters?.length}<p class="break-words">{run.snapshot.characters.map(character => `${character.name} · v${character.version}`).join(', ')}</p>{#if run.status === 'completed'}<p class="text-[var(--app-text-muted)]">{m['creative.character_review_required']()}</p>{/if}{/if}
          {#if run.errorCode}<p class="break-words leading-5 text-[var(--app-danger)]">{creativeError(run.errorCode)}</p>{/if}
          <div class="flex flex-wrap items-center gap-2 pt-1">
            {#if ACTIVE_CREATIVE_STATUSES.includes(run.status) && !['submission_uncertain', 'cancel_requested'].includes(run.status)}<Button size="sm" variant="outline" disabled={busy} onclick={() => command(run.id, 'cancel')}><Square size={12} />{m['creative.cancel']()}</Button>{/if}
            {#if run.status === 'download_failed'}<Button size="sm" variant="outline" disabled={busy} onclick={() => command(run.id, 'retry_download')}><RotateCcw size={12} />{m['creative.retry_download']()}</Button>{/if}
            {#if ['submission_uncertain', 'download_failed'].includes(run.status)}<Button size="sm" variant="outline" disabled={busy} onclick={() => closeRun = run.id}>{m['creative.close_unconfirmed']()}</Button>{/if}
            {#if run.output}<a class="inline-flex items-center gap-1 py-1 text-[var(--app-accent)] underline" href={`/api/agent-room/workspaces/${data.workspaceId}/creative-media/videos/${run.id}`} download><Download size={12} />{m['creative.download']()}</a>{/if}
          </div>
        </div>
      {/each}
    </section>
  </div>
</NodeShell>
<CreativeProviderDialog bind:open={configure} workspaceId={data.workspaceId} onSaved={options} />
<AlertDialog.Root open={closeRun !== null} onOpenChange={(open: boolean) => { if (!open) closeRun = null; }}>
  <AlertDialog.Content>
    <AlertDialog.Header><AlertDialog.Title>{m['creative.close_unconfirmed']()}</AlertDialog.Title><AlertDialog.Description>{m['creative.close_unconfirmed_help']()}</AlertDialog.Description></AlertDialog.Header>
    <AlertDialog.Footer><AlertDialog.Cancel>{m['dlg.cancel']()}</AlertDialog.Cancel><AlertDialog.Action onclick={() => { const runId = closeRun; closeRun = null; if (runId) void command(runId, 'close_unconfirmed'); }}>{m['creative.close_unconfirmed']()}</AlertDialog.Action></AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
