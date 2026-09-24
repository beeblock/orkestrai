<script lang="ts">
  import type { KnowledgePassage } from '$lib/modules/agent-room/domain/knowledge.js';
  import * as m from '$lib/paraglide/messages.js';
  let { passages }: { passages: KnowledgePassage[] } = $props();
</script>
<!-- Trechos com o localizador como etiqueta discreta e o texto em corpo legivel. -->
{#each passages as passage}
  <section class="passage">
    <h4 class="passage-locator">{passage.locator}</h4>
    {#if passage.extraction === 'ocr' || passage.extraction === 'mixed'}
      <p class="passage-ocr">{m['knowledge.ocr_passage']({ confidence: passage.confidence ?? 0 })}</p>
    {/if}
    {#if passage.cells}
      <div class="passage-table"><table><thead><tr>{#each passage.cells as cell}<th>{cell.address}</th>{/each}</tr></thead><tbody><tr>{#each passage.cells as cell}<td>{cell.text}</td>{/each}</tr></tbody></table></div>
    {:else}<p class="passage-text">{passage.text}</p>{/if}
  </section>
{/each}

<style>
  .passage {
    margin-bottom: 16px;
  }

  .passage-locator {
    display: inline-flex;
    max-width: 100%;
    margin: 0 0 6px;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--app-hover);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1.6;
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .passage-ocr {
    margin: 0 0 6px;
    color: var(--app-text-muted);
    font-size: 11.5px;
    line-height: 1.45;
  }

  .passage-text {
    margin: 0;
    color: var(--app-text);
    font-size: 13px;
    line-height: 1.65;
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  .passage-table {
    max-width: 100%;
    overflow-x: auto;
    border-radius: 8px;
    box-shadow: var(--app-shadow-border);
  }

  .passage-table table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .passage-table th {
    padding: 6px 8px;
    background: var(--app-surface-subtle);
    color: var(--app-text-muted);
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    text-align: left;
    border-bottom: 1px solid var(--app-border);
  }

  .passage-table th + th,
  .passage-table td + td {
    border-left: 1px solid var(--app-border);
  }

  .passage-table td {
    min-width: 5rem;
    max-width: 16rem;
    padding: 6px 8px;
    color: var(--app-text);
    vertical-align: top;
    overflow-wrap: break-word;
  }
</style>
