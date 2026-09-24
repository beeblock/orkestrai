<script lang="ts">
  import type { KnowledgeExtraction } from '$lib/modules/agent-room/domain/knowledge.js';
  import * as m from '$lib/paraglide/messages.js';
  let { extraction }: { extraction?: KnowledgeExtraction } = $props();
</script>
{#if extraction}
  {#if extraction.ocrPages.length}
    <p class="my-2 text-xs leading-5 text-[var(--app-text-muted)]" data-testid="document-ocr-summary">{m['knowledge.ocr_summary']({ pages: extraction.ocrPages.length })}</p>
  {/if}
  {#if extraction.issue === 'encrypted'}
    <p role="status" class="my-2 text-xs leading-5 text-[var(--app-warning)]">{m['knowledge.pdf_encrypted']()}</p>
  {:else if extraction.issue === 'timeout' || extraction.issue === 'cancelled'}
    <p role="status" class="my-2 text-xs leading-5 text-[var(--app-warning)]">{m['knowledge.ocr_interrupted']()}</p>
  {/if}
  {#if extraction.failedPages.length || extraction.skippedPages.length}
    <p class="my-2 break-words text-xs leading-5 text-[var(--app-warning)]">{m['knowledge.ocr_incomplete']({ pages: [...new Set([...extraction.failedPages, ...extraction.skippedPages])].sort((a, b) => a - b).join(', ') })}</p>
  {/if}
{/if}
