<script lang="ts">
  import { LoaderCircle, Paperclip } from '@lucide/svelte';
  import type { ComposerAttachments } from './composer-attachments.svelte.js';
  import * as m from '$lib/paraglide/messages.js';

  /** Picks images, PDFs or any file for a message field; paste and drop work on the field itself. */
  let { attachments, disabled = false, class: className = '' }: { attachments: ComposerAttachments; disabled?: boolean; class?: string } = $props();

  let picker = $state<HTMLInputElement | null>(null);

  function picked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void attachments.addFiles(files);
  }
</script>

<button
  type="button"
  class={className}
  disabled={disabled || attachments.busy}
  aria-label={attachments.busy ? m['composer.attaching']() : m['composer.attach']()}
  title={attachments.busy ? m['composer.attaching']() : m['composer.attach']()}
  onclick={() => picker?.click()}
>
  {#if attachments.busy}<LoaderCircle size={15} class="animate-spin" />{:else}<Paperclip size={15} />{/if}
</button>
<input bind:this={picker} type="file" multiple hidden onchange={picked} />
