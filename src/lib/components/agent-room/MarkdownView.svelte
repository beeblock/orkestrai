<script module lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { createContentCache } from './bounded-content-cache.js';
  import { withWorkspaceImages } from './markdown-images.js';

  const render = (content: string) => {
    const raw = marked.parse(content, { async: false, gfm: true, breaks: true }) as string;
    return DOMPurify.sanitize(raw, { ADD_ATTR: ['target', 'rel', 'checked', 'disabled', 'type', 'class'] })
      .replaceAll('<a href', '<a target="_blank" rel="noopener noreferrer" href');
  };
  const cachedRender = createContentCache(render);

</script>

<script lang="ts">

  type Props = {
    content: string;
    /** compact = tipografia menor (cartoes do kanban). */
    compact?: boolean;
    /** Resolves images that name a file in this workspace. */
    workspaceId?: string | null;
  };

  let { content, compact = false, workspaceId = null }: Props = $props();

  /** markdown -> html sanitizado; links abrem fora, checkboxes editaveis visualmente. */
  const html = $derived(withWorkspaceImages(typeof window === 'undefined' ? render(content ?? '') : cachedRender(content ?? ''), workspaceId));
</script>

<div class="md" class:compact>
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitizado com DOMPurify -->
  {@html html}
</div>

<style>
  .md {
    font-size: var(--md-size, 12.5px);
    line-height: 1.65;
    color: var(--md-text, var(--app-text-soft));
    overflow-wrap: break-word;
  }

  .md.compact {
    font-size: var(--md-size, 11.5px);
    line-height: 1.55;
  }

  .md :global(h1),
  .md :global(h2),
  .md :global(h3),
  .md :global(h4) {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--md-heading, var(--app-text));
    margin: 12px 0 6px;
    text-wrap: balance;
  }

  .md :global(h1) { font-size: var(--md-h1, 16px); }
  .md :global(h2) { font-size: var(--md-h2, 14.5px); }
  .md :global(h3) { font-size: var(--md-h3, 13px); }
  .md :global(h4) { font-size: var(--md-h4, 12px); }

  .md :global(h1:first-child),
  .md :global(h2:first-child),
  .md :global(h3:first-child) {
    margin-top: 0;
  }

  .md :global(p) {
    margin: 0 0 8px;
  }

  .md :global(p:last-child) {
    margin-bottom: 0;
  }

  .md :global(a) {
    color: var(--md-link, var(--app-secondary));
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .md :global(a:hover) {
    color: var(--md-link-hover, color-mix(in srgb, var(--app-secondary) 75%, var(--app-text)));
  }

  .md :global(ul),
  .md :global(ol) {
    margin: 0 0 8px;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .md :global(li > p) {
    margin: 0;
  }

  /* Checkboxes de task list (GFM) */
  .md :global(li input[type='checkbox']) {
    appearance: none;
    width: 13px;
    height: 13px;
    border-radius: 4px;
    border: 1px solid var(--md-check-border, var(--app-border-strong));
    background: transparent;
    vertical-align: -2px;
    margin-right: 6px;
    position: relative;
    pointer-events: none;
  }

  .md :global(li input[type='checkbox']:checked) {
    background: var(--md-check-on, var(--app-accent));
    border-color: var(--md-check-on, var(--app-accent));
  }

  .md :global(li input[type='checkbox']:checked::after) {
    content: '✓';
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: var(--md-check-mark, var(--app-accent-contrast));
  }

  .md :global(li:has(input[type='checkbox'])) {
    list-style: none;
    margin-left: -18px;
  }

  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.9em;
    background: var(--md-code-bg, var(--app-surface-raised));
    border-radius: 5px;
    padding: 1px 5px;
  }

  .md :global(pre) {
    background: var(--md-pre-bg, var(--app-canvas));
    border: 1px solid var(--md-border, var(--app-border));
    border-radius: 10px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 0 0 8px;
  }

  .md :global(pre code) {
    background: transparent;
    padding: 0;
    font-size: 11px;
    line-height: 1.55;
  }

  .md :global(blockquote) {
    margin: 0 0 8px;
    padding: 4px 12px;
    border-left: 3px solid var(--md-quote-accent, var(--app-accent));
    background: var(--md-quote-bg, color-mix(in srgb, var(--app-accent) 8%, transparent));
    border-radius: 0 8px 8px 0;
    color: var(--md-text, var(--app-text-soft));
  }

  .md :global(blockquote p) {
    margin: 0;
  }

  .md :global(table) {
    border-collapse: collapse;
    margin: 0 0 8px;
    font-size: 11.5px;
  }

  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--md-border, var(--app-border));
    padding: 4px 9px;
    text-align: left;
  }

  .md :global(th) {
    background: var(--app-surface-raised);
    font-weight: 600;
    color: var(--app-text);
  }

  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--app-border);
    margin: 10px 0;
  }

  .md :global(img) {
    max-width: 100%;
    border-radius: 8px;
  }

  .md :global(strong) {
    color: var(--app-text);
    font-weight: 600;
  }

  .md :global(del) {
    color: var(--app-text-muted);
  }
</style>
