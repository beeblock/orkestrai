<script lang="ts">
  import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy } from '@lucide/svelte';
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

<div class="min-h-36 overflow-hidden rounded border border-[var(--app-border)] bg-[var(--app-canvas)]">
  <div class="flex h-8 items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] px-2">
    <span class="text-ui-xs font-semibold uppercase text-[var(--app-text-muted)]">{parsed.kind === 'json' ? 'JSON' : parsed.kind === 'xml' ? 'XML' : m['api_client.response_text']()}</span>
    <div class="flex items-center gap-1">
      {#if parsed.kind === 'json' || parsed.kind === 'xml'}
        <Button size="icon-sm" variant="ghost" class="size-6" title={m['api_client.expand_all']()} aria-label={m['api_client.expand_all']()} onclick={expandAll}><ChevronsUpDown size={12} /></Button>
        <Button size="icon-sm" variant="ghost" class="size-6" title={m['api_client.collapse_all']()} aria-label={m['api_client.collapse_all']()} onclick={() => (expanded = new Set())}><ChevronsDownUp size={12} /></Button>
      {/if}
      <Button size="icon-sm" variant="ghost" class="size-6" title={m['api_client.copy_response']()} aria-label={m['api_client.copy_response']()} onclick={() => void copyBody()}>{#if copied}<Check size={12} />{:else}<Copy size={12} />{/if}</Button>
    </div>
  </div>
  {#if parsed.kind === 'json' || parsed.kind === 'xml'}
    <div class="max-h-[420px] overflow-auto py-1 font-mono text-ui-xs leading-5" role="tree" aria-label={m['api_client.structured_response']()}>
      {#each rows as row (row.path)}
        <div class="flex min-w-max items-start pr-3 hover:bg-[var(--app-surface-raised)]" style={`padding-left:${6 + row.depth * 16}px`} role="treeitem" aria-selected="false" aria-expanded={row.kind === 'value' ? undefined : expanded.has(row.path)}>
          {#if row.kind !== 'value' && row.kind !== 'close'}
            <button class="grid size-5 shrink-0 place-items-center text-[var(--app-text-muted)]" aria-label={expanded.has(row.path) ? m['api_client.collapse_item']() : m['api_client.expand_item']()} onclick={() => toggle(row.path)}>{#if expanded.has(row.path)}<ChevronDown size={11} />{:else}<ChevronRight size={11} />{/if}</button>
          {:else}<span class="block size-5 shrink-0"></span>{/if}
          {#if row.key && row.kind !== 'element' && row.kind !== 'close'}<span class="text-sky-600 dark:text-sky-400">{JSON.stringify(row.key)}</span><span class="mr-1 text-[var(--app-text-muted)]">:</span>{/if}
          {#if row.kind === 'object'}<span class="text-[var(--app-text-soft)]">{'{'}<span class="ml-1 text-[var(--app-text-muted)]">{row.count} {m['api_client.response_items']()}</span>{expanded.has(row.path) ? '' : ' }'}</span>
          {:else if row.kind === 'array'}<span class="text-[var(--app-text-soft)]">[<span class="ml-1 text-[var(--app-text-muted)]">{row.count} {m['api_client.response_items']()}</span>{expanded.has(row.path) ? '' : ' ]'}</span>
          {:else if row.kind === 'element'}<span class="text-sky-600 dark:text-sky-400">&lt;{row.key}{#each row.attributes ?? [] as attribute} <span class="text-violet-600 dark:text-violet-400">{attribute[0]}</span>=<span class="text-emerald-600 dark:text-emerald-400">{JSON.stringify(attribute[1])}</span>{/each}&gt;{expanded.has(row.path) ? '' : `…</${row.key}>`}</span>
          {:else if row.kind === 'close'}<span class="text-[var(--app-text-soft)]">{parsed.kind === 'xml' ? `</${row.key}>` : row.value}</span>
          {:else}<span class:text-emerald-600={row.valueKind === 'string'} class:text-amber-600={row.valueKind === 'number'} class:text-violet-600={row.valueKind === 'boolean'} class:text-[var(--app-text-muted)]={row.valueKind === 'null'} class="whitespace-pre-wrap break-all dark:brightness-125">{row.value}</span>{/if}
        </div>
      {/each}
    </div>
  {:else}
    <pre class="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-ui-xs leading-5 text-[var(--app-text)]">{parsed.value}</pre>
  {/if}
</div>
