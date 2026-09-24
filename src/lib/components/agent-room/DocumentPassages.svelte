<script lang="ts">
  import type { KnowledgePassage } from '$lib/modules/agent-room/domain/knowledge.js';
  import * as m from '$lib/paraglide/messages.js';
  let { passages }: { passages: KnowledgePassage[] } = $props();
</script>
{#each passages as passage}
  <section class="mb-4">
    <h4 class="mb-1 break-words font-mono text-xs font-semibold text-[var(--app-text-muted)]">{passage.locator}</h4>
    {#if passage.extraction === 'ocr' || passage.extraction === 'mixed'}
      <p class="mb-1 text-xs text-[var(--app-text-muted)]">{m['knowledge.ocr_passage']({ confidence: passage.confidence ?? 0 })}</p>
    {/if}
    {#if passage.cells}
      <div class="max-w-full overflow-x-auto"><table class="w-full border-collapse text-xs"><thead><tr>{#each passage.cells as cell}<th class="border border-[var(--app-border)] bg-[var(--app-surface-subtle)] p-1.5 text-left font-mono">{cell.address}</th>{/each}</tr></thead><tbody><tr>{#each passage.cells as cell}<td class="min-w-20 max-w-64 break-words border border-[var(--app-border)] p-1.5 align-top">{cell.text}</td>{/each}</tr></tbody></table></div>
    {:else}<p class="whitespace-pre-wrap break-words text-sm leading-6">{passage.text}</p>{/if}
  </section>
{/each}
