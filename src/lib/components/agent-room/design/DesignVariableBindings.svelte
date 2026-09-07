<script lang="ts">
  import { Braces, ExternalLink } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type {
    DesignBindableProperty,
    DesignDocument,
    DesignElement,
    DesignVariableType,
  } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import * as m from '$lib/paraglide/messages.js';
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

<section class="space-y-2 border-y border-[var(--app-border)] py-3">
  <div class="flex items-center justify-between gap-2">
    <div class="flex min-w-0 items-center gap-1.5">
      <Braces size={13} class="shrink-0 text-[var(--app-accent)]" />
      <h3 class="truncate font-semibold text-[var(--app-text-soft)]">{m['design.variable_bindings']()}</h3>
    </div>
    <Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.open_variables']()} title={m['design.open_variables']()} onclick={onOpenVariables}><ExternalLink size={11} /></Button>
  </div>
  {#if !document.variables.length}
    <button class="w-full border border-dashed border-[var(--app-border)] px-2 py-2 text-left text-ui-xs leading-4 text-[var(--app-text-muted)] hover:border-[var(--app-accent)] hover:text-[var(--app-text)]" onclick={onOpenVariables}>{m['design.bindings_empty']()}</button>
  {:else}
    <div class="space-y-1.5">
      {#each specs as spec (spec.property)}
        <label class="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
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
    </div>
  {/if}
</section>
