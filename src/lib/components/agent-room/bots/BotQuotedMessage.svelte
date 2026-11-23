<script lang="ts">
  import { Button } from '$lib/components/ui/button/index.js';
  import { whatsAppQuoteSchema } from '$lib/modules/agent-room/contracts/schemas/whatsapp-message.schema.js';
  import * as m from '$lib/paraglide/messages.js';
  let { meta }: { meta: Record<string, unknown> } = $props();
  let expanded = $state(false);
  const parsed = $derived(whatsAppQuoteSchema.safeParse(meta.quote));
  const quote = $derived(parsed.success ? parsed.data : null);
</script>
{#if quote}
  <blockquote class="mb-2 rounded-md border-l-2 border-[var(--app-border-strong)] bg-[var(--app-surface)] px-3 py-2 text-xs text-[var(--app-text-muted)]" data-testid="bot-quoted-message">
    <strong class="block text-[var(--app-text)]">{m['bots.quoted_message']()}</strong>
    {#if quote.unavailable}
      <p>{quote.unavailableReason === 'audio_not_ready' ? m['bots.quoted_audio_not_ready']() : m['bots.quoted_unavailable']()}</p>
    {:else if quote.text}
      <p class="whitespace-pre-wrap break-words">{expanded || quote.text.length <= 300 ? quote.text : quote.text.slice(0, 300) + '…'}</p>
      {#if quote.text.length > 300}<Button variant="ghost" size="sm" class="h-auto px-0 py-1" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>{expanded ? m['bots.quoted_less']() : m['bots.quoted_more']()}</Button>{/if}
    {:else}<p>{m['bots.quoted_attachment']()}</p>{/if}
  </blockquote>
{/if}
