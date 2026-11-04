<script lang="ts">
  import { FolderOpen, LoaderCircle } from '@lucide/svelte';
  import { getCsrfToken } from '@beeblock/svelar/http';
  import { toast } from 'svelte-sonner';
  import * as m from '$lib/paraglide/messages.js';
  import HeaderIconButton from './HeaderIconButton.svelte';

  let { workspaceId, path }: { workspaceId: string; path: string | null | undefined } = $props();
  let busy = $state(false);

  async function reveal() {
    if (!path || busy) return;
    busy = true;
    try {
      const token = getCsrfToken();
      const response = await fetch(`/api/agent-room/workspaces/${encodeURIComponent(workspaceId)}/fs/open-folder`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { 'X-CSRF-Token': token } : {}) },
        body: JSON.stringify({ path, select: true }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error('File reveal failed.');
    } catch { toast.error(m['node.reveal_source_error']()); }
    finally { busy = false; }
  }
</script>

{#if path}
  <span class="contents" data-testid="node-reveal-source">
  <HeaderIconButton class="node-action-btn" label={m['node.reveal_source']()} disabled={busy} onclick={() => void reveal()}>
    {#if busy}<LoaderCircle size={13} class="animate-spin" aria-hidden="true" />{:else}<FolderOpen size={13} aria-hidden="true" />{/if}
  </HeaderIconButton>
  </span>
{/if}
