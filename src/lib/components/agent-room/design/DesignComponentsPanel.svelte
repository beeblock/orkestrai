<script lang="ts">
  import { BookOpen, Boxes, Component, CopyPlus, Diamond, Eye, Link2, Plus, Search, Trash2, Unlink2 } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Switch } from '$lib/components/ui/switch';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as NativeSelect from '$lib/components/ui/native-select';
  import type {
    DesignComponent,
    DesignComponentProperty,
    DesignComponentPropertyType,
    DesignDocument,
    DesignElement,
    DesignOperation,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignLibrariesPanel from './DesignLibrariesPanel.svelte';

  let {
    document,
    selectedIds,
    saving,
    makeId,
    onApply,
    onSelectElements,
    onDocumentChange,
  }: {
    document: DesignDocument;
    selectedIds: string[];
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string, inverse: DesignOperation[]) => Promise<boolean>;
    onSelectElements: (elementIds: string[]) => void;
    onDocumentChange: (document: DesignDocument) => void;
  } = $props();

  let search = $state('');
  let selectedComponentId = $state('');
  let view = $state<'components' | 'libraries'>('components');

  const selectedElements = $derived(document.elements.filter((element) => selectedIds.includes(element.id)));
  const selectedElement = $derived(selectedElements.length === 1 ? selectedElements[0] : null);
  const selectedInstance = $derived(selectedElements.find((element) => element.instanceRootId === element.id && element.instanceOf) ?? null);
  const components = $derived(document.components
    .filter((component) => component.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((left, right) => left.name.localeCompare(right.name)));
  const activeComponent = $derived(document.components.find((component) => component.id === selectedComponentId)
    ?? (selectedElement?.componentId ? document.components.find((component) => component.id === selectedElement.componentId) : null)
    ?? (selectedInstance?.instanceOf ? document.components.find((component) => component.id === selectedInstance.instanceOf) : null)
    ?? components[0]
    ?? null);
  const owningComponent = $derived(selectedElement ? componentOwningElement(selectedElement) : null);
  const instanceCount = $derived(activeComponent ? document.elements.filter((element) => element.instanceRootId === element.id && element.instanceOf === activeComponent.id).length : 0);
  const selectedSet = $derived(activeComponent?.setId ? document.componentSets.find((candidate) => candidate.id === activeComponent.setId) ?? null : null);

  $effect(() => {
    if (activeComponent && selectedComponentId !== activeComponent.id) selectedComponentId = activeComponent.id;
    if (!activeComponent && selectedComponentId) selectedComponentId = '';
  });

  function componentOwningElement(element: DesignElement): DesignComponent | null {
    let current: DesignElement | undefined = element;
    while (current) {
      if (current.componentId) return document.components.find((component) => component.id === current?.componentId) ?? null;
      current = current.parentId ? document.elements.find((candidate) => candidate.id === current?.parentId) : undefined;
    }
    return null;
  }

  function componentKey(name: string, id: string): string {
    return `${name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'component'}-${id.slice(-8)}`;
  }

  function inputValue(event: Event): string {
    return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  }

  function propertyTypeLabel(type: DesignComponentPropertyType): string {
    if (type === 'text') return m['design.property_text']();
    if (type === 'boolean') return m['design.property_boolean']();
    return m['design.property_slot']();
  }

  async function createComponent() {
    if (!selectedElement || (selectedElement.type !== 'frame' && selectedElement.type !== 'group') || selectedElement.componentId || selectedElement.instanceRootId) return;
    const id = makeId();
    const component: DesignComponent = {
      id,
      name: selectedElement.name,
      description: '',
      rootElementId: selectedElement.id,
      setId: null,
      variantValues: {},
      properties: [],
      key: componentKey(selectedElement.name, id),
      libraryId: null,
      librarySourceId: null,
      codeConnect: null,
      updatedAt: new Date().toISOString(),
    };
    if (await onApply(
      [{ kind: 'add-component', component }],
      m['design.operation_create_component']({ name: component.name }),
      [{ kind: 'delete-component', componentId: component.id }],
    )) selectedComponentId = component.id;
  }

  async function updateComponent(changes: Partial<DesignComponent>) {
    if (!activeComponent) return;
    const inverseChanges = { ...Object.fromEntries(Object.keys(changes).map((key) => [key, activeComponent[key as keyof DesignComponent]])), updatedAt: activeComponent.updatedAt };
    await onApply(
      [{ kind: 'update-component', componentId: activeComponent.id, changes: { ...changes, updatedAt: new Date().toISOString() } }],
      m['design.operation_update_component']({ name: activeComponent.name }),
      [{ kind: 'update-component', componentId: activeComponent.id, changes: inverseChanges } as DesignOperation],
    );
  }

  async function deleteComponent() {
    if (!activeComponent || instanceCount) return;
    if (await onApply(
      [{ kind: 'delete-component', componentId: activeComponent.id }],
      m['design.operation_delete_component']({ name: activeComponent.name }),
      [{ kind: 'add-component', component: activeComponent }],
    )) selectedComponentId = '';
  }

  async function createInstance(component = activeComponent) {
    if (!component) return;
    const root = document.elements.find((element) => element.id === component.rootElementId);
    if (!root) return;
    const instanceId = makeId();
    const operation: DesignOperation = {
      kind: 'create-component-instance',
      componentId: component.id,
      instanceId,
      pageId: root.pageId,
      parentId: root.parentId,
      x: root.x + root.width + 48,
      y: root.y,
    };
    if (await onApply(
      [operation],
      m['design.operation_create_instance']({ name: component.name }),
      [{ kind: 'delete', elementId: instanceId }],
    )) onSelectElements([instanceId]);
  }

  function propertyDefault(type: DesignComponentPropertyType, element: DesignElement) {
    if (type === 'text') return element.text;
    if (type === 'boolean') return element.visible;
    return null;
  }

  function canExpose(type: DesignComponentPropertyType): boolean {
    if (!selectedElement || !owningComponent) return false;
    if (type === 'text') return selectedElement.type === 'text';
    if (type === 'slot') return selectedElement.type === 'frame' || selectedElement.type === 'group';
    return true;
  }

  async function exposeProperty(type: DesignComponentPropertyType) {
    if (!selectedElement || !owningComponent || !canExpose(type)) return;
    const defaultValue = propertyDefault(type, selectedElement);
    const property: DesignComponentProperty = {
      id: makeId(),
      name: type === 'text'
        ? selectedElement.name
        : type === 'boolean'
          ? m['design.component_property_name_visible']({ name: selectedElement.name })
          : type === 'slot'
            ? m['design.component_property_name_slot']({ name: selectedElement.name })
            : m['design.component_property_name_slot']({ name: selectedElement.name }),
      type,
      targetElementId: selectedElement.id,
      defaultValue,
      preferredValues: [],
      order: owningComponent.properties.length,
    };
    const operations: DesignOperation[] = [{ kind: 'update-component', componentId: owningComponent.id, changes: { properties: [...owningComponent.properties, property], updatedAt: new Date().toISOString() } }];
    const inverse: DesignOperation[] = [{ kind: 'update-component', componentId: owningComponent.id, changes: { properties: owningComponent.properties, updatedAt: owningComponent.updatedAt } }];
    if (type === 'slot') {
      operations.push({ kind: 'update', elementId: selectedElement.id, changes: { slotName: property.name } });
      inverse.push({ kind: 'update', elementId: selectedElement.id, changes: { slotName: selectedElement.slotName } });
    }
    await onApply(operations, m['design.operation_expose_property']({ name: property.name }), inverse);
  }

  async function updateProperty(property: DesignComponentProperty, changes: Partial<DesignComponentProperty>) {
    if (!activeComponent) return;
    const properties = activeComponent.properties.map((candidate) => candidate.id === property.id ? { ...candidate, ...changes } : candidate);
    await updateComponent({ properties });
  }

  async function deleteProperty(property: DesignComponentProperty) {
    if (!activeComponent) return;
    const target = document.elements.find((element) => element.id === property.targetElementId);
    const operations: DesignOperation[] = [{ kind: 'update-component', componentId: activeComponent.id, changes: { properties: activeComponent.properties.filter((candidate) => candidate.id !== property.id), updatedAt: new Date().toISOString() } }];
    const inverse: DesignOperation[] = [{ kind: 'update-component', componentId: activeComponent.id, changes: { properties: activeComponent.properties, updatedAt: activeComponent.updatedAt } }];
    if (property.type === 'slot' && target) {
      operations.push({ kind: 'update', elementId: target.id, changes: { slotName: null } });
      inverse.push({ kind: 'update', elementId: target.id, changes: { slotName: target.slotName } });
    }
    await onApply(operations, m['design.operation_delete_component_property']({ name: property.name }), inverse);
  }

  async function setInstanceProperty(property: DesignComponentProperty, value: string | boolean | null) {
    if (!selectedInstance || !activeComponent) return;
    const previous = selectedInstance.instanceProperties[property.id] ?? property.defaultValue;
    await onApply(
      [{ kind: 'set-instance-property', instanceId: selectedInstance.id, propertyId: property.id, value }],
      m['design.operation_set_instance_property']({ name: property.name }),
      [{ kind: 'set-instance-property', instanceId: selectedInstance.id, propertyId: property.id, value: previous }],
    );
  }

  async function assignSlot(property: DesignComponentProperty) {
    if (!selectedInstance) return;
    const contentIds = selectedIds.filter((id) => id !== selectedInstance.id);
    const previous = selectedInstance.slotAssignments[property.id] ?? [];
    await onApply(
      [{ kind: 'assign-instance-slot', instanceId: selectedInstance.id, propertyId: property.id, elementIds: contentIds }],
      m['design.operation_assign_slot']({ name: property.name }),
      [{ kind: 'assign-instance-slot', instanceId: selectedInstance.id, propertyId: property.id, elementIds: previous }],
    );
  }

  function snapshotCreateOperations(root: DesignElement): DesignOperation[] {
    const ids = new Set([root.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const element of document.elements) if (element.parentId && ids.has(element.parentId) && !ids.has(element.id)) {
        ids.add(element.id);
        changed = true;
      }
    }
    const snapshots = document.elements.filter((element) => ids.has(element.id));
    const depth = (element: DesignElement) => {
      let value = 0;
      let parentId = element.parentId;
      while (parentId && ids.has(parentId)) {
        value += 1;
        parentId = snapshots.find((candidate) => candidate.id === parentId)?.parentId ?? null;
      }
      return value;
    };
    return snapshots.sort((left, right) => depth(left) - depth(right) || left.order - right.order).map((element) => {
      const { id, order, ...rest } = structuredClone(element);
      return { kind: 'create', element: { ...rest, id, order } } as DesignOperation;
    });
  }

  async function detachInstance() {
    if (!selectedInstance) return;
    const restore = snapshotCreateOperations(selectedInstance);
    await onApply(
      [{ kind: 'detach-component-instance', instanceId: selectedInstance.id }],
      m['design.operation_detach_instance']({ name: selectedInstance.name }),
      [{ kind: 'delete', elementId: selectedInstance.id }, ...restore],
    );
  }

  async function swapInstance(componentId: string) {
    if (!selectedInstance || selectedInstance.instanceOf === componentId) return;
    const restore = snapshotCreateOperations(selectedInstance);
    await onApply(
      [{ kind: 'swap-component-instance', instanceId: selectedInstance.id, componentId }],
      m['design.operation_swap_instance'](),
      [{ kind: 'delete', elementId: selectedInstance.id }, ...restore],
    );
  }

  async function combineVariants() {
    const selectedComponents = selectedElements.map((element) => element.componentId ? document.components.find((component) => component.id === element.componentId) : null).filter((component): component is DesignComponent => Boolean(component));
    if (selectedComponents.length < 2) return;
    const setId = makeId();
    const prefix = selectedComponents.map((component) => component.name.split(/[\/]/)[0].trim()).find(Boolean) ?? m['design.component_set']();
    const propertyName = m['design.variant_state']();
    const set = { id: setId, name: prefix, propertyNames: [propertyName], order: document.componentSets.length, libraryId: null, librarySourceId: null };
    const operations: DesignOperation[] = [
      { kind: 'add-component-set', componentSet: set },
      ...selectedComponents.map((component) => ({ kind: 'update-component' as const, componentId: component.id, changes: { setId, variantValues: { [propertyName]: component.name.split(/[\/]/).at(-1)?.trim() || component.name }, updatedAt: new Date().toISOString() } })),
    ];
    const inverse: DesignOperation[] = [
      ...selectedComponents.map((component) => ({ kind: 'update-component' as const, componentId: component.id, changes: { setId: component.setId, variantValues: component.variantValues, updatedAt: component.updatedAt } })),
      { kind: 'delete-component-set', componentSetId: setId },
    ];
    await onApply(operations, m['design.operation_combine_variants']({ name: set.name }), inverse);
  }
</script>

<div class="flex h-full min-h-0 flex-col text-ui-sm">
  <div class="grid grid-cols-2 gap-0.5 border-b border-[var(--app-border)] p-1">
    <button class={`flex h-7 items-center justify-center gap-1 rounded text-ui-xs font-medium ${view === 'components' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === 'components'} onclick={() => (view = 'components')}><Diamond size={11} />{m['design.components']()}</button>
    <button class={`flex h-7 items-center justify-center gap-1 rounded text-ui-xs font-medium ${view === 'libraries' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === 'libraries'} onclick={() => (view = 'libraries')}><BookOpen size={11} />{m['design.libraries']()}</button>
  </div>
  {#if view === 'components'}
  <div class="space-y-2 border-b border-[var(--app-border)] p-2">
    <div class="flex h-6 items-center justify-between"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.components']()}</span><div class="flex gap-0.5"><Button variant="ghost" size="icon-sm" class="size-6" disabled={selectedElements.length < 2 || !selectedElements.every((element) => element.componentId)} aria-label={m['design.combine_variants']()} title={m['design.combine_variants']()} onclick={() => void combineVariants()}><Boxes size={12} /></Button><Button variant="ghost" size="icon-sm" class="size-6" disabled={!selectedElement || !['frame', 'group'].includes(selectedElement.type) || Boolean(selectedElement.componentId || selectedElement.instanceRootId)} aria-label={m['design.create_component']()} title={m['design.create_component']()} onclick={() => void createComponent()}><Plus size={12} /></Button></div></div>
    <div class="relative"><Search size={12} class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--app-text-muted)]" /><Input class="pl-7" placeholder={m['design.search_components']()} bind:value={search} /></div>
  </div>

  <div class="max-h-52 shrink-0 overflow-y-auto border-b border-[var(--app-border)] p-1">
    {#if !components.length}<p class="p-2 text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.components_empty']()}</p>{/if}
    {#each components as component (component.id)}
      {@const root = document.elements.find((element) => element.id === component.rootElementId)}
      <div class={`flex h-8 items-center rounded pr-1 ${activeComponent?.id === component.id ? 'bg-[var(--app-accent-soft)] text-[var(--app-text)]' : 'text-[var(--app-text-soft)] hover:bg-[var(--app-surface-raised)]'}`}>
        <button class="flex min-w-0 flex-1 items-center gap-2 self-stretch px-2 text-left" disabled={saving} onclick={() => (selectedComponentId = component.id)}><Diamond size={12} class="shrink-0 text-[var(--app-accent)]" /><span class="min-w-0 flex-1 truncate">{component.name}</span>{#if component.setId}<span class="text-ui-xs text-[var(--app-text-muted)]">{Object.values(component.variantValues).join(' · ')}</span>{/if}</button>
        <button class="grid size-6 shrink-0 place-items-center rounded text-[var(--app-text-muted)] hover:bg-[var(--app-border)] hover:text-[var(--app-text)]" aria-label={m['design.select_component_source']()} onclick={() => root && onSelectElements([root.id])}><Eye size={11} /></button>
      </div>
    {/each}
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-2">
    {#if selectedInstance && activeComponent}
      <div class="space-y-3">
        <div class="flex items-center gap-2"><Link2 size={13} class="text-[var(--app-accent)]" /><div class="min-w-0"><p class="truncate font-semibold text-[var(--app-text)]">{selectedInstance.name}</p><p class="truncate text-ui-xs text-[var(--app-text-muted)]">{activeComponent.name}</p></div></div>
        {#if selectedSet}<label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{selectedSet.name}</span><NativeSelect.Root value={activeComponent.id} onchange={(event: Event) => void swapInstance(inputValue(event))}>{#each document.components.filter((component) => component.setId === selectedSet.id) as component}<NativeSelect.Option value={component.id}>{Object.values(component.variantValues).join(' · ') || component.name}</NativeSelect.Option>{/each}</NativeSelect.Root></label>{/if}
        {#each activeComponent.properties as property (property.id)}
          {@const value = selectedInstance.instanceProperties[property.id] ?? property.defaultValue}
          <label class="block space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{property.name}</span>
            {#if property.type === 'text'}<Input value={String(value ?? '')} onchange={(event: Event) => void setInstanceProperty(property, inputValue(event))} />
            {:else if property.type === 'boolean'}<div class="flex h-8 items-center justify-between border border-[var(--app-border)] px-2"><span>{value ? m['design.enabled']() : m['design.disabled']()}</span><Switch size="sm" checked={Boolean(value)} onCheckedChange={(checked: boolean) => void setInstanceProperty(property, checked)} /></div>
            {:else}<Button class="w-full" variant="outline" size="sm" onclick={() => void assignSlot(property)}>{m['design.assign_selected_to_slot']({ count: String(Math.max(0, selectedIds.length - 1)) })}</Button>{/if}
          </label>
        {/each}
        <Button class="w-full" variant="outline" size="sm" onclick={() => void detachInstance()}><Unlink2 size={13} />{m['design.detach_instance']()}</Button>
      </div>
    {:else if activeComponent}
      <div class="space-y-3">
        <div class="grid grid-cols-[minmax(0,1fr)_28px] gap-1.5"><Input value={activeComponent.name} aria-label={m['design.component_name']()} onchange={(event: Event) => void updateComponent({ name: inputValue(event) })} /><Button variant="ghost" size="icon-sm" disabled={instanceCount > 0} aria-label={instanceCount ? m['design.component_in_use']({ count: String(instanceCount) }) : m['design.delete_component']()} title={instanceCount ? m['design.component_in_use']({ count: String(instanceCount) }) : m['design.delete_component']()} onclick={() => void deleteComponent()}><Trash2 size={12} /></Button></div>
        <Input value={activeComponent.description} placeholder={m['design.component_description']()} onchange={(event: Event) => void updateComponent({ description: inputValue(event) })} />
        <Button class="w-full" variant="secondary" size="sm" onclick={() => void createInstance()}><CopyPlus size={13} />{m['design.create_instance']()}</Button>
        {#if activeComponent.setId}
          {@const set = document.componentSets.find((candidate) => candidate.id === activeComponent.setId)}
          {#if set}{#each set.propertyNames as propertyName}<label class="space-y-1"><span class="text-ui-xs text-[var(--app-text-muted)]">{propertyName}</span><Input value={activeComponent.variantValues[propertyName] ?? ''} onchange={(event: Event) => void updateComponent({ variantValues: { ...activeComponent.variantValues, [propertyName]: inputValue(event) } })} /></label>{/each}{/if}
        {/if}
        <section class="space-y-1.5 border-t border-[var(--app-border)] pt-2"><div class="flex items-center justify-between"><span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{m['design.component_properties']()}</span><DropdownMenu.Root><DropdownMenu.Trigger class="inline-grid size-6 place-items-center rounded hover:bg-[var(--app-surface-raised)]" disabled={!owningComponent || owningComponent.id !== activeComponent.id} aria-label={m['design.expose_property']()}><Plus size={12} /></DropdownMenu.Trigger><DropdownMenu.Content class="z-[140] min-w-44" align="end"><DropdownMenu.Item disabled={!canExpose('text')} onclick={() => void exposeProperty('text')}>{m['design.property_text']()}</DropdownMenu.Item><DropdownMenu.Item disabled={!canExpose('boolean')} onclick={() => void exposeProperty('boolean')}>{m['design.property_boolean']()}</DropdownMenu.Item><DropdownMenu.Item disabled={!canExpose('slot')} onclick={() => void exposeProperty('slot')}>{m['design.property_slot']()}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Root></div>
          {#if !activeComponent.properties.length}<p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.component_properties_empty']()}</p>{/if}
          {#each activeComponent.properties as property (property.id)}<div class="grid grid-cols-[minmax(0,1fr)_72px_26px] items-center gap-1"><Input class="h-7" value={property.name} onchange={(event: Event) => void updateProperty(property, { name: inputValue(event) })} /><span class="truncate text-ui-xs uppercase text-[var(--app-text-muted)]">{propertyTypeLabel(property.type)}</span><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.delete']()} onclick={() => void deleteProperty(property)}><Trash2 size={10} /></Button></div>{/each}
        </section>
      </div>
    {:else}
      <div class="border border-dashed border-[var(--app-border)] p-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"><Component size={17} class="mb-2 text-[var(--app-accent)]" />{m['design.components_empty']()}</div>
    {/if}
  </div>
  {:else if view === 'libraries'}
    <div class="min-h-0 flex-1"><DesignLibrariesPanel {document} {onApply} {onDocumentChange} /></div>
  {/if}
</div>
