<script lang="ts">
  import { toast } from '@beeblock/svelar/ui';
  import { Accessibility, Braces, Check, ClipboardCopy, Code2, Component, FileCode2, Link2, Shapes } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { DesignDocument, DesignElement, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import { designInspectBindings, designInspectCss, designOwningComponent } from '$lib/modules/agent-room/domain/design-inspect.js';
  import * as m from '$lib/paraglide/messages.js';
  import NodeEmptyState from '$lib/components/agent-room/canvas/NodeEmptyState.svelte';
  import DesignCodebasePanel from './DesignCodebasePanel.svelte';
  import DesignFigmaPanel from './DesignFigmaPanel.svelte';

  let {
    document,
    selectedIds,
    saving,
    makeId,
    onApply,
    onSelectElements,
    onDocumentChange,
    onCaptureDesign,
  }: {
    document: DesignDocument;
    selectedIds: string[];
    saving: boolean;
    makeId: () => string;
    onApply: (operations: DesignOperation[], summary: string, inverse: DesignOperation[]) => Promise<boolean>;
    onSelectElements: (elementIds: string[]) => void;
    onDocumentChange: (document: DesignDocument) => void;
    onCaptureDesign: (elementIds: string[], width: number, height: number) => Promise<string>;
  } = $props();

  type View = 'inspect' | 'code' | 'figma';
  let view = $state<View>('inspect');
  let copied = $state(false);

  const selectedElements = $derived(document.elements.filter((element) => selectedIds.includes(element.id)));
  const selected = $derived(selectedElements.length === 1 ? selectedElements[0] : null);
  const activeComponent = $derived(designOwningComponent(document, selected));
  const bindings = $derived(selected ? designInspectBindings(document, selected) : []);
  const css = $derived(selected ? designInspectCss(selected) : '');
  const artifacts = $derived(document.codeArtifacts.filter((artifact) => artifact.elementIds.some((id) => selectedIds.includes(id))));
  const figmaLink = $derived(selected?.figmaSource
    ? document.figmaLinks.find((link) => link.id === selected.figmaSource?.linkId) ?? null
    : activeComponent?.figmaSource
      ? document.figmaLinks.find((link) => link.id === activeComponent.figmaSource?.linkId) ?? null
      : null);

  function elementTypeLabel(element: DesignElement): string {
    if (element.type === 'frame') return m['design.frame']();
    if (element.type === 'group') return m['design.group']();
    if (element.type === 'rectangle') return m['design.rectangle']();
    if (element.type === 'ellipse') return m['design.ellipse']();
    if (element.type === 'text') return m['design.text']();
    if (element.type === 'path') return m['design.pen']();
    return m['design.image']();
  }

  function accessibilityRoleLabel(element: DesignElement): string {
    const labels = {
      none: m['design.accessibility_role_none'](),
      button: m['design.accessibility_role_button'](),
      link: m['design.accessibility_role_link'](),
      heading: m['design.accessibility_role_heading'](),
      image: m['design.accessibility_role_image'](),
      text: m['design.accessibility_role_text'](),
      input: m['design.accessibility_role_input'](),
      navigation: m['design.accessibility_role_navigation'](),
      region: m['design.accessibility_role_region'](),
    };
    return labels[element.accessibilityRole];
  }

  async function copyCss() {
    if (!css) return;
    try {
      await navigator.clipboard.writeText(css);
      copied = true;
      toast.success(m['design.inspect_css_copied']());
      setTimeout(() => (copied = false), 1_500);
    } catch {
      toast.error(m['design.inspect_copy_error']());
    }
  }
</script>

{#snippet subTab(id: View, label: string, Icon: typeof Braces)}
  <button type="button" class={`flex h-7 min-w-0 flex-auto items-center justify-center gap-1.5 rounded-md px-2 text-ui-sm font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent)] ${view === id ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-[var(--app-shadow-border)]' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === id} onclick={() => (view = id)}><Icon size={13} class="shrink-0" /><span class="truncate">{label}</span></button>
{/snippet}

{#snippet sectionTitle(label: string, Icon: typeof Braces)}
  <div class="flex items-center gap-1.5 text-[var(--app-text-muted)]"><Icon size={13} class="shrink-0" /><span class="section-label">{label}</span></div>
{/snippet}

{#snippet emptyNote(text: string)}
  <p class="text-ui-sm leading-5 text-[var(--app-text-muted)] [text-wrap:pretty]">{text}</p>
{/snippet}

<div class="flex h-full min-h-0 flex-col text-ui-sm" data-testid="design-inspect-panel">
  <div class="border-b border-[var(--app-border)] p-2">
    <div class="flex gap-0.5 rounded-lg bg-[var(--app-hover)] p-0.5">
      {@render subTab('inspect', m['design.inspect'](), Braces)}
      {@render subTab('code', m['design.code'](), Code2)}
      {@render subTab('figma', m['design.figma'](), Shapes)}
    </div>
  </div>

  {#if view === 'code'}
    <div class="min-h-0 flex-1"><DesignCodebasePanel {document} {activeComponent} {selectedIds} {saving} {makeId} {onApply} {onSelectElements} {onCaptureDesign} /></div>
  {:else if view === 'figma'}
    <div class="min-h-0 flex-1"><DesignFigmaPanel {document} {onDocumentChange} {onSelectElements} /></div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if selected}
        <section class="flex items-center gap-2.5 border-b border-[var(--app-border)] px-3 py-2.5">
          <div class="min-w-0 flex-1"><p class="truncate text-ui-md font-semibold text-[var(--app-text)]" title={selected.name}>{selected.name}</p><p class="mt-0.5 text-ui-xs tabular-nums text-[var(--app-text-muted)]">{elementTypeLabel(selected)} · {Math.round(selected.width)} × {Math.round(selected.height)}</p></div>
          <span class="meta-mono shrink-0 rounded-md bg-[var(--app-hover)] px-1.5 py-0.5" title={selected.id}>{selected.id.slice(-6)}</span>
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          {@render sectionTitle(m['design.accessibility'](), Accessibility)}
          <dl class="grid grid-cols-[84px_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-ui-sm"><dt class="text-ui-xs leading-5 text-[var(--app-text-muted)]">{m['design.accessibility_role']()}</dt><dd class="truncate text-[var(--app-text-soft)]">{accessibilityRoleLabel(selected)}</dd><dt class="text-ui-xs leading-5 text-[var(--app-text-muted)]">{m['design.accessibility_label']()}</dt><dd class="break-words text-[var(--app-text-soft)]">{selected.decorative ? m['design.decorative']() : selected.accessibilityLabel || m['design.inspect_not_set']()}</dd></dl>
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          {@render sectionTitle(m['design.inspect_bindings'](), Braces)}
          {#if bindings.length}
            <div class="space-y-1">{#each bindings as binding (binding.property)}<div class="grid grid-cols-[84px_minmax(0,1fr)] gap-2 rounded-md bg-[var(--app-hover)] px-2 py-1.5"><span class="truncate font-mono text-ui-xs text-[var(--app-text-muted)]" title={binding.property}>{binding.property}</span><span class="min-w-0"><span class="block truncate text-ui-sm text-[var(--app-text)]">{binding.variableName}</span><span class="block truncate font-mono text-ui-xs text-[var(--app-text-muted)]">{binding.resolvedValue}</span></span></div>{/each}</div>
          {:else}{@render emptyNote(m['design.inspect_bindings_empty']())}{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          {@render sectionTitle(m['design.inspect_component_contract'](), Component)}
          {#if activeComponent}
            <p class="text-ui-md font-medium text-[var(--app-text)]">{activeComponent.name}</p>
            {#if activeComponent.codeConnect}<div class="rounded-md bg-[var(--app-hover)] p-2"><p class="flex items-center gap-1 text-ui-xs font-medium text-[var(--app-text-soft)]"><Link2 size={11} />{m['design.code_connect']()}</p><p class="mt-1 break-all font-mono text-ui-xs text-[var(--app-text-muted)]">{activeComponent.codeConnect.path} · {activeComponent.codeConnect.exportName}</p></div>{:else}{@render emptyNote(m['design.inspect_code_connect_empty']())}{/if}
          {:else}{@render emptyNote(m['design.inspect_component_empty']())}{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          {@render sectionTitle(m['design.inspect_figma_origin'](), Shapes)}
          {#if selected.figmaSource || activeComponent?.figmaSource}<div class="rounded-md bg-[var(--app-hover)] p-2"><p class="truncate text-ui-sm text-[var(--app-text)]">{figmaLink?.fileName ?? m['design.figma_official']()}</p><p class="mt-1 break-all font-mono text-ui-xs text-[var(--app-text-muted)]">{selected.figmaSource?.nodeId ?? activeComponent?.figmaSource?.nodeId}</p></div>{:else}{@render emptyNote(m['design.inspect_figma_empty']())}{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          {@render sectionTitle(m['design.inspect_artifacts'](), FileCode2)}
          {#if artifacts.length}<div class="space-y-1">{#each artifacts as artifact (artifact.id)}<div class="rounded-md bg-[var(--app-hover)] px-2 py-1.5"><p class="truncate text-ui-sm text-[var(--app-text)]">{artifact.name}</p><p class="truncate font-mono text-ui-xs text-[var(--app-text-muted)]" title={artifact.path}>{artifact.path} · {artifact.framework}</p></div>{/each}</div>{:else}{@render emptyNote(m['design.inspect_artifacts_empty']())}{/if}
        </section>

        <section class="space-y-2 p-3">
          <div class="flex items-center justify-between gap-2">{@render sectionTitle(m['design.css'](), Code2)}<Button variant="ghost" size="icon-sm" class="size-7 text-[var(--app-text-soft)] hover:text-[var(--app-text)]" aria-label={m['design.inspect_copy_css']()} title={m['design.inspect_copy_css']()} onclick={() => void copyCss()}>{#if copied}<Check size={13} class="text-[var(--app-success)]" />{:else}<ClipboardCopy size={13} />{/if}</Button></div>
          <pre class="max-h-64 overflow-auto rounded-lg bg-[var(--app-canvas)] p-2.5 font-mono text-ui-xs leading-5 text-[var(--app-text-soft)] shadow-[inset_0_0_0_1px_var(--app-border)]"><code>{css}</code></pre>
        </section>
      {:else}
        <div class="py-4"><NodeEmptyState compact icon={Braces} title={selectedIds.length > 1 ? m['design.multiple_selection']({ count: String(selectedIds.length) }) : m['design.no_selection_title']()} description={m['design.inspect_no_selection']()} /></div>
      {/if}
    </div>
  {/if}
</div>
