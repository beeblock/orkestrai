<script lang="ts">
  import { toast } from '@beeblock/svelar/ui';
  import { Accessibility, Braces, Check, ClipboardCopy, Code2, Component, FileCode2, Link2, Shapes } from '@lucide/svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { Button } from '$lib/components/ui/button';
  import type { DesignDocument, DesignElement, DesignOperation } from '$lib/modules/agent-room/contracts/schemas/designSchemas.js';
  import { designInspectBindings, designInspectCss, designOwningComponent } from '$lib/modules/agent-room/domain/design-inspect.js';
  import * as m from '$lib/paraglide/messages.js';
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

<div class="flex h-full min-h-0 flex-col text-ui-sm" data-testid="design-inspect-panel">
  <div class="grid grid-cols-3 gap-0.5 border-b border-[var(--app-border)] p-1">
    <button class={`flex h-7 items-center justify-center gap-1 rounded text-ui-xs font-medium ${view === 'inspect' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === 'inspect'} onclick={() => (view = 'inspect')}><Braces size={11} />{m['design.inspect']()}</button>
    <button class={`flex h-7 items-center justify-center gap-1 rounded text-ui-xs font-medium ${view === 'code' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === 'code'} onclick={() => (view = 'code')}><Code2 size={11} />{m['design.code']()}</button>
    <button class={`flex h-7 items-center justify-center gap-1 rounded text-ui-xs font-medium ${view === 'figma' ? 'bg-[var(--app-surface-raised)] text-[var(--app-text)] shadow-sm' : 'text-[var(--app-text-muted)] hover:text-[var(--app-text)]'}`} aria-pressed={view === 'figma'} onclick={() => (view = 'figma')}><Shapes size={11} />{m['design.figma']()}</button>
  </div>

  {#if view === 'code'}
    <div class="min-h-0 flex-1"><DesignCodebasePanel {document} {activeComponent} {selectedIds} {saving} {makeId} {onApply} {onSelectElements} {onCaptureDesign} /></div>
  {:else if view === 'figma'}
    <div class="min-h-0 flex-1"><DesignFigmaPanel {document} {onDocumentChange} {onSelectElements} /></div>
  {:else}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if selected}
        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0"><p class="truncate font-semibold text-[var(--app-text)]">{selected.name}</p><p class="mt-0.5 text-ui-xs text-[var(--app-text-muted)]">{elementTypeLabel(selected)} · {Math.round(selected.width)} × {Math.round(selected.height)}</p></div>
            <Badge variant="outline" class="shrink-0 text-ui-xs">{selected.id.slice(-6)}</Badge>
          </div>
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><Accessibility size={12} />{m['design.accessibility']()}</div>
          <div class="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-ui-xs"><span class="text-[var(--app-text-muted)]">{m['design.accessibility_role']()}</span><span class="truncate text-[var(--app-text-soft)]">{accessibilityRoleLabel(selected)}</span><span class="text-[var(--app-text-muted)]">{m['design.accessibility_label']()}</span><span class="break-words text-[var(--app-text-soft)]">{selected.decorative ? m['design.decorative']() : selected.accessibilityLabel || m['design.inspect_not_set']()}</span></div>
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><Braces size={12} />{m['design.inspect_bindings']()}</div>
          {#if bindings.length}
            <div class="space-y-1">{#each bindings as binding (binding.property)}<div class="grid grid-cols-[72px_minmax(0,1fr)] gap-2 rounded bg-[var(--app-surface-subtle)] px-2 py-1.5"><span class="truncate text-ui-xs text-[var(--app-text-muted)]">{binding.property}</span><span class="min-w-0"><span class="block truncate text-ui-xs text-[var(--app-text)]">{binding.variableName}</span><span class="block truncate text-ui-xs text-[var(--app-text-muted)]">{binding.resolvedValue}</span></span></div>{/each}</div>
          {:else}<p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.inspect_bindings_empty']()}</p>{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><Component size={12} />{m['design.inspect_component_contract']()}</div>
          {#if activeComponent}
            <p class="font-medium text-[var(--app-text)]">{activeComponent.name}</p>
            {#if activeComponent.codeConnect}<div class="rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2"><p class="flex items-center gap-1 text-ui-xs font-medium"><Link2 size={10} />{m['design.code_connect']()}</p><p class="mt-1 break-all text-ui-xs text-[var(--app-text-muted)]">{activeComponent.codeConnect.path} · {activeComponent.codeConnect.exportName}</p></div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['design.inspect_code_connect_empty']()}</p>{/if}
          {:else}<p class="text-ui-xs leading-4 text-[var(--app-text-muted)]">{m['design.inspect_component_empty']()}</p>{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><Shapes size={12} />{m['design.inspect_figma_origin']()}</div>
          {#if selected.figmaSource || activeComponent?.figmaSource}<div class="rounded border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-2"><p class="truncate text-ui-xs text-[var(--app-text)]">{figmaLink?.fileName ?? m['design.figma_official']()}</p><p class="mt-1 break-all text-ui-xs text-[var(--app-text-muted)]">{selected.figmaSource?.nodeId ?? activeComponent?.figmaSource?.nodeId}</p></div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['design.inspect_figma_empty']()}</p>{/if}
        </section>

        <section class="space-y-2 border-b border-[var(--app-border)] p-3">
          <div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><FileCode2 size={12} />{m['design.inspect_artifacts']()}</div>
          {#if artifacts.length}<div class="space-y-1">{#each artifacts as artifact (artifact.id)}<div class="rounded border border-[var(--app-border)] px-2 py-1.5"><p class="truncate text-ui-xs text-[var(--app-text)]">{artifact.name}</p><p class="truncate text-ui-xs text-[var(--app-text-muted)]">{artifact.path} · {artifact.framework}</p></div>{/each}</div>{:else}<p class="text-ui-xs text-[var(--app-text-muted)]">{m['design.inspect_artifacts_empty']()}</p>{/if}
        </section>

        <section class="space-y-2 p-3">
          <div class="flex items-center justify-between gap-2"><div class="flex items-center gap-1.5 text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]"><Code2 size={12} />{m['design.css']()}</div><Button variant="ghost" size="icon-sm" class="size-6" aria-label={m['design.inspect_copy_css']()} title={m['design.inspect_copy_css']()} onclick={() => void copyCss()}>{#if copied}<Check size={11} />{:else}<ClipboardCopy size={11} />{/if}</Button></div>
          <pre class="max-h-64 overflow-auto rounded border border-[var(--app-border)] bg-[var(--app-canvas)] p-2 font-mono text-ui-xs leading-4 text-[var(--app-text-soft)]"><code>{css}</code></pre>
        </section>
      {:else}
        <div class="m-3 border border-dashed border-[var(--app-border)] p-3 text-ui-xs leading-4 text-[var(--app-text-muted)]"><Braces size={17} class="mb-2 text-[var(--app-accent)]" />{selectedIds.length > 1 ? m['design.inspect_multiple_selection']({ count: String(selectedIds.length) }) : m['design.inspect_no_selection']()}</div>
      {/if}
    </div>
  {/if}
</div>
