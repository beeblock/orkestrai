<script lang="ts">
  import { Check, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import * as m from '$lib/paraglide/messages.js';

  type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
  type XmlValue = { name: string; attributes: Array<[string, string]>; text: string; children: XmlValue[] };
  type TreeNode = { path: string; key: string; depth: number; kind: 'object' | 'array' | 'element' | 'value' | 'close'; value?: string; valueKind?: string; count?: number; attributes?: Array<[string, string]> };

  let { body, contentType }: { body: string; contentType: string } = $props();
  let expanded = $state<Set<string>>(new Set(['$']));
  let copied = $state(false);

  const parsed = $derived(parseStructured(body, contentType));
  const rows = $derived(parsed.kind === 'json' ? flattenJson(parsed.value, expanded) : parsed.kind === 'xml' ? flattenXml(parsed.value, expanded) : []);

  function parseStructured(value: string, type: string): { kind: 'json'; value: JsonValue } | { kind: 'xml'; value: XmlValue } | { kind: 'text'; value: string } {
    const trimmed = value.trim();
    if (/json|graphql/i.test(type) || /^[\[{]/.test(trimmed)) {
      try { return { kind: 'json', value: JSON.parse(value) as JsonValue }; } catch { /* Keep malformed JSON inspectable as text. */ }
    }
    if (/xml/i.test(type) || trimmed.startsWith('<?xml') || /^<[^>]+>/.test(trimmed)) {
      try { return { kind: 'xml', value: parseXml(value) }; } catch { /* Keep malformed XML inspectable as text. */ }
    }
    return { kind: 'text', value };
  }

  function parseXml(value: string): XmlValue {
    const document = new DOMParser().parseFromString(value, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('Invalid XML');
    const visit = (element: Element): XmlValue => ({
      name: element.tagName,
      attributes: Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value]),
      text: Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('').trim(),
      children: Array.from(element.children).map(visit),
    });
    return visit(document.documentElement);
  }

  function primitive(value: JsonValue): { value: string; valueKind: string } {
    if (value === null) return { value: 'null', valueKind: 'null' };
    if (typeof value === 'string') return { value: JSON.stringify(value), valueKind: 'string' };
    if (typeof value === 'number') return { value: String(value), valueKind: 'number' };
    if (typeof value === 'boolean') return { value: String(value), valueKind: 'boolean' };
    return { value: '', valueKind: '' };
  }

  function flattenJson(root: JsonValue, open: Set<string>): TreeNode[] {
    const result: TreeNode[] = [];
    const visit = (value: JsonValue, key: string, path: string, depth: number) => {
      if (Array.isArray(value)) {
        result.push({ path, key, depth, kind: 'array', count: value.length });
        if (open.has(path)) {
          value.forEach((entry, index) => visit(entry, String(index), `${path}[${index}]`, depth + 1));
          result.push({ path: `${path}.__close`, key: '', depth, kind: 'close', value: ']' });
        }
      } else if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value);
        result.push({ path, key, depth, kind: 'object', count: entries.length });
        if (open.has(path)) {
          for (const [childKey, entry] of entries) visit(entry, childKey, `${path}.${childKey}`, depth + 1);
          result.push({ path: `${path}.__close`, key: '', depth, kind: 'close', value: '}' });
        }
      } else result.push({ path, key, depth, kind: 'value', ...primitive(value) });
    };
    visit(root, '', '$', 0);
    return result;
  }

  function flattenXml(root: XmlValue, open: Set<string>): TreeNode[] {
    const result: TreeNode[] = [];
    const visit = (value: XmlValue, path: string, depth: number) => {
      result.push({ path, key: value.name, depth, kind: 'element', attributes: value.attributes, count: value.children.length + (value.text ? 1 : 0) });
      if (!open.has(path)) return;
      if (value.text) result.push({ path: `${path}.__text`, key: '', depth: depth + 1, kind: 'value', value: value.text, valueKind: 'string' });
      value.children.forEach((child, index) => visit(child, `${path}.${child.name}[${index}]`, depth + 1));
      result.push({ path: `${path}.__close`, key: value.name, depth, kind: 'close' });
    };
    visit(root, '$', 0);
    return result;
  }

  function toggle(path: string) {
    const next = new Set(expanded);
    if (next.has(path)) next.delete(path); else next.add(path);
    expanded = next;
  }

  function expandAll() {
    const paths = new Set<string>();
    const visit = (value: JsonValue, path: string) => {
      if (value === null || typeof value !== 'object') return;
      paths.add(path);
      if (Array.isArray(value)) value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      else for (const [key, entry] of Object.entries(value)) visit(entry, `${path}.${key}`);
    };
    if (parsed.kind === 'json') visit(parsed.value, '$');
    else if (parsed.kind === 'xml') {
      const visitXml = (value: XmlValue, path: string) => {
        paths.add(path);
        value.children.forEach((child, index) => visitXml(child, `${path}.${child.name}[${index}]`));
      };
      visitXml(parsed.value, '$');
    }
    expanded = paths;
  }

  async function copyBody() {
    await navigator.clipboard.writeText(body);
    copied = true;
    setTimeout(() => (copied = false), 1_500);
  }
</script>

<div class="api-viewer min-h-36 overflow-hidden">
  <div class="api-viewer-head">
    <span class="section-label">{parsed.kind === 'json' ? 'JSON' : parsed.kind === 'xml' ? 'XML' : m['api_client.response_text']()}</span>
    <div class="flex items-center gap-0.5">
      {#if parsed.kind === 'json' || parsed.kind === 'xml'}
        <Button size="icon-sm" variant="ghost" class="size-[26px] text-[var(--app-text-muted)]" title={m['api_client.expand_all']()} aria-label={m['api_client.expand_all']()} onclick={expandAll}><ChevronsUpDown size={13} /></Button>
        <Button size="icon-sm" variant="ghost" class="size-[26px] text-[var(--app-text-muted)]" title={m['api_client.collapse_all']()} aria-label={m['api_client.collapse_all']()} onclick={() => (expanded = new Set())}><ChevronsDownUp size={13} /></Button>
      {/if}
      <Button size="icon-sm" variant="ghost" class="size-[26px] text-[var(--app-text-muted)]" title={m['api_client.copy_response']()} aria-label={m['api_client.copy_response']()} onclick={() => void copyBody()}>
        <span class="copy-swap" class:copied aria-hidden="true"><Copy size={13} class="copy-icon" /><Check size={13} class="check-icon" /></span>
      </Button>
    </div>
  </div>
  {#if parsed.kind === 'json' || parsed.kind === 'xml'}
    <div class="api-viewer-tree max-h-[420px] overflow-auto py-1.5" role="tree" aria-label={m['api_client.structured_response']()}>
      {#each rows as row (row.path)}
        <div class="api-viewer-row" style={`padding-left:${6 + row.depth * 16}px`} role="treeitem" aria-selected="false" aria-expanded={row.kind === 'value' ? undefined : expanded.has(row.path)}>
          {#if row.kind !== 'value' && row.kind !== 'close'}
            <button class="api-viewer-toggle" aria-label={expanded.has(row.path) ? m['api_client.collapse_item']() : m['api_client.expand_item']()} onclick={() => toggle(row.path)}><span class="chevron" class:open={expanded.has(row.path)}><ChevronRight size={11} /></span></button>
          {:else}<span class="block size-5 shrink-0"></span>{/if}
          {#if row.key && row.kind !== 'element' && row.kind !== 'close'}<span class="syn-key">{JSON.stringify(row.key)}</span><span class="syn-punct mr-1">:</span>{/if}
          {#if row.kind === 'object'}<span class="syn-punct">{'{'}<span class="syn-count">{row.count} {m['api_client.response_items']()}</span>{expanded.has(row.path) ? '' : ' }'}</span>
          {:else if row.kind === 'array'}<span class="syn-punct">[<span class="syn-count">{row.count} {m['api_client.response_items']()}</span>{expanded.has(row.path) ? '' : ' ]'}</span>
          {:else if row.kind === 'element'}<span class="syn-tag">&lt;{row.key}{#each row.attributes ?? [] as attribute} <span class="syn-attr">{attribute[0]}</span>=<span class="syn-string">{JSON.stringify(attribute[1])}</span>{/each}&gt;{expanded.has(row.path) ? '' : `…</${row.key}>`}</span>
          {:else if row.kind === 'close'}<span class="syn-punct">{parsed.kind === 'xml' ? `</${row.key}>` : row.value}</span>
          {:else}<span class="syn-value whitespace-pre-wrap break-all" data-kind={row.valueKind}>{row.value}</span>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <pre class="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11.5px] leading-5 text-[var(--app-text)]">{parsed.value}</pre>
  {/if}
</div>

<style>
  /* Moldura do visualizador: elevacao por sombra (anel de 1px do tema). */
  .api-viewer {
    border-radius: 8px;
    background: var(--app-canvas);
    box-shadow: var(--app-shadow-border);
  }

  .api-viewer-head {
    display: flex;
    height: 34px;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px 0 10px;
    border-bottom: 1px solid var(--app-border);
    background: var(--app-surface-subtle);
  }

  .api-viewer-tree {
    font-family: var(--font-mono);
    font-size: 11.5px;
    line-height: 20px;
  }

  .api-viewer-row {
    display: flex;
    min-width: max-content;
    align-items: flex-start;
    padding-right: 12px;
  }

  .api-viewer-row:hover {
    background: var(--app-hover);
  }

  .api-viewer-toggle {
    display: grid;
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--app-text-muted);
    cursor: pointer;
  }

  .api-viewer-toggle:hover {
    color: var(--app-text);
  }

  .api-viewer-toggle:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -1px;
  }

  .chevron {
    display: grid;
    transition: transform var(--duration-quick) var(--ease-smooth-out);
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  /*
   * Sintaxe a partir dos tokens do tema (os mesmos do editor de codigo), para
   * acompanhar qualquer tema do app. O violeta nasce da mistura info+perigo.
   */
  .api-viewer {
    --syn-key: var(--app-info);
    --syn-string: var(--app-success);
    --syn-number: var(--app-warning);
    --syn-literal: color-mix(in oklch, var(--app-info), var(--app-danger));
  }

  .syn-key,
  .syn-tag {
    color: var(--syn-key);
  }

  .syn-attr {
    color: var(--syn-literal);
  }

  .syn-string,
  .syn-value[data-kind='string'] {
    color: var(--syn-string);
  }

  .syn-value[data-kind='number'] {
    color: var(--syn-number);
  }

  .syn-value[data-kind='boolean'] {
    color: var(--syn-literal);
  }

  .syn-value[data-kind='null'],
  .syn-count {
    color: var(--app-text-muted);
  }

  .syn-punct {
    color: var(--app-text-soft);
  }

  .syn-count {
    margin-left: 4px;
  }

  /* Copiar -> confirmado: troca cruzada de icones (opacidade, escala, blur). */
  .copy-swap {
    position: relative;
    display: grid;
    width: 13px;
    height: 13px;
  }

  .copy-swap :global(svg) {
    position: absolute;
    inset: 0;
    transition: opacity var(--duration-fast) cubic-bezier(0.2, 0, 0, 1), scale var(--duration-fast) cubic-bezier(0.2, 0, 0, 1), filter var(--duration-fast) cubic-bezier(0.2, 0, 0, 1);
  }

  .copy-swap :global(.check-icon) {
    color: var(--app-success);
    opacity: 0;
    scale: 0.25;
    filter: blur(4px);
  }

  .copy-swap.copied :global(.copy-icon) {
    opacity: 0;
    scale: 0.25;
    filter: blur(4px);
  }

  .copy-swap.copied :global(.check-icon) {
    opacity: 1;
    scale: 1;
    filter: blur(0);
  }
</style>
