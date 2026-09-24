<script lang="ts">
  import { onMount } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { Compartment, EditorState } from '@codemirror/state';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { EditorView } from '@codemirror/view';
  import { javascript } from '@codemirror/lang-javascript';
  import { json } from '@codemirror/lang-json';
  import { xml } from '@codemirror/lang-xml';
  import { graphql } from 'cm6-graphql';
  import { tags } from '@lezer/highlight';
  import { AlertCircle, Braces, Check, WandSparkles, WrapText } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { apiClientCompletionExtension, type ApiCodeCompletionProfile } from './api-code-completions.js';
  import * as m from '$lib/paraglide/messages.js';

  type Language = 'json' | 'javascript' | 'graphql' | 'xml' | 'text';
  let {
    value,
    language = 'text',
    label,
    minHeight = 180,
    completionProfile = 'none',
    onchange,
    onblur,
  }: {
    value: string;
    language?: Language;
    label: string;
    minHeight?: number;
    completionProfile?: ApiCodeCompletionProfile;
    onchange?: (value: string) => void;
    onblur?: () => void;
  } = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | null = null;
  let wrap = $state(true);
  let formatting = $state(false);
  let formatted = $state(false);
  let formatError = $state('');
  const languageCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const wrapCompartment = new Compartment();

  function languageExtension(kind: Language, profile: ApiCodeCompletionProfile) {
    if (kind === 'json') return json();
    if (kind === 'javascript') return [javascript(), apiClientCompletionExtension(profile)];
    if (kind === 'graphql') return graphql();
    if (kind === 'xml') return xml();
    return [];
  }

  function editorTheme() {
    const dark = document.documentElement.classList.contains('dark');
    // Cores de sintaxe derivadas dos tokens do tema (as mesmas do visualizador
    // de resposta), para acompanhar qualquer tema em vez de hex fixos.
    const literal = 'color-mix(in oklch, var(--app-info), var(--app-danger))';
    const highlight = HighlightStyle.define([
      { tag: [tags.keyword, tags.bool, tags.null], color: literal },
      { tag: [tags.string, tags.special(tags.string)], color: 'var(--app-success)' },
      { tag: [tags.number, tags.integer, tags.float], color: 'var(--app-warning)' },
      { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--app-info)' },
      { tag: [tags.typeName, tags.className, tags.namespace], color: 'color-mix(in oklch, var(--app-info), var(--app-success))' },
      { tag: [tags.propertyName, tags.attributeName], color: 'var(--app-info)' },
      { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--app-text-muted)', fontStyle: 'italic' },
      { tag: [tags.operator, tags.punctuation, tags.bracket], color: 'var(--app-text-soft)' },
      { tag: [tags.invalid], color: 'var(--app-danger)', textDecoration: 'underline' },
    ]);
    return [
      EditorView.theme({
        '&': { color: 'var(--app-text)', backgroundColor: 'var(--app-canvas)' },
        '.cm-content': { caretColor: 'var(--app-accent)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--app-accent)' },
        '.cm-gutters': { backgroundColor: 'var(--app-surface-subtle)', color: 'var(--app-text-muted)', border: 'none' },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--app-surface-raised)' },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--app-accent-soft) !important' },
        '.cm-panels': { backgroundColor: 'var(--app-surface-subtle)', color: 'var(--app-text)' },
        '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--app-border)' },
        '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--app-warning) 28%, transparent)' },
        '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--app-accent) 38%, transparent)' },
        '.cm-tooltip-autocomplete': { border: 'none', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--app-surface-raised)', boxShadow: 'var(--app-shadow-overlay)' },
        '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-mono)', fontSize: '11.5px', maxHeight: 'min(320px, 45vh)', padding: '4px' },
        '.cm-tooltip-autocomplete > ul > li': { padding: '4px 8px', borderRadius: '5px', color: 'var(--app-text)' },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--app-accent-soft)', color: 'var(--app-text)' },
        '.cm-completionDetail': { color: 'var(--app-text-muted)', fontStyle: 'normal', marginLeft: '12px' },
      }, { dark }),
      syntaxHighlighting(highlight),
    ];
  }

  function prettyXml(source: string): string {
    const document = new DOMParser().parseFromString(source, 'application/xml');
    if (document.querySelector('parsererror')) throw new Error(m['api_client.format_invalid_xml']());
    const serialized = new XMLSerializer().serializeToString(document);
    let depth = 0;
    return serialized.replace(/>\s*</g, '><').replace(/(<\/?[^>]+>)/g, '$1\n').trim().split('\n').map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
      const output = `${'  '.repeat(depth)}${line}`;
      if (/^<[^!?/][^>]*[^/]>/i.test(line) && !/<\/[^>]+>$/.test(line)) depth += 1;
      return output;
    }).join('\n');
  }

  async function formatCode() {
    if (!view || !view.state.doc.length || formatting) return;
    formatting = true;
    formatError = '';
    try {
      const source = view.state.doc.toString();
      let next = source;
      if (language === 'json') next = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
      else if (language === 'xml') next = prettyXml(source);
      else if (language === 'javascript') {
        const [{ format }, babel, estree] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/babel'), import('prettier/plugins/estree')]);
        next = await format(source, { parser: 'babel', plugins: [babel.default, estree.default], printWidth: 100, singleQuote: true });
      } else if (language === 'graphql') {
        const [{ format }, graphqlPlugin] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/graphql')]);
        next = await format(source, { parser: 'graphql', plugins: [graphqlPlugin.default], printWidth: 100 });
      }
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
      formatted = true;
      setTimeout(() => (formatted = false), 1_500);
    } catch (error) {
      formatError = error instanceof Error ? error.message : m['api_client.format_failed']();
    } finally {
      formatting = false;
    }
  }

  function toggleWrap() {
    wrap = !wrap;
    view?.dispatch({ effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }

  $effect(() => {
    const next = value;
    if (view && view.state.doc.toString() !== next) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
  });

  $effect(() => {
    const next = language;
    const profile = completionProfile;
    view?.dispatch({ effects: languageCompartment.reconfigure(languageExtension(next, profile)) });
  });

  onMount(() => {
    if (!host) return;
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageCompartment.of(languageExtension(language, completionProfile)),
          themeCompartment.of(editorTheme()),
          wrapCompartment.of(EditorView.lineWrapping),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onchange?.(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({ blur: () => { onblur?.(); return false; } }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '11.5px' },
            '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
            '.cm-content': { padding: '8px 0' },
            '.cm-line': { padding: '0 10px' },
          }),
        ],
      }),
    });
    const observer = new MutationObserver(() => view?.dispatch({ effects: themeCompartment.reconfigure(editorTheme()) }));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-app-theme'] });
    return () => { observer.disconnect(); view?.destroy(); view = null; };
  });
</script>

<div class="code-frame flex h-full min-h-0 flex-col overflow-hidden">
  <div class="flex h-[34px] items-center justify-between gap-2 border-b border-[var(--app-border)] bg-[var(--app-surface-subtle)] pl-2.5 pr-1">
    <span class="flex min-w-0 items-center gap-1.5 text-[var(--app-text-muted)]"><Braces size={12} class="shrink-0" aria-hidden="true" /><span class="section-label truncate">{label}</span><span class="code-lang">{language}</span></span>
    <div class="flex min-w-0 items-center gap-0.5">
      {#if formatError}<span class="flex min-w-0 max-w-52 items-center gap-1 text-[11.5px] text-[var(--app-danger)]" title={formatError} role="status"><AlertCircle size={12} class="shrink-0" aria-hidden="true" /><span class="truncate">{formatError}</span></span>{/if}
      <Button size="icon-sm" variant="ghost" class="size-[26px] text-[var(--app-text-muted)] aria-pressed:bg-[var(--app-active)] aria-pressed:text-[var(--app-text)]" aria-pressed={wrap} title={m['api_client.toggle_wrap']()} aria-label={m['api_client.toggle_wrap']()} onclick={toggleWrap}><WrapText size={13} /></Button>
      {#if language !== 'text'}<Button size="icon-sm" variant="ghost" class="size-[26px] text-[var(--app-text-muted)]" disabled={formatting} title={m['api_client.format_code']()} aria-label={m['api_client.format_code']()} onclick={() => void formatCode()}>{#if formatted}<Check size={13} class="text-[var(--app-success)]" />{:else}<WandSparkles size={13} />{/if}</Button>{/if}
    </div>
  </div>
  <div class="nodrag nowheel min-h-0 flex-1" bind:this={host} style={`min-height:${minHeight}px`} aria-label={label}></div>
</div>

<style>
  /* Moldura: anel de 1px do tema em repouso; o foco acende o acento. */
  .code-frame {
    border-radius: 8px;
    background: var(--app-canvas);
    box-shadow: var(--app-shadow-border);
    transition: box-shadow var(--duration-quick) ease-out;
  }

  .code-frame:focus-within {
    box-shadow: 0 0 0 1px var(--app-accent), 0 0 0 3px color-mix(in srgb, var(--app-accent) 16%, transparent);
  }

  .code-lang {
    flex-shrink: 0;
    padding: 0 6px;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 18px;
  }
</style>
