<script lang="ts">
  import { ArrowDown, ArrowUp, Braces, Copy, Download, FileJson, Link2, Minus, MoreHorizontal, Plus, ScanSearch, Search, Sparkles, Trash2, Upload } from '@lucide/svelte';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';
  import { toast } from 'svelte-sonner';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type {
    DesignDocument,
    DesignEffect,
    DesignOperation,
    DesignVariable,
    DesignVariableCollection,
    DesignVariableType,
    DesignVariableValue,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import {
    auditDesignSystem,
    createDesignTokenPreset,
    designVariableUsageCount,
    exportDesignTokensCss,
    exportDesignTokensDtcg,
    exportDesignTokensTailwind,
    importDesignTokens,
    type DesignTokenPreset,
  } from '$lib/modules/agent-room/domain/design-tokens.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignColorControl from './DesignColorControl.svelte';
  import DesignVariableCombobox from './DesignVariableCombobox.svelte';

  let {
    document,
    saving,
    makeId,
    onApply,
    onSelectElements,
  }: {
    document: DesignDocument;
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string, inverse: DesignOperation[]) => Promise<boolean>;
    onSelectElements: (elementIds: string[]) => void;
  } = $props();

  const variableTypes: DesignVariableType[] = [
    'color', 'spacing', 'radius', 'font-size', 'font-weight', 'line-height',
    'opacity', 'effect', 'breakpoint', 'string', 'boolean',
  ];

  let selectedCollectionId = $state('');
  let selectedVariableId = $state('');
  let search = $state('');
  let nextType = $state<DesignVariableType>('color');
  let importInput: HTMLInputElement;
  let auditOpen = $state(false);

  const collections = $derived([...document.variableCollections].sort((left, right) => left.order - right.order));
  const collection = $derived(collections.find((candidate) => candidate.id === selectedCollectionId) ?? collections[0] ?? null);
  const variables = $derived(collection
    ? document.variables
        .filter((variable) => variable.collectionId === collection.id && variable.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        .sort((left, right) => left.order - right.order)
    : []);
  const selectedVariable = $derived(document.variables.find((candidate) => candidate.id === selectedVariableId && candidate.collectionId === collection?.id) ?? variables[0] ?? null);
  const audit = $derived(auditDesignSystem(document));

  $effect(() => {
    if (collection && selectedCollectionId !== collection.id) selectedCollectionId = collection.id;
    if (selectedVariable && selectedVariableId !== selectedVariable.id) selectedVariableId = selectedVariable.id;
    if (!selectedVariable && selectedVariableId) selectedVariableId = '';
  });

  function typeLabel(type: DesignVariableType): string {
    if (type === 'color') return m['design.variable_type_color']();
    if (type === 'spacing') return m['design.variable_type_spacing']();
    if (type === 'radius') return m['design.variable_type_radius']();
    if (type === 'font-size') return m['design.variable_type_font_size']();
    if (type === 'font-weight') return m['design.variable_type_font_weight']();
    if (type === 'line-height') return m['design.variable_type_line_height']();
    if (type === 'opacity') return m['design.variable_type_opacity']();
    if (type === 'effect') return m['design.variable_type_effect']();
    if (type === 'breakpoint') return m['design.variable_type_breakpoint']();
    if (type === 'boolean') return m['design.variable_type_boolean']();
    return m['design.variable_type_string']();
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  }

  function defaultValue(type: DesignVariableType): DesignVariableValue {
    if (type === 'color') return { kind: 'color', value: '#7c5cff' };
    if (type === 'string') return { kind: 'string', value: '' };
    if (type === 'boolean') return { kind: 'boolean', value: false };
    if (type === 'effect') return { kind: 'effect', value: [] };
    if (type === 'opacity') return { kind: 'number', value: 1 };
    if (type === 'font-weight') return { kind: 'number', value: 400 };
    if (type === 'font-size') return { kind: 'number', value: 16 };
    if (type === 'line-height') return { kind: 'number', value: 1.5 };
    if (type === 'breakpoint') return { kind: 'number', value: 768 };
    if (type === 'radius') return { kind: 'number', value: 8 };
    return { kind: 'number', value: 16 };
  }

  function inverseCollectionUpdate(source: DesignVariableCollection, changes: Partial<DesignVariableCollection>): DesignOperation {
    return {
      kind: 'update-variable-collection',
      collectionId: source.id,
      changes: Object.fromEntries(Object.keys(changes).map((key) => [key, source[key as keyof DesignVariableCollection]])),
    } as DesignOperation;
  }

  function inverseVariableUpdate(source: DesignVariable, changes: Partial<DesignVariable>): DesignOperation {
    return {
      kind: 'update-variable',
      variableId: source.id,
      changes: Object.fromEntries(Object.keys(changes).map((key) => [key, source[key as keyof DesignVariable]])),
    } as DesignOperation;
  }

  async function addCollection() {
    const modeId = makeId();
    const next: DesignVariableCollection = {
      id: makeId(),
      name: m['design.default_collection']({ number: String(collections.length + 1) }),
      modes: [{ id: modeId, name: m['design.default_mode']() }],
      defaultModeId: modeId,
      order: collections.length,
      libraryId: null,
      librarySourceId: null,
      codeSource: null,
    };
    if (await onApply(
      [{ kind: 'add-variable-collection', collection: next }],
      m['design.operation_add_collection']({ name: next.name }),
      [{ kind: 'delete-variable-collection', collectionId: next.id }],
    )) {
      selectedCollectionId = next.id;
      selectedVariableId = '';
    }
  }

  async function addImportedTokens(imported: ReturnType<typeof createDesignTokenPreset>, summary: string) {
    const collectionWithOrder = { ...imported.collection, order: collections.length };
    const operations: DesignOperation[] = [
      { kind: 'add-variable-collection', collection: collectionWithOrder },
      ...imported.variables.map((variable) => ({ kind: 'add-variable' as const, variable })),
    ];
    if (await onApply(operations, summary, [{ kind: 'delete-variable-collection', collectionId: collectionWithOrder.id }])) {
      selectedCollectionId = collectionWithOrder.id;
      selectedVariableId = imported.variables[0]?.id ?? '';
      if (imported.warnings.length) toast.warning(m['design.tokens_import_warnings']({ count: String(imported.warnings.length) }));
    }
  }

  async function addPreset(preset: DesignTokenPreset) {
    const imported = createDesignTokenPreset(preset, makeId);
    imported.collection.name = preset === 'product'
      ? m['design.preset_product']()
      : preset === 'marketing'
        ? m['design.preset_marketing']()
        : m['design.preset_mobile']();
    imported.collection.modes = imported.collection.modes.map((mode, index) => ({
      ...mode,
      name: preset === 'marketing'
        ? (index === 0 ? m['design.default_mode']() : m['design.high_contrast_mode']())
        : (index === 0 ? m['theme.light']() : m['theme.dark']()),
    }));
    await addImportedTokens(imported, m['design.operation_add_token_preset']({ name: imported.collection.name }));
  }

  async function importTokenFile(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const imported = importDesignTokens(await file.text(), file.name, makeId);
      await addImportedTokens(imported, m['design.operation_import_tokens']({ name: imported.collection.name }));
    } catch {
      toast.error(m['design.tokens_import_error']());
    } finally {
      (event.currentTarget as HTMLInputElement).value = '';
    }
  }

  function downloadText(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportTokens(format: 'dtcg' | 'css' | 'tailwind') {
    if (!collection) return;
    const base = collection.name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tokens';
    if (format === 'dtcg') downloadText(exportDesignTokensDtcg(document, collection.id), `${base}.tokens.json`, 'application/json');
    if (format === 'css') downloadText(exportDesignTokensCss(document, collection.id), `${base}.css`, 'text/css');
    if (format === 'tailwind') downloadText(exportDesignTokensTailwind(document, collection.id), `${base}.tailwind.js`, 'text/javascript');
  }

  async function updateCollection(changes: Partial<DesignVariableCollection>) {
    if (!collection) return;
    await onApply(
      [{ kind: 'update-variable-collection', collectionId: collection.id, changes }],
      m['design.operation_update_collection']({ name: collection.name }),
      [inverseCollectionUpdate(collection, changes)],
    );
  }

  async function deleteCollection() {
    if (!collection) return;
    const removedVariables = document.variables.filter((variable) => variable.collectionId === collection.id);
    const removedIds = new Set(removedVariables.map((variable) => variable.id));
    const restoreBindings: DesignOperation[] = document.elements.flatMap((element) =>
      Object.entries(element.variableBindings)
        .filter(([, variableId]) => removedIds.has(variableId))
        .map(([property, variableId]) => ({ kind: 'bind-variable', elementId: element.id, property, variableId }) as DesignOperation),
    );
    const inverse: DesignOperation[] = [
      { kind: 'add-variable-collection', collection },
      ...removedVariables.map((variable) => ({ kind: 'add-variable', variable }) as DesignOperation),
      ...restoreBindings,
      { kind: 'set-active-variable-mode', collectionId: collection.id, modeId: document.activeVariableModes[collection.id] ?? collection.defaultModeId },
    ];
    if (await onApply(
      [{ kind: 'delete-variable-collection', collectionId: collection.id }],
      m['design.operation_delete_collection']({ name: collection.name }),
      inverse,
    )) {
      selectedCollectionId = '';
      selectedVariableId = '';
    }
  }

  async function addMode() {
    if (!collection) return;
    const mode = { id: makeId(), name: m['design.new_mode']({ number: String(collection.modes.length + 1) }) };
    const sourceModeId = document.activeVariableModes[collection.id] ?? collection.defaultModeId;
    const variableOperations = document.variables
      .filter((variable) => variable.collectionId === collection.id)
      .map((variable) => ({
        kind: 'update-variable' as const,
        variableId: variable.id,
        changes: { values: { ...variable.values, [mode.id]: structuredClone(variable.values[sourceModeId] ?? defaultValue(variable.type)) } },
      }));
    const operations: DesignOperation[] = [
      { kind: 'update-variable-collection', collectionId: collection.id, changes: { modes: [...collection.modes, mode] } },
      ...variableOperations,
      { kind: 'set-active-variable-mode', collectionId: collection.id, modeId: mode.id },
    ];
    const inverse: DesignOperation[] = [
      { kind: 'update-variable-collection', collectionId: collection.id, changes: { modes: collection.modes } },
      ...document.variables.filter((variable) => variable.collectionId === collection.id).map((variable) => ({ kind: 'update-variable', variableId: variable.id, changes: { values: variable.values } }) as DesignOperation),
      { kind: 'set-active-variable-mode', collectionId: collection.id, modeId: sourceModeId },
    ];
    await onApply(operations, m['design.operation_add_mode']({ name: mode.name }), inverse);
  }

  async function deleteActiveMode() {
    if (!collection || collection.modes.length <= 1) return;
    const modeId = document.activeVariableModes[collection.id] ?? collection.defaultModeId;
    const remaining = collection.modes.filter((mode) => mode.id !== modeId);
    const defaultModeId = collection.defaultModeId === modeId ? remaining[0].id : collection.defaultModeId;
    const variableUpdates = document.variables.filter((variable) => variable.collectionId === collection.id).map((variable) => ({
      kind: 'update-variable' as const,
      variableId: variable.id,
      changes: { values: Object.fromEntries(Object.entries(variable.values).filter(([candidate]) => candidate !== modeId)) },
    }));
    await onApply(
      [
        { kind: 'update-variable-collection', collectionId: collection.id, changes: { modes: remaining, defaultModeId } },
        ...variableUpdates,
        { kind: 'set-active-variable-mode', collectionId: collection.id, modeId: defaultModeId },
      ],
      m['design.operation_delete_mode'](),
      [
        { kind: 'update-variable-collection', collectionId: collection.id, changes: { modes: collection.modes, defaultModeId: collection.defaultModeId } },
        ...document.variables.filter((variable) => variable.collectionId === collection.id).map((variable) => ({ kind: 'update-variable', variableId: variable.id, changes: { values: variable.values } }) as DesignOperation),
        { kind: 'set-active-variable-mode', collectionId: collection.id, modeId },
      ],
    );
  }

  async function setActiveMode(modeId: string) {
    if (!collection) return;
    const oldModeId = document.activeVariableModes[collection.id] ?? collection.defaultModeId;
    if (oldModeId === modeId) return;
    await onApply(
      [{ kind: 'set-active-variable-mode', collectionId: collection.id, modeId }],
      m['design.operation_change_mode'](),
      [{ kind: 'set-active-variable-mode', collectionId: collection.id, modeId: oldModeId }],
    );
  }

  async function renameActiveMode(name: string) {
    if (!collection) return;
    const modeId = document.activeVariableModes[collection.id] ?? collection.defaultModeId;
    const modes = collection.modes.map((mode) => mode.id === modeId ? { ...mode, name } : mode);
    await updateCollection({ modes });
  }

  async function addVariable() {
    if (!collection) return;
    const sameTypeCount = document.variables.filter((variable) => variable.collectionId === collection.id && variable.type === nextType).length;
    const variable: DesignVariable = {
      id: makeId(),
      collectionId: collection.id,
      name: m['design.default_variable']({ type: typeLabel(nextType), number: String(sameTypeCount + 1) }),
      type: nextType,
      description: '',
      values: Object.fromEntries(collection.modes.map((mode) => [mode.id, defaultValue(nextType)])),
      order: document.variables.filter((candidate) => candidate.collectionId === collection.id).length,
      libraryId: null,
      librarySourceId: null,
      codeSourceKey: null,
    };
    if (await onApply(
      [{ kind: 'add-variable', variable }],
      m['design.operation_add_variable']({ name: variable.name }),
      [{ kind: 'delete-variable', variableId: variable.id }],
    )) selectedVariableId = variable.id;
  }

  async function updateVariable(changes: Partial<DesignVariable>) {
    if (!selectedVariable) return;
    await onApply(
      [{ kind: 'update-variable', variableId: selectedVariable.id, changes }],
      m['design.operation_update_variable']({ name: selectedVariable.name }),
      [inverseVariableUpdate(selectedVariable, changes)],
    );
  }

  async function changeVariableType(type: DesignVariableType) {
    if (!selectedVariable || !collection || selectedVariable.type === type) return;
    await updateVariable({ type, values: Object.fromEntries(collection.modes.map((mode) => [mode.id, defaultValue(type)])) });
  }

  async function updateValue(modeId: string, value: DesignVariableValue) {
    if (!selectedVariable) return;
    await updateVariable({ values: { ...selectedVariable.values, [modeId]: value } });
  }

  function compatibleAliases(variable: DesignVariable) {
    return document.variables
      .filter((candidate) => candidate.id !== variable.id && candidate.type === variable.type)
      .map((candidate) => ({
        value: candidate.id,
        label: `${document.variableCollections.find((item) => item.id === candidate.collectionId)?.name ?? ''} / ${candidate.name}`,
      }));
  }

  function rawValue(variable: DesignVariable, modeId: string) {
    const value = variable.values[modeId];
    if (value?.kind !== 'alias') return value ?? defaultValue(variable.type);
    return defaultValue(variable.type);
  }

  function effectsWithChange(effects: DesignEffect[], index: number, changes: Partial<DesignEffect>): DesignEffect[] {
    return effects.map((effect, effectIndex) => effectIndex === index ? { ...effect, ...changes } as DesignEffect : effect);
  }

  async function deleteVariable() {
    if (!selectedVariable) return;
    const bindings = document.elements.flatMap((element) => Object.entries(element.variableBindings)
      .filter(([, variableId]) => variableId === selectedVariable.id)
      .map(([property]) => ({ kind: 'bind-variable', elementId: element.id, property, variableId: selectedVariable.id }) as DesignOperation));
    if (await onApply(
      [{ kind: 'delete-variable', variableId: selectedVariable.id }],
      m['design.operation_delete_variable']({ name: selectedVariable.name }),
      [{ kind: 'add-variable', variable: selectedVariable }, ...bindings],
    )) selectedVariableId = '';
  }

  async function duplicateVariable() {
    if (!selectedVariable) return;
    const duplicate: DesignVariable = {
      ...structuredClone(selectedVariable),
      id: makeId(),
      name: `${selectedVariable.name} ${m['design.copy_suffix']()}`,
      order: document.variables.filter((candidate) => candidate.collectionId === selectedVariable.collectionId).length,
    };
    if (await onApply(
      [{ kind: 'add-variable', variable: duplicate }],
      m['design.operation_duplicate_variable']({ name: selectedVariable.name }),
      [{ kind: 'delete-variable', variableId: duplicate.id }],
    )) selectedVariableId = duplicate.id;
  }

  async function moveVariable(direction: -1 | 1) {
    if (!selectedVariable || !collection) return;
    const siblings = document.variables.filter((variable) => variable.collectionId === collection.id).sort((left, right) => left.order - right.order);
    const index = siblings.findIndex((variable) => variable.id === selectedVariable.id);
    const other = siblings[index + direction];
    if (!other) return;
    await onApply(
      [
        { kind: 'update-variable', variableId: selectedVariable.id, changes: { order: other.order } },
        { kind: 'update-variable', variableId: other.id, changes: { order: selectedVariable.order } },
      ],
      m['design.operation_reorder_variable']({ name: selectedVariable.name }),
      [
        { kind: 'update-variable', variableId: selectedVariable.id, changes: { order: selectedVariable.order } },
        { kind: 'update-variable', variableId: other.id, changes: { order: other.order } },
      ],
    );
  }

  function selectVariableUsages(variableId: string) {
    onSelectElements(document.elements.filter((element) => Object.values(element.variableBindings).includes(variableId)).map((element) => element.id));
  }
</script>

{#snippet headerIcon(label: string, Icon: typeof Plus, onclick: () => void, disabled: boolean = false, pressed: boolean | undefined = undefined)}
  <Button variant="ghost" size="icon-sm" class={`size-7 ${pressed ? 'bg-[var(--app-active)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)] hover:text-[var(--app-text)]'}`} aria-label={label} title={label} aria-pressed={pressed} {disabled} {onclick}><Icon size={14} /></Button>
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui-sm">
  <input class="hidden" type="file" accept=".json,.tokens.json,.css,application/json,text/css" bind:this={importInput} onchange={(event) => void importTokenFile(event)} />
  <div class="space-y-2 border-b border-[var(--app-border)] px-3 pt-1.5 pb-3">
    <div class="flex h-7 items-center justify-between gap-2">
      <span class="section-label">{m['design.collections']()}</span>
      <div class="flex items-center gap-0.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="grid size-7 place-items-center rounded-md text-[var(--app-text-soft)] outline-none transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] data-[state=open]:bg-[var(--app-active)]" aria-label={m['design.token_presets']()} title={m['design.token_presets']()}><Sparkles size={14} /></DropdownMenu.Trigger>
          <DropdownMenu.Content class="z-[140] min-w-48" align="start">
            <DropdownMenu.Label>{m['design.token_presets']()}</DropdownMenu.Label>
            <DropdownMenu.Item onclick={() => void addPreset('product')}>{m['design.preset_product']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => void addPreset('marketing')}>{m['design.preset_marketing']()}</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => void addPreset('mobile')}>{m['design.preset_mobile']()}</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        {@render headerIcon(m['design.import_tokens'](), Upload, () => importInput?.click(), saving)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger class="grid size-7 place-items-center rounded-md text-[var(--app-text-soft)] outline-none transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] disabled:pointer-events-none disabled:opacity-40 data-[state=open]:bg-[var(--app-active)]" disabled={!collection} aria-label={m['design.export_tokens']()} title={m['design.export_tokens']()}><Download size={14} /></DropdownMenu.Trigger>
          <DropdownMenu.Content class="z-[140] min-w-44" align="start">
            <DropdownMenu.Item onclick={() => exportTokens('dtcg')}><FileJson size={13} />DTCG JSON</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => exportTokens('css')}><Braces size={13} />CSS variables</DropdownMenu.Item>
            <DropdownMenu.Item onclick={() => exportTokens('tailwind')}><Braces size={13} />Tailwind</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
        {@render headerIcon(m['design.audit_tokens'](), ScanSearch, () => (auditOpen = !auditOpen), false, auditOpen)}
        {@render headerIcon(m['design.add_collection'](), Plus, () => void addCollection(), saving)}
      </div>
    </div>
    {#if auditOpen}
      <div class="max-h-52 space-y-1.5 overflow-y-auto rounded-lg bg-[var(--app-hover)] p-1.5">
        <div class="grid grid-cols-3 gap-1 text-center">
          {#each [{ value: audit.duplicateTokens.length, label: m['design.audit_duplicates']() }, { value: audit.unusedVariableIds.length, label: m['design.audit_unused']() }, { value: audit.componentCandidates.length, label: m['design.audit_components']() }] as stat (stat.label)}
            <div class="rounded-md bg-[var(--app-surface-raised)] px-1 py-1.5 shadow-[var(--app-shadow-border)]"><strong class="block text-ui-lg font-semibold tabular-nums text-[var(--app-text)]">{stat.value}</strong><span class="block truncate text-ui-xs text-[var(--app-text-muted)]" title={stat.label}>{stat.label}</span></div>
          {/each}
        </div>
        {#each audit.hardcodedValues as group}
          <button type="button" class="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]" onclick={() => onSelectElements(group.elementIds)}><span class="truncate">{group.property} · {group.value}</span><span class="meta-mono shrink-0">{group.elementIds.length}</span></button>
        {/each}
        {#each audit.componentCandidates as candidate, index}
          <button type="button" class="flex h-7 w-full items-center justify-between gap-2 rounded-md px-2 text-left transition-colors duration-150 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]" onclick={() => onSelectElements(candidate.elementIds)}><span class="truncate">{m['design.component_candidate']({ number: String(index + 1) })}</span><span class="meta-mono shrink-0">{candidate.elementIds.length}</span></button>
        {/each}
      </div>
    {/if}
    {#if collection}
      <div class="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
        <NativeSelect.Root size="sm" class="w-full min-w-0 [&_select]:text-ui-md" aria-label={m['design.collection']()} value={collection.id} onchange={(event: Event) => { selectedCollectionId = inputValue(event); selectedVariableId = ''; }}>
          {#each collections as item (item.id)}<NativeSelect.Option value={item.id}>{item.name}</NativeSelect.Option>{/each}
        </NativeSelect.Root>
        <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['design.delete_collection']()} title={m['design.delete_collection']()} disabled={saving} onclick={() => void deleteCollection()}><Trash2 size={13} /></Button>
      </div>
      <label class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2"><span class="truncate text-ui-xs text-[var(--app-text-muted)]" title={m['design.collection_name']()}>{m['design.name']()}</span><Input class="h-7 text-ui-md md:text-ui-md" aria-label={m['design.collection_name']()} value={collection.name} onchange={(event: Event) => void updateCollection({ name: inputValue(event) })} /></label>
      <div class="flex h-7 items-center justify-between pt-1">
        <span class="section-label">{m['design.modes']()}</span>
        <div class="flex gap-0.5">{@render headerIcon(m['design.add_mode'](), Plus, () => void addMode(), saving)}{@render headerIcon(m['design.delete_mode'](), Minus, () => void deleteActiveMode(), saving || collection.modes.length <= 1)}</div>
      </div>
      <NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" aria-label={m['design.active_mode']()} value={document.activeVariableModes[collection.id] ?? collection.defaultModeId} onchange={(event: Event) => void setActiveMode(inputValue(event))}>
        {#each collection.modes as mode (mode.id)}<NativeSelect.Option value={mode.id}>{mode.name}</NativeSelect.Option>{/each}
      </NativeSelect.Root>
      <label class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2"><span class="truncate text-ui-xs text-[var(--app-text-muted)]" title={m['design.mode_name']()}>{m['design.name']()}</span><Input class="h-7 text-ui-md md:text-ui-md" aria-label={m['design.mode_name']()} value={collection.modes.find((mode) => mode.id === (document.activeVariableModes[collection.id] ?? collection.defaultModeId))?.name ?? ''} onchange={(event: Event) => void renameActiveMode(inputValue(event))} /></label>
    {/if}
  </div>

  {#if !collection}
    <div class="min-h-0 flex-1 overflow-y-auto">
      <NodeEmptyState icon={Braces} title={m['design.variables_empty_title']()} description={m['design.variables_empty']()}>
        {#snippet actions()}<Button size="sm" disabled={saving} onclick={() => void addCollection()}><Plus size={13} />{m['design.add_collection']()}</Button>{/snippet}
      </NodeEmptyState>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="space-y-2 border-b border-[var(--app-border)] px-3 pt-1.5 pb-2.5">
        <div class="flex h-7 items-center gap-2"><span class="section-label">{m['design.tokens']()}</span><span class="meta-mono">{variables.length}</span></div>
        <div class="relative"><Search size={13} class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input class="h-7 pl-8 text-ui-md md:text-ui-md" placeholder={m['design.search_variables']()} aria-label={m['design.search_variables']()} bind:value={search} /></div>
        <div class="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
          <NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" aria-label={m['design.new_variable_type']()} value={nextType} onchange={(event: Event) => (nextType = inputValue(event) as DesignVariableType)}>
            {#each variableTypes as type}<NativeSelect.Option value={type}>{typeLabel(type)}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
          <Button variant="secondary" size="icon-sm" class="size-7" aria-label={m['design.add_variable']()} title={m['design.add_variable']()} disabled={saving} onclick={() => void addVariable()}><Plus size={14} /></Button>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col">
        <div class="max-h-52 shrink-0 space-y-px overflow-y-auto border-b border-[var(--app-border)] p-1.5">
          {#if !variables.length}<p class="px-2 py-3 text-center text-ui-sm text-[var(--app-text-muted)]">{m['design.no_variable_results']()}</p>{/if}
          {#each variables as variable (variable.id)}
            {@const swatch = rawValue(variable, document.activeVariableModes[collection.id] ?? collection.defaultModeId)}
            <div class={`flex h-7 w-full items-center rounded-md pr-0.5 transition-colors duration-150 ${selectedVariable?.id === variable.id ? 'bg-[var(--app-active)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)] hover:bg-[var(--app-hover)] hover:text-[var(--app-text)]'}`}>
              <button type="button" class="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left outline-none focus-visible:underline" onclick={() => (selectedVariableId = variable.id)}>
                {#if variable.type === 'color'}<span class="size-3.5 shrink-0 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.16)]" style:background={swatch.kind === 'color' ? (swatch as { kind: 'color'; value: string }).value : 'transparent'}></span>{:else}<Braces size={13} class="shrink-0 text-[var(--app-text-muted)]" />{/if}
                <span class="min-w-0 flex-1 truncate text-ui-md">{variable.name}</span>
                <span class="shrink-0 text-ui-xs text-[var(--app-text-muted)]">{typeLabel(variable.type)}</span>
              </button>
              <button type="button" class="grid h-6 min-w-6 shrink-0 place-items-center rounded-[5px] px-1 font-mono text-ui-xs tabular-nums text-[var(--app-text-muted)] transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)]" aria-label={m['design.variable_usages']({ count: String(designVariableUsageCount(document, variable.id)) })} title={m['design.variable_usages']({ count: String(designVariableUsageCount(document, variable.id)) })} onclick={() => selectVariableUsages(variable.id)}>{designVariableUsageCount(document, variable.id)}</button>
            </div>
          {/each}
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">
          {#if selectedVariable}
            <div class="space-y-2">
              <div class="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5">
                <Input class="h-7 text-ui-md font-medium md:text-ui-md" aria-label={m['design.variable_name']()} value={selectedVariable.name} onchange={(event: Event) => void updateVariable({ name: inputValue(event) })} />
                <DropdownMenu.Root><DropdownMenu.Trigger class="grid size-7 place-items-center rounded-md text-[var(--app-text-soft)] outline-none transition-colors duration-150 hover:bg-[var(--app-hover)] hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-accent)] data-[state=open]:bg-[var(--app-active)]" aria-label={m['design.variable_actions']()} title={m['design.variable_actions']()}><MoreHorizontal size={14} /></DropdownMenu.Trigger><DropdownMenu.Content class="z-[140] min-w-44" align="end"><DropdownMenu.Item onclick={() => void duplicateVariable()}><Copy size={13} />{m['design.duplicate']()}</DropdownMenu.Item><DropdownMenu.Item onclick={() => void moveVariable(-1)}><ArrowUp size={13} />{m['design.move_up']()}</DropdownMenu.Item><DropdownMenu.Item onclick={() => void moveVariable(1)}><ArrowDown size={13} />{m['design.move_down']()}</DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item variant="destructive" onclick={() => void deleteVariable()}><Trash2 size={13} />{m['design.delete_variable']()}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root>
              </div>
              <NativeSelect.Root size="sm" class="w-full [&_select]:text-ui-md" aria-label={m['design.variable_type']()} value={selectedVariable.type} onchange={(event: Event) => void changeVariableType(inputValue(event) as DesignVariableType)}>
                {#each variableTypes as type}<NativeSelect.Option value={type}>{typeLabel(type)}</NativeSelect.Option>{/each}
              </NativeSelect.Root>
              <Input class="h-7 text-ui-md md:text-ui-md" aria-label={m['design.variable_description']()} placeholder={m['design.variable_description']()} value={selectedVariable.description} onchange={(event: Event) => void updateVariable({ description: inputValue(event) })} />

              {#each collection.modes as mode (mode.id)}
                {@const value = selectedVariable.values[mode.id] ?? defaultValue(selectedVariable.type)}
                <section class="space-y-1.5 border-t border-[var(--app-border)] pt-2.5">
                  <div class="flex h-6 items-center justify-between gap-2"><span class="truncate text-ui-sm font-semibold text-[var(--app-text)]">{mode.name}</span>{#if value.kind === 'alias'}<span class="flex shrink-0 items-center gap-1 rounded-full bg-[var(--app-hover)] px-2 py-0.5 text-ui-xs text-[var(--app-text-soft)]"><Link2 size={11} />{m['design.alias']()}</span>{/if}</div>
                  <DesignVariableCombobox
                    value={value.kind === 'alias' ? value.variableId : ''}
                    options={compatibleAliases(selectedVariable)}
                    emptyLabel={m['design.raw_value']()}
                    searchPlaceholder={m['design.search_variables']()}
                    noResultsLabel={m['design.no_variable_results']()}
                    ariaLabel={m['design.variable_alias_for_mode']({ mode: mode.name })}
                    onValueChange={(variableId) => void updateValue(mode.id, variableId ? { kind: 'alias', variableId } : defaultValue(selectedVariable.type))}
                  />
                  {#if value.kind !== 'alias'}
                    {#if value.kind === 'color'}
                      <!-- Seletor com amostra (o mesmo do inspector) no lugar do
                           input de cor nativo; o hex continua editavel ao lado. -->
                      <div class="grid grid-cols-[28px_minmax(0,1fr)] gap-1.5"><DesignColorControl color={value.value.slice(0, 7)} opacity={1} alpha={false} label={m['design.variable_value']()} onChange={(color) => void updateValue(mode.id, { kind: 'color', value: color })} /><Input class="h-7 font-mono text-ui-md uppercase md:text-ui-md" aria-label={m['design.hex_color']()} value={value.value} onchange={(event: Event) => void updateValue(mode.id, { kind: 'color', value: inputValue(event) })} /></div>
                    {:else if value.kind === 'number'}
                      <Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" aria-label={m['design.variable_value']()} step={selectedVariable.type === 'line-height' || selectedVariable.type === 'opacity' ? '0.05' : '1'} min={selectedVariable.type === 'opacity' ? '0' : undefined} max={selectedVariable.type === 'opacity' ? '1' : undefined} value={value.value} onchange={(event: Event) => void updateValue(mode.id, { kind: 'number', value: Number(inputValue(event)) })} />
                    {:else if value.kind === 'string'}
                      <Input class="h-7 text-ui-md md:text-ui-md" aria-label={m['design.variable_value']()} value={value.value} onchange={(event: Event) => void updateValue(mode.id, { kind: 'string', value: inputValue(event) })} />
                    {:else if value.kind === 'boolean'}
                      <label class="flex h-7 items-center justify-between rounded-md bg-[var(--app-hover)] px-2"><span class="text-ui-sm">{value.value ? m['design.enabled']() : m['design.disabled']()}</span><Switch size="sm" checked={value.value} onCheckedChange={(checked: boolean) => void updateValue(mode.id, { kind: 'boolean', value: checked })} /></label>
                    {:else if value.kind === 'effect'}
                      <div class="space-y-1.5">
                        {#each value.value as effect, index}
                          <div class="group/effect grid grid-cols-[minmax(0,1fr)_64px_28px] items-center gap-1 rounded-lg bg-[var(--app-hover)] p-1 pl-2">
                            <span class="truncate text-ui-sm text-[var(--app-text-soft)]">{effect.type === 'layer-blur' || effect.type === 'background-blur' ? m['design.blur']() : m['design.shadow']()}</span>
                            <Input class="h-7 text-ui-md tabular-nums md:text-ui-md" type="number" min="0" aria-label={m['design.blur']()} value={effect.blur} onchange={(event: Event) => void updateValue(mode.id, { kind: 'effect', value: effectsWithChange(value.value, index, { blur: Number(inputValue(event)) }) })} />
                            <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] hover:text-[var(--app-danger)]" aria-label={m['design.delete']()} title={m['design.delete']()} onclick={() => void updateValue(mode.id, { kind: 'effect', value: value.value.filter((_, itemIndex) => itemIndex !== index) })}><Minus size={13} /></Button>
                          </div>
                        {/each}
                        <div class="grid grid-cols-2 gap-1.5"><Button variant="outline" size="sm" class="min-w-0 px-1.5" onclick={() => void updateValue(mode.id, { kind: 'effect', value: [...value.value, { type: 'drop-shadow', color: '#00000040', x: 0, y: 4, blur: 12, spread: 0, visible: true }] })}><span class="truncate">{m['design.add_shadow']()}</span></Button><Button variant="outline" size="sm" class="min-w-0 px-1.5" onclick={() => void updateValue(mode.id, { kind: 'effect', value: [...value.value, { type: 'layer-blur', blur: 8, visible: true }] })}><span class="truncate">{m['design.add_blur']()}</span></Button></div>
                      </div>
                    {/if}
                  {/if}
                </section>
              {/each}
            </div>
          {:else}
            <NodeEmptyState compact icon={Braces} title={m['design.select_variable']()} />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
