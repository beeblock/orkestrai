<script lang="ts">
  import { Braces, ChevronDown, ExternalLink } from '@lucide/svelte';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';
  import { Button } from '$lib/components/ui/button';
  import type {
    DesignBindableProperty,
    DesignDocument,
    DesignElement,
    DesignVariableType,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import * as m from '$lib/paraglide/messages.js';
  import DesignInspectorSection from './DesignInspectorSection.svelte';
  import DesignVariableCombobox from './DesignVariableCombobox.svelte';

  let {
    document,
    element,
    onBind,
    onOpenVariables,
  }: {
    document: DesignDocument;
    element: DesignElement;
    onBind: (property: DesignBindableProperty, variableId: string | null) => void;
    onOpenVariables: () => void;
  } = $props();

  const specs = $derived.by(() => {
    const result: Array<{ property: DesignBindableProperty; label: string; types: DesignVariableType[] }> = [
      { property: 'opacity', label: m['design.opacity'](), types: ['opacity'] },
    ];
    if (element.type !== 'image' && element.type !== 'group') result.unshift({ property: 'fill', label: m['design.fill'](), types: ['color'] });
    if (element.type !== 'group') {
      result.push({ property: 'stroke', label: m['design.stroke'](), types: ['color'] });
      result.push({ property: 'strokeWidth', label: m['design.stroke_width'](), types: ['spacing'] });
      result.push({ property: 'effects', label: m['design.effects'](), types: ['effect'] });
    }
    if (!['path', 'text', 'image', 'group'].includes(element.type)) result.push({ property: 'cornerRadius', label: m['design.radius'](), types: ['radius'] });
    if (element.type === 'text') {
      result.push({ property: 'fontSize', label: m['design.font_size'](), types: ['font-size'] });
      result.push({ property: 'fontWeight', label: m['design.font_weight'](), types: ['font-weight'] });
    }
    if (element.type === 'frame') {
      result.push({ property: 'layoutGap', label: m['design.gap'](), types: ['spacing'] });
      result.push({ property: 'layoutRowGap', label: m['design.row_gap'](), types: ['spacing'] });
      result.push({ property: 'layoutColumnGap', label: m['design.column_gap'](), types: ['spacing'] });
      result.push({ property: 'layoutPaddingTop', label: m['design.padding_top'](), types: ['spacing'] });
      result.push({ property: 'layoutPaddingRight', label: m['design.padding_right'](), types: ['spacing'] });
      result.push({ property: 'layoutPaddingBottom', label: m['design.padding_bottom'](), types: ['spacing'] });
      result.push({ property: 'layoutPaddingLeft', label: m['design.padding_left'](), types: ['spacing'] });
    }
    return result;
  });

  const boundCount = $derived(specs.filter((spec) => element.variableBindings[spec.property]).length);
  // Frames chegam a 13 propriedades vinculaveis: mostramos as tres mais usadas
  // (e qualquer uma ja vinculada) e o resto sob demanda.
  let showAll = $state(false);
  const visibleSpecs = $derived(showAll ? specs : specs.filter((spec, index) => index < 3 || element.variableBindings[spec.property]));

  function options(types: DesignVariableType[]) {
    return document.variables
      .filter((variable) => types.includes(variable.type))
      .sort((left, right) => left.order - right.order)
      .map((variable) => ({
        value: variable.id,
        label: `${document.variableCollections.find((collection) => collection.id === variable.collectionId)?.name ?? ''} / ${variable.name}`,
      }));
  }
</script>

{#snippet openVariables()}
  <Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-muted)] hover:text-[var(--app-text)]" aria-label={m['design.open_variables']()} title={m['design.open_variables']()} onclick={onOpenVariables}><ExternalLink size={13} /></Button>
{/snippet}

<!-- Aberta por padrao: o combobox de cada propriedade precisa estar no DOM
     logo apos selecionar a camada. A contagem no cabecalho resume o estado. -->
<DesignInspectorSection id="variable-bindings" title={m['design.variable_bindings']()} meta={boundCount ? String(boundCount) : undefined} actions={document.variables.length ? openVariables : undefined}>
  {#if !document.variables.length}
    <NodeEmptyState compact icon={Braces} title={m['design.bindings_empty_title']()} description={m['design.bindings_empty']()}>
      {#snippet actions()}<Button variant="outline" size="sm" onclick={onOpenVariables}><Braces size={13} />{m['design.open_variables']()}</Button>{/snippet}
    </NodeEmptyState>
  {:else}
    {#each visibleSpecs as spec (spec.property)}
      <label class="grid grid-cols-[84px_minmax(0,1fr)] items-center gap-2">
        <span class="truncate text-ui-xs text-[var(--app-text-muted)]" title={spec.label}>{spec.label}</span>
        <DesignVariableCombobox
          value={element.variableBindings[spec.property] ?? ''}
          options={options(spec.types)}
          emptyLabel={m['design.variable_unbound']()}
          searchPlaceholder={m['design.search_variables']()}
          noResultsLabel={m['design.no_variable_results']()}
          ariaLabel={m['design.bind_property']({ property: spec.label })}
          onValueChange={(value) => onBind(spec.property, value || null)}
        />
      </label>
    {/each}
    {#if specs.length > visibleSpecs.length || showAll}
      <button type="button" class="flex h-6 items-center gap-1 rounded-md px-1 text-ui-xs text-[var(--app-text-muted)] transition-colors duration-150 hover:text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)]" aria-expanded={showAll} onclick={() => (showAll = !showAll)}>
        <ChevronDown size={12} class={`transition-transform duration-150 ease-out ${showAll ? '' : '-rotate-90'}`} />{showAll ? m['design.bindings_show_less']() : m['design.bindings_show_all']({ count: String(specs.length) })}
      </button>
    {/if}
  {/if}
</DesignInspectorSection>
