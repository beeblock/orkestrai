<script lang="ts">
  import { ScanText, TriangleAlert } from '@lucide/svelte';
  import type { KnowledgeExtraction } from '$lib/modules/agent-room/domain/knowledge.js';
  import * as m from '$lib/paraglide/messages.js';
  let { extraction }: { extraction?: KnowledgeExtraction } = $props();
</script>
<!-- Avisos de extracao como faixas com icone: informativo (OCR) neutro, problemas em alerta. -->
{#if extraction}
  {#if extraction.ocrPages.length}
    <p class="doc-notice" data-testid="document-ocr-summary"><ScanText size={13} aria-hidden="true" /><span>{m['knowledge.ocr_summary']({ pages: extraction.ocrPages.length })}</span></p>
  {/if}
  {#if extraction.issue === 'encrypted'}
    <p role="status" class="doc-notice warning"><TriangleAlert size={13} aria-hidden="true" /><span>{m['knowledge.pdf_encrypted']()}</span></p>
  {:else if extraction.issue === 'timeout' || extraction.issue === 'cancelled'}
    <p role="status" class="doc-notice warning"><TriangleAlert size={13} aria-hidden="true" /><span>{m['knowledge.ocr_interrupted']()}</span></p>
  {/if}
  {#if extraction.failedPages.length || extraction.skippedPages.length}
    <p class="doc-notice warning"><TriangleAlert size={13} aria-hidden="true" /><span class="break-words">{m['knowledge.ocr_incomplete']({ pages: [...new Set([...extraction.failedPages, ...extraction.skippedPages])].sort((a, b) => a - b).join(', ') })}</span></p>
  {/if}
{/if}

<style>
  .doc-notice {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 0 0 8px;
    padding: 7px 10px;
    border-radius: 8px;
    background: var(--app-hover);
    color: var(--app-text-soft);
    font-size: 12px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .doc-notice :global(svg) {
    flex-shrink: 0;
    margin-top: 2px;
    color: var(--app-text-muted);
  }

  .doc-notice.warning {
    background: var(--app-warning-soft);
    color: var(--app-text);
  }

  .doc-notice.warning :global(svg) {
    color: var(--app-warning);
  }
</style>
