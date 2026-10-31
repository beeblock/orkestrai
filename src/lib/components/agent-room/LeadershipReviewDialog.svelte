<script lang="ts">
  import { onMount } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { LoaderCircle } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import type { LeadershipReview } from '$lib/modules/agent-room/contracts/schemas/leadership.schema.js';
  import { leadershipReviewLabel } from './leadership-labels.js';
  import * as m from '$lib/paraglide/messages.js';
  let { workspaceId, reviewId, signal = '', onClose }: { workspaceId: string; reviewId: string; signal?: string; onClose: () => void } = $props();
  let review = $state<LeadershipReview | null>(null);
  let loading = $state(true);
  let error = $state(false);
  let generation = 0;
  async function load() {
    const current = ++generation; loading = true; error = false;
    try {
      const response = await fetch(`/api/agent-room/workspaces/${workspaceId}/leadership`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': getCsrfToken() ?? '' }, body: JSON.stringify({ command: 'review_read', reviewId }) });
      const result = await response.json();
      if (!response.ok) throw new Error();
      if (current === generation) review = result.data;
    } catch { if (current === generation) error = true; }
    finally { if (current === generation) loading = false; }
  }
  $effect(() => { void signal; void reviewId; void workspaceId; void load(); });
  onMount(() => () => { generation++; });
</script>
<Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
  <Dialog.Content class="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
    <Dialog.Header><Dialog.Title>{m['leadership.review_title']()}</Dialog.Title><Dialog.Description>{m['leadership.review_description']()}</Dialog.Description></Dialog.Header>
    {#if loading}<LoaderCircle class="animate-spin" size={18} aria-label={m['leadership.loading']()} />{/if}
    {#if error}<p role="alert" class="text-sm text-destructive">{m['leadership.error']()}</p>{/if}
    {#if review}
      <p class="text-sm font-medium" role="status">{leadershipReviewLabel(review.status)}</p>
      <code class="break-all text-xs text-muted-foreground">{review.revision}</code>
      <div class="grid gap-3">
        {#each [{ label: m['leadership.leader'](), vote: review.leaderVote }, { label: m['leadership.deputy'](), vote: review.deputyVote }] as reviewer}
          <section class="min-w-0 rounded-xl border p-4">
            <h3 class="text-sm font-medium">{reviewer.label}</h3>
            <p class="mt-1 text-xs text-muted-foreground">{!reviewer.vote ? m['leadership.waiting_vote']() : reviewer.vote.decision === 'approve' ? m['leadership.approve']() : m['leadership.changes_requested']()}</p>
            {#if reviewer.vote}
              <h4 class="mt-3 text-xs font-medium">{m['leadership.evidence']()}</h4>
              <ul class="mt-1 list-disc space-y-1 pl-4 text-sm">{#each reviewer.vote.evidence as evidence}<li class="whitespace-pre-wrap break-words">{evidence}</li>{/each}</ul>
              {#if reviewer.vote.findings.length}<h4 class="mt-3 text-xs font-medium text-destructive">{m['leadership.findings']()}</h4><ul class="mt-1 list-disc space-y-1 pl-4 text-sm">{#each reviewer.vote.findings as finding}<li class="whitespace-pre-wrap break-words">{finding}</li>{/each}</ul>{/if}
            {/if}
          </section>
        {/each}
      </div>
      {#if review.artifacts.length}<h3 class="text-xs font-medium">{m['leadership.artifacts']()}</h3><ul class="space-y-1 text-xs text-muted-foreground">{#each review.artifacts as artifact}<li class="break-all">{artifact.kind === 'file' ? artifact.path : artifact.nodeId}</li>{/each}</ul>{/if}
    {/if}
    <Dialog.Footer><Button variant="outline" disabled={loading} onclick={load}>{m['leadership.retry']()}</Button></Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
